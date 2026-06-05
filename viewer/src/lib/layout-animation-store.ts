// Replaces bb's jotai `layoutAnimationInFlightCountAtom`
// (apps/app/src/components/ui/layoutAnimationAtoms.ts). bb uses a jotai atom so
// that ExpandablePanel can signal "a CSS grid expand is in flight" and the
// surrounding AutoHeightContainer / HeightTransition wrappers snap their height
// each frame instead of running a compounding 180ms transition. The viewer
// doesn't use jotai, so this is a minimal module-level counter with the same
// semantics (read current count synchronously; subscribe for changes).

let inFlightCount = 0
const listeners = new Set<() => void>()

export const layoutAnimationStore = {
  get(): number {
    return inFlightCount
  },
  increment(): void {
    inFlightCount += 1
    listeners.forEach((l) => l())
  },
  decrement(): void {
    inFlightCount = Math.max(0, inFlightCount - 1)
    listeners.forEach((l) => l())
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
