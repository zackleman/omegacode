// Client-side port of serve.ts's foldSnapshot: fold a run's WorkflowEvent stream into a RunSnapshot.
// The SSE stream replays all events then tails, so the viewer folds incrementally off the same data.

import type { AgentSnapshot, PhaseSnapshot, RunSnapshot, RunStatus, WorkflowEvent } from "./types"

export function foldEvents(runId: string, events: WorkflowEvent[]): RunSnapshot {
  const agentByIndex = new Map<number, AgentSnapshot>()
  const phaseByIndex = new Map<number, PhaseSnapshot>()
  const logs: Array<{ t: number; message: string }> = []
  let status: RunStatus = "unknown"
  let startedAt: number | undefined
  let endedAt: number | undefined
  let workflowFile: string | undefined
  let error: string | undefined

  for (const ev of events) {
    switch (ev.type) {
      case "run": {
        if (ev.status === "started") {
          status = "started"
          if (startedAt === undefined) startedAt = ev.t
          if (ev.workflowFile) workflowFile = ev.workflowFile
        } else {
          status = ev.status
          endedAt = ev.t
          if (ev.error) error = ev.error
        }
        break
      }
      case "phase": {
        const existing = phaseByIndex.get(ev.index)
        if (existing) existing.title = ev.title
        else phaseByIndex.set(ev.index, { index: ev.index, title: ev.title, agents: [] })
        break
      }
      case "agent": {
        const prev = agentByIndex.get(ev.index)
        agentByIndex.set(ev.index, {
          index: ev.index,
          phaseIndex: ev.phaseIndex ?? prev?.phaseIndex,
          phaseTitle: ev.phaseTitle ?? prev?.phaseTitle,
          label: ev.label ?? prev?.label ?? "",
          provider: ev.provider ?? prev?.provider ?? "codex",
          model: ev.model ?? prev?.model,
          state: ev.state,
          cached: ev.cached ?? prev?.cached,
          durationMs: ev.durationMs ?? prev?.durationMs,
          inputTokens: ev.inputTokens ?? prev?.inputTokens,
          outputTokens: ev.outputTokens ?? prev?.outputTokens,
          costUsd: ev.costUsd ?? prev?.costUsd,
          lastTool: ev.lastTool ?? prev?.lastTool,
          promptPreview: ev.promptPreview ?? prev?.promptPreview,
          resultPreview: ev.resultPreview ?? prev?.resultPreview,
          error: ev.error ?? prev?.error,
          t: ev.t,
        })
        break
      }
      case "log":
        logs.push({ t: ev.t, message: ev.message })
        break
    }
  }

  const agents = [...agentByIndex.values()].sort((a, b) => a.index - b.index)
  for (const a of agents) {
    if (a.phaseIndex !== undefined && !phaseByIndex.has(a.phaseIndex)) {
      phaseByIndex.set(a.phaseIndex, { index: a.phaseIndex, title: a.phaseTitle ?? `Phase ${a.phaseIndex}`, agents: [] })
    }
  }
  for (const a of agents) {
    if (a.phaseIndex !== undefined) phaseByIndex.get(a.phaseIndex)?.agents.push(a)
  }
  const phases = [...phaseByIndex.values()].sort((p, q) => p.index - q.index)
  for (const p of phases) p.agents.sort((a, b) => a.index - b.index)

  const base = workflowFile ? (workflowFile.split("/").pop() ?? "") : undefined
  const name = base?.replace(/\.workflow\.[cm]?[jt]s$/i, "").replace(/\.[cm]?[jt]s$/i, "")

  return { runId, status, name, workflowFile, error, startedAt, endedAt, phases, agents, logs }
}
