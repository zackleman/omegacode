// Ported from bb: apps/app/src/components/ui/diff-stats-tally.tsx
// (formatDiffCount now comes from the ported file-change-summary helpers).
import { formatDiffCount } from "@/lib/thread-view/file-change-summary"
import { cn } from "@/lib/utils"

export interface DiffStatsTallyProps {
  insertions: number
  deletions: number
  /** Drop a side when its count is 0 (e.g. show only `-2` instead of `+0 -2`). */
  hideZero?: boolean
  className?: string
}

export function DiffStatsTally({ insertions, deletions, hideZero = false, className }: DiffStatsTallyProps) {
  const showInsertions = !hideZero || insertions > 0
  const showDeletions = !hideZero || deletions > 0
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {showInsertions ? <span className="text-diff-added">+{formatDiffCount(insertions)}</span> : null}
      {showInsertions && showDeletions ? " " : null}
      {showDeletions ? <span className="text-diff-removed">-{formatDiffCount(deletions)}</span> : null}
    </span>
  )
}
