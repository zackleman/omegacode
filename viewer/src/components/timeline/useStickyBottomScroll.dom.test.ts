// @vitest-environment jsdom
//
// useStickyBottomScroll — the mechanism behind M29: AgentChat used to force-scroll to the bottom
// on every chunk, yanking the user out of scrollback during live runs. The contract: follow the
// bottom while streaming, release the moment the user deliberately scrolls up, re-stick when they
// return to the bottom — and never mistake our own programmatic scrolls for user intent.

import { renderHook } from "@testing-library/react"
import type { UIEvent, WheelEvent } from "react"
import { describe, expect, it } from "vitest"

import { useStickyBottomScroll } from "./useStickyBottomScroll"

const SCROLL_HEIGHT = 1000
const CLIENT_HEIGHT = 200
const BOTTOM = SCROLL_HEIGHT - CLIENT_HEIGHT

/** jsdom has no layout: fake the scroll geometry with plain properties. */
function makeScrollable(): HTMLDivElement {
  const el = document.createElement("div")
  Object.defineProperty(el, "scrollHeight", { value: SCROLL_HEIGHT, configurable: true })
  Object.defineProperty(el, "clientHeight", { value: CLIENT_HEIGHT, configurable: true })
  let scrollTop = 0
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
    configurable: true,
  })
  el.scrollTo = ((opts: ScrollToOptions) => {
    el.scrollTop = opts.top ?? 0
  }) as typeof el.scrollTo
  return el
}

function setup(initialStreaming = true) {
  const el = makeScrollable()
  const view = renderHook(
    ({ key, streaming }: { key: string; streaming: boolean }) => useStickyBottomScroll<HTMLDivElement>({ contentKey: key, streaming }),
    { initialProps: { key: "0", streaming: initialStreaming } },
  )
  view.result.current.ref.current = el
  const stream = (key: string) => view.rerender({ key, streaming: true })
  const scrollEvent = () => ({ currentTarget: el }) as unknown as UIEvent<HTMLDivElement>
  const wheelEvent = () => ({}) as unknown as WheelEvent<HTMLDivElement>
  return { el, view, stream, scrollEvent, wheelEvent }
}

describe("useStickyBottomScroll (M29: follow the stream, respect the reader)", () => {
  it("follows the bottom as streamed content grows", () => {
    const { el, stream } = setup()
    stream("1")
    expect(el.scrollTop).toBe(BOTTOM)
    stream("2")
    expect(el.scrollTop).toBe(BOTTOM)
  })

  // THE M29 regression: once the user deliberately scrolls up (wheel intent + a scroll away from
  // the bottom), new chunks must not yank them back down.
  it("stops force-scrolling once the user scrolls up", () => {
    const { el, view, stream, scrollEvent, wheelEvent } = setup()
    stream("1")
    expect(el.scrollTop).toBe(BOTTOM)

    view.result.current.onWheel(wheelEvent()) // user intent
    el.scrollTop = 300 // ...and the scroll it caused
    view.result.current.onScroll(scrollEvent())

    stream("2")
    expect(el.scrollTop).toBe(300) // scrollback stays readable
  })

  it("re-sticks when the user returns to the bottom", () => {
    const { el, view, stream, scrollEvent, wheelEvent } = setup()
    stream("1")
    view.result.current.onWheel(wheelEvent())
    el.scrollTop = 300
    view.result.current.onScroll(scrollEvent())
    stream("2")
    expect(el.scrollTop).toBe(300)

    el.scrollTop = BOTTOM - 2 // within the stick threshold
    view.result.current.onScroll(scrollEvent())
    stream("3")
    expect(el.scrollTop).toBe(BOTTOM)
  })

  // Our own scrollToBottom fires scroll events too; without the intent gate they'd unstick the
  // pane and the follow would self-destruct after one chunk.
  it("ignores scroll events without user intent (programmatic scrolls keep following)", () => {
    const { el, view, stream, scrollEvent } = setup()
    stream("1")
    el.scrollTop = 100 // a scroll with NO preceding wheel/touch/pointer intent
    view.result.current.onScroll(scrollEvent())
    stream("2")
    expect(el.scrollTop).toBe(BOTTOM) // still following
  })

  // The skip only applies when streaming was ALREADY off — the streaming→false transition itself
  // still snaps once (the stream's final content lands with the flip).
  it("does not scroll on content changes while not streaming", () => {
    const { el, view } = setup(false)
    view.rerender({ key: "1", streaming: false })
    expect(el.scrollTop).toBe(0)
  })
})
