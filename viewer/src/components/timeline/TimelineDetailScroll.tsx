// Ported verbatim from bb:
// apps/app/src/components/thread/timeline/TimelineDetailScroll.tsx
// (useComposedRefs sourced from the local compose-refs util instead of the
// @radix-ui subpackage).
import { useCallback, type ReactNode, type UIEvent } from "react"
import { useComposedRefs } from "@/lib/compose-refs"
import { cn } from "@/lib/utils"
import { getDetailScrollMaxHeightClass, type DetailScrollSize } from "@/components/ui/detail-scroll-size"
import { useStickyBottomScroll } from "./useStickyBottomScroll"
import { useScrollOverflowState } from "./useScrollOverflowState"

export interface TimelineDetailScrollProps {
  size: DetailScrollSize
  streaming?: boolean
  contentKey: string
  className?: string
  scrollClassName?: string
  children: ReactNode
}

export function TimelineDetailScroll({
  size,
  streaming = false,
  contentKey,
  className,
  scrollClassName,
  children,
}: TimelineDetailScrollProps) {
  const sticky = useStickyBottomScroll<HTMLDivElement>({
    contentKey,
    streaming,
  })
  const overflow = useScrollOverflowState<HTMLDivElement>()
  const maxHeightClassName = getDetailScrollMaxHeightClass(size)
  const { aboveOverflow, belowOverflow } = overflow

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      sticky.onScroll(event)
    },
    [sticky],
  )

  const refCallback = useComposedRefs<HTMLDivElement>(sticky.ref, overflow.scrollRef)

  return (
    <div className={cn("relative isolate min-w-0", className)} data-detail-scroll={size}>
      <div
        ref={refCallback}
        onScroll={handleScroll}
        onPointerDown={sticky.onPointerDown}
        onTouchMove={sticky.onTouchMove}
        onTouchStart={sticky.onTouchStart}
        onWheel={sticky.onWheel}
        data-detail-scroll-area={size}
        className={cn("min-w-0 overflow-auto", maxHeightClassName, scrollClassName)}
      >
        <div ref={overflow.topSentinelRef} aria-hidden className="h-px w-full" />
        {children}
        <div ref={overflow.bottomSentinelRef} aria-hidden className="h-px w-full" />
      </div>
      {aboveOverflow ? (
        <div
          aria-hidden
          data-detail-scroll-fade="above"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-background to-transparent"
        />
      ) : null}
      {belowOverflow ? (
        <div
          aria-hidden
          data-detail-scroll-fade="below"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-background to-transparent"
        />
      ) : null}
    </div>
  )
}
