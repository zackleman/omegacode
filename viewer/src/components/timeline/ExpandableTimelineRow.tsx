// Adapted from bb:
// apps/app/src/components/thread/timeline/ExpandableTimelineRow.tsx
//
// bb's row takes a structured `TimelineTitle` and renders it through
// `TimelineTitleView` (segments, shimmer, links) produced by the full
// projection. The viewer drives the timeline from a per-chunk loop, so this
// takes a plain `title: ReactNode` + a `tone` flag. The expand/collapse wiring
// (ExpandablePanel, manual-override-over-auto-expanded state, header tone
// classes, horizontal padding, memoization) is bb's behavior verbatim.
import { memo, useCallback, useState, type ReactNode } from "react"
import { ExpandablePanel, getCollapsibleHeaderToneClass } from "@/components/ui/disclosure"
import { cn } from "@/lib/utils"
import {
  TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME,
  timelineRowHeaderClassName,
  timelineRowHorizontalPaddingClassName,
  type TimelineRowHorizontalPadding,
} from "./TimelineRowHeader"

export type TimelineRowTone = "default" | "summary"

export interface ExpandableTimelineRowProps {
  autoExpanded?: boolean
  onBeforeExpand?: () => void
  renderBody: () => ReactNode
  title: ReactNode
  tone?: TimelineRowTone
  className?: string
  horizontalPadding?: TimelineRowHorizontalPadding
}

type ManualExpansionOverride = boolean | null

function headerToneClass(tone: TimelineRowTone, isExpanded: boolean): string {
  if (tone === "summary") {
    return "text-subtle-foreground transition-colors hover:text-muted-foreground focus-visible:text-muted-foreground"
  }
  return getCollapsibleHeaderToneClass(isExpanded)
}

function ExpandableTimelineRowComponent({
  autoExpanded = false,
  className,
  horizontalPadding = "default",
  onBeforeExpand,
  renderBody,
  title,
  tone = "default",
}: ExpandableTimelineRowProps) {
  const [manualExpansionOverride, setManualExpansionOverride] = useState<ManualExpansionOverride>(null)
  const isExpanded = manualExpansionOverride ?? autoExpanded
  const horizontalPaddingClass = timelineRowHorizontalPaddingClassName(horizontalPadding)
  const handleToggle = useCallback((): void => {
    if (!isExpanded) {
      onBeforeExpand?.()
    }
    setManualExpansionOverride(!isExpanded)
  }, [isExpanded, onBeforeExpand])

  return (
    <ExpandablePanel
      isExpanded={isExpanded}
      onToggle={handleToggle}
      headerToneClass={headerToneClass(tone, isExpanded)}
      summaryContent={title}
      summaryContentClassName={TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME}
      className={cn("w-full", className)}
      headerClassName={timelineRowHeaderClassName(horizontalPadding)}
      contentClassName={cn(horizontalPaddingClass, "pb-1 pt-0.5")}
      renderBody={renderBody}
    />
  )
}

export const ExpandableTimelineRow = memo(ExpandableTimelineRowComponent)
