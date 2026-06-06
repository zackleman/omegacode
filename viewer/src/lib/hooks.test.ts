import { describe, expect, it } from "vitest"

import {
  bufferLiveness,
  chunkLiveness,
  isResumedReplay,
  mergeRunStatus,
  quietStreamClosable,
  STREAM_QUIET_MS,
  tailLiveness,
} from "./hooks"
import { foldEvents } from "./fold"
import type { ChatChunk, WorkflowEvent } from "./types"

describe("isResumedReplay (H17: reconnect must not duplicate or drop the buffer)", () => {
  // Regression: reconnects replayed the whole file from byte 0 and the client never reset, so
  // laptop sleep / server restart visibly duplicated the entire transcript. With no id frames the
  // first frame of a connection must trigger a reset.
  it("treats a connection with no id frames as a replay (reset)", () => {
    expect(isResumedReplay(null, "")).toBe(false)
    expect(isResumedReplay(1024, "")).toBe(false)
  })

  it("treats the very first connection as a replay (nothing buffered, reset is a no-op)", () => {
    expect(isResumedReplay(null, "0")).toBe(false)
    expect(isResumedReplay(null, "512")).toBe(false)
  })

  // The server half of H17 adds byte-offset id: frames and honors Last-Event-ID. When it resumes
  // mid-stream, resetting would DROP everything buffered before the reconnect — it must not.
  it("treats a monotonically advancing byte offset as a resume (keep buffer)", () => {
    expect(isResumedReplay(1024, "1100")).toBe(true)
    expect(isResumedReplay(0, "57")).toBe(true)
  })

  it("treats a rewound or repeated offset as a replay from scratch (reset)", () => {
    expect(isResumedReplay(1024, "57")).toBe(false)
    expect(isResumedReplay(1024, "1024")).toBe(false)
    expect(isResumedReplay(1024, "0")).toBe(false)
  })

  it("treats a non-numeric id as a replay (reset, fail-safe against duplication)", () => {
    expect(isResumedReplay(1024, "abc")).toBe(false)
  })
})

describe("mergeRunStatus (H18/H19: server deadman vs local fold)", () => {
  // Regression (H19): the client fold can't see the heartbeat file, so a SIGKILLed run folded to a
  // perpetual "started". The server's stale/terminal verdict must override a live-looking fold.
  it("lets a terminal server status override a still-started fold", () => {
    expect(mergeRunStatus("started", "stale")).toBe("stale")
    expect(mergeRunStatus("started", "completed")).toBe("completed")
    expect(mergeRunStatus("started", "failed")).toBe("failed")
    expect(mergeRunStatus("started", "interrupted")).toBe("interrupted")
  })

  // Regression (H18): a resumed run appends a fresh "started" after the prior terminal event; the
  // fold (which sees the freshest events) must win over a lagging non-terminal server status.
  it("keeps the folded status when the server status is non-terminal", () => {
    expect(mergeRunStatus("started", "started")).toBe("started")
    expect(mergeRunStatus("completed", "started")).toBe("completed")
    expect(mergeRunStatus("started", "unknown")).toBe("started")
  })

  it("keeps an already-terminal folded status (no double-override)", () => {
    expect(mergeRunStatus("completed", "stale")).toBe("completed")
    expect(mergeRunStatus("failed", "completed")).toBe("failed")
  })

  it("keeps the folded status with no server answer yet", () => {
    expect(mergeRunStatus("started", null)).toBe("started")
    expect(mergeRunStatus("completed", null)).toBe("completed")
  })

  // Regression (H19 rejection): staleness is the server's call — a "stale" on the folded side can
  // only echo an older server verdict (the events file never contains one), so a fresher server
  // answer must replace it. The rejected fix let a client-guessed "stale" beat the server's
  // "started", dead-ending a healthy run as "stale (run died)" with no path back.
  it("lets the server's live verdict replace a stale fold", () => {
    expect(mergeRunStatus("stale", "started")).toBe("started")
  })

  it("lets a definitive server terminal replace a stale fold (resume that finished between polls)", () => {
    expect(mergeRunStatus("stale", "completed")).toBe("completed")
    expect(mergeRunStatus("stale", "failed")).toBe("failed")
  })

  it("keeps stale when the server has nothing fresher to say", () => {
    expect(mergeRunStatus("stale", "stale")).toBe("stale")
    expect(mergeRunStatus("stale", "unknown")).toBe("stale")
    expect(mergeRunStatus("stale", null)).toBe("stale")
  })
})

describe("tailLiveness (H19: the tail latch keys off the FOLDED status, never the merged one)", () => {
  it("keeps the tail open while the fold is non-terminal", () => {
    expect(tailLiveness("started")).toBe(true)
    expect(tailLiveness("unknown")).toBe(true)
  })

  it("closes the tail once the fold goes terminal (run-end event delivered ⇒ replay complete)", () => {
    expect(tailLiveness("completed")).toBe(false)
    expect(tailLiveness("failed")).toBe(false)
    expect(tailLiveness("interrupted")).toBe(false)
  })

  // Regression (H19 rejection): mid-replay of a large finished run, the poll's "completed" lands
  // while frames are still in flight. The MERGED status is terminal (display it), but the latch
  // must stay open — latching off the merged status severed the EventSource mid-replay and froze
  // the agent list at a truncated backlog.
  it("stays open mid-replay even when the merged status is already terminal", () => {
    const folded: WorkflowEvent[] = [{ type: "run", t: 1_000_000, status: "started" }]
    const snap = foldEvents("run-123", folded)
    expect(mergeRunStatus(snap.status, "completed")).toBe("completed") // shown to the user
    expect(tailLiveness(snap.status)).toBe(true) // but the replay keeps streaming
  })

  // The reviewer's healthy-but-quiet repro, end to end at the pure layer: a live run whose newest
  // event is arbitrarily old folds "started", the server poll agrees, and the tail stays open.
  it("keeps a live-but-quiet run open (no event for > the stale window)", () => {
    const events: WorkflowEvent[] = [
      { type: "run", t: 1_000_000, status: "started" },
      { type: "agent", t: 1_005_000, index: 0, label: "a", provider: "codex", state: "running" },
    ]
    const snap = foldEvents("run-123", events) // folded long after t=1_005_000 — no clock input exists
    expect(mergeRunStatus(snap.status, "started")).toBe("started")
    expect(tailLiveness(snap.status)).toBe(true)
  })
})

describe("quietStreamClosable (H19: a server-terminal verdict never closes a draining replay)", () => {
  it("defers the close while frames are still arriving", () => {
    const now = 1_000_000
    expect(quietStreamClosable(now - 10, now)).toBe(false)
    expect(quietStreamClosable(now - (STREAM_QUIET_MS - 1), now)).toBe(false)
  })

  it("allows the close once the stream has been quiet for the window", () => {
    const now = 1_000_000
    expect(quietStreamClosable(now - STREAM_QUIET_MS, now)).toBe(true)
    expect(quietStreamClosable(now - STREAM_QUIET_MS * 10, now)).toBe(true)
  })

  it("respects a custom quiet window", () => {
    expect(quietStreamClosable(900, 1000, 50)).toBe(true)
    expect(quietStreamClosable(990, 1000, 50)).toBe(false)
  })
})

describe("chunkLiveness (H18: terminal-status latch must re-arm)", () => {
  const status = (state: "running" | "done" | "failed"): ChatChunk => ({ t: 1, kind: "status", state })

  it("latches off on a terminal status chunk", () => {
    expect(chunkLiveness(status("done"))).toBe(false)
    expect(chunkLiveness(status("failed"))).toBe(false)
  })

  // Regression: `--resume` appends a fresh "running" status to the same transcript file; the old
  // code latched live=false permanently so the page never showed the resumed execution.
  it("re-arms on a running status chunk", () => {
    expect(chunkLiveness(status("running"))).toBe(true)
  })

  it("leaves the latch untouched for non-status chunks", () => {
    expect(chunkLiveness({ t: 1, kind: "text", text: "hi" })).toBeNull()
    expect(chunkLiveness({ t: 1, kind: "reasoning", text: "hmm" })).toBeNull()
    expect(chunkLiveness({ t: 1, kind: "tool", name: "Bash", input: "ls" })).toBeNull()
    expect(chunkLiveness({ t: 1, kind: "tool-result", output: "ok" })).toBeNull()
    expect(chunkLiveness({ t: 1, kind: "meta", index: 0, label: "a", provider: "codex", prompt: "p" })).toBeNull()
  })

  it("models the full resume sequence: replay → done → resumed running → done", () => {
    const seq: Array<boolean | null> = [
      chunkLiveness({ t: 1, kind: "text", text: "old attempt" }),
      chunkLiveness(status("done")),
      chunkLiveness(status("running")),
      chunkLiveness({ t: 4, kind: "text", text: "resumed attempt" }),
      chunkLiveness(status("done")),
    ]
    let live = true
    const states: boolean[] = []
    for (const s of seq) {
      if (s !== null) live = s
      states.push(live)
    }
    expect(states).toEqual([true, false, true, true, false])
  })
})

describe("bufferLiveness (H18: latch from the latest status, not per-chunk)", () => {
  const status = (state: "running" | "done" | "failed"): ChatChunk => ({ t: 1, kind: "status", state })
  const text = (t: string): ChatChunk => ({ t: 1, kind: "text", text: t })

  it("returns null when no status chunk exists yet", () => {
    expect(bufferLiveness([])).toBeNull()
    expect(bufferLiveness([text("a"), text("b")])).toBeNull()
  })

  // Regression: latching off on the prior attempt's mid-replay "done" closed the EventSource
  // before the resumed attempt's frames were delivered. The buffer's LATEST status must win.
  it("stays live when a replay contains done-then-running (resumed run)", () => {
    expect(bufferLiveness([text("old"), status("done"), status("running"), text("new")])).toBe(true)
  })

  it("latches off when the latest status is terminal", () => {
    expect(bufferLiveness([text("old"), status("running"), text("x"), status("done")])).toBe(false)
    expect(bufferLiveness([status("running"), status("failed")])).toBe(false)
  })

  it("ignores trailing non-status chunks when finding the latest status", () => {
    expect(bufferLiveness([status("done"), text("stray log line")])).toBe(false)
  })
})
