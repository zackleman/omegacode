import path from "path"
import { defineConfig } from "vitest/config"

// Unit tests cover the pure data layer (fold / to-thread-events / work-summary / format /
// convertIncremental). They run in a plain node environment — no DOM, no app build plugins —
// keeping the suite fast and isolated. The exception is the *.dom.test.{ts,tsx} files, which opt
// into jsdom per-file (// @vitest-environment) to drive the stream hooks and components end to
// end — H19's first fix passed every pure-function test while the hook-level composition
// misfired, so the latch/fold/poll wiring and the component-level overlays (H19/L26/L28/M29)
// need behavioral coverage.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
