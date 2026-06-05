// Ported verbatim from bb: apps/app/src/components/ui/detail-scroll-size.ts
// Cap sizes for expandable detail scroll containers in the thread timeline.

export const detailScrollSizeValues = ["summary", "base", "delegation"] as const
export type DetailScrollSize = (typeof detailScrollSizeValues)[number]

const DETAIL_SCROLL_MAX_HEIGHT_CLASS_BY_SIZE: Record<DetailScrollSize, string> = {
  summary: "max-h-[240px]",
  base: "max-h-[288px]",
  delegation: "max-h-[768px]",
}

export function getDetailScrollMaxHeightClass(size: DetailScrollSize): string {
  return DETAIL_SCROLL_MAX_HEIGHT_CLASS_BY_SIZE[size]
}
