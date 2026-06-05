import { useCallback, type Ref } from "react"

// Minimal local stand-in for @radix-ui/react-compose-refs so the ported
// TimelineDetailScroll can attach multiple refs to one element without pulling
// in an extra radix subpackage. Mirrors radix's setRef/composeRefs behavior.

type PossibleRef<T> = Ref<T> | undefined

function setRef<T>(ref: PossibleRef<T>, value: T): void {
  if (typeof ref === "function") {
    ref(value)
  } else if (ref !== null && ref !== undefined) {
    ;(ref as React.MutableRefObject<T>).current = value
  }
}

export function composeRefs<T>(...refs: PossibleRef<T>[]): (node: T) => void {
  return (node: T) => {
    for (const ref of refs) {
      setRef(ref, node)
    }
  }
}

export function useComposedRefs<T>(...refs: PossibleRef<T>[]): (node: T) => void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(composeRefs(...refs), refs)
}
