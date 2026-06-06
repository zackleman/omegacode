// @vitest-environment jsdom
//
// Behavioral tests for useRunStream and useAgentStream — the layer where H19's first fix went
// wrong. The pure pieces (foldEvents, mergeRunStatus, tailLiveness, bufferLiveness) each passed
// their unit tests while the COMPOSITION misfired: the hook fed the fold a wall clock but no
// heartbeat, folded healthy-but-quiet runs to "stale", and latched the stream off with no path
// back. These tests drive the real hooks with a fake EventSource + stubbed snapshot poll so a
// composition regression fails here, not in review.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentStream, useRunStream } from "./hooks"
import type { AgentState, ChatChunk, WorkflowEvent } from "./types"

// RTL can't auto-register its act environment/cleanup without vitest globals.
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

class FakeEventSource {
  static instances: FakeEventSource[] = []
  static get last(): FakeEventSource {
    const es = FakeEventSource.instances.at(-1)
    if (!es) throw new Error("no EventSource was opened")
    return es
  }
  url: string
  closed = false
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: string; lastEventId: string }) => void) | null = null
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  close(): void {
    this.closed = true
  }
  open(): void {
    this.onopen?.({})
  }
  emit(data: unknown, lastEventId = ""): void {
    if (this.closed) return
    this.onmessage?.({ data: JSON.stringify(data), lastEventId })
  }
}

// Deterministic rAF: queue callbacks, flush on demand (the hook coalesces refolds per frame, M27).
let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = []
let rafId = 0
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
  rafQueue.push({ id: ++rafId, cb })
  return rafId
})
vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
  rafQueue = rafQueue.filter((r) => r.id !== id)
})
const flushRaf = (): void => {
  const q = rafQueue
  rafQueue = []
  for (const { cb } of q) cb(0)
}

// Snapshot poll stub: whatever /api/runs/:id should answer right now.
let serverSnapshot: { status: string } = { status: "started" }
vi.stubGlobal("EventSource", FakeEventSource)
vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ ok: true, json: async () => serverSnapshot })),
)

function setup(runId: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children)
  const view = renderHook(() => useRunStream(runId), { wrapper })
  return { qc, view }
}

/**
 * Let the snapshot poll resolve and its effects run. A single macrotask raced react-query's
 * notifyManager — the success notification lands on its own scheduled batch, so one setTimeout(0)
 * sometimes returned before the hook ever saw the data (flaked under full-suite load). Poll the
 * query cache until no fetch is in flight (bounded), then yield one more turn for the batched
 * notification + subscriber effects to flush; by then the notify timer is already queued ahead of
 * ours, so the extra turn is deterministic, not a sleep.
 */
const settle = (qc: QueryClient) =>
  act(async () => {
    const deadline = Date.now() + 5_000
    while (qc.isFetching() > 0) {
      if (Date.now() > deadline) throw new Error("snapshot poll never settled")
      await new Promise((r) => setTimeout(r, 0))
    }
    await new Promise((r) => setTimeout(r, 0))
  })

const runStarted = (t: number): WorkflowEvent => ({ type: "run", t, status: "started" })
const runDone = (t: number): WorkflowEvent => ({ type: "run", t, status: "completed" })
const agentRunning = (t: number, index = 0): WorkflowEvent => ({
  type: "agent",
  t,
  index,
  label: `agent-${index}`,
  provider: "codex",
  state: "running",
})

beforeEach(() => {
  FakeEventSource.instances = []
  rafQueue = []
  serverSnapshot = { status: "started" }
})

afterEach(() => cleanup())

describe("useRunStream (H19 rejection regressions)", () => {
  // THE rejected-fix repro: a healthy live run whose newest event is older than the stale window
  // (any long Bash/tool gap — routine). The old client deadman keyed staleness off event
  // timestamps, folded "stale", mergeRunStatus kept it over the server's "started", setLive(false)
  // closed the stream, and the re-arm effect never fired (the polled value never changed). The
  // run must stay "started" with its tail open — the server, which stats the heartbeat file,
  // says it is alive.
  it("keeps a live-but-quiet run started with the stream open", async () => {
    serverSnapshot = { status: "started" }
    const { qc, view } = setup("r-quiet")
    const es = FakeEventSource.last
    await settle(qc)
    act(() => {
      es.open()
      es.emit(runStarted(Date.now() - 120_000))
      es.emit(agentRunning(Date.now() - 90_000)) // newest event: 90s ago, far past the stale window
      flushRaf()
    })
    expect(view.result.current?.status).toBe("started")
    expect(view.result.current?.agents).toHaveLength(1)
    expect(es.closed).toBe(false)
  })

  // The original H19: a SIGKILLed run's stream just goes quiet — no terminal event ever arrives.
  // The server poll (heartbeat deadman) is the authority; its "stale" verdict must land on the
  // snapshot without needing another SSE frame.
  it("overlays the server's stale verdict on a dead run", async () => {
    serverSnapshot = { status: "stale" }
    const { qc, view } = setup("r-dead")
    const es = FakeEventSource.last
    act(() => {
      es.open()
      es.emit(runStarted(Date.now() - 120_000))
      es.emit(agentRunning(Date.now() - 90_000))
      flushRaf()
    })
    await settle(qc)
    expect(view.result.current?.status).toBe("stale")
    // The replayed agents survive — the verdict overlays the status, it doesn't sever the stream.
    expect(view.result.current?.agents).toHaveLength(1)
  })

  // Rejected-fix failure mode #2: the poll's terminal verdict landing mid-replay of a large
  // finished run closed the EventSource with frames still in flight, freezing the agent list at
  // a truncated backlog. The tail latch must key off the FOLDED status (run-end event delivered
  // ⇒ replay complete), not the merged one.
  it("does not sever a replay when the poll's terminal verdict lands mid-replay", async () => {
    serverSnapshot = { status: "completed" }
    const { qc, view } = setup("r-big")
    const es = FakeEventSource.last
    await settle(qc) // poll answers "completed" before the replay finishes
    act(() => {
      es.open()
      es.emit(runStarted(1_000_000))
      es.emit(agentRunning(1_001_000, 0))
      flushRaf()
    })
    // Merged status already shows the server's verdict, but the replay must keep streaming.
    expect(view.result.current?.status).toBe("completed")
    expect(es.closed).toBe(false)
    act(() => {
      es.emit(agentRunning(1_002_000, 1))
      es.emit(runDone(1_003_000)) // the file's last line — replay is now complete
      flushRaf()
    })
    expect(view.result.current?.agents).toHaveLength(2)
    expect(view.result.current?.status).toBe("completed")
    expect(es.closed).toBe(true) // folded terminal ⇒ safe to close the tail
  })

  // H18 × H19: after the tail latches off on a terminal fold, a `--resume` flips the server
  // status back to "started" — the only signal the page gets — and must re-open the stream.
  it("re-opens the stream when a resume flips the server status back to started", async () => {
    serverSnapshot = { status: "completed" }
    const { qc, view } = setup("r-resume")
    const es1 = FakeEventSource.last
    await settle(qc)
    act(() => {
      es1.open()
      es1.emit(runStarted(1_000_000))
      es1.emit(runDone(1_001_000))
      flushRaf()
    })
    expect(es1.closed).toBe(true)
    serverSnapshot = { status: "started" }
    await act(async () => await qc.invalidateQueries())
    await settle(qc) // react-query batches the data notification past the refetch promise
    expect(FakeEventSource.instances).toHaveLength(2)
    const es2 = FakeEventSource.last
    act(() => {
      es2.open()
      es2.emit(runStarted(1_000_000))
      es2.emit(runDone(1_001_000))
      es2.emit(runStarted(1_002_000)) // the resume appended a fresh "started"
      flushRaf()
    })
    expect(view.result.current?.status).toBe("started")
    expect(es2.closed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// useAgentStream — the agent-transcript twin of useRunStream. The H18 re-arm was previously
// covered only via the pure helpers (chunkLiveness/bufferLiveness); these drive the hook itself:
// the latch, the buffer-level (not per-chunk) liveness, the agent-state re-arm, and the H17 reset.
// ---------------------------------------------------------------------------

function setupAgentStream(runId: string, index: number, initialState?: AgentState) {
  return renderHook(({ state }: { state?: AgentState }) => useAgentStream(runId, index, state), {
    initialProps: { state: initialState },
  })
}

const chunkMeta = (t: number): ChatChunk => ({ t, kind: "meta", index: 0, label: "agent-0", provider: "codex", prompt: "do the thing" })
const chunkText = (t: number, text: string): ChatChunk => ({ t, kind: "text", text })
const chunkStatus = (t: number, state: "running" | "done" | "failed"): ChatChunk => ({ t, kind: "status", state })

describe("useAgentStream (H18 re-arm / H17 reset, dom-level)", () => {
  it("latches the stream off on a terminal status and keeps the transcript", () => {
    const view = setupAgentStream("r1", 0, "running")
    const es = FakeEventSource.last
    act(() => {
      es.open()
      es.emit(chunkMeta(1))
      es.emit(chunkStatus(2, "running"))
      es.emit(chunkText(3, "hello"))
      es.emit(chunkStatus(4, "done"))
      flushRaf()
    })
    expect(view.result.current.live).toBe(false)
    expect(es.closed).toBe(true) // terminal ⇒ EventSource released (idle shutdown depends on this)
    expect(view.result.current.chunks).toHaveLength(4) // ...but the transcript stays rendered
  })

  // The H18 latch must consider the full buffer, not latch per-chunk: a resumed run appends to the
  // same transcript file, so a replay carries the PRIOR attempt's "done" mid-stream. Closing on it
  // would drop the resumed attempt's frames still in flight.
  it("does not sever a replay on a prior attempt's mid-replay terminal status", () => {
    const view = setupAgentStream("r1", 0, "running")
    const es = FakeEventSource.last
    act(() => {
      es.open()
      es.emit(chunkMeta(1))
      es.emit(chunkStatus(2, "done")) // prior attempt's terminal status
      es.emit(chunkStatus(3, "running")) // the resumed attempt, same file
      es.emit(chunkText(4, "resumed work"))
      flushRaf()
    })
    expect(view.result.current.live).toBe(true)
    expect(es.closed).toBe(false)
    expect(view.result.current.chunks).toHaveLength(4)
  })

  // The original H18: the page latched off on "done", then a `--resume` re-ran this agent. The
  // only signal the closed page gets is the run fold flipping the agent back to "running" — that
  // transition must re-open the stream and replay the appended transcript.
  it("re-opens the stream when the run fold flips the agent back to running", () => {
    const view = setupAgentStream("r1", 0, "done")
    const es1 = FakeEventSource.last
    act(() => {
      es1.open()
      es1.emit(chunkMeta(1))
      es1.emit(chunkStatus(2, "done"))
      flushRaf()
    })
    expect(view.result.current.live).toBe(false)
    expect(es1.closed).toBe(true)

    view.rerender({ state: "running" }) // the resumed run's fold re-runs this agent
    expect(FakeEventSource.instances).toHaveLength(2)
    const es2 = FakeEventSource.last
    act(() => {
      es2.open()
      es2.emit(chunkMeta(1))
      es2.emit(chunkStatus(2, "done"))
      es2.emit(chunkStatus(3, "running")) // the resume appended a fresh "running"
      es2.emit(chunkText(4, "second attempt"))
      flushRaf()
    })
    expect(view.result.current.live).toBe(true)
    expect(es2.closed).toBe(false)
    expect(view.result.current.chunks).toHaveLength(4)
  })

  // H17: a reconnect with no id frames replays the file from byte 0 — the buffer must reset so the
  // transcript isn't duplicated onto what was already folded.
  it("resets the buffer when a reconnect replays from byte 0", () => {
    const view = setupAgentStream("r1", 0, "running")
    const es = FakeEventSource.last
    act(() => {
      es.open()
      es.emit(chunkMeta(1))
      es.emit(chunkText(2, "hello"))
      flushRaf()
    })
    expect(view.result.current.chunks).toHaveLength(2)
    act(() => {
      es.open() // EventSource auto-reconnect re-fires onopen on the same instance
      es.emit(chunkMeta(1))
      es.emit(chunkText(2, "hello"))
      es.emit(chunkText(3, "more"))
      flushRaf()
    })
    expect(view.result.current.chunks).toHaveLength(3) // replaced, not appended (would be 5)
  })
})
