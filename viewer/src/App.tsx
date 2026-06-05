import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"

interface RunSummary {
  runId: string
  name?: string
  status: string
  agents: number
}

export function App() {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setError(null)
    fetch("/api/runs")
      .then((r) => r.json())
      .then((data: RunSummary[]) => setRuns(data))
      .catch((e: unknown) => setError(String(e)))
  }
  useEffect(load, [])

  return (
    <div className="min-h-svh p-6 font-mono text-sm">
      <h1 className="mb-1 text-base font-medium">
        agent-workflows viewer <span className="text-muted-foreground">— shadcn scaffold (M0)</span>
      </h1>
      <p className="mb-4 text-xs text-muted-foreground">
        Proves the Vite + shadcn pipeline and the `/api` dev proxy. The bb-styled timeline lands in M1+.
      </p>
      {error && (
        <p className="text-destructive">
          API error: {error} — is <code>agent-workflows serve</code> running on :4123?
        </p>
      )}
      <ul className="space-y-1">
        {runs.map((r) => (
          <li key={r.runId} className="flex items-center gap-2">
            <span className="w-20 text-muted-foreground">{r.status}</span>
            <span className="font-medium">{r.name ?? r.runId}</span>
            <span className="text-muted-foreground">· {r.agents} agents</span>
          </li>
        ))}
      </ul>
      <Button className="mt-4" onClick={load}>
        Refresh ({runs.length})
      </Button>
    </div>
  )
}

export default App
