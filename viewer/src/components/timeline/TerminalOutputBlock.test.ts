// Unit tests for convertIncremental — the M28 fix's core: streamed terminal output used to be
// re-converted ANSI→HTML in full on every chunk (O(n²), froze long runs). The incremental path is
// the algorithmically subtle part: it must detect appends, convert only the new suffix while
// carrying SGR state across chunks on a stream-mode Convert, and rebuild from a fresh instance on
// any non-append change so stale color state never bleeds into unrelated output.

import { describe, expect, it } from "vitest"

import { convertIncremental } from "./TerminalOutputBlock"

const RED = "\x1b[31m" // SGR 31 → color index 1 → var(--ansi-1)
const GREEN = "\x1b[32m" // SGR 32 → color index 2 → var(--ansi-2)
const RESET = "\x1b[0m"

describe("convertIncremental (M28: incremental ANSI→HTML)", () => {
  it("converts the full output on the first call", () => {
    const state = convertIncremental(null, `${RED}red text`)
    expect(state.source).toBe(`${RED}red text`)
    expect(state.html).toBe('<span style="color:var(--ansi-1)">red text</span>')
  })

  it("returns the same state object when the output is unchanged (no re-conversion)", () => {
    const prev = convertIncremental(null, "line one\n")
    expect(convertIncremental(prev, "line one\n")).toBe(prev)
  })

  // The append fast path: prior HTML is reused verbatim and only the delta is fed to the carried
  // converter — the O(n)→O(1)-per-chunk property the fix exists for.
  it("appends only the new suffix onto the prior html, reusing the carried converter", () => {
    const prev = convertIncremental(null, "one\n")
    const next = convertIncremental(prev, "one\ntwo\n")
    expect(next.html.startsWith(prev.html)).toBe(true)
    expect(next.html.slice(prev.html.length)).toContain("two")
    expect(next.html.slice(prev.html.length)).not.toContain("one")
    expect(next.convert).toBe(prev.convert) // same stream-mode instance carries the SGR state
    expect(next.source).toBe("one\ntwo\n")
  })

  // SGR-state carry: a chunk boundary can split an escape sequence from the text it styles. The
  // appended delta has NO escape codes of its own, yet must still render in the carried color.
  it("carries SGR state into a later chunk that has no escape codes", () => {
    const prev = convertIncremental(null, `${RED}red`)
    const next = convertIncremental(prev, `${RED}red and still red`)
    const appended = next.html.slice(prev.html.length)
    expect(appended).toContain('color:var(--ansi-1)')
    expect(appended).toContain("and still red")
  })

  it("ends the carried color when a later chunk resets it", () => {
    const prev = convertIncremental(null, `${RED}red`)
    const next = convertIncremental(prev, `${RED}red${RESET} plain`)
    const appended = next.html.slice(prev.html.length)
    expect(appended.endsWith(" plain")).toBe(true) // outside any span — the reset closed it
  })

  it("accumulates state across many appends like a single conversion would", () => {
    let state = convertIncremental(null, `${RED}r`)
    state = convertIncremental(state, `${RED}r${RESET}p`)
    state = convertIncremental(state, `${RED}r${RESET}p${GREEN}g`)
    expect(state.html).toContain('color:var(--ansi-1)')
    expect(state.html).toContain('color:var(--ansi-2)')
    expect(state.source).toBe(`${RED}r${RESET}p${GREEN}g`)
  })

  // Non-append (replaced output): the old converter holds open SGR state from the previous source;
  // reusing it would bleed that color into unrelated text. A rebuild must start clean.
  it("rebuilds from a fresh converter when the output is replaced, dropping stale SGR state", () => {
    const prev = convertIncremental(null, `${RED}red with open color state`)
    const next = convertIncremental(prev, "completely different output")
    expect(next.html).toBe("completely different output") // no carried red span
    expect(next.html).toBe(convertIncremental(null, "completely different output").html)
    expect(next.convert).not.toBe(prev.convert)
  })

  it("rebuilds when the output shrinks (a prefix is not an append)", () => {
    const prev = convertIncremental(null, "one\ntwo\n")
    const next = convertIncremental(prev, "one\n")
    expect(next.source).toBe("one\n")
    expect(next.html).toBe(convertIncremental(null, "one\n").html)
    expect(next.convert).not.toBe(prev.convert)
  })

  // The converted HTML is injected via dangerouslySetInnerHTML — escaping is load-bearing, on both
  // the first-conversion and append paths.
  it("escapes XML on both the initial and appended paths", () => {
    const prev = convertIncremental(null, "<script>")
    expect(prev.html).toBe("&lt;script&gt;")
    const next = convertIncremental(prev, "<script><img>")
    expect(next.html).toBe("&lt;script&gt;&lt;img&gt;")
  })
})
