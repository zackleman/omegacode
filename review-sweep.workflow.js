export const meta = {
  name: "review-sweep-fix",
  description: "Fix all 132 review findings across 9 disjoint subsystems + exhaustive tests, with gate, adversarial review, repair, and completeness critic",
  phases: [
    { title: "Fix", detail: "9 subsystem agents in parallel, disjoint file ownership, each fixes + writes tests" },
    { title: "Gate", detail: "build doctor: typecheck + full test suite + builds, fix integration fallout" },
    { title: "Review", detail: "adversarial per-finding diff review, one reviewer per subsystem" },
    { title: "Repair", detail: "fix flagged verdicts, re-gate" },
    { title: "Critic", detail: "completeness check vs the full report" },
    { title: "Final", detail: "close small gaps, final green gate" },
  ],
}

const REPO = "/Users/sawyerhood/omegacode"
const REPORT = `${REPO}/CODEBASE_REVIEW.md`
const BASELINE = args.baseline

const FIX_RESULT = {
  type: "object",
  required: ["fixed", "skipped", "testsAdded", "summary"],
  properties: {
    fixed: { type: "array", items: { type: "string" } },
    skipped: { type: "array", items: { type: "object", required: ["id", "reason"], properties: { id: { type: "string" }, reason: { type: "string" } } } },
    testsAdded: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
}

const GATE_RESULT = {
  type: "object",
  required: ["green", "summary"],
  properties: {
    green: { type: "boolean" },
    summary: { type: "string" },
    blockers: { type: "array", items: { type: "string" } },
  },
}

const REVIEW_RESULT = {
  type: "object",
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "status", "note"],
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["fixed", "incomplete", "regression", "not-attempted"] },
          note: { type: "string" },
        },
      },
    },
  },
}

const CRITIC_RESULT = {
  type: "object",
  required: ["gaps"],
  properties: {
    gaps: {
      type: "array",
      items: {
        type: "object",
        required: ["owner", "what", "size"],
        properties: {
          owner: { type: "string" },
          what: { type: "string" },
          size: { type: "string", enum: ["small", "medium", "large"] },
        },
      },
    },
  },
}

const SUBSYSTEMS = [
  {
    key: "runtime-core",
    files: ["src/runtime/primitives.ts", "src/runtime/keys.ts", "src/runtime/journal.ts", "src/runtime/run.ts", "src/runtime/semaphore.ts"],
    tests: ["test/keys.test.ts", "test/journal.test.ts", "test/primitives.test.ts", "test/semaphore.test.ts", "test/resume.test.ts"],
    findings: "C1, H6, H7, H8, M4 (the WIRING half: wrap worker.runAgent in withRetry at primitives.ts:214 using the EXISTING withRetry signature from src/worker/errors.ts — another agent is fixing its classification but will NOT change its signature), M10, M11, M12 (the run.ts/Semaphore-assert half; the CLI validation half belongs to another agent), M21, L5 (the run.ts pass-through half: pass claudeModel/pathToClaudeCodeExecutable into the factory; the factory half belongs to another agent), L10, L11, L12 (you own the primitives.ts side: name transcript files by journal key instead of positional index; transcript.ts itself belongs to another agent — keep its API call shape), L13",
    notes: `THE BIG ONE — C1 per-branch key lineage: replace the global mutable prevKey with a per-branch KeyContext so every parallel() thunk and pipeline() (item, stage) chains keys off hash(parentKey, kind, index) instead of wall-clock completion order. Make the deterministic time/rng substreams and agent indices per-branch-deterministic too. Bump KEY_VERSION. Also implement the report's rec #4: honor cached.status on replay (a journaled FAILED result must not replay as success), verify fileHash/args/keyVersion preconditions on resume, and fail fast on duplicate explicit opts.key values. Your test/resume.test.ts MUST include the acceptance test the report calls for: a parallel() workflow with deliberately staggered completion order whose resume gets 100% cache hits — this test must fail against the old design and pass with yours. Use the FakeWorker (src/worker/fake.ts) for runtime tests; another agent is fixing its schema-synthesis bugs in parallel, so prefer schemaless fake agents or simple object schemas in your tests.`,
  },
  {
    key: "codex-worker",
    files: ["src/worker/codex.ts", "src/worker/codex-protocol.ts"],
    tests: ["test/codex-protocol.test.ts", "test/codex-worker.test.ts"],
    findings: "H1, H2, H3, H5, M1, M2, M3, M30, M32, L1, L2, L3",
    notes: `Hang-prevention cluster. L3 (extracting a JsonRpcStdioClient that owns child + framing + pending map with a guaranteed settle-on-death invariant) is RECOMMENDED because it makes H1/M1/M2 testable with a scripted fake child process — if you extract, the new file src/worker/jsonrpc-stdio.ts is yours. Do NOT change the Worker interface (runAgent signature) — other agents depend on it. H3: fail CLOSED — decline commandExecution approvals under read-only sandboxes and decline anything with missing TurnState. H5: resolve the double-count by using tokenUsage.last per turn (or only the extraction turn's total) — read the protocol types carefully and leave a comment stating which semantics you verified. Write protocol/worker tests against a fake stdio child (a small node script or in-process Readable/Writable pair).`,
  },
  {
    key: "worker-shared",
    files: ["src/worker/claude.ts", "src/worker/fake.ts", "src/worker/schema.ts", "src/worker/errors.ts", "src/worker/factory.ts", "src/worker/index.ts"],
    tests: ["test/schema.test.ts", "test/fake-worker.test.ts", "test/errors.test.ts", "test/factory.test.ts"],
    findings: "H4, M5 (the factory half: exhaustive provider switch that throws on unknown ids; CLI-side validation belongs to another agent), M6, M7, M8, L4, L5 (the factory half: actually consume claudeModel/pathToClaudeCodeExecutable), L6, L7, L8, L9 — plus the CLASSIFICATION half of M4: error_max_turns must not be retryable, and fix the broken sleep in errors.ts (L4) using node:timers/promises setTimeout with the abort signal. CRITICAL CONSTRAINT: do NOT change the exported signature of withRetry — another agent is wiring call sites against it concurrently.",
    notes: `H4: make claude-code workspace-write real — enforce write-tool paths against spec.cwd and gate Bash via the Agent SDK permission hooks (canUseTool or equivalent); read-only should still allow harmless read-only Bash if you can do it safely, but correctness of the write boundary comes first. M7: FakeWorker must honor its own validation result and synthesize constraint-aware values (enum -> first member, const -> the value, minItems/min/max bounds respected) and throw loudly if still invalid. M6: strictification must give optional fields a real null escape for enum/const/anyOf/$ref/typeless schemas. Schema round-trip tests should cover every shape listed in M6/L7/L9.`,
  },
  {
    key: "runtime-infra",
    files: ["src/runtime/sandbox.ts", "src/runtime/worktree.ts", "src/runtime/transcript.ts", "src/runtime/event-sink.ts", "src/runtime/events.ts", "src/runtime/progress.ts"],
    tests: ["test/sandbox.test.ts", "test/worktree.test.ts", "test/transcript.test.ts", "test/event-sink.test.ts"],
    findings: "H9, H10, H11, M13, M14, M15, M16, M17, L14, L15, L16",
    notes: `H10: record the base commit at worktree CREATION time and compare against that at teardown; any detection failure must be treated as dirty (preserve, never force-delete). H9: a leftover worktree path from a crashed attempt must be pruned or reused so resume works. Worktree tests should build real throwaway git repos under a tmpdir. H11/L16: extract one JsonlWriter used by both transcript.ts and event-sink.ts with an error handler that degrades to best-effort instead of crashing the run. M13: async sandbox execution must be raceable against the abort signal/timeout, not just the sync portion. Note: another agent owns primitives.ts and will start passing journal-key-derived transcript filenames — keep the external API shape of transcript.ts stable.`,
  },
  {
    key: "cli",
    files: ["src/cli.ts"],
    tests: ["test/cli.test.ts"],
    findings: "H12, H13, H14, M5 (the CLI-side validation half), M12 (the CLI-side validation half), M18, M19, M20, M22, L17",
    notes: `M18 is the keystone: rebuild parseArgs with a known-boolean-flag set and --flag=value support so --fake/--json/--open/--no-serve can never consume a value, then per-flag validation with friendly usage errors for --keep, --concurrency, --budget, --port, --resume, --provider, --sandbox, --effort (H12, H14, M5, M12, M20). H13: openBrowser needs an error listener and the win32 form: cmd /c start "" <url>. M22: ensureViewer must have a real failure path — no URL claims when the viewer never came up. L17: route error classification through typed error classes (WorkflowSyntaxError already exists) instead of regex over prose; you may import existing classes from src/runtime / src/worker but do not edit those files. Export parseArgs (or restructure minimally) so test/cli.test.ts can unit-test it directly; also add a spawn-based smoke test using --fake.`,
  },
  {
    key: "server",
    files: ["src/server/serve.ts"],
    tests: ["test/serve.test.ts"],
    findings: "H15, H17 (the SERVER half), M23, M24, M25, L20, L21",
    notes: `You may split helpers into new files under src/server/ if it aids testability. H15: register close/error cleanup BEFORE any awaited replay work. H17 server half: emit SSE id: frames carrying the byte offset and honor Last-Event-ID on reconnect so EventSource resume is dedup-correct (the viewer agent is independently making the client reset buffers on onopen — byte-offset ids are the agreed contract). M23: fs.watch on a not-yet-existing directory must retry/poll or watch the nearest existing ancestor so early-opened agent streams eventually deliver. M24: chunked replay with partial-line carry instead of one whole-file alloc. M25: cache run summaries keyed by (runId, size/mtime), async stat. Tests: spin the real server on an ephemeral port against a temp data dir fixture with synthetic runs; cover tailJsonl offsets/truncation, SSE replay + Last-Event-ID resume, disconnect-during-replay cleanup, and the missing-dir watch.`,
  },
  {
    key: "viewer",
    files: ["viewer/src/** (all of it)", "viewer/package.json", "viewer/vite.config.ts or a new vitest config"],
    tests: ["viewer/src/**/*.test.ts colocated or viewer/src/__tests__/ — your choice"],
    findings: "H16, H17 (the CLIENT half: reset accumulated buffers on EventSource onopen; the server is adding byte-offset id: frames + Last-Event-ID handling), H18, H19 (CLIENT-side fix: the run list already shows staleness correctly via the snapshot endpoint — make RunDetail/AgentChat/fold consume the same signal, e.g. poll the snapshot status or thread heartbeat info into the fold, so a SIGKILLed run stops rendering a live spinner), M26, M27, M28, M29, L22, L23, L24, L25, L26, L27, L28, L29",
    notes: `Set up vitest in viewer/ (pnpm add -D vitest in the viewer dir; add a test script to viewer/package.json) and write thorough unit tests for the pure data layer: fold.ts, to-thread-events.ts, work-summary.ts (shell tokenizer fd-redirect cases from L24!), format.ts (L22 sub-dollar costs), hooks-level reducer logic where extractable. If pnpm install fails in your environment, fall back to wiring vitest via npm in viewer/ — do NOT touch the ROOT package.json (another agent owns it). L29 dead-code deletion: grep for imports before deleting anything; if a dead-looking primitive is actually imported anywhere, leave it and note it. M27/M28 are performance: batch SSE replay folds per animation frame and make ANSI->HTML conversion incremental — verify the viewer still builds (pnpm -C viewer build) after your changes.`,
  },
  {
    key: "packaging",
    files: ["package.json (root)", "tsup.config.ts", "src/index.ts", "src/dsl/types.ts", "src/dsl/ambient.d.ts", "new scripts/*.mjs build helpers if needed"],
    tests: ["test/packaging.test.ts"],
    findings: "M31, L18, L19",
    notes: `Make the published package real for TypeScript consumers: dts generation for the main entry (tsup dts: true or a tsc declaration pass), a types condition in exports, and an ./ambient subpath export whose d.ts is SELF-CONTAINED in the tarball (no imports of files outside the files whitelist). Export the missing public types (WorkflowBudget, EventListener, and anything else src/index.ts exposes untyped). L18: add the codex "none" effort level to the Effort union. L19: replace the POSIX-only rm -rf/cp -r onSuccess with a portable node script, and make ONE coherent package-manager story for a fresh clone -> install -> build -> npm pack (root currently npm + viewer pnpm; pick the smallest consistent fix and make prepublishOnly survive it — e.g. ensure the viewer deps are installed before its build). test/packaging.test.ts should assert npm pack --dry-run contains dist/, dist/index.d.ts, the ambient d.ts, LICENSE, and no surprises you did not intend. Do not edit viewer/package.json (another agent owns it) — coordinate only through root scripts. NOTE: a prior partial sweep already landed some of this (exports/types/files/scripts in package.json, scripts/build-viewer.mjs, scripts/postbuild.mjs) — verify what exists, finish what is missing, and make sure it all actually works.`,
  },
  {
    key: "docs",
    files: ["README.md", "DESIGN.md", "PARITY.md"],
    tests: [],
    findings: "rec #12 from the architecture section",
    notes: `Reconcile docs with reality: README currently UNDERSELLS (calls the working codex worker a stub); DESIGN.md lists phantom modules and unshipped CLI features (--resume-last, tail, config, detach) — remove or mark them as future work, do NOT implement them; state that skill/SKILL.md is the canonical usage doc. Read the actual source to verify every claim you write. Note: many findings are being fixed in parallel right now, so describe current architecture/behavior at the level that will not be invalidated by those fixes (e.g. do not document exact KEY_VERSION values).`,
  },
]

const ownership = SUBSYSTEMS.map((s) => `- ${s.key}: ${s.files.join(", ")}`).join("\n")

const fixerPrompt = (s) => `You are one of 9 parallel agents fixing the findings of a code review of the omegacode repo at ${REPO} (branch review-sweep, baseline commit ${BASELINE}). omegacode is a CLI that runs JS workflow files orchestrating Codex/Claude Code agents, with a resume journal, sandboxed workers, and a React viewer over SSE.

FIRST read the full review report at ${REPORT} — especially sections 2 and 3 where every finding has an ID, file:line, failure scenario, and suggested fix.

YOUR SUBSYSTEM: ${s.key}
YOUR FILES (you may ONLY modify these, plus create your listed test files): ${s.files.join(", ")}
YOUR FINDINGS: ${s.findings}
YOUR TEST FILES TO CREATE: ${s.tests.join(", ") || "(none — docs only)"}

SPECIAL INSTRUCTIONS: ${s.notes}

IMPORTANT: a previous sweep was interrupted partway — the working tree already contains PARTIAL fixes (possibly including in your files, possibly half-finished or even syntactically broken). Diff against the baseline (git diff ${BASELINE} -- <your files>) to see what was already attempted. Verify anything that looks done, finish or redo anything half-done, and count a finding as fixed only when YOU have verified the failure scenario is gone and a regression test exists.

The full file-ownership map (other agents are editing these RIGHT NOW — do not touch their files, and expect transient breakage if you import them):
${ownership}
Root package.json belongs to packaging. New test/*.test.ts files are owned by whoever the map assigns them to.

RULES:
1. Fix every finding in your list. If a finding is WRONG (the code is actually correct), skip it with reason — never break correct code to satisfy the report. If a fix is genuinely out of scope for your files, skip with reason.
2. Write EXHAUSTIVE tests in your assigned test files using the built-in node test runner (the repo test script is: node --test --import tsx ./test/*.test.ts — new files are picked up automatically; run a single file with: node --test --import tsx ./test/yourfile.test.ts). Tests must cover the fixed bugs (regression tests that would fail on the old code) AND the core happy paths and edge cases of the module. Use temp dirs for filesystem tests; never touch the user's ~/.omegacode runs dir.
3. Run YOUR OWN test files and make them pass. Do NOT run the full repo typecheck/test suite — other agents are mid-edit; a later gate handles integration.
4. Match the existing code style (no semicolons, ESM imports with .js extensions where the codebase does that). Comments only for constraints the code cannot express.
5. Do NOT commit, do NOT move/rename existing modules, do NOT touch dist/.
6. Deferred by design (do NOT attempt): the shared server/viewer contract-module refactor (rec #3), the Runtime.agent() decomposition (rec #11), relocating schema.ts.

Return (as structured output): fixed (finding IDs), skipped ({id, reason}), testsAdded (paths), summary (what you changed, anything the gate should watch for).`

phase("Fix")
log("Launching 9 subsystem fixers with disjoint file ownership")
const fixResults = await parallel(SUBSYSTEMS.map((s) => () =>
  agent(fixerPrompt(s), { label: `fix:${s.key}`, schema: FIX_RESULT, sandbox: "workspace-write", key: `fix:${s.key}` })
    .then((r) => r && { key: s.key, ...r })
))
const fixes = fixResults.filter(Boolean)
const allFixed = fixes.flatMap((f) => f.fixed)
const allSkipped = fixes.flatMap((f) => (f.skipped || []).map((sk) => ({ ...sk, owner: f.key })))
log(`Fix phase done: ${allFixed.length} findings fixed, ${allSkipped.length} skipped, across ${fixes.length}/9 subsystems`)

phase("Gate")
const gatePrompt = (round) => `You are the build doctor for the omegacode repo at ${REPO} (branch review-sweep). Nine agents just landed fixes for a large code review (report: ${REPORT}); your job is to make the whole repo green. Round: ${round}.

Run, in order, fixing failures as you go:
1. npm run typecheck
2. npm test   (node --test --import tsx ./test/*.test.ts)
3. viewer: install deps if needed, then its build (check root package.json + viewer/package.json for the current script names — agents may have changed them) and viewer tests if a test script exists
4. npm run build
5. npm pack --dry-run (sanity: dist + types + ambient d.ts present)

You may edit ANY file to fix integration breakage (mismatched imports, type errors across subsystem seams, flaky tests). Respect the intent of the fixes — read ${REPORT} when a failure relates to a finding (IDs like C1/H1/M1/L1). Prefer fixing the seam over reverting a fix; revert only as a last resort and say so. If a test is wrong (tests stale behavior), fix the test. Iterate until everything passes or you hit a genuine blocker. Do not commit.

Return: green (true only if ALL five steps pass), summary (what you fixed), blockers (anything you could not resolve).`
let gate = await agent(gatePrompt(1), { label: "gate:1", schema: GATE_RESULT, sandbox: "workspace-write", key: "gate:1" })
log(gate?.green ? "Gate 1 GREEN" : `Gate 1 not green: ${gate?.blockers?.join("; ") || "unknown"}`)

phase("Review")
const reviewPrompt = (s, fixResult) => `Adversarial fix-verification for the omegacode repo at ${REPO}, branch review-sweep, baseline commit ${BASELINE}.

A fixer agent claims to have fixed these review findings in subsystem ${s.key} (files: ${s.files.join(", ")}):
- claimed fixed: ${JSON.stringify(fixResult?.fixed || [])}
- claimed skipped: ${JSON.stringify(fixResult?.skipped || [])}
- fixer summary: ${fixResult?.summary || "(none)"}

Read the finding definitions in ${REPORT} (sections 2-3). Then run: git diff ${BASELINE} -- <the subsystem files and its test files>, and read the post-fix source. For EACH finding ID in the claimed-fixed list, adversarially verify:
- Does the diff actually eliminate the described failure scenario (not just adjacent cosmetics)?
- Did the fix introduce a regression or behavior change beyond the finding scope?
- Is there a regression test that would fail on the old code?
For claimed-skipped findings, judge whether the skip reason holds (status not-attempted if it does not).
Verify by reading code and, where cheap, running the relevant test file (node --test --import tsx ./test/<file>.test.ts). You must NOT edit any source file — verification only.

Return verdicts: one per finding ID — status fixed | incomplete | regression | not-attempted, with a specific note (file:line evidence). Be skeptical: when uncertain whether the failure scenario is truly gone, say incomplete, not fixed.`
const reviews = await parallel(SUBSYSTEMS.map((s) => () => {
  const fr = fixes.find((f) => f.key === s.key)
  return agent(reviewPrompt(s, fr), { label: `verify:${s.key}`, schema: REVIEW_RESULT, sandbox: "workspace-write", key: `verify:${s.key}` })
    .then((r) => r && { key: s.key, verdicts: r.verdicts })
}))
const flagged = reviews.filter(Boolean).map((r) => ({
  key: r.key,
  bad: r.verdicts.filter((v) => v.status !== "fixed"),
})).filter((r) => r.bad.length > 0)
const flaggedCount = flagged.reduce((n, f) => n + f.bad.length, 0)
log(`Review: ${flaggedCount} findings flagged across ${flagged.length} subsystems`)

phase("Repair")
if (flagged.length > 0) {
  await parallel(flagged.map((f) => () => {
    const s = SUBSYSTEMS.find((x) => x.key === f.key)
    return agent(`Repair pass for subsystem ${f.key} in the omegacode repo at ${REPO} (branch review-sweep). An adversarial reviewer rejected these fix attempts:

${JSON.stringify(f.bad, null, 2)}

Read the finding definitions in ${REPORT}, read the reviewer notes above, and FIX each properly. Your files: ${s.files.join(", ")} plus test files ${s.tests.join(", ") || "(none)"}. Same rules as before: only your files, match code style, add/repair regression tests, run your own test files, no commits. If the reviewer is wrong and the original fix is correct, prove it in your summary with file:line evidence instead of churning code.

Return: fixed (IDs you repaired or defended), skipped ({id, reason} for anything genuinely unfixable), testsAdded, summary.`,
      { label: `repair:${f.key}`, schema: FIX_RESULT, sandbox: "workspace-write", key: `repair:${f.key}` })
  }))
  gate = await agent(gatePrompt(2), { label: "gate:2", schema: GATE_RESULT, sandbox: "workspace-write", key: "gate:2" })
  log(gate?.green ? "Gate 2 GREEN" : `Gate 2 not green: ${gate?.blockers?.join("; ") || "unknown"}`)
} else {
  log("Nothing flagged — skipping repair round")
}

phase("Critic")
const critic = await agent(`Completeness critic for the omegacode review sweep at ${REPO} (branch review-sweep, baseline ${BASELINE}).

The review report is ${REPORT}. The sweep claims: fixed=${JSON.stringify(allFixed)}, skipped=${JSON.stringify(allSkipped)}.
Explicitly DEFERRED by design (not gaps): the shared server/viewer contract module (rec #3), Runtime.agent() decomposition (rec #11), relocating schema.ts, implementing unshipped CLI features (--resume-last/tail/config/detach).

Audit: (1) every finding ID in report sections 2-3 — is it in fixed or legitimately skipped? Spot-check the diffs (git diff ${BASELINE} --stat, then targeted file diffs) for any fixed claim that looks hollow. (2) Test coverage — run npm test, look at what test files exist vs the subsystems; name concrete missing coverage (a module with no tests, a critical path untested). (3) Anything the gate left broken. Verification only — do not edit source files.

Return gaps: each with owner (one of: ${SUBSYSTEMS.map((s) => s.key).join(", ")}), what (specific, actionable), size (small/medium/large). Empty list if genuinely complete. Do not pad — only real gaps.`,
  { label: "critic", schema: CRITIC_RESULT, sandbox: "workspace-write", key: "critic" })
const gaps = critic?.gaps || []
log(`Critic found ${gaps.length} gaps`)

phase("Final")
const actionable = gaps.filter((g) => g.size !== "large")
const deferred = gaps.filter((g) => g.size === "large")
if (actionable.length > 0) {
  const byOwner = {}
  for (const g of actionable) (byOwner[g.owner] = byOwner[g.owner] || []).push(g)
  await parallel(Object.entries(byOwner).map(([owner, items]) => () => {
    const s = SUBSYSTEMS.find((x) => x.key === owner)
    const files = s ? s.files.join(", ") : "whichever files the gaps require"
    const tests = s ? s.tests.join(", ") : "matching test files"
    return agent(`Close these review-sweep gaps in the omegacode repo at ${REPO} (branch review-sweep). Context report: ${REPORT}.

${JSON.stringify(items, null, 2)}

Your files: ${files}; tests: ${tests}. Same rules: match style, regression tests for fixes, run your own test files, no commits.
Return: fixed (short labels per gap closed), skipped ({id: label, reason}), testsAdded, summary.`,
      { label: `final:${owner}`, schema: FIX_RESULT, sandbox: "workspace-write", key: `final:${owner}` })
  }))
  gate = await agent(`Final gate for ${REPO}: run npm run typecheck, npm test, the viewer build + tests, npm run build. Fix any remaining breakage (any file). Do not commit. Return green/summary/blockers.`,
    { label: "gate:final", schema: GATE_RESULT, sandbox: "workspace-write", key: "gate:final" })
  log(gate?.green ? "Final gate GREEN" : `Final gate not green: ${gate?.blockers?.join("; ") || "unknown"}`)
}

return {
  fixed: allFixed,
  skipped: allSkipped,
  flaggedInReview: flaggedCount,
  criticGaps: gaps,
  deferredLargeGaps: deferred,
  finalGate: gate,
  perSubsystem: fixes.map((f) => ({ key: f.key, fixed: f.fixed.length, tests: f.testsAdded })),
}
