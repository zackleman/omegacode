// Ported from bb: apps/app/src/components/ui/height-transition.tsx
// jotai `useStore()` + `store.get(layoutAnimationInFlightCountAtom)` replaced
// with the local layout-animation store. The snap/restore math, ResizeObserver
// height tracking, visibility-change handling, and CSS transition setup are
// bb's code verbatim.
import { useLayoutEffect, useRef, type ReactNode } from "react"
import { layoutAnimationStore } from "@/lib/layout-animation-store"

export const HEIGHT_TRANSITION_DURATION_MS = 180
export const HEIGHT_TRANSITION_EASE_CSS = "cubic-bezier(0.16, 1, 0.3, 1)"

interface SnapState {
  savedDuration: string | null
  restoreFrame: number | null
}

function enterSnapMode(target: HTMLElement, state: SnapState): void {
  if (state.savedDuration === null) {
    state.savedDuration = target.style.transitionDuration
  }
  target.style.transitionDuration = "0s"
}

function scheduleRestore(target: HTMLElement, state: SnapState): void {
  if (state.restoreFrame !== null) {
    cancelAnimationFrame(state.restoreFrame)
  }
  state.restoreFrame = requestAnimationFrame(() => {
    state.restoreFrame = null
    if (state.savedDuration === null) return
    target.style.transitionDuration = state.savedDuration
    state.savedDuration = null
  })
}

function applyHeight(target: HTMLElement, nextHeight: string, snap: boolean, state: SnapState): void {
  const currentHeightPx = parseFloat(target.style.height)
  const nextHeightPx = parseFloat(nextHeight)
  const heightDecreasing =
    Number.isFinite(currentHeightPx) && Number.isFinite(nextHeightPx) && nextHeightPx < currentHeightPx
  if (snap || heightDecreasing) {
    enterSnapMode(target, state)
    scheduleRestore(target, state)
  }
  target.style.height = nextHeight
}

function cleanupSnapState(target: HTMLElement | null, state: SnapState): void {
  if (state.restoreFrame !== null) {
    cancelAnimationFrame(state.restoreFrame)
    state.restoreFrame = null
  }
  if (state.savedDuration !== null && target) {
    target.style.transitionDuration = state.savedDuration
    state.savedDuration = null
  }
}

export interface HeightTransitionProps {
  visible: boolean
  children: ReactNode
  durationMs?: number
  className?: string
}

export function HeightTransition({
  visible,
  children,
  durationMs = HEIGHT_TRANSITION_DURATION_MS,
  className,
}: HeightTransitionProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const inner = innerRef.current
    if (!wrapper || !inner) return
    wrapper.style.height = visible ? `${inner.offsetHeight}px` : "0px"
    if (typeof ResizeObserver === "undefined") return
    let lastWidth: number | null = null
    let pendingVisibilitySnap = false
    const snapState: SnapState = { savedDuration: null, restoreFrame: null }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      const widthChanged = lastWidth !== null && width !== lastWidth
      const layoutAnimationActive = layoutAnimationStore.get() > 0
      const snap = widthChanged || pendingVisibilitySnap || layoutAnimationActive
      pendingVisibilitySnap = false
      lastWidth = width
      const nextHeight = visible ? `${height}px` : "0px"
      applyHeight(wrapper, nextHeight, snap, snapState)
    })
    observer.observe(inner)
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      pendingVisibilitySnap = true
      const nextHeight = visible ? `${inner.offsetHeight}px` : "0px"
      applyHeight(wrapper, nextHeight, true, snapState)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      cleanupSnapState(wrapper, snapState)
    }
  }, [visible])
  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        overflowX: "visible",
        overflowY: "clip",
        opacity: visible ? 1 : 0,
        transition: `height ${durationMs}ms ${HEIGHT_TRANSITION_EASE_CSS}, opacity ${durationMs}ms ${HEIGHT_TRANSITION_EASE_CSS}`,
      }}
    >
      <div ref={innerRef} style={{ display: "flow-root" }}>
        {children}
      </div>
    </div>
  )
}

export interface AutoHeightContainerProps {
  children: ReactNode
  className?: string
  durationMs?: number
}

const AUTO_HEIGHT_INITIAL_SETTLE_MS = 250

export function AutoHeightContainer({
  children,
  className,
  durationMs = HEIGHT_TRANSITION_DURATION_MS,
}: AutoHeightContainerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current
    const inner = innerRef.current
    if (!wrapper || !inner || typeof ResizeObserver === "undefined") return
    wrapper.style.height = `${inner.offsetHeight}px`
    let lastWidth: number | null = null
    let pendingVisibilitySnap = false
    let initialSettleComplete = false
    let initialSettleTimerId = window.setTimeout(() => {
      initialSettleComplete = true
    }, AUTO_HEIGHT_INITIAL_SETTLE_MS)
    const snapState: SnapState = { savedDuration: null, restoreFrame: null }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      const widthChanged = lastWidth !== null && width !== lastWidth
      const layoutAnimationActive = layoutAnimationStore.get() > 0
      const snap = widthChanged || pendingVisibilitySnap || !initialSettleComplete || layoutAnimationActive
      pendingVisibilitySnap = false
      lastWidth = width
      applyHeight(wrapper, `${height}px`, snap, snapState)
      if (!initialSettleComplete) {
        window.clearTimeout(initialSettleTimerId)
        initialSettleTimerId = window.setTimeout(() => {
          initialSettleComplete = true
        }, AUTO_HEIGHT_INITIAL_SETTLE_MS)
      }
    })
    observer.observe(inner)
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      pendingVisibilitySnap = true
      applyHeight(wrapper, `${inner.offsetHeight}px`, true, snapState)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearTimeout(initialSettleTimerId)
      cleanupSnapState(wrapper, snapState)
    }
  }, [])
  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{
        overflowX: "visible",
        overflowY: "clip",
        transition: `height ${durationMs}ms ${HEIGHT_TRANSITION_EASE_CSS}`,
      }}
    >
      <div ref={innerRef} style={{ display: "flow-root" }}>
        {children}
      </div>
    </div>
  )
}
