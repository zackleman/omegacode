import type { ReactNode } from "react"

import type { AgentState, ProviderId, RunStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Status glyph shared by runs and agents: ✓ done · ✗ failed · spinner running · ◌ queued. */
export function StatusGlyph({ state, className }: { state: AgentState | RunStatus; className?: string }) {
  const running = state === "running" || state === "started"
  const ok = state === "done" || state === "completed"
  const fail = state === "failed" || state === "interrupted"
  if (running) return <span className={cn("inline-block animate-spin text-primary", className)}>◐</span>
  if (ok) return <span className={cn("text-success", className)}>✓</span>
  if (fail) return <span className={cn("text-destructive", className)}>✗</span>
  if (state === "queued") return <span className={cn("text-muted-foreground/60", className)}>◌</span>
  if (state === "skipped") return <span className={cn("text-muted-foreground/60", className)}>⊘</span>
  return <span className={cn("text-muted-foreground", className)}>•</span>
}

/** Provider accent dot (blue codex / amber claude). */
export function ProviderDot({ provider, className }: { provider: ProviderId; className?: string }) {
  const color = provider === "claude-code" ? "var(--claude)" : "var(--codex)"
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", className)} style={{ background: color }} aria-hidden />
}

/** Shimmering in-progress text (bb's animate-shine). */
export function Working({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("animate-shine font-mono text-xs", className)}>{children}</span>
}
