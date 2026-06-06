export const meta = {
  name: "test-drive",
  description: "Small smoke workflow: 3 parallel readers + a synthesis, for testing the viewer live",
  phases: [
    { title: "Read", detail: "3 agents each skim one subsystem" },
    { title: "Synthesize", detail: "one agent merges the three blurbs" },
  ],
}

const AREAS = [
  { key: "runtime", path: "src/runtime/keys.ts" },
  { key: "worker", path: "src/worker/jsonrpc-stdio.ts" },
  { key: "viewer", path: "viewer/src/lib/fold.ts" },
]

phase("Read")
const blurbs = await parallel(AREAS.map((a) => () =>
  agent(`Read ${a.path} in this repo and explain in 3-4 sentences what it does and one thing you find well-designed about it. Your final text is the blurb itself.`,
    { label: `read:${a.key}`, effort: "low" })
    .then((r) => r && { area: a.key, blurb: r })
))

phase("Synthesize")
const summary = await agent(`Combine these three blurbs about the omegacode codebase into one short, punchy paragraph (5-6 sentences) a new contributor would enjoy reading:

${JSON.stringify(blurbs.filter(Boolean), null, 2)}

Your final text is the paragraph itself.`,
  { label: "synthesize", effort: "low" })

return { areas: blurbs.filter(Boolean).length, summary }
