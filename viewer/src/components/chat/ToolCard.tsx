import { useState } from "react"

import { renderAnsi } from "@/lib/ansi"
import { cn } from "@/lib/utils"

export interface ToolPair {
  id?: string
  name: string
  input?: unknown
  output?: string
  isError?: boolean
  running?: boolean
}

const COMMAND_TOOLS = new Set(["command", "commandExecution", "Bash", "bash"])

function commandText(input: unknown): string | null {
  let parts: string[] | null = null
  if (Array.isArray(input)) parts = input.map(String)
  else if (input && typeof input === "object" && Array.isArray((input as Record<string, unknown>).command)) {
    parts = ((input as Record<string, unknown>).command as unknown[]).map(String)
  }
  if (parts) {
    // Strip a shell wrapper like ["/bin/zsh","-lc","<script>"] → "<script>".
    const ci = parts.findIndex((p) => p === "-lc" || p === "-c" || p === "-ic")
    return (ci >= 0 && parts[ci + 1] !== undefined ? parts.slice(ci + 1) : parts).join(" ")
  }
  const s =
    typeof input === "string"
      ? input
      : input && typeof input === "object" && typeof (input as Record<string, unknown>).command === "string"
        ? ((input as Record<string, unknown>).command as string)
        : null
  if (s == null) return null
  const m = /^(?:\S*\/)?(?:zsh|bash|sh)\s+-[lic]+c?\s+(['"]?)([\s\S]*)\1\s*$/.exec(s.trim())
  return m ? m[2]! : s
}

/** A tool/command call paired with its result, rendered like bb's terminal/tool detail card. */
export function ToolCard({ tool }: { tool: ToolPair }) {
  const [open, setOpen] = useState(false)
  const isCommand = COMMAND_TOOLS.has(tool.name)
  const cmd = isCommand ? commandText(tool.input) : null
  const argsText =
    !isCommand && tool.input !== undefined
      ? typeof tool.input === "string"
        ? tool.input
        : JSON.stringify(tool.input, null, 2)
      : null
  const hasOutput = tool.output != null && tool.output !== ""

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card/50">
      <div className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs">
        {isCommand ? (
          <>
            <span className="shrink-0 text-muted-foreground">$</span>
            <span className="truncate">{cmd ?? "command"}</span>
          </>
        ) : (
          <span className="truncate font-semibold">{tool.name}</span>
        )}
        {tool.running && <span className="ml-auto inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />}
      </div>

      {argsText && (
        <div className="border-t border-border/50 px-3 py-1">
          <button
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-[11px] text-subtle-foreground transition-colors hover:text-muted-foreground"
          >
            {open ? "▾ args" : "▸ args"}
          </button>
          {open && (
            <pre className="mt-1 max-h-60 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {argsText}
            </pre>
          )}
        </div>
      )}

      {hasOutput && (
        <pre
          className={cn(
            "max-h-72 overflow-auto border-t border-border/50 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap",
            tool.isError ? "text-destructive" : "text-foreground/80",
          )}
        >
          {renderAnsi(tool.output!)}
        </pre>
      )}
    </div>
  )
}
