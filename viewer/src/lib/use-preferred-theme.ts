import { useEffect, useState } from "react"

// Stand-in for bb's `usePreferredTheme` (@/hooks/useTheme). The viewer's
// ThemeProvider applies a `light`/`dark` class to <html>; this reads the
// resolved theme from that class and tracks changes via a MutationObserver, so
// MarkdownPreview's <source media="(prefers-color-scheme: …)"> resolution keeps
// working.
export type Theme = "light" | "dark"

function readResolvedTheme(): Theme {
  if (typeof document === "undefined") return "light"
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function usePreferredTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readResolvedTheme)

  useEffect(() => {
    const root = document.documentElement
    const update = () => setTheme(readResolvedTheme())
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return theme
}
