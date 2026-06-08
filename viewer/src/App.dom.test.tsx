// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import App from "./App"
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/lib/hooks", () => ({
  useRuns: () => ({
    data: [
      {
        runId: "r1",
        name: "Review run",
        status: "completed",
        agents: 2,
        startedAt: 1,
      },
    ],
    isError: false,
  }),
  useRunStream: () => null,
}))

class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "matchMedia"
)
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "localStorage"
)
const originalResizeObserverDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "ResizeObserver"
)

function restoreDescriptor<T extends object>(
  target: T,
  key: keyof T,
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
  } else {
    delete target[key]
  }
}

function installLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => {
        store.delete(key)
      }),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value)
      }),
    },
  })
}

function installMatchMedia(
  matches: boolean,
  opts: { legacyListener?: boolean } = {}
) {
  let currentMatches = matches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = {
    get matches() {
      return currentMatches
    },
    media: "",
    onchange: null,
    addEventListener: vi.fn(
      (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === "function")
          listeners.add(listener as (event: MediaQueryListEvent) => void)
      }
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === "function")
          listeners.delete(listener as (event: MediaQueryListEvent) => void)
      }
    ),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    }),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    }),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList
  if (opts.legacyListener) {
    delete (media as Partial<MediaQueryList>).addEventListener
    delete (media as Partial<MediaQueryList>).removeEventListener
  }
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    Object.defineProperty(media, "media", { value: query, configurable: true })
    return media
  })

  return {
    setMatches(nextMatches: boolean) {
      currentMatches = nextMatches
      const event = {
        matches: nextMatches,
        media: media.media,
      } as MediaQueryListEvent
      act(() => {
        listeners.forEach((listener) => listener(event))
        media.onchange?.call(media, event)
      })
    },
  }
}

function renderApp() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>
  )
}

beforeEach(() => {
  globalThis.ResizeObserver = ResizeObserverMock
  installLocalStorage()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  restoreDescriptor(window, "matchMedia", originalMatchMediaDescriptor)
  restoreDescriptor(window, "localStorage", originalLocalStorageDescriptor)
  restoreDescriptor(
    globalThis,
    "ResizeObserver",
    originalResizeObserverDescriptor
  )
})

describe("viewer sidebar visibility", () => {
  it("lets a large viewport hide and reopen the runs sidebar", () => {
    installMatchMedia(false)
    renderApp()

    expect(screen.getByText("Runs")).toBeTruthy()

    fireEvent.click(screen.getByLabelText("Hide runs sidebar"))
    expect(screen.queryByText("Runs")).toBeNull()
    expect(screen.getByLabelText("Show runs sidebar")).toBeTruthy()

    fireEvent.click(screen.getByLabelText("Show runs sidebar"))
    expect(screen.getByText("Runs")).toBeTruthy()
  })

  it("auto-hides the runs sidebar on narrow viewports and closes it after selecting a run", () => {
    installMatchMedia(true)
    renderApp()

    expect(screen.queryByText("Runs")).toBeNull()
    fireEvent.click(screen.getByLabelText("Show runs sidebar"))
    expect(screen.getByText("Runs")).toBeTruthy()

    fireEvent.click(screen.getByText("Review run"))
    expect(screen.queryByText("Runs")).toBeNull()
  })

  it("restores the desktop sidebar preference after leaving an auto-hide viewport", () => {
    const media = installMatchMedia(false)
    renderApp()

    expect(screen.getByText("Runs")).toBeTruthy()

    media.setMatches(true)
    expect(screen.queryByText("Runs")).toBeNull()

    fireEvent.click(screen.getByLabelText("Show runs sidebar"))
    expect(screen.getByText("Runs")).toBeTruthy()

    media.setMatches(false)
    expect(screen.getByText("Runs")).toBeTruthy()
  })

  it("subscribes with the legacy media query listener API when needed", () => {
    const media = installMatchMedia(false, { legacyListener: true })
    renderApp()

    expect(screen.getByText("Runs")).toBeTruthy()

    media.setMatches(true)
    expect(screen.queryByText("Runs")).toBeNull()
  })
})
