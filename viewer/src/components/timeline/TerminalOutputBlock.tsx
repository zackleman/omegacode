// Ported verbatim from bb:
// apps/app/src/components/thread/timeline/TerminalOutputBlock.tsx
// (only import paths adjusted to the viewer's layout). The ANSI→themed-HTML
// mapping onto --ansi-0…15 / --ansi-bg-fg-N and the card chrome are bb's code.
import { useMemo, useRef, type CSSProperties } from "react"
import Convert from "ansi-to-html"
import { cn } from "@/lib/utils"
import { getDetailScrollMaxHeightClass } from "@/components/ui/detail-scroll-size"
import { ExpandableLine } from "@/components/ui/expandable-line"
import { TimelineDetailScroll } from "./TimelineDetailScroll"

export interface TerminalOutputBlockProps {
  output: string
  commandLine?: string
  exitCode?: number | null
  metadataLines?: readonly string[]
  streaming?: boolean
}

interface TerminalScrollContentKeyArgs {
  commandLine: string | undefined
  exitCode: number | null
  metadataLines: readonly string[]
  output: string
}

const COMMAND_LINE_CLAMP_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
}

const ANSI_THEME_COLORS: Record<number, string> = {
  0: "var(--ansi-0)",
  1: "var(--ansi-1)",
  2: "var(--ansi-2)",
  3: "var(--ansi-3)",
  4: "var(--ansi-4)",
  5: "var(--ansi-5)",
  6: "var(--ansi-6)",
  7: "var(--ansi-7)",
  8: "var(--ansi-8)",
  9: "var(--ansi-9)",
  10: "var(--ansi-10)",
  11: "var(--ansi-11)",
  12: "var(--ansi-12)",
  13: "var(--ansi-13)",
  14: "var(--ansi-14)",
  15: "var(--ansi-15)",
}
const ANSI_COLOR_INDEXES = Object.keys(ANSI_THEME_COLORS).map(Number)
const BACKGROUND_RESET_STYLE = "background-color:var(--background)"
const BACKGROUND_RESET_CONTRAST_STYLE = `${BACKGROUND_RESET_STYLE};color:var(--foreground)`

function addBackgroundContrastColors(html: string): string {
  let out = html
  for (const colorIndex of ANSI_COLOR_INDEXES) {
    const backgroundStyle = `background-color:var(--ansi-${colorIndex})`
    out = out.replaceAll(backgroundStyle, `${backgroundStyle};color:var(--ansi-bg-fg-${colorIndex})`)
  }
  return out.replaceAll(BACKGROUND_RESET_STYLE, BACKGROUND_RESET_CONTRAST_STYLE)
}

const ANSI_TO_HTML_OPTS = {
  escapeXML: true,
  newline: false,
  fg: "var(--foreground)",
  bg: "var(--background)",
  colors: ANSI_THEME_COLORS,
} as const

const ANSI_TO_HTML = new Convert({ ...ANSI_TO_HTML_OPTS, stream: false })

export interface IncrementalAnsiState {
  source: string
  html: string
  convert: Convert
}

/**
 * Incrementally convert streamed terminal output to themed HTML. Streamed output grows by
 * appending, so re-converting the whole accumulated buffer on every chunk is O(n²) and freezes
 * long runs (M28). We keep a stream-mode Convert that carries SGR state across calls and only feed
 * the new suffix; a non-append change (replace/shrink) rebuilds from a fresh instance.
 * Exported for unit coverage — the component holds the state in a ref, out of tests' reach.
 */
// eslint-disable-next-line react-refresh/only-export-components -- test-only export of pure logic
export function convertIncremental(prev: IncrementalAnsiState | null, output: string): IncrementalAnsiState {
  if (prev && output.startsWith(prev.source)) {
    if (output.length === prev.source.length) return prev
    const delta = output.slice(prev.source.length)
    const appended = prev.convert.toHtml(delta)
    return { source: output, html: prev.html + appended, convert: prev.convert }
  }
  const convert = new Convert({ ...ANSI_TO_HTML_OPTS, stream: true })
  return { source: output, html: convert.toHtml(output), convert }
}

function stringLengthSum(values: readonly string[]): number {
  let length = 0
  for (const value of values) {
    length += value.length
  }
  return length
}

function terminalScrollContentKey({ commandLine, exitCode, metadataLines, output }: TerminalScrollContentKeyArgs): string {
  return [commandLine?.length ?? 0, stringLengthSum(metadataLines), output.length, exitCode ?? ""].join(":")
}

export function TerminalOutputBlock({
  commandLine,
  exitCode = null,
  metadataLines = [],
  output,
  streaming = false,
}: TerminalOutputBlockProps) {
  // Incremental ANSI→HTML so a streamed buffer isn't fully re-converted on every chunk (M28): the
  // append-only fast path converts just the new suffix and reuses the carried SGR state. The running
  // state is held in a ref (the cross-render handle React's own streaming requires); a one-shot
  // convert handles terminal/non-append output. Computed synchronously so the HTML never lags a frame.
  const ansiState = useRef<IncrementalAnsiState | null>(null)
  /* eslint-disable react-hooks/refs -- incremental stream conversion carries SGR state across renders */
  const renderedOutputHtml = useMemo(() => {
    if (output.length === 0) {
      ansiState.current = null
      return null
    }
    if (streaming) {
      const next = convertIncremental(ansiState.current, output)
      ansiState.current = next
      return addBackgroundContrastColors(next.html)
    }
    ansiState.current = null
    return addBackgroundContrastColors(ANSI_TO_HTML.toHtml(output))
  }, [output, streaming])
  /* eslint-enable react-hooks/refs */

  const showExitCode = exitCode !== null
  const outputContentKey = terminalScrollContentKey({
    commandLine,
    exitCode,
    metadataLines,
    output,
  })

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="px-4 py-3 font-mono text-xs leading-tight text-foreground">
        {commandLine ? (
          <ExpandableLine
            fullText={commandLine}
            collapsedClassName="max-h-[2lh] overflow-hidden whitespace-pre-wrap break-words"
            collapsedStyle={COMMAND_LINE_CLAMP_STYLE}
            expandedClassName={cn("overflow-auto whitespace-pre-wrap break-words", getDetailScrollMaxHeightClass("base"))}
          >
            {commandLine}
          </ExpandableLine>
        ) : null}
        {metadataLines.map((line, index) => (
          <div key={`${index}:${line}`} className="mt-1 text-muted-foreground">
            {line}
          </div>
        ))}
        {renderedOutputHtml ? (
          <TimelineDetailScroll
            size="base"
            streaming={streaming}
            contentKey={outputContentKey}
            className={cn(commandLine || metadataLines.length > 0 ? "mt-1.5" : null)}
            scrollClassName="whitespace-pre leading-tight text-foreground"
          >
            <div dangerouslySetInnerHTML={{ __html: renderedOutputHtml }} />
          </TimelineDetailScroll>
        ) : null}
        {showExitCode ? (
          <div
            className={cn(
              renderedOutputHtml ? "mt-1.5" : commandLine ? "mt-1.5" : null,
              "font-mono text-xs leading-tight text-muted-foreground",
            )}
          >
            exit code {exitCode}
          </div>
        ) : null}
      </div>
    </div>
  )
}
