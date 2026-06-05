// Minimal ANSI SGR → styled React spans, using bb's --ansi-* palette. Foreground/background
// 16-color, bold/dim/italic; all other escape sequences (cursor moves, OSC, clear-line) are stripped.
import type { CSSProperties, ReactNode } from "react"

const SGR = /\x1b\[([0-9;]*)m/g
// Leftover non-SGR CSI sequences + OSC titles.
const CLEAN = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][\s\S]*?(?:\x07|\x1b\\)|\r/g

function fgVar(code: number): string | undefined {
  if (code >= 30 && code <= 37) return `--ansi-${code - 30}`
  if (code >= 90 && code <= 97) return `--ansi-${code - 90 + 8}`
  return undefined
}
function bgVar(code: number): string | undefined {
  if (code >= 40 && code <= 47) return `--ansi-${code - 40}`
  if (code >= 100 && code <= 107) return `--ansi-${code - 100 + 8}`
  return undefined
}

export function renderAnsi(input: string): ReactNode {
  if (!input.includes("\x1b")) return input
  const nodes: ReactNode[] = []
  let style: CSSProperties = {}
  let last = 0
  let key = 0

  const push = (raw: string): void => {
    const clean = raw.replace(CLEAN, "")
    if (!clean) return
    if (Object.keys(style).length === 0) nodes.push(clean)
    else
      nodes.push(
        <span key={key++} style={style}>
          {clean}
        </span>,
      )
  }

  SGR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SGR.exec(input)) !== null) {
    push(input.slice(last, m.index))
    last = SGR.lastIndex
    const codes = (m[1] || "0").split(";").map((s) => Number(s) || 0)
    for (const c of codes) {
      const next = { ...style }
      if (c === 0) style = {}
      else if (c === 1) (next.fontWeight = 600), (style = next)
      else if (c === 2) (next.opacity = 0.7), (style = next)
      else if (c === 3) (next.fontStyle = "italic"), (style = next)
      else if (c === 22) (delete next.fontWeight, delete next.opacity), (style = next)
      else if (c === 23) (delete next.fontStyle, (style = next))
      else if (c === 39) (delete next.color, (style = next))
      else if (c === 49) (delete next.backgroundColor, (style = next))
      else {
        const f = fgVar(c)
        const b = bgVar(c)
        if (f) next.color = `var(${f})`
        if (b) next.backgroundColor = `var(${b})`
        if (f || b) style = next
      }
    }
  }
  push(input.slice(last))
  return nodes
}
