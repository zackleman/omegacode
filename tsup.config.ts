import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Type declarations for the public library entry only (the CLI is a binary, not an import target).
  // This produces dist/index.d.ts, which the "." export's "types" condition points at.
  dts: { entry: "src/index.ts" },
  splitting: false,
})
