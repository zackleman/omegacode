// Adapted from bb:
// apps/app/src/components/thread/timeline/TimelineFileDiffBlock.tsx
//
// bb renders the rich syntax-highlighted diff via @pierre/diffs + GitDiffCard
// (shiki-backed). That dependency tree is heavy and unrelated to this viewer,
// so — per the leaf-component fallback path — we keep bb's full
// patch-normalization / diff-stat logic and render the diff body through bb's
// own EventCodeBlock fallback surface, with per-line themed coloring
// (text-diff-added / text-diff-removed) so additions/deletions read like bb's
// diff card. The card header (action icon + repo-relative path + +N/-N tally)
// mirrors GitDiffCard's header.
import { memo, useMemo, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
  getFileChangeAction,
  getFileChangeActionPastTense,
  getFileChangeDiffStats,
  isPatchMetadataLine,
  type FileChangeAction,
  type FileChangeLike,
} from "@/lib/thread-view/file-change-summary"
import { DiffStatsTally } from "@/components/ui/diff-stats-tally"
import { Icon, type IconName } from "@/components/ui/icon"
import { TimelineDetailScroll } from "./TimelineDetailScroll"

export interface TimelineFileChange extends FileChangeLike {
  path: string
}

export interface TimelineFileDiffBlockProps {
  change: TimelineFileChange
  /**
   * Workspace root path the agent ran in. When defined, the prefix is stripped
   * from the displayed path so the header shows a repo-relative path.
   */
  workspaceRootPath?: string | undefined
}

function stripWorkspacePrefix(path: string, root: string | undefined): string {
  if (!root) return path
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`
  return path.startsWith(normalizedRoot) ? path.slice(normalizedRoot.length) : path
}

function actionIconName(action: FileChangeAction): IconName {
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

interface DiffLineProps {
  line: string
}

function DiffLine({ line }: DiffLineProps) {
  const tone =
    line.startsWith("+") && !line.startsWith("+++")
      ? "text-diff-added"
      : line.startsWith("-") && !line.startsWith("---")
        ? "text-diff-removed"
        : isPatchMetadataLine(line)
          ? "text-subtle-foreground"
          : "text-muted-foreground"
  return <div className={cn("whitespace-pre", tone)}>{line.length > 0 ? line : " "}</div>
}

function renderDiffBody(diff: string): ReactNode {
  const lines = diff.replaceAll("\r\n", "\n").split("\n")
  if (lines[lines.length - 1] === "") lines.pop()
  return lines.map((line, index) => <DiffLine key={index} line={line} />)
}

export const TimelineFileDiffBlock = memo(function TimelineFileDiffBlock({
  change,
  workspaceRootPath,
}: TimelineFileDiffBlockProps) {
  const action = useMemo(() => getFileChangeAction(change), [change])
  const stats = useMemo(() => getFileChangeDiffStats(change), [change])
  const displayPath = stripWorkspacePrefix(change.movePath ?? change.path, workspaceRootPath)
  const diff = change.diff?.trimEnd() ?? ""

  const diffContentKey = `${displayPath}:${diff.length}`

  return (
    <div className="mt-1 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 font-mono text-xs">
        <Icon name={actionIconName(action)} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-foreground" title={change.movePath ?? change.path}>
          {displayPath}
        </span>
        <span className="shrink-0 text-subtle-foreground">{getFileChangeActionPastTense(action)}</span>
        {stats.added > 0 || stats.removed > 0 ? (
          <DiffStatsTally insertions={stats.added} deletions={stats.removed} hideZero className="shrink-0" />
        ) : null}
      </div>
      {diff.length > 0 ? (
        <TimelineDetailScroll
          size="base"
          contentKey={diffContentKey}
          scrollClassName="px-3 py-2 font-mono text-xs leading-tight"
        >
          <div className="min-w-fit">{renderDiffBody(diff)}</div>
        </TimelineDetailScroll>
      ) : (
        <div className="px-3 py-1.5 text-xs text-muted-foreground">No diff available.</div>
      )}
    </div>
  )
})
