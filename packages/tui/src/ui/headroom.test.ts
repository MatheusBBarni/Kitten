// Suite: pure context-headroom display formatting
// Invariant: known percentages map to a fixed-width bar while absent data remains explicitly unknown
// Boundary IN: derived percentage or null plus an optional cell count
// Boundary OUT: terminal glyph composition, palette, store state, and selectors

import { describe, expect, it } from "bun:test"

import { formatHeadroom, HEADROOM_UNKNOWN } from "./headroom.ts"

describe("formatHeadroom", () => {
  it("rounds a representative percentage to the nearest filled cell", () => {
    expect(formatHeadroom(38, 5)).toEqual({ label: "38%", filled: 2, cells: 5 })
  })

  it("represents empty and full headroom", () => {
    expect(formatHeadroom(0, 5)).toEqual({ label: "0%", filled: 0, cells: 5 })
    expect(formatHeadroom(100, 5)).toEqual({ label: "100%", filled: 5, cells: 5 })
  })

  it("renders absent usage as an honest unknown with no filled cells", () => {
    expect(formatHeadroom(null)).toEqual({ label: HEADROOM_UNKNOWN, filled: 0, cells: 5 })
    expect(HEADROOM_UNKNOWN).toBe("—")
  })

  it("clamps out-of-range percentages without throwing", () => {
    expect(() => formatHeadroom(130, 5)).not.toThrow()
    expect(formatHeadroom(130, 5)).toEqual({ label: "130%", filled: 5, cells: 5 })
    expect(() => formatHeadroom(-20, 5)).not.toThrow()
    expect(formatHeadroom(-20, 5)).toEqual({ label: "-20%", filled: 0, cells: 5 })
  })

  it("uses the default width when cells are omitted", () => {
    expect(formatHeadroom(50)).toEqual({ label: "50%", filled: 3, cells: 5 })
  })

  it("normalizes invalid widths to a safe fixed-width contract", () => {
    expect(formatHeadroom(50, -3)).toEqual({ label: "50%", filled: 0, cells: 0 })
    expect(formatHeadroom(50, 3.8)).toEqual({ label: "50%", filled: 2, cells: 3 })
    expect(formatHeadroom(50, Number.NaN)).toEqual({ label: "50%", filled: 3, cells: 5 })
  })
})
