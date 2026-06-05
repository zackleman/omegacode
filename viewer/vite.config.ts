import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built assets work when served from agent-workflows' static server.
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // In dev, proxy the API + SSE to a running `agent-workflows serve` instance.
    proxy: {
      "/api": {
        target: process.env.AW_API ?? "http://127.0.0.1:4123",
        changeOrigin: true,
      },
    },
  },
})
