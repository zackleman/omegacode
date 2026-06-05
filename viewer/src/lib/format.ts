export function fmtTokens(n?: number): string {
  if (!n) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function fmtDuration(ms?: number): string {
  if (ms == null) return ""
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m${rem.toString().padStart(2, "0")}s`
}

export function fmtCost(usd?: number): string {
  if (!usd) return ""
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(2)}`
}

export function timeAgo(t?: number, now: number = Date.now()): string {
  if (!t) return ""
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}:${(s % 60).toString().padStart(2, "0")}`
  const h = Math.floor(m / 60)
  return `${h}:${(m % 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`
}
