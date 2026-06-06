import { describe, expect, it } from "vitest"

import type { ThreadEventItem } from "@/lib/thread-events"
import {
  buildWorkSummaryLabel,
  itemActivityIntents,
  parseShellCommandIntents,
  plural,
  summarizeWork,
} from "./work-summary"

let idSeq = 0
function cmd(command: string): ThreadEventItem {
  return { type: "commandExecution", id: `c${idSeq++}`, command, cwd: "", status: "completed" }
}
function tool(toolName: string, args?: Record<string, unknown>): ThreadEventItem {
  return { type: "toolCall", id: `t${idSeq++}`, tool: toolName, arguments: args, status: "completed" }
}
function fileChange(path: string, kind: "add" | "delete" | "update", diff?: string): ThreadEventItem {
  return { type: "fileChange", id: `f${idSeq++}`, changes: [{ path, kind, diff }], status: "completed" }
}

describe("plural", () => {
  it("handles singular vs plural", () => {
    expect(plural(1, "file")).toBe("1 file")
    expect(plural(2, "file")).toBe("2 files")
    expect(plural(2, "search", "searches")).toBe("2 searches")
  })
})

describe("parseShellCommandIntents — exploration classification", () => {
  it("classifies cat as a read with the file path", () => {
    expect(parseShellCommandIntents("cat src/index.ts")).toEqual([{ type: "read", name: "cat", path: "src/index.ts" }])
  })

  it("classifies rg as a search with query and path", () => {
    expect(parseShellCommandIntents("rg foo src")).toEqual([{ type: "search", query: "foo", path: "src" }])
  })

  it("classifies ls as list_files", () => {
    expect(parseShellCommandIntents("ls -la dir")).toEqual([{ type: "list_files", path: "dir" }])
  })

  it("returns the first exploration intent across piped segments", () => {
    expect(parseShellCommandIntents("cat a.txt | grep x")).toEqual([{ type: "read", name: "cat", path: "a.txt" }])
  })

  it("disqualifies exploration when a segment writes to a real file", () => {
    expect(parseShellCommandIntents("rg foo src > out.txt")).toEqual([])
  })

  it("disqualifies on tee and sed -i", () => {
    expect(parseShellCommandIntents("echo x | tee f")).toEqual([])
    expect(parseShellCommandIntents("sed -i s/a/b/ f")).toEqual([])
  })
})

describe("parseShellCommandIntents — fd redirects (L24)", () => {
  // Regression: `2>/dev/null` leaked the `2` as a positional ("Searched for foo in 2").
  it("does not leak the fd number from `2>/dev/null` as a positional", () => {
    const intents = parseShellCommandIntents("rg foo src 2>/dev/null")
    expect(intents).toEqual([{ type: "search", query: "foo", path: "src" }])
  })

  it("does not leak `2` when there is no explicit path", () => {
    const intents = parseShellCommandIntents("rg foo 2>/dev/null")
    expect(intents).toEqual([{ type: "search", query: "foo", path: null }])
  })

  // Regression: `2>&1` was tokenized as a write redirect, disqualifying exploration entirely.
  it("treats `2>&1` as an fd-dup, not a write — exploration survives", () => {
    const intents = parseShellCommandIntents("rg foo src 2>&1")
    expect(intents).toEqual([{ type: "search", query: "foo", path: "src" }])
  })

  it("handles combined `2>/dev/null` on a cat read", () => {
    expect(parseShellCommandIntents("cat file.ts 2>/dev/null")).toEqual([
      { type: "read", name: "cat", path: "file.ts" },
    ])
  })

  it("handles `>&2` fd-dup without disqualifying", () => {
    expect(parseShellCommandIntents("grep x f >&2")).toEqual([{ type: "search", query: "x", path: "f" }])
  })

  it("still disqualifies a real `2>logfile` stderr-to-file write", () => {
    // Redirecting stderr to a named file is still a write — must disqualify exploration.
    expect(parseShellCommandIntents("rg foo src 2>errors.log")).toEqual([])
  })

  it("treats `>/dev/null` (stdout to null) as non-write", () => {
    expect(parseShellCommandIntents("rg foo src >/dev/null")).toEqual([{ type: "search", query: "foo", path: "src" }])
  })
})

describe("itemActivityIntents — structured claude tools", () => {
  it("maps Read to a read intent", () => {
    expect(itemActivityIntents(tool("Read", { file_path: "/x/y.ts" }))).toEqual([
      { type: "read", name: "Read", path: "/x/y.ts" },
    ])
  })

  it("maps Grep to a search intent", () => {
    expect(itemActivityIntents(tool("Grep", { pattern: "foo", path: "src" }))).toEqual([
      { type: "search", query: "foo", path: "src" },
    ])
  })

  it("maps Glob/LS to a list intent", () => {
    expect(itemActivityIntents(tool("Glob", { pattern: "**/*.ts" }))).toEqual([{ type: "list_files", path: "**/*.ts" }])
  })

  it("returns [] for a non-exploration tool", () => {
    expect(itemActivityIntents(tool("WebSearch", { q: "x" }))).toEqual([])
  })
})

describe("summarizeWork + buildWorkSummaryLabel", () => {
  it("counts explored files distinctly", () => {
    const counts = summarizeWork([cmd("cat a.ts"), cmd("cat a.ts"), cmd("cat b.ts")])
    expect(counts.files).toBe(2)
  })

  it("labels a mix of exploration, commands, and file changes", () => {
    const items = [
      cmd("rg foo src"),
      cmd("npm run build"),
      fileChange("x.ts", "add", "+1"),
    ]
    const label = buildWorkSummaryLabel(items, false)
    // Phrases join in encounter order; only the first keeps its leading capital (joinPhrases).
    expect(label).toBe("Explored 1 search, ran 1 command, created 1 file")
  })

  it("uses gerund verbs when active", () => {
    expect(buildWorkSummaryLabel([cmd("npm test")], true)).toBe("Running 1 command")
    expect(buildWorkSummaryLabel([cmd("npm test")], false)).toBe("Ran 1 command")
  })

  it("falls back to Working/Worked with no items", () => {
    expect(buildWorkSummaryLabel([], true)).toBe("Working")
    expect(buildWorkSummaryLabel([], false)).toBe("Worked")
  })

  it("does not count a real-file write as exploration (it becomes a command)", () => {
    const label = buildWorkSummaryLabel([cmd("rg foo src > out.txt")], false)
    expect(label).toBe("Ran 1 command")
  })

  it("counts created/edited/deleted file changes", () => {
    const counts = summarizeWork([
      fileChange("a.ts", "add", "+1"),
      fileChange("b.ts", "update", "-1\n+2"),
      fileChange("c.ts", "delete", "-1"),
    ])
    expect(counts.createdFiles).toBe(1)
    expect(counts.editedFiles).toBe(1)
    expect(counts.deletedFiles).toBe(1)
  })
})
