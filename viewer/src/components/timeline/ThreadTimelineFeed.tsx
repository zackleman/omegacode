// Driver that renders a `ThreadEventItem[]` through bb's leaf timeline
// components. This stands in for bb's ThreadTimelineRows / TimelineRowView /
// TimelineExpandableBody routing: it walks the items, builds a row title per
// item kind, and renders each leaf body through the ported bb components
// (TerminalOutputBlock, ToolCallDetailBlock, TimelineFileDiffBlock,
// ConversationMessageContent, ExpandableTimelineRow, TimelineWorkingIndicator).
//
// bb's full projection (build-thread-timeline → buildTimelineViewRows → rich
// TimelineTitle segments, turn/bundle grouping, lazy turn-detail queries, jotai
// layout atoms, realtime client) is too coupled to the bb app to lift wholesale
// — so per the port plan's fallback, the rendering primitives are bb's actual
// components, driven by this per-chunk loop.
import { Fragment, useMemo, type ReactNode } from "react"
import type { ThreadEventItem } from "@/lib/thread-events"
import {
  getFileChangeAction,
  getFileChangeActionPastTense,
  getFileChangeDiffStats,
  fileNameFromPath,
} from "@/lib/thread-view/file-change-summary"
import { cn } from "@/lib/utils"
import { AutoHeightContainer } from "@/components/ui/height-transition"
import { DiffStatsTally } from "@/components/ui/diff-stats-tally"
import { Icon, type IconName } from "@/components/ui/icon"
import { ConversationMessageContent } from "./ConversationMessageContent"
import { ExpandableTimelineRow } from "./ExpandableTimelineRow"
import { TerminalOutputBlock } from "./TerminalOutputBlock"
import { ToolCallDetailBlock } from "./ToolCallDetailBlock"
import { TimelineFileDiffBlock } from "./TimelineFileDiffBlock"
import { TimelineWorkingIndicator } from "./TimelineWorkingIndicator"

const NESTED_ROWS_GROUP_LINE_CLASS = "relative my-0"

export interface ThreadTimelineFeedProps {
  items: ThreadEventItem[]
  /** Live runs auto-expand the active (last) row and stream its output. */
  streaming?: boolean
  workspaceRootPath?: string
  /** Shown as the trailing working indicator while the run is in progress. */
  workingLabel?: string
  showWorking?: boolean
  workingIsThinking?: boolean
}

interface RowTitleProps {
  icon?: IconName
  verb?: string
  text: ReactNode
  trailing?: ReactNode
  mono?: boolean
}

function RowTitle({ icon, verb, text, trailing, mono }: RowTitleProps) {
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", mono && "font-mono text-xs")}>
      {icon ? <Icon name={icon} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
      {verb ? <span className="shrink-0 text-foreground">{verb}</span> : null}
      <span className="min-w-0 truncate">{text}</span>
      {trailing ? <span className="ml-1 shrink-0">{trailing}</span> : null}
    </span>
  )
}

function commandTitleText(command: string): string {
  // First non-empty line is the row title; the body holds the full command.
  const line = command.split("\n").find((l) => l.trim().length > 0) ?? command
  return line.trim()
}

function fileChangeActionIcon(action: ReturnType<typeof getFileChangeAction>): IconName {
  switch (action) {
    case "created":
      return "FilePlus"
    case "deleted":
      return "Trash2"
    case "renamed":
      return "FileText"
    case "edited":
      return "FileDiff"
  }
}

interface TimelineItemRowProps {
  item: ThreadEventItem
  autoExpanded: boolean
  streaming: boolean
  workspaceRootPath?: string
}

function TimelineItemRow({ item, autoExpanded, streaming, workspaceRootPath }: TimelineItemRowProps) {
  switch (item.type) {
    case "userMessage":
      return <ConversationMessageContent role="user" text={item.text} />

    case "agentMessage":
      return <ConversationMessageContent role="assistant" text={item.text} />

    case "reasoning": {
      const detail = item.content.join("\n\n") || item.summary.join("\n")
      return (
        <ExpandableTimelineRow
          title={<RowTitle text="Thought" />}
          tone="summary"
          autoExpanded={autoExpanded}
          renderBody={() => (
            <div className="whitespace-pre-wrap text-sm italic leading-relaxed text-muted-foreground">{detail}</div>
          )}
        />
      )
    }

    case "commandExecution": {
      const pending = item.status === "pending"
      const output = item.aggregatedOutput ?? ""
      const exitCode = item.status === "pending" ? null : (item.exitCode ?? null)
      return (
        <ExpandableTimelineRow
          title={
            <RowTitle
              icon="Terminal"
              text={<span className="font-mono text-xs">{commandTitleText(item.command) || "command"}</span>}
              trailing={
                item.status === "failed" ? (
                  <Icon name="CircleX" className="size-3.5 text-destructive" aria-hidden />
                ) : null
              }
            />
          }
          autoExpanded={autoExpanded}
          renderBody={() => (
            <TerminalOutputBlock commandLine={item.command} output={output} exitCode={exitCode} streaming={streaming && pending} />
          )}
        />
      )
    }

    case "fileChange": {
      if (item.changes.length === 0) {
        return <RowTitle icon="FileDiff" text="File change" />
      }
      const primary = item.changes[0]!
      const action = getFileChangeAction(primary)
      const stats = item.changes.reduce(
        (acc, c) => {
          const s = getFileChangeDiffStats(c)
          return { added: acc.added + s.added, removed: acc.removed + s.removed }
        },
        { added: 0, removed: 0 },
      )
      const label =
        item.changes.length === 1
          ? fileNameFromPath(primary.movePath ?? primary.path)
          : `${item.changes.length} files`
      return (
        <ExpandableTimelineRow
          title={
            <RowTitle
              icon={fileChangeActionIcon(action)}
              verb={getFileChangeActionPastTense(action)}
              text={<span className="font-mono text-xs">{label}</span>}
              trailing={
                stats.added > 0 || stats.removed > 0 ? (
                  <DiffStatsTally insertions={stats.added} deletions={stats.removed} hideZero />
                ) : null
              }
            />
          }
          autoExpanded={autoExpanded}
          renderBody={() => (
            <div className="flex flex-col gap-1">
              {item.changes.map((change, index) => (
                <TimelineFileDiffBlock key={index} change={change} workspaceRootPath={workspaceRootPath} />
              ))}
            </div>
          )}
        />
      )
    }

    case "toolCall": {
      const toolLabel = item.server ? `${item.server}/${item.tool}` : item.tool
      const result =
        typeof item.result === "string"
          ? item.result
          : item.result !== undefined
            ? JSON.stringify(item.result, null, 2)
            : ""
      const output = item.error ? item.error : result
      const pending = item.status === "pending"
      return (
        <ExpandableTimelineRow
          title={
            <RowTitle
              icon="Info"
              text={<span className="font-mono text-xs">{toolLabel}</span>}
              trailing={
                item.status === "failed" ? (
                  <Icon name="CircleX" className="size-3.5 text-destructive" aria-hidden />
                ) : null
              }
            />
          }
          autoExpanded={autoExpanded}
          renderBody={() => (
            <ToolCallDetailBlock toolName={toolLabel} args={item.arguments} output={output} streaming={streaming && pending} />
          )}
        />
      )
    }
  }
}

export function ThreadTimelineFeed({
  items,
  streaming = false,
  workspaceRootPath,
  workingLabel,
  showWorking = false,
  workingIsThinking = false,
}: ThreadTimelineFeedProps) {
  // Mirror bb: while the run is live, the active (last) pending row auto-expands
  // and streams its output. Completed rows stay collapsed.
  const lastPendingIndex = useMemo(() => {
    if (!streaming) return -1
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!
      if (
        (item.type === "commandExecution" || item.type === "toolCall" || item.type === "fileChange") &&
        item.status === "pending"
      ) {
        return i
      }
    }
    return -1
  }, [items, streaming])

  return (
    <AutoHeightContainer>
      <div className={cn("flex min-w-0 flex-col gap-4", NESTED_ROWS_GROUP_LINE_CLASS)} data-timeline-row-list="top-level">
        {items.map((item, index) => (
          <Fragment key={item.id}>
            <div data-timeline-row-id={item.id}>
              <TimelineItemRow
                item={item}
                autoExpanded={index === lastPendingIndex}
                streaming={streaming}
                workspaceRootPath={workspaceRootPath}
              />
            </div>
          </Fragment>
        ))}
        {showWorking ? <TimelineWorkingIndicator label={workingLabel} isThinking={workingIsThinking} /> : null}
      </div>
    </AutoHeightContainer>
  )
}
