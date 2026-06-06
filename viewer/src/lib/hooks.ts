import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { foldEvents } from "./fold"
import {
  type AgentState,
  type ChatChunk,
  isTerminalRun,
  type RunSnapshot,
  type RunStatus,
  type RunSummary,
  type WorkflowEvent,
} from "./types"

/**
 * The server's deadman window (serve.ts STALE_MS): a "started" run whose heartbeat file is older
 * than this is dead. The client never judges staleness itself — heartbeats live in a file the
 * event stream doesn't carry, and a healthy run routinely goes longer than this between events
 * (H19) — this constant only paces the poll that fetches the server's verdict.
 */
export const STALE_MS = 20_000

/**
 * How long the events SSE must be frame-free before a server-terminal verdict may close it. A
 * (re)connect replays the whole backlog, so a poll answering "stale"/"completed" mid-replay must
 * not sever the EventSource with frames still in flight — replay bursts arrive with millisecond
 * gaps, so a stream this quiet has drained.
 */
export const STREAM_QUIET_MS = 2_000

/**
 * Merge the locally-folded run status with the server's authoritative snapshot status. The server
 * runs the heartbeat deadman the client's event stream can't see, so staleness is always the
 * server's call (H19): its terminal/stale verdict overrides a live-looking fold, and any fresher
 * verdict (a resume's "started", a definitive "completed") replaces a previously-overlaid "stale" —
 * the events file never contains one, so a stale fold only ever echoes an older server answer.
 * Otherwise the fold (which sees the freshest events) wins — including a resume's fresh "started"
 * after a prior terminal event (H18).
 */
export function mergeRunStatus(folded: RunStatus, server: RunStatus | null): RunStatus {
  if (!server) return folded
  if (folded === "stale" && server !== "unknown") return server
  return isTerminalRun(server) && !isTerminalRun(folded) ? server : folded
}

/**
 * Whether the events tail should stay open after a refold — keyed off the FOLDED status, never
 * the merged one. A run-end event is the last line of the events file, so a terminal fold means
 * the replay is fully delivered and the tail can close; the merged status can go terminal while
 * frames are still in flight (a poll's "completed"/"stale" landing mid-replay) and closing on it
 * would freeze the agent list at a truncated replay (H19). A resumed run's fresh "started"
 * re-arms the tail (H18). Deadman-stale runs never fold terminal (their run-end event was never
 * written) — useRunStream's quiet-close handles those once the stream drains.
 */
export function tailLiveness(folded: RunStatus): boolean {
  return !isTerminalRun(folded)
}

/**
 * Whether a server-terminal verdict may close the events tail yet: only once the stream has been
 * quiet for `quietMs` — never mid-replay (frames still arriving keep deferring the close).
 */
export function quietStreamClosable(lastFrameAt: number, now: number, quietMs: number = STREAM_QUIET_MS): boolean {
  return now - lastFrameAt >= quietMs
}

/**
 * Liveness transition carried by an agent chunk: `false` latches the stream off on a terminal
 * status, `true` re-arms it (a resumed run appends a fresh "running" to the same transcript, H18),
 * `null` leaves the latch untouched.
 */
export function chunkLiveness(c: ChatChunk): boolean | null {
  if (c.kind !== "status") return null
  if (c.state === "done" || c.state === "failed") return false
  if (c.state === "running") return true
  return null
}

/**
 * Liveness of the whole accumulated transcript: the latest status chunk wins. Latching per-chunk
 * would close the EventSource on a mid-replay terminal status from a *prior* attempt, dropping the
 * resumed attempt's frames still in flight — the latch must consider the full buffer (H18).
 */
export function bufferLiveness(chunks: ChatChunk[]): boolean | null {
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    const l = chunkLiveness(chunks[i]!)
    if (l !== null) return l
  }
  return null
}

/**
 * Reconnect epoch detection (H17). After a drop (laptop sleep / server restart) the server either
 * replays the file from byte 0 — duplicating everything we already buffered — or honors the
 * Last-Event-ID byte offset and resumes. The first frame after a (re)connect tells us which: a
 * monotonically advancing numeric id means resume (keep the buffer); anything else — no id frames,
 * a non-numeric id, or an offset at/behind what we've seen — means replay (reset the buffer).
 */
export function isResumedReplay(lastSeenId: number | null, firstFrameId: string): boolean {
  if (lastSeenId === null || firstFrameId === "") return false
  const id = Number(firstFrameId)
  return Number.isFinite(id) && id > lastSeenId
}

interface SseHandlers {
  onMessage: (data: unknown) => void
  // Fired on (re)connect — including EventSource's automatic reconnect after a drop.
  onOpen?: () => void
  // Fired before the first frame of a connection whose data restarts from byte 0 (H17): consumers
  // drop accumulated buffers here so a replay isn't appended onto what they already hold. Not
  // fired when the server honored Last-Event-ID and resumed mid-stream.
  onReset?: () => void
}

/** Subscribe to an SSE endpoint; pass `url = null` to close. Auto-reconnects (EventSource default). */
function useSse(url: string | null, handlers: SseHandlers): void {
  const cb = useRef(handlers)
  cb.current = handlers
  useEffect(() => {
    if (!url) return
    const es = new EventSource(url)
    let lastSeenId: number | null = null
    let firstFrame = true
    es.onopen = () => {
      firstFrame = true
      cb.current.onOpen?.()
    }
    es.onmessage = (e) => {
      if (firstFrame) {
        firstFrame = false
        if (!isResumedReplay(lastSeenId, e.lastEventId)) cb.current.onReset?.()
      }
      const id = Number(e.lastEventId)
      if (e.lastEventId !== "" && Number.isFinite(id)) lastSeenId = id
      try {
        cb.current.onMessage(JSON.parse(e.data))
      } catch {
        // ignore malformed frame
      }
    }
    return () => es.close()
  }, [url])
}

/**
 * Coalesce a high-frequency callback to one invocation per animation frame. The SSE replay can
 * deliver thousands of historical frames synchronously; folding + re-rendering per frame is O(n²)
 * and freezes the tab (M27). We accumulate during a burst and flush once per frame instead.
 */
function useAnimationFrameFlush(flush: () => void): () => void {
  const flushRef = useRef(flush)
  flushRef.current = flush
  const scheduled = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (scheduled.current !== null) cancelAnimationFrame(scheduled.current)
    }
  }, [])
  return () => {
    if (scheduled.current !== null) return
    scheduled.current = requestAnimationFrame(() => {
      scheduled.current = null
      flushRef.current()
    })
  }
}

/** Run list — polled (the list is the one surface without a watch stream). */
export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: async (): Promise<RunSummary[]> => {
      const r = await fetch("/api/runs")
      if (!r.ok) throw new Error(`runs ${r.status}`)
      return r.json()
    },
    refetchInterval: 4000,
  })
}

/**
 * Poll the single-run snapshot endpoint. The server's foldSnapshot runs the authoritative
 * heartbeat deadman, so this surfaces "stale" to the detail view the same way the run list gets
 * it — a SIGKILLed run stops rendering a live spinner (H19). It keeps polling after the run goes
 * terminal too: that's the only signal an open page has that a `--resume` re-started the run once
 * the SSE latch closed the stream (H18). Returns the server status, or null with no answer yet.
 */
function useRunStatusPoll(runId: string | null): RunStatus | null {
  const { data } = useQuery({
    queryKey: ["run-status", runId],
    enabled: runId != null,
    queryFn: async (): Promise<RunSnapshot> => {
      const r = await fetch(`/api/runs/${encodeURIComponent(runId!)}`)
      if (!r.ok) throw new Error(`run ${r.status}`)
      return r.json()
    },
    // Poll a little finer than the deadman window so a freshly-dead run flips promptly.
    refetchInterval: Math.max(4000, Math.floor(STALE_MS / 2)),
  })
  return data?.status ?? null
}

/** Live run snapshot: fold the events SSE (replay + tail); stops when the run is terminal. */
export function useRunStream(runId: string | null): RunSnapshot | null {
  const [snap, setSnap] = useState<RunSnapshot | null>(null)
  const [live, setLive] = useState(true)
  const events = useRef<WorkflowEvent[]>([])
  // When the last SSE frame arrived — the quiet-close effect's "is the replay drained?" signal.
  // Stamped on mount/run-change (below) and on open/message, all before any poll verdict can land.
  const lastFrameAt = useRef(0)

  useEffect(() => {
    events.current = []
    lastFrameAt.current = Date.now()
    setSnap(null)
    setLive(true)
  }, [runId])

  // Overlay the server's deadman: poll the snapshot so the detail view learns a SIGKILLed run is
  // stale (H19) and a resumed run is started again (H18).
  const serverStatus = useRunStatusPoll(runId)
  const serverStatusRef = useRef<RunStatus | null>(serverStatus)
  serverStatusRef.current = serverStatus

  const refold = () => {
    if (!runId) return
    const folded = foldEvents(runId, events.current)
    setSnap({ ...folded, status: mergeRunStatus(folded.status, serverStatusRef.current) })
    // Latch the tail off the FOLDED status, not the merged one: a terminal fold means the run-end
    // event (the file's last line) is delivered, so the replay is complete — whereas a server
    // verdict landing mid-replay must not sever the stream with frames still in flight (H19).
    // Don't permanently latch off either: a resumed run appends a fresh "started" to the same
    // file, so the latest folded status re-arms liveness (H18).
    setLive(tailLiveness(folded.status))
  }
  const scheduleRefold = useAnimationFrameFlush(refold)

  const url = runId && live ? `/api/runs/${encodeURIComponent(runId)}/stream` : null
  useSse(url, {
    onOpen: () => {
      // A (re)connect is about to replay; restart the quiet clock so it can't close under us.
      lastFrameAt.current = Date.now()
    },
    onReset: () => {
      // Reconnect replays from the start; drop the accumulated stream so we don't double-fold (H17).
      events.current = []
    },
    onMessage: (data) => {
      if (!runId) return
      lastFrameAt.current = Date.now()
      events.current.push(data as WorkflowEvent)
      scheduleRefold()
    },
  })

  // A terminal server status should land even if no further SSE frame arrives — the deadman fires
  // on a SIGKILL where the stream just goes quiet, so no refold would ever carry it (H19). And the
  // reverse: a non-terminal server status after we latched off means a `--resume` appended to the
  // same events file — re-open the stream and let the replay refold it (H18).
  useEffect(() => {
    if (!serverStatus || !runId) return
    if (isTerminalRun(serverStatus)) {
      setSnap((prev) => (prev ? { ...prev, status: mergeRunStatus(prev.status, serverStatus) } : prev))
    } else if (serverStatus === "started") {
      setLive(true)
    }
  }, [serverStatus, runId])

  // Quiet-close: a deadman-stale run never gets a run-end event, so refold would hold its tail
  // open forever. Once the server's verdict is terminal AND the stream has drained (no frame for
  // STREAM_QUIET_MS), close it — for idle-shutdown of an auto-started viewer. Checking quietness
  // (instead of closing on the verdict itself) keeps a mid-replay poll answer from truncating a
  // large run's backlog (H19); a completed run's tail usually closes earlier via the folded
  // run-end event.
  useEffect(() => {
    if (!runId || !live || !serverStatus || !isTerminalRun(serverStatus)) return
    const timer = setInterval(() => {
      if (quietStreamClosable(lastFrameAt.current, Date.now())) setLive(false)
    }, STREAM_QUIET_MS)
    return () => clearInterval(timer)
  }, [serverStatus, runId, live])

  return snap
}

/**
 * Live agent transcript: the chat-feed chunks SSE (replay + tail); stops on a terminal status.
 * `agentState` is the agent's state from the run fold — when a resumed run re-runs this agent it
 * flips back to "running" while our latch is off and the stream is closed, so it re-opens it (H18).
 */
export function useAgentStream(
  runId: string | null,
  index: number | null,
  agentState?: AgentState,
): { chunks: ChatChunk[]; live: boolean } {
  const [chunks, setChunks] = useState<ChatChunk[]>([])
  const [live, setLive] = useState(true)
  const ref = useRef<ChatChunk[]>([])

  useEffect(() => {
    ref.current = []
    setChunks([])
    setLive(true)
  }, [runId, index])

  // Re-arm only on a fresh transition into "running" (H18). The buffers are not cleared here —
  // onOpen does that when the stream actually reopens, so an already-live stream is unaffected.
  const prevState = useRef<AgentState | undefined>(undefined)
  useEffect(() => {
    const was = prevState.current
    prevState.current = agentState
    if (agentState === "running" && was !== "running") setLive(true)
  }, [agentState])

  const flush = () => {
    setChunks(ref.current)
    // Latch from the latest status in the buffer, not per-chunk: a prior attempt's mid-replay
    // "done" must not close the stream before the resumed attempt's frames land (H18).
    const liveness = bufferLiveness(ref.current)
    if (liveness !== null) setLive(liveness)
  }
  const scheduleFlush = useAnimationFrameFlush(flush)

  const url = runId && index != null && live ? `/api/runs/${encodeURIComponent(runId)}/agents/${index}/stream` : null
  useSse(url, {
    onReset: () => {
      // The connection's data restarts from byte 0; reset so the transcript isn't duplicated (H17).
      ref.current = []
    },
    onOpen: () => {
      // Re-arm liveness: a resumed run appends to the same file, so a prior attempt's terminal
      // status must not latch the page closed (H18). The replay's own latest status re-settles it.
      setLive(true)
    },
    onMessage: (data) => {
      const c = data as ChatChunk
      ref.current = [...ref.current, c]
      scheduleFlush()
    },
  })

  return { chunks, live }
}
