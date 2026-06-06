// @vitest-environment jsdom
//
// AgentChat behavioral regressions:
// - H19 (UI overlay): a SIGKILLed/finished run's agents may never receive a terminal chunk, so an
//   agent stuck "running" inside a dead run must render the run's fate — no live spinner, no
//   "Working…" shimmer.
// - M29: the transcript pane force-scrolled to the bottom on every chunk, making scrollback
//   unreadable during live runs. The fix wires useStickyBottomScroll to the scroll container —
//   guard the wiring here; the stick/release behavior itself is covered by the hook's own test.
//
// useAgentStream is stubbed (its latch/re-arm behavior has dedicated dom tests in
// lib/hooks.dom.test.ts); this file tests what AgentChat renders from a given stream.

import { cleanup, render } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StickyBottomScrollBinding, UseStickyBottomScrollArgs } from "@/components/timeline/useStickyBottomScroll"
import type { AgentSnapshot, ChatChunk, RunStatus } from "@/lib/types"

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const stream = vi.hoisted(() => ({
  chunks: [] as unknown[],
  live: true,
}))
vi.mock("@/lib/hooks", () => ({
  useAgentStream: () => ({ chunks: stream.chunks, live: stream.live }),
}))

// Pass-through spy: the real hook runs (so the ref actually binds), but we capture each call's
// args + returned binding to prove AgentChat wired it to the scroll container (M29's bug was the
// hook existing and going unused here).
const sticky = vi.hoisted(() => ({
  calls: [] as Array<{ contentKey: string; streaming: boolean }>,
  binding: null as unknown,
}))
vi.mock("@/components/timeline/useStickyBottomScroll", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/components/timeline/useStickyBottomScroll")>()
  return {
    ...mod,
    useStickyBottomScroll: (args: UseStickyBottomScrollArgs) => {
      sticky.calls.push(args)
      const binding = mod.useStickyBottomScroll<HTMLDivElement>(args)
      sticky.binding = binding
      return binding
    },
  }
})

// Import after the mocks so AgentChat picks them up.
import { AgentChat } from "./AgentChat"

const chunkMeta: ChatChunk = { t: 1, kind: "meta", index: 0, label: "agent-0", provider: "codex", prompt: "do the thing" }
const chunkRunning: ChatChunk = { t: 2, kind: "status", state: "running" }

function makeAgent(over: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return { index: 0, label: "agent-0", provider: "codex", state: "running", t: 1, ...over }
}

function renderChat(agent?: AgentSnapshot, runStatus?: RunStatus) {
  return render(
    <MemoryRouter initialEntries={["/run/r1/agent/0"]}>
      <Routes>
        <Route path="/run/:id/agent/:index" element={<AgentChat agent={agent} runStatus={runStatus} />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  stream.chunks = [chunkMeta, chunkRunning]
  stream.live = true
  sticky.calls = []
  sticky.binding = null
})

afterEach(() => cleanup())

describe("AgentChat run-level deadman overlay (H19)", () => {
  it("renders the run's fate for a running agent in a stale run — no spinner, no Working shimmer", () => {
    const { container, queryByText } = renderChat(makeAgent({ state: "running" }), "stale")
    expect(container.querySelector('[aria-label="in progress"]')).toBeNull()
    expect(container.querySelector('[aria-label="stale (run died)"]')).toBeTruthy()
    expect(queryByText("Working...")).toBeNull()
  })

  it("keeps the live spinner and Working indicator while the run is alive", () => {
    const { container, getByText } = renderChat(makeAgent({ state: "running" }), "started")
    expect(container.querySelector('[aria-label="in progress"]')).toBeTruthy()
    expect(getByText("Working...")).toBeTruthy()
  })

  it("never shows Working for an agent the run fold already settled (e.g. a cached hit)", () => {
    const { queryByText } = renderChat(makeAgent({ state: "done", cached: true }), "started")
    expect(queryByText("Working...")).toBeNull()
  })
})

describe("AgentChat sticky-bottom scroll wiring (M29)", () => {
  it("binds useStickyBottomScroll to the transcript scroll container, keyed by the stream", () => {
    const { container } = renderChat(makeAgent({ state: "running" }), "started")
    // AgentChat's own call (no TimelineDetailScroll renders for a text-free feed).
    expect(sticky.calls).toContainEqual({ contentKey: String(stream.chunks.length), streaming: true })
    const scrollPane = container.querySelector(".scroll-bottom-anchor-content")
    expect(scrollPane).toBeTruthy()
    const binding = sticky.binding as StickyBottomScrollBinding<HTMLDivElement>
    expect(binding.ref.current).toBe(scrollPane)
  })

  it("stops treating the pane as streaming once the stream latches off", () => {
    stream.live = false
    renderChat(makeAgent({ state: "done" }), "completed")
    expect(sticky.calls).toContainEqual({ contentKey: String(stream.chunks.length), streaming: false })
  })
})
