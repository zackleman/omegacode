// Named-workflow registry: tier precedence (project > user > builtin), meta.name matching,
// walk-up project discovery, skip rules, and the CLI surface (workflows / save / run-by-name).
// Filesystem-touching parts are scoped to temp dirs + a temp OMEGACODE_HOME; the builtin tier
// resolves package-relative so the repo's builtins/ workflows are always visible.

import { strict as assert } from "node:assert"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, afterEach, before, describe, test } from "node:test"

import { builtinDir, listWorkflows, resolveWorkflowName, WorkflowNotFoundError } from "../src/runtime/registry.ts"

const CLI_ENTRY = fileURLToPath(new URL("../src/cli.ts", import.meta.url))
// Absolute URL so `--import` works when the child's cwd is a temp project dir (a bare "tsx"
// specifier resolves against the child cwd, where there is no node_modules).
const TSX = import.meta.resolve("tsx")

/** Write a minimal valid workflow claiming `metaName` to dir/filename. */
function writeWorkflow(dir: string, metaName: string, filename = `${metaName}.workflow.js`): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, filename)
  writeFileSync(
    file,
    `export const meta = { name: ${JSON.stringify(metaName)}, description: "test workflow ${metaName}" }\n` +
      `return await agent("say hi")\n`,
  )
  return file
}

/** A temp project root with a .git marker so the walk-up never escapes the temp tree. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "omega-registry-proj-"))
  mkdirSync(join(root, ".git"))
  return root
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[], env: Record<string, string> = {}, cwd?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", TSX, CLI_ENTRY, ...args], {
      env: { ...process.env, ...env },
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d))
    child.stderr.on("data", (d) => (stderr += d))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, stdout, stderr }))
  })
}

describe("registry resolution", () => {
  let home: string
  let project: string
  const savedHome = process.env.OMEGACODE_HOME

  before(() => {
    home = mkdtempSync(join(tmpdir(), "omega-registry-home-"))
    project = makeProject()
    process.env.OMEGACODE_HOME = home
  })
  after(() => {
    if (savedHome === undefined) delete process.env.OMEGACODE_HOME
    else process.env.OMEGACODE_HOME = savedHome
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })
  afterEach(() => {
    // Each test writes into these two tiers; reset them so cases stay independent.
    rmSync(join(home, "workflows"), { recursive: true, force: true })
    rmSync(join(project, ".omegacode"), { recursive: true, force: true })
  })

  test("matches by meta.name, not filename", () => {
    writeWorkflow(join(home, "workflows"), "real-name", "totally-different-file.js")
    const hit = resolveWorkflowName("real-name", project)
    assert.ok(hit.endsWith("totally-different-file.js"))
    assert.throws(() => resolveWorkflowName("totally-different-file", project), WorkflowNotFoundError)
  })

  test("project beats user beats builtin on the same name", () => {
    const userFile = writeWorkflow(join(home, "workflows"), "dupe")
    assert.equal(resolveWorkflowName("dupe", project), userFile)
    const projFile = writeWorkflow(join(project, ".omegacode", "workflows"), "dupe")
    assert.equal(resolveWorkflowName("dupe", project), projFile)

    // Shadow a builtin from the user tier.
    const shadow = writeWorkflow(join(home, "workflows"), "deep-research")
    assert.equal(resolveWorkflowName("deep-research", project), shadow)
  })

  test("builtins resolve with empty project/user tiers, regardless of OMEGACODE_HOME", () => {
    const hit = resolveWorkflowName("deep-research", project)
    assert.ok(hit.startsWith(builtinDir()), `expected a builtin path, got ${hit}`)
    assert.ok(resolveWorkflowName("code-review", project).endsWith("code-review.workflow.js"))
  })

  test("walk-up finds a parent .omegacode/workflows and a nearer dir shadows it", () => {
    const rootFile = writeWorkflow(join(project, ".omegacode", "workflows"), "walk")
    const nested = join(project, "packages", "app")
    mkdirSync(nested, { recursive: true })
    assert.equal(resolveWorkflowName("walk", nested), rootFile)

    const nearFile = writeWorkflow(join(nested, ".omegacode", "workflows"), "walk")
    assert.equal(resolveWorkflowName("walk", nested), nearFile)
  })

  test("walk-up stops at the repo boundary (.git)", () => {
    // A workflow ABOVE the repo root must not be visible from inside it.
    const outer = mkdtempSync(join(tmpdir(), "omega-registry-outer-"))
    try {
      writeWorkflow(join(outer, ".omegacode", "workflows"), "outside")
      const repo = join(outer, "repo")
      mkdirSync(join(repo, ".git"), { recursive: true })
      assert.throws(() => resolveWorkflowName("outside", repo), WorkflowNotFoundError)
    } finally {
      rmSync(outer, { recursive: true, force: true })
    }
  })

  test("skips invalid-meta and oversize files without crashing", () => {
    const dir = join(home, "workflows")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "broken.js"), "this is not a workflow at all {{{\n")
    writeFileSync(
      join(dir, "huge.js"),
      `export const meta = { name: "huge", description: "too big" }\n` + `// ${"x".repeat(600_000)}\n`,
    )
    writeWorkflow(dir, "good")

    const names = listWorkflows(project).map((e) => e.name)
    assert.ok(names.includes("good"))
    assert.ok(!names.includes("huge"), "oversize file must be skipped")
    assert.throws(() => resolveWorkflowName("huge", project), WorkflowNotFoundError)
  })

  test("miss throws WorkflowNotFoundError listing what IS available", () => {
    writeWorkflow(join(home, "workflows"), "present")
    try {
      resolveWorkflowName("absent", project)
      assert.fail("expected WorkflowNotFoundError")
    } catch (err) {
      assert.ok(err instanceof WorkflowNotFoundError)
      assert.match(err.message, /"absent" not found/)
      assert.match(err.message, /present/)
      assert.match(err.message, /deep-research/) // builtins are part of "available"
    }
  })

  test("listWorkflows returns winners only, with tier and description", () => {
    writeWorkflow(join(home, "workflows"), "deep-research") // shadows the builtin
    const entries = listWorkflows(project)
    const dr = entries.filter((e) => e.name === "deep-research")
    assert.equal(dr.length, 1, "shadowed builtin must not appear twice")
    assert.equal(dr[0]!.tier, "user")
    assert.equal(dr[0]!.description, "test workflow deep-research")
    assert.equal(entries.find((e) => e.name === "code-review")?.tier, "builtin")
  })
})

describe("registry CLI (workflows / save / run-by-name)", () => {
  let home: string
  let project: string

  before(() => {
    home = mkdtempSync(join(tmpdir(), "omega-registry-cli-home-"))
    project = makeProject()
  })
  after(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  const env = () => ({ OMEGACODE_HOME: home })

  test("save → workflows → run <name> --fake round-trip", async () => {
    const src = writeWorkflow(project, "roundtrip", "anything.js")

    const save = await runCli(["save", src], env(), project)
    assert.equal(save.code, 0, `stderr=${save.stderr}`)
    assert.match(save.stdout, /saved "roundtrip"/)
    assert.match(save.stdout, /roundtrip\.workflow\.js/)

    const list = await runCli(["workflows", "--json"], env(), project)
    assert.equal(list.code, 0, `stderr=${list.stderr}`)
    const entries = JSON.parse(list.stdout) as Array<{ name: string; tier: string; description: string }>
    const hit = entries.find((e) => e.name === "roundtrip")
    assert.equal(hit?.tier, "user")
    assert.ok(entries.some((e) => e.name === "deep-research" && e.tier === "builtin"))

    const run = await runCli(["run", "roundtrip", "--fake", "--no-serve", "--json"], env(), project)
    assert.equal(run.code, 0, `stderr=${run.stderr}`)
    assert.equal(JSON.parse(run.stdout).status, "completed")

    const validate = await runCli(["validate", "roundtrip"], env(), project)
    assert.equal(validate.code, 0, `stderr=${validate.stderr}`)
    assert.match(validate.stdout, /ok: "roundtrip"/)
  })

  test("run by name keeps the NAME in the resume hint, not the resolved path", async () => {
    writeWorkflow(join(home, "workflows"), "hinted")
    const r = await runCli(["run", "hinted", "--fake", "--no-serve"], env(), project)
    assert.equal(r.code, 0, `stderr=${r.stderr}`)
    assert.match(r.stderr, /omegacode run hinted --resume wf_/)
  })

  test("save --project writes into <cwd>/.omegacode/workflows", async () => {
    const src = writeWorkflow(project, "proj-saved", "src.js")
    const r = await runCli(["save", src, "--project"], env(), project)
    assert.equal(r.code, 0, `stderr=${r.stderr}`)
    // join() so the assertion holds on Windows path separators too.
    assert.ok(r.stdout.includes(join(".omegacode", "workflows", "proj-saved.workflow.js")), r.stdout)
  })

  test("re-save refuses without --force, succeeds with it", async () => {
    const src = writeWorkflow(project, "twice", "twice-src.js")
    const first = await runCli(["save", src], env(), project)
    assert.equal(first.code, 0, `stderr=${first.stderr}`)

    const again = await runCli(["save", src], env(), project)
    assert.equal(again.code, 1)
    assert.match(again.stderr, /already exists/)
    assert.ok(!again.stderr.includes("    at "), "should be a clean message, not a stack")

    const forced = await runCli(["save", src, "--force"], env(), project)
    assert.equal(forced.code, 0, `stderr=${forced.stderr}`)
  })

  test("save rejects a file with invalid meta, cleanly", async () => {
    const bad = join(project, "bad.js")
    writeFileSync(bad, `export const meta = { description: "no name" }\nreturn 1\n`)
    const r = await runCli(["save", bad], env(), project)
    assert.equal(r.code, 1)
    assert.ok(!r.stderr.includes("    at "), `should be a clean message, got: ${r.stderr}`)
  })

  test("run with a path-looking arg that doesn't exist errors instead of registry lookup", async () => {
    for (const arg of ["./missing.workflow.js", "missing-dir/wf.js", "missing.js"]) {
      const r = await runCli(["run", arg, "--fake", "--no-serve"], env(), project)
      assert.equal(r.code, 1, `arg=${arg}`)
      assert.match(r.stderr, /workflow file not found/, `arg=${arg}`)
    }
  })

  test("run with an unknown bare name lists what's available", async () => {
    const r = await runCli(["run", "no-such-workflow", "--fake", "--no-serve"], env(), project)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /workflow "no-such-workflow" not found/)
    assert.match(r.stderr, /deep-research/)
    assert.ok(!r.stderr.includes("    at "), "should be a clean message, not a stack")
  })
})
