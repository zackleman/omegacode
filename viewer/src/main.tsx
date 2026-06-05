import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { HashRouter } from "react-router-dom"

import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"

import App from "./App.tsx"
import "./index.css"

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <HashRouter>
            <App />
          </HashRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
