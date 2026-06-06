// ClaudeWorker turn-loop tests. The SDK's query() is injected (ClaudeWorkerOpts.queryFn — the
// claude analogue of CodexWorker's spawnChild seam): tests script the message stream and observe
// the Options the worker built. This is what asserts the canUseTool gate is actually WIRED into
// the SDK call — checkTool's own classification semantics are covered in factory.test.ts.

import { test } from "node:test"
import assert from "node:assert/strict"
import { ClaudeWorker, type QueryFn } from "../src/worker/claude.ts"
import { AgentError, AgentInterrupted, type WorkerContext, type WorkerProgress } from "../src/worker/index.ts"
import type { AgentSpec } from "../src/dsl/types.ts"
import type { Options, PermissionResult, SDKMessage } from "@anthropic-ai/claude-agent-sdk"

interface QueryCall {
  prompt: string
  options: Options
}

/** A QueryFn that records its call and replays a scripted message sequence. */
function scripted(messages: unknown[], calls: QueryCall[] = []): QueryFn {
  return (params) => {
    calls.push(params as QueryCall)
    return (async function* () {
      yield* messages as SDKMessage[]
    })()
  }
}

function assistantMsg(blocks: unknown): unknown {
  return { type: "assistant", message: { content: blocks } }
}
function userMsg(blocks: unknown): unknown {
  return { type: "user", message: { content: blocks } }
}
/** A success result message (override `subtype`/`usage`/… for the error shapes). */
function resultMsg(over: Record<string, unknown> = {}): unknown {
  return {
    type: "result",
    subtype: "success",
    result: "all done",
    usage: { input_tokens: 10, output_tokens: 4 },
    total_cost_usd: 0.01,
    ...over,
  }
}

function ctx(signal?: AbortSignal): WorkerContext & { events: WorkerProgress[] } {
  const events: WorkerProgress[] = []
  return { signal: signal ?? new AbortController().signal, onProgress: (e) => events.push(e), events }
}

function spec(over: Partial<AgentSpec> = {}): AgentSpec {
  return { prompt: "do the thing", provider: "claude-code", cwd: "/work/repo", sandbox: "workspace-write", approval: "never", ...over }
}

/** The shape the worker installs (the SDK type carries an extra options param we don't use). */
type Gate = (toolName: string, input: Record<string, unknown>) => Promise<PermissionResult>

function tick(): Promise<void> {
  return new Promise((r) => setImmediate(r))
}

// ===========================================================================
// canUseTool wiring — deleting the canUseTool option must fail these tests
// ===========================================================================

test("canUseTool is wired into the SDK options and enforces the spec's sandbox + cwd", async () => {
  const calls: QueryCall[] = []
  const worker = new ClaudeWorker({ queryFn: scripted([resultMsg()], calls) })
  await worker.runAgent(spec({ sandbox: "workspace-write", cwd: "/work/repo" }), ctx())
  const gate = calls[0]!.options.canUseTool as Gate | undefined
  assert.ok(gate, "options.canUseTool must be installed — without it workspace-write is unenforced")
  const denied = await gate("Write", { file_path: "/etc/passwd" })
  assert.equal(denied.behavior, "deny")
  assert.match((denied as { message: string }).message, /outside the workspace/)
  const input = { file_path: "/work/repo/ok.txt", content: "x" }
  const allowed = await gate("Write", input)
  assert.equal(allowed.behavior, "allow")
  assert.equal((allowed as { updatedInput: unknown }).updatedInput, input) // input passed through untouched
})

test("canUseTool carries the spec's SANDBOX through (read-only denies writes, allows read Bash)", async () => {
  const calls: QueryCall[] = []
  const worker = new ClaudeWorker({ queryFn: scripted([resultMsg()], calls) })
  await worker.runAgent(spec({ sandbox: "read-only" }), ctx())
  const gate = calls[0]!.options.canUseTool as Gate
  assert.equal((await gate("Bash", { command: "rm -rf x" })).behavior, "deny")
  assert.equal((await gate("Bash", { command: "git log --oneline" })).behavior, "allow")
  assert.equal((await gate("Write", { file_path: "/work/repo/x" })).behavior, "deny")
})

// ===========================================================================
// runAgent — happy path, options mapping, structured output
// ===========================================================================

test("happy path: result text + usage (cache tokens fold into inputTokens)", async () => {
  const calls: QueryCall[] = []
  const worker = new ClaudeWorker({
    queryFn: scripted(
      [resultMsg({ usage: { input_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, output_tokens: 4 }, total_cost_usd: 0.05 })],
      calls,
    ),
  })
  const res = await worker.runAgent(spec(), ctx())
  assert.equal(res.text, "all done")
  assert.equal(res.status, "completed")
  assert.equal(res.structured, undefined) // no schema on the spec → structured stays absent
  assert.equal(res.usage.inputTokens, 240)
  assert.equal(res.usage.outputTokens, 4)
  assert.equal(res.usage.costUsd, 0.05)
  assert.equal(calls[0]!.prompt, "do the thing")
})

test("spec → SDK options: cwd/model/maxTurns/effort floor/instructions preset append", async () => {
  const calls: QueryCall[] = []
  const worker = new ClaudeWorker({ queryFn: scripted([resultMsg()], calls), model: "default-model" })
  await worker.runAgent(spec({ model: "claude-x", maxTurns: 7, effort: "none", instructions: "be terse" }), ctx())
  const o = calls[0]!.options
  assert.equal(o.cwd, "/work/repo")
  assert.equal(o.model, "claude-x") // spec.model wins over the worker default
  assert.equal(o.maxTurns, 7)
  assert.equal(o.effort, "low") // codex-only "none" maps to the SDK floor
  assert.deepEqual(o.systemPrompt, { type: "preset", preset: "claude_code", append: "be terse" })
  assert.equal(o.permissionMode, "default")
  assert.deepEqual(o.settingSources, [])

  await worker.runAgent(spec(), ctx()) // no spec.model/effort/instructions
  const o2 = calls[1]!.options
  assert.equal(o2.model, "default-model")
  assert.equal(o2.effort, undefined)
  assert.equal(o2.systemPrompt, undefined)
})

test("schema spec: outputFormat is sent and structured_output comes back on the result", async () => {
  const schema = { type: "object", properties: { answer: { type: "number" } }, required: ["answer"] }
  const calls: QueryCall[] = []
  const worker = new ClaudeWorker({ queryFn: scripted([resultMsg({ structured_output: { answer: 42 } })], calls) })
  const res = await worker.runAgent(spec({ schema }), ctx())
  assert.deepEqual(calls[0]!.options.outputFormat, { type: "json_schema", schema })
  assert.deepEqual(res.structured, { answer: 42 })
  // without a schema the same SDK field is ignored and no outputFormat is sent
  const calls2: QueryCall[] = []
  const w2 = new ClaudeWorker({ queryFn: scripted([resultMsg({ structured_output: { answer: 42 } })], calls2) })
  const r2 = await w2.runAgent(spec(), ctx())
  assert.equal(r2.structured, undefined)
  assert.equal(calls2[0]!.options.outputFormat, undefined)
})

// ===========================================================================
// progress mapping
// ===========================================================================

test("progress mapping: text/thinking/tool_use/tool_result → WorkerProgress events in order", async () => {
  const c = ctx()
  const worker = new ClaudeWorker({
    queryFn: scripted([
      assistantMsg([
        { type: "text", text: "hello" },
        { type: "thinking", thinking: "hmm" },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ]),
      userMsg([{ type: "tool_result", tool_use_id: "t1", content: "file.txt", is_error: false }]),
      // non-string tool_result content is JSON-stringified; is_error maps through
      userMsg([{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "x" }], is_error: true }]),
      resultMsg(),
    ]),
  })
  await worker.runAgent(spec(), c)
  assert.deepEqual(c.events, [
    { kind: "text", text: "hello" },
    { kind: "reasoning", text: "hmm" },
    { kind: "tool", id: "t1", name: "Bash", input: { command: "ls" } },
    { kind: "tool-result", id: "t1", output: "file.txt", isError: false },
    { kind: "tool-result", id: "t2", output: '[{"type":"text","text":"x"}]', isError: true },
  ])
})

test("malformed/unknown blocks and message types are skipped without crashing", async () => {
  const c = ctx()
  const worker = new ClaudeWorker({
    queryFn: scripted([
      { type: "system", subtype: "init" }, // unrelated message type
      assistantMsg(["raw string", null, { type: "text" }, { type: "thinking", thinking: 42 }, { type: "tool_use", name: 7 }]),
      assistantMsg("not-an-array"),
      userMsg("not-an-array"),
      resultMsg(),
    ]),
  })
  const res = await worker.runAgent(spec(), c)
  assert.equal(res.text, "all done")
  assert.deepEqual(c.events, [])
})

// ===========================================================================
// result-loop failure paths
// ===========================================================================

test("a stream that ends without a result message → no_result (and is NOT re-wrapped as sdk_error)", async () => {
  const empty = new ClaudeWorker({ queryFn: scripted([]) })
  await assert.rejects(empty.runAgent(spec(), ctx()), (e) => e instanceof AgentError && e.code === "no_result" && e.retryable === false)
  // a stream with progress but no terminal result is equally incomplete
  const partial = new ClaudeWorker({ queryFn: scripted([assistantMsg([{ type: "text", text: "thinking…" }])]) })
  await assert.rejects(partial.runAgent(spec(), ctx()), (e) => e instanceof AgentError && e.code === "no_result")
})

test("non-success result → AgentError with the subtype as code; retryable only for rate/overload shapes", async () => {
  async function failWith(subtype: string): Promise<AgentError> {
    const worker = new ClaudeWorker({ queryFn: scripted([resultMsg({ subtype })]) })
    const err = await worker.runAgent(spec(), ctx()).catch((e) => e)
    assert.ok(err instanceof AgentError, `subtype ${subtype} must surface as AgentError`)
    return err
  }
  const maxTurns = await failWith("error_max_turns") // terminal cap: never retry
  assert.equal(maxTurns.code, "error_max_turns")
  assert.equal(maxTurns.retryable, false)
  assert.match(maxTurns.message, /claude result: error_max_turns/)
  assert.equal((await failWith("error_overloaded_529")).retryable, true)
  assert.equal((await failWith("error_rate_limited")).retryable, true)
  assert.equal((await failWith("error_during_execution")).retryable, false)
})

test("a failed turn's AgentError carries cache-inclusive usage (failed turns still bill)", async () => {
  const worker = new ClaudeWorker({
    queryFn: scripted([
      resultMsg({
        subtype: "error_during_execution",
        usage: { input_tokens: 100, cache_read_input_tokens: 4000, cache_creation_input_tokens: 500, output_tokens: 42 },
        total_cost_usd: 0.07,
      }),
    ]),
  })
  const err = await worker.runAgent(spec(), ctx()).catch((e) => e)
  assert.ok(err instanceof AgentError)
  assert.equal(err.usage?.inputTokens, 4600)
  assert.equal(err.usage?.outputTokens, 42)
  assert.equal(err.usage?.costUsd, 0.07)
})

test("an SDK throw is wrapped as retryable sdk_error (message preserved)", async () => {
  const midStream = new ClaudeWorker({
    queryFn: () =>
      (async function* (): AsyncGenerator<SDKMessage> {
        yield assistantMsg([{ type: "text", text: "partial" }]) as SDKMessage
        throw new Error("socket hung up")
      })(),
  })
  await assert.rejects(
    midStream.runAgent(spec(), ctx()),
    (e) => e instanceof AgentError && e.code === "sdk_error" && e.retryable === true && /socket hung up/.test(e.message),
  )
  const syncThrow = new ClaudeWorker({
    queryFn: () => {
      throw new Error("spawn failed")
    },
  })
  await assert.rejects(syncThrow.runAgent(spec(), ctx()), (e) => e instanceof AgentError && e.code === "sdk_error" && /spawn failed/.test(e.message))
})

// ===========================================================================
// abort semantics
// ===========================================================================

test("abort mid-query → AgentInterrupted, and the abort is PROPAGATED to the SDK's abortController", async () => {
  const ac = new AbortController()
  const calls: QueryCall[] = []
  const queryFn: QueryFn = (params) => {
    calls.push(params as QueryCall)
    return (async function* (): AsyncGenerator<SDKMessage> {
      // Hang until the worker-side controller fires (proves the ctx.signal → abortController
      // wiring), then throw the way the SDK does on abort. The ctx-signal backstop keeps a
      // broken wiring from hanging the test — the post-reject assert catches it instead.
      await new Promise<void>((resolve) => {
        params.options.abortController?.signal.addEventListener("abort", () => resolve(), { once: true })
        ac.signal.addEventListener("abort", () => setTimeout(resolve, 50), { once: true })
      })
      throw new Error("aborted")
    })()
  }
  const worker = new ClaudeWorker({ queryFn })
  const run = worker.runAgent(spec(), ctx(ac.signal))
  await tick()
  ac.abort()
  await assert.rejects(run, (e) => e instanceof AgentInterrupted)
  assert.equal(calls[0]!.options.abortController?.signal.aborted, true, "ctx.signal abort must propagate to the SDK controller")
})

test("the abort listener is removed once the turn settles (no leak onto a later ctx abort)", async () => {
  const ac = new AbortController()
  const calls: QueryCall[] = []
  const worker = new ClaudeWorker({ queryFn: scripted([resultMsg()], calls) })
  await worker.runAgent(spec(), ctx(ac.signal))
  ac.abort()
  assert.equal(calls[0]!.options.abortController?.signal.aborted, false, "a leaked listener aborted the finished turn's controller")
})
