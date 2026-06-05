import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { foldEvents } from "./fold"
import { type ChatChunk, isTerminalRun, type RunSnapshot, type RunSummary, type WorkflowEvent } from "./types"

/** Subscribe to an SSE endpoint; pass `url = null` to close. Auto-reconnects (EventSource default). */
function useSse(url: string | null, onMessage: (data: unknown) => void): void {
  const cb = useRef(onMessage)
  cb.current = onMessage
  useEffect(() => {
    if (!url) return
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        cb.current(JSON.parse(e.data))
      } catch {
        // ignore malformed frame
      }
    }
    return () => es.close()
  }, [url])
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

/** Live run snapshot: fold the events SSE (replay + tail); stops when the run is terminal. */
export function useRunStream(runId: string | null): RunSnapshot | null {
  const [snap, setSnap] = useState<RunSnapshot | null>(null)
  const [live, setLive] = useState(true)
  const events = useRef<WorkflowEvent[]>([])

  useEffect(() => {
    events.current = []
    setSnap(null)
    setLive(true)
  }, [runId])

  const url = runId && live ? `/api/runs/${encodeURIComponent(runId)}/stream` : null
  useSse(url, (data) => {
    if (!runId) return
    events.current.push(data as WorkflowEvent)
    const folded = foldEvents(runId, events.current)
    setSnap(folded)
    if (isTerminalRun(folded.status)) setLive(false)
  })

  return snap
}

/** Live agent transcript: the chat-feed chunks SSE (replay + tail); stops on a terminal status. */
export function useAgentStream(runId: string | null, index: number | null): { chunks: ChatChunk[]; live: boolean } {
  const [chunks, setChunks] = useState<ChatChunk[]>([])
  const [live, setLive] = useState(true)
  const ref = useRef<ChatChunk[]>([])

  useEffect(() => {
    ref.current = []
    setChunks([])
    setLive(true)
  }, [runId, index])

  const url = runId && index != null && live ? `/api/runs/${encodeURIComponent(runId)}/agents/${index}/stream` : null
  useSse(url, (data) => {
    const c = data as ChatChunk
    ref.current = [...ref.current, c]
    setChunks(ref.current)
    if (c.kind === "status" && (c.state === "done" || c.state === "failed")) setLive(false)
  })

  return { chunks, live }
}
