// Ported verbatim from bb: packages/thread-view/src/file-change-summary.ts
// (only the file-change action / diff-stat helpers the timeline leaf
// components need — projection-specific helpers were dropped).

export type FileChangeAction = "created" | "deleted" | "renamed" | "edited"

export interface FileChangeDiffStats {
  added: number
  removed: number
}

export interface FileChangeLike {
  path: string
  kind?: string | null
  movePath?: string | null
  diff?: string | null
}

const EMPTY_DIFF_STATS: FileChangeDiffStats = {
  added: 0,
  removed: 0,
}

function normalizeFileChangeKind(kind: string | null | undefined): string {
  return (kind ?? "").toLowerCase().replaceAll(/[^a-z0-9]/gu, "")
}

export function isPatchMetadataLine(line: string): boolean {
  const normalizedLine = line.trimEnd()
  return (
    normalizedLine.startsWith("diff --git ") ||
    normalizedLine.startsWith("index ") ||
    normalizedLine.startsWith("new file mode ") ||
    normalizedLine.startsWith("deleted file mode ") ||
    normalizedLine.startsWith("similarity index ") ||
    normalizedLine.startsWith("rename from ") ||
    normalizedLine.startsWith("rename to ") ||
    normalizedLine.startsWith("--- ") ||
    normalizedLine.startsWith("+++ ") ||
    normalizedLine.startsWith("@@") ||
    normalizedLine === "\\ No newline at end of file"
  )
}

function hasSubstantiveDiff(change: FileChangeLike): boolean {
  const diff = change.diff
  if (!diff) return false
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue
    if (line.startsWith("+") || line.startsWith("-")) return true
  }
  return false
}

export function getFileChangeAction(change: FileChangeLike): FileChangeAction {
  if (change.movePath) {
    return hasSubstantiveDiff(change) ? "edited" : "renamed"
  }

  const kind = normalizeFileChangeKind(change.kind)
  if (kind.includes("add") || kind.includes("create")) return "created"
  if (kind.includes("delete") || kind.includes("remove")) return "deleted"
  return "edited"
}

export function getFileChangeActionPastTense(action: FileChangeAction): string {
  switch (action) {
    case "created":
      return "Created"
    case "deleted":
      return "Deleted"
    case "renamed":
      return "Renamed"
    case "edited":
      return "Edited"
  }
}

function countPlainContentLines(diff: string): number {
  return diff
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isPatchMetadataLine(line)).length
}

function hasPatchMetadata(diff: string): boolean {
  return diff.split("\n").some(isPatchMetadataLine)
}

export function getFileChangeDiffStats(change: FileChangeLike): FileChangeDiffStats {
  const diff = change.diff
  if (!diff) {
    return EMPTY_DIFF_STATS
  }

  const action = getFileChangeAction(change)
  const plainContentLineCount = countPlainContentLines(diff)
  if (!hasPatchMetadata(diff) && (action === "created" || action === "deleted")) {
    return action === "created"
      ? { added: plainContentLineCount, removed: 0 }
      : { added: 0, removed: plainContentLineCount }
  }

  let added = 0
  let removed = 0
  let sawUnifiedDiffLine = false
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue
    if (line.startsWith("+")) {
      sawUnifiedDiffLine = true
      added += 1
      continue
    }
    if (line.startsWith("-")) {
      sawUnifiedDiffLine = true
      removed += 1
    }
  }
  if (sawUnifiedDiffLine) {
    return { added, removed }
  }

  switch (action) {
    case "created":
      return { added: plainContentLineCount, removed: 0 }
    case "deleted":
      return { added: 0, removed: plainContentLineCount }
    case "renamed":
    case "edited":
      return EMPTY_DIFF_STATS
  }
}

// From bb: packages/thread-view/src/timeline-path-display.ts
export function fileNameFromPath(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/")
  const segments = normalizedPath.split("/")
  const candidate = segments[segments.length - 1]
  return candidate && candidate.length > 0 ? candidate : path
}

// From bb: packages/thread-view/src/format-helpers.ts (formatDiffCount)
export function formatDiffCount(value: number): string {
  if (value < 1000) {
    return String(value)
  }
  const thousands = value / 1000
  const rounded = Math.round(thousands * 10) / 10
  return `${rounded}k`
}
