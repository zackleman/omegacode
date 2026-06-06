import { useParams } from "react-router-dom"

import { AgentChat } from "@/components/AgentChat"
import { RunDetail } from "@/components/RunDetail"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { useRunStream } from "@/lib/hooks"

export function RunView() {
  const { id, index } = useParams<{ id: string; index?: string }>()
  const snap = useRunStream(id ?? null)
  const showChat = index != null
  const agent = showChat && snap ? snap.agents.find((a) => a.index === Number(index)) : undefined

  if (!showChat) return <RunDetail snap={snap} />

  return (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel defaultSize="50%" minSize="30%">
        <RunDetail snap={snap} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="50%" minSize="32%">
        <AgentChat agent={agent} runStatus={snap?.status} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
