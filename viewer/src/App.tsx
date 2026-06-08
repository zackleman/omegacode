import { useCallback, useEffect, useState } from "react"
import { Route, Routes } from "react-router-dom"

import { OmegaIcon } from "@/components/icons/OmegaIcon"
import { RunList } from "@/components/RunList"
import { RunView } from "@/components/RunView"
import { Icon } from "@/components/ui/icon"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { cn } from "@/lib/utils"

const SIDEBAR_STORAGE_KEY = "omegacode.viewer.sidebarOpen"
const SIDEBAR_AUTOHIDE_QUERY = "(max-width: 900px)"

function isAutoHideViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(SIDEBAR_AUTOHIDE_QUERY).matches
  )
}

function readStoredSidebarOpen(): boolean {
  if (typeof window === "undefined") return true
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    return stored == null ? true : stored === "true"
  } catch {
    return true
  }
}

function writeStoredSidebarOpen(open: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(open))
  } catch {
    // Ignore private-mode/storage-denied failures; the control should still work for this session.
  }
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <OmegaIcon className="size-10 opacity-90" />
      <span className="text-sm">Select a run to view its phase tree.</span>
    </div>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Empty />} />
      <Route path="/run/:id" element={<RunView />} />
      <Route path="/run/:id/agent/:index" element={<RunView />} />
    </Routes>
  )
}

function SidebarToggleButton({
  open,
  onClick,
  className,
}: {
  open: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={open ? "Hide runs sidebar" : "Show runs sidebar"}
      title={open ? "Hide runs sidebar" : "Show runs sidebar"}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden",
        className
      )}
    >
      <Icon
        name={open ? "PanelLeftClose" : "PanelLeftOpen"}
        className="size-4"
        aria-hidden
      />
    </button>
  )
}

export function App() {
  const [autoHide, setAutoHide] = useState(isAutoHideViewport)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !isAutoHideViewport() && readStoredSidebarOpen()
  )

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const media = window.matchMedia(SIDEBAR_AUTOHIDE_QUERY)
    const syncViewport = () => {
      setAutoHide(media.matches)
      setSidebarOpen(media.matches ? false : readStoredSidebarOpen())
    }

    syncViewport()
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncViewport)
      return () => media.removeEventListener("change", syncViewport)
    }

    media.addListener(syncViewport)
    return () => media.removeListener(syncViewport)
  }, [])

  const setSidebarVisible = useCallback(
    (open: boolean) => {
      setSidebarOpen(open)
      if (!autoHide) writeStoredSidebarOpen(open)
    },
    [autoHide]
  )

  const hideSidebar = useCallback(
    () => setSidebarVisible(false),
    [setSidebarVisible]
  )
  const showSidebar = useCallback(
    () => setSidebarVisible(true),
    [setSidebarVisible]
  )
  const hideAfterRunSelect = useCallback(() => {
    if (autoHide) setSidebarVisible(false)
  }, [autoHide, setSidebarVisible])

  const sidebarHeaderAction = <SidebarToggleButton open onClick={hideSidebar} />

  if (autoHide) {
    return (
      <div className="relative h-screen w-screen overflow-hidden">
        <div className={cn("h-full", !sidebarOpen && "pl-11")}>
          <AppRoutes />
        </div>
        {!sidebarOpen && (
          <SidebarToggleButton
            open={false}
            onClick={showSidebar}
            className="absolute top-2 left-2 z-20 bg-background/90"
          />
        )}
        {sidebarOpen && (
          <>
            <button
              type="button"
              aria-label="Close runs sidebar"
              className="absolute inset-0 z-20 bg-background/45"
              onClick={hideSidebar}
            />
            <aside className="absolute inset-y-0 left-0 z-30 w-[min(22rem,calc(100vw-3rem))] border-r border-sidebar-border shadow-xl">
              <RunList
                headerAction={sidebarHeaderAction}
                onSelectRun={hideAfterRunSelect}
              />
            </aside>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="h-screen w-screen overflow-hidden">
      <ResizablePanelGroup orientation="horizontal">
        {sidebarOpen && (
          <>
            <ResizablePanel defaultSize="20%" minSize="15%" maxSize="34%">
              <RunList headerAction={sidebarHeaderAction} />
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        <ResizablePanel defaultSize={sidebarOpen ? "80%" : "100%"}>
          <div className={cn("relative h-full", !sidebarOpen && "pl-11")}>
            {!sidebarOpen && (
              <SidebarToggleButton
                open={false}
                onClick={showSidebar}
                className="absolute top-2 left-2 z-20"
              />
            )}
            <AppRoutes />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

export default App
