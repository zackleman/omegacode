// Ported from bb: apps/app/src/components/ui/icon.tsx
// Same hugeicons-backed Icon component and name map. Trimmed to the glyphs the
// ported timeline surface references (the viewer already depends on
// @hugeicons/react + @hugeicons/core-free-icons).
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  Alert02Icon,
  AlertCircleIcon,
  ArrowMoveDownRightIcon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  ComputerTerminal01Icon,
  Copy01Icon,
  DashedLineCircleIcon,
  Delete02Icon,
  Edit02Icon,
  File01Icon,
  FileEmpty02Icon,
  FileXIcon,
  FolderAddIcon,
  InformationCircleIcon,
  LinkSquare02Icon,
  PlusMinusSquare01Icon,
  Refresh01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

const ICON_MAP = {
  AlertCircle: AlertCircleIcon,
  AlertTriangle: Alert02Icon,
  Check: Tick02Icon,
  CircleCheck: CheckmarkCircle02Icon,
  CircleX: CancelCircleIcon,
  Copy: Copy01Icon,
  CornerDownRight: ArrowMoveDownRightIcon,
  Edit: Edit02Icon,
  ExternalLink: LinkSquare02Icon,
  File: FileEmpty02Icon,
  FileDiff: PlusMinusSquare01Icon,
  FilePlus: FolderAddIcon,
  FileText: File01Icon,
  FileX2: FileXIcon,
  Info: InformationCircleIcon,
  RotateCcw: Refresh01Icon,
  Spinner: DashedLineCircleIcon,
  Terminal: ComputerTerminal01Icon,
  Trash2: Delete02Icon,
  X: Cancel01Icon,
} as const satisfies Record<string, IconSvgElement>

export type IconName = keyof typeof ICON_MAP

export const ICON_NAMES = Object.keys(ICON_MAP) as readonly IconName[]

export interface IconProps {
  name: IconName
  className?: string
  "aria-hidden"?: boolean | "true" | "false"
  "aria-label"?: string
}

export function Icon({ name, className, "aria-hidden": ariaHidden, "aria-label": ariaLabel }: IconProps) {
  return (
    <HugeiconsIcon
      icon={ICON_MAP[name]}
      className={cn(className)}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
    />
  )
}
