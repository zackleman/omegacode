import { useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { Markdown } from "@/components/chat/Markdown"
import { ToolCard, type ToolPair } from "@/components/chat/ToolCard"
import { ProviderDot, StatusGlyph, Working } from "@/components/glyphs"
import { useAgentStream } from "@/lib/hooks"
import { fmtCost, fmtDuration, fmtTokens } from "@/lib/format"
import type { AgentSnapshot, ChatChunk, ProviderId } from "@/lib/types"
import { cn } from "@/lib/utils"

type FeedItem =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; pair: ToolPair }

interface FeedMeta {
  label: string
  provider: ProviderId
  model?: string
  prompt: string
}

function buildFeed(chunks: ChatChunk[]): { meta?: FeedMeta; items: FeedItem[]; status?: "running" | "done" | "failed" } {
  let meta: FeedMeta | undefined
  let status: "running" | "done" | "failed" | undefined
  const items: FeedItem[] = []
  const toolById = new Map<string, ToolPair>()
  let lastTool: ToolPair | null = null
  let text = ""
  let reason = ""
  const flushText = () => {
    if (text) items.push({ kind: "text", text })
    text = ""
  }
  const flushReason = () => {
    if (reason) items.push({ kind: "reasoning", text: reason })
    reason = ""
  }

  for (const c of chunks) {
    switch (c.kind) {
      case "meta":
        meta = { label: c.label, provider: c.provider, model: c.model, prompt: c.prompt }
        break
      case "text":
        flushReason()
        text += c.text
        break
      case "reasoning":
        flushText()
        reason += c.text
        break
      case "tool": {
        flushText()
        flushReason()
        const pair: ToolPair = { id: c.id, name: c.name, input: c.input, running: true }
        items.push({ kind: "tool", pair })
        if (c.id) toolById.set(c.id, pair)
        lastTool = pair
        break
      }
      case "tool-result": {
        const target = (c.id && toolById.get(c.id)) || lastTool
        if (target) {
          target.output = c.output
          target.isError = c.isError
          target.running = false
        } else {
          flushText()
          flushReason()
          items.push({ kind: "tool", pair: { name: c.name ?? "result", output: c.output, isError: c.isError } })
        }
        break
      }
      case "status":
        status = c.state
        break
    }
  }
  flushText()
  flushReason()
  return { meta, items, status }
}

/** Assistant text — pretty-prints a bare JSON object/array (e.g. a structured-output result). */
function AssistantText({ text }: { text: string }) {
  const t = text.trim()
  if ((t.startsWith("{") || t.startsWith("[")) && t.length > 2) {
    try {
      const parsed: unknown = JSON.parse(t)
      return <Markdown>{"```json\n" + JSON.stringify(parsed, null, 2) + "\n```"}</Markdown>
    } catch {
      // not JSON — fall through to markdown
    }
  }
  return <Markdown>{text}</Markdown>
}

function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-l border-border-hairline pl-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[11px] text-subtle-foreground italic transition-colors hover:text-muted-foreground"
      >
        {open ? "▾ Thinking" : "▸ Thinking"}
      </button>
      {open && <div className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground italic">{text}</div>}
    </div>
  )
}

export function AgentChat({ agent }: { agent?: AgentSnapshot }) {
  const { id, index } = useParams<{ id: string; index: string }>()
  const navigate = useNavigate()
  const idx = index != null ? Number(index) : null
  const { chunks, live } = useAgentStream(id ?? null, idx)
  const { meta, items, status } = buildFeed(chunks)

  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ block: "end" })
  }, [chunks.length, live])

  const provider = agent?.provider ?? meta?.provider ?? "codex"
  const label = agent?.label ?? meta?.label ?? `agent ${idx ?? ""}`
  const model = agent?.model ?? meta?.model
  const state = agent?.state ?? (status === "done" ? "done" : status === "failed" ? "failed" : "running")
  const stats = [
    agent?.outputTokens ? `${fmtTokens((agent.inputTokens ?? 0) + agent.outputTokens)} tok` : null,
    fmtDuration(agent?.durationMs),
    fmtCost(agent?.costUsd),
  ].filter(Boolean)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <StatusGlyph state={state} className="text-sm" />
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ProviderDot provider={provider} />
          {provider}
          {model && <span className="text-subtle-foreground">· {model}</span>}
        </span>
        {stats.length > 0 && <span className="ml-auto shrink-0 font-mono text-[11px] text-subtle-foreground">{stats.join(" · ")}</span>}
        <button
          onClick={() => navigate(`/run/${id}`)}
          className="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="scroll-bottom-anchor-content min-h-0 flex-1 overflow-auto px-4 py-3">
        {meta?.prompt && (
          <div className="mb-4 rounded-md border border-border-hairline bg-surface-recessed px-3 py-2">
            <div className="mb-1 font-mono text-[10px] tracking-wide text-subtle-foreground uppercase">Instruction</div>
            <div className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{meta.prompt}</div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {items.map((item, i) =>
            item.kind === "text" ? (
              <AssistantText key={i} text={item.text} />
            ) : item.kind === "reasoning" ? (
              <Reasoning key={i} text={item.text} />
            ) : (
              <ToolCard key={i} tool={item.pair} />
            ),
          )}
          {live && (
            <Working className={cn("text-muted-foreground", items.length === 0 && "opacity-70")}>
              {status === "running" || status === undefined ? "Working…" : ""}
            </Working>
          )}
        </div>
        <div ref={bottomRef} className="scroll-bottom-anchor" />
      </div>
    </div>
  )
}
