// Trimmed port of bb's ThreadEventItem model
// (packages/domain/src/provider-event.ts). Only the item variants the
// omegacode viewer materializes from a `ChatChunk[]` transcript are
// kept; bb's provider/system envelope events, zod schemas, and
// background-task/web/plan variants were dropped since the viewer drives the
// leaf timeline components directly rather than through the full event
// projection.

export type ThreadEventItemStatus = "pending" | "completed" | "failed" | "interrupted"

export type ThreadEventFileChangeKind = "add" | "delete" | "update"

export interface ThreadEventFileChange {
  path: string
  kind: ThreadEventFileChangeKind
  movePath?: string
  diff?: string
}

export interface ThreadEventUserMessageItem {
  type: "userMessage"
  id: string
  text: string
}

export interface ThreadEventAgentMessageItem {
  type: "agentMessage"
  id: string
  text: string
}

export interface ThreadEventReasoningItem {
  type: "reasoning"
  id: string
  summary: string[]
  content: string[]
}

export interface ThreadEventCommandExecutionItem {
  type: "commandExecution"
  id: string
  command: string
  cwd: string
  status: ThreadEventItemStatus
  /** Omitted when the process produced no stdout/stderr. */
  aggregatedOutput?: string
  exitCode?: number
  durationMs?: number
}

export interface ThreadEventFileChangeItem {
  type: "fileChange"
  id: string
  changes: ThreadEventFileChange[]
  status: ThreadEventItemStatus
}

export interface ThreadEventToolCallItem {
  type: "toolCall"
  id: string
  server?: string
  tool: string
  arguments?: Record<string, unknown>
  status: ThreadEventItemStatus
  result?: unknown
  error?: string
}

export type ThreadEventItem =
  | ThreadEventUserMessageItem
  | ThreadEventAgentMessageItem
  | ThreadEventReasoningItem
  | ThreadEventCommandExecutionItem
  | ThreadEventFileChangeItem
  | ThreadEventToolCallItem

export type ThreadEventItemType = ThreadEventItem["type"]

export type ThreadRuntimeDisplayStatus = "idle" | "working" | "thinking"
