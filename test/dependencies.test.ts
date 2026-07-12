import { describe, expect, it } from "bun:test"

import pkg from "../package.json" with { type: "json" }

/**
 * TechSpecs require OpenTUI, the ACP SDK, and xterm's headless emulator to be
 * version-pinned exactly because these runtime boundaries are fast-moving.
 */
const EXACT_PIN_REQUIRED = ["@opentui/core", "@opentui/react", "@agentclientprotocol/sdk", "@xterm/headless"] as const

// Exact semver: MAJOR.MINOR.PATCH with an optional prerelease/build tail.
// Rejects range operators (^ ~ >= <= > <), wildcards (x *), and " - " ranges.
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

describe("dependency pinning", () => {
  const deps = pkg.dependencies as Record<string, string>

  it("declares every runtime dependency that requires an exact pin", () => {
    for (const name of EXACT_PIN_REQUIRED) {
      expect(deps[name]).toBeDefined()
    }
  })

  it("pins fast-moving runtime dependencies to exact versions (no ^ or ~ ranges)", () => {
    for (const name of EXACT_PIN_REQUIRED) {
      const spec = deps[name]!
      expect(spec).toMatch(EXACT_SEMVER)
      expect(spec.startsWith("^")).toBe(false)
      expect(spec.startsWith("~")).toBe(false)
    }
  })

  it("pins react to an exact version", () => {
    expect(deps.react).toMatch(EXACT_SEMVER)
  })

  it("requires a Bun release with native Terminal support", () => {
    expect(pkg.engines.bun).toBe(">=1.3.5")
  })
})
