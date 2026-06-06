import { describe, expect, it } from "vitest"

import { fmtClock, fmtCost, fmtDuration, fmtTokens, timeAgo } from "./format"

describe("fmtTokens", () => {
  it("renders 0 for falsy/zero input", () => {
    expect(fmtTokens()).toBe("0")
    expect(fmtTokens(0)).toBe("0")
    expect(fmtTokens(undefined)).toBe("0")
  })

  it("renders raw value under 1k", () => {
    expect(fmtTokens(1)).toBe("1")
    expect(fmtTokens(999)).toBe("999")
  })

  it("renders k for thousands and M for millions", () => {
    expect(fmtTokens(1_000)).toBe("1k")
    expect(fmtTokens(1_500)).toBe("2k")
    expect(fmtTokens(12_345)).toBe("12k")
    expect(fmtTokens(1_000_000)).toBe("1.0M")
    expect(fmtTokens(2_500_000)).toBe("2.5M")
  })
})

describe("fmtCost (L22: sub-dollar costs)", () => {
  it("returns empty string for falsy/zero", () => {
    expect(fmtCost()).toBe("")
    expect(fmtCost(0)).toBe("")
    expect(fmtCost(undefined)).toBe("")
  })

  it("renders dollar+ values with two decimals", () => {
    expect(fmtCost(1)).toBe("$1.00")
    expect(fmtCost(12.349)).toBe("$12.35")
  })

  // Regression: the old code had identical ternary branches, so every sub-dollar cost rendered
  // "$0.00" — the typical case for a single agent. These must now be distinguishable.
  it("does NOT collapse small costs to $0.00", () => {
    expect(fmtCost(0.5)).not.toBe("$0.00")
    expect(fmtCost(0.012)).not.toBe("$0.00")
    expect(fmtCost(0.0034)).not.toBe("$0.00")
  })

  it("renders distinct strings for distinct sub-dollar costs", () => {
    expect(fmtCost(0.5)).toBe("$0.500")
    expect(fmtCost(0.012)).toBe("$0.012")
    expect(fmtCost(0.0034)).toBe("$0.0034")
    expect(fmtCost(0.5)).not.toBe(fmtCost(0.012))
    expect(fmtCost(0.012)).not.toBe(fmtCost(0.0034))
  })
})

describe("fmtDuration", () => {
  it("returns empty string for null/undefined", () => {
    expect(fmtDuration()).toBe("")
    expect(fmtDuration(undefined)).toBe("")
  })

  it("renders ms under a second", () => {
    expect(fmtDuration(0)).toBe("0ms")
    expect(fmtDuration(999)).toBe("999ms")
  })

  it("renders seconds and minutes", () => {
    expect(fmtDuration(1500)).toBe("1.5s")
    expect(fmtDuration(59_900)).toBe("59.9s")
    expect(fmtDuration(60_000)).toBe("1m00s")
    expect(fmtDuration(125_000)).toBe("2m05s")
  })
})

describe("timeAgo", () => {
  it("returns empty string for falsy", () => {
    expect(timeAgo(undefined, 1000)).toBe("")
    expect(timeAgo(0, 1000)).toBe("")
  })

  it("renders relative units, clamping negatives to 0", () => {
    const now = 1_000_000
    expect(timeAgo(now, now)).toBe("0s ago")
    expect(timeAgo(now + 5000, now)).toBe("0s ago") // future → clamp
    expect(timeAgo(now - 30_000, now)).toBe("30s ago")
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago")
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago")
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d ago")
  })
})

describe("fmtClock", () => {
  it("renders m:ss under an hour", () => {
    expect(fmtClock(0)).toBe("0:00")
    expect(fmtClock(65_000)).toBe("1:05")
    expect(fmtClock(59 * 60_000 + 59_000)).toBe("59:59")
  })

  it("renders h:mm:ss past an hour", () => {
    expect(fmtClock(3_600_000)).toBe("1:00:00")
    expect(fmtClock(3_661_000)).toBe("1:01:01")
  })
})
