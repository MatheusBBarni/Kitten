// Suite: first-run app state
// Invariant: optional runtime state never blocks boot and only valid markers count as seen.
// Boundary IN: XDG path resolution, state-file I/O seams, schema validation, banner decision.
// Boundary OUT: boot timing and banner rendering, owned by later integration tasks.

import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { bannerVariant, markFirstRunSeen, readFirstRunSeen, resolveAppStatePath } from "./appState.ts"

function withStateHome(run: (stateHome: string) => void): void {
  const stateHome = mkdtempSync(join(tmpdir(), "kitten-state-"))
  try {
    run(stateHome)
  } finally {
    rmSync(stateHome, { recursive: true, force: true })
  }
}

describe("first-run marker", () => {
  it("Should read not-seen when absent and seen after marking", () => {
    withStateHome((stateHome) => {
      const env = { XDG_STATE_HOME: stateHome }

      expect(readFirstRunSeen({ env })).toBe(false)
      markFirstRunSeen({ env, now: () => new Date("2026-07-10T12:00:00.000Z") })
      expect(readFirstRunSeen({ env })).toBe(true)
    })
  })

  it("Should reset malformed JSON to not-seen without throwing", () => {
    withStateHome((stateHome) => {
      const path = join(stateHome, "state.json")
      writeFileSync(path, "{ malformed", "utf8")

      expect(() => readFirstRunSeen({ path })).not.toThrow()
      expect(readFirstRunSeen({ path })).toBe(false)
    })
  })

  it("Should reject a marker with an invalid timestamp or unknown field", () => {
    const invalidMarkers = [
      { firstRunSeenAt: "yesterday" },
      { firstRunSeenAt: "2026-07-10T12:00:00.000Z", extra: true },
    ]

    for (const marker of invalidMarkers) {
      expect(readFirstRunSeen({ readFile: () => JSON.stringify(marker) })).toBe(false)
    }
  })

  it("Should return not-seen when the reader fails", () => {
    expect(
      readFirstRunSeen({
        readFile: () => {
          throw new Error("read-only filesystem")
        },
      }),
    ).toBe(false)
  })

  it("Should return without throwing when the writer fails", () => {
    expect(() =>
      markFirstRunSeen({
        ensureDir: () => {},
        writeFile: () => {
          throw new Error("disk full")
        },
      }),
    ).not.toThrow()
  })
})

describe("state path", () => {
  it("Should honor XDG_STATE_HOME", () => {
    expect(resolveAppStatePath({ XDG_STATE_HOME: "/state" })).toBe("/state/kitten/state.json")
  })

  it("Should fall back under the home state directory", () => {
    expect(resolveAppStatePath({}).endsWith(join(".local", "state", "kitten", "state.json"))).toBe(true)
  })
})

describe("bannerVariant", () => {
  const cases = [
    { pref: "auto", seen: false, expected: "full" },
    { pref: "auto", seen: true, expected: "quiet" },
    { pref: "always", seen: false, expected: "full" },
    { pref: "always", seen: true, expected: "full" },
    { pref: "off", seen: false, expected: "none" },
    { pref: "off", seen: true, expected: "none" },
  ] as const

  for (const { pref, seen, expected } of cases) {
    it(`Should return ${expected} for ${pref} when seen is ${seen}`, () => {
      expect(bannerVariant(pref, seen)).toBe(expected)
    })
  }
})
