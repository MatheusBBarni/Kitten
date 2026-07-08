import { describe, expect, it } from "bun:test"

import pkg from "../package.json" with { type: "json" }

/**
 * The TechSpec ("Technical Dependencies") requires OpenTUI and the ACP SDK to be
 * version-pinned exactly, because both are fast-moving pre-1.0/early releases.
 */
const EXACT_PIN_REQUIRED = ["@opentui/core", "@opentui/react", "@agentclientprotocol/sdk"] as const

// Exact semver: MAJOR.MINOR.PATCH with an optional prerelease/build tail.
// Rejects range operators (^ ~ >= <= > <), wildcards (x *), and " - " ranges.
const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

describe("dependency pinning", () => {
  const deps = pkg.dependencies as Record<string, string>

  it("declares every OpenTUI and ACP dependency", () => {
    for (const name of EXACT_PIN_REQUIRED) {
      expect(deps[name]).toBeDefined()
    }
  })

  it("pins OpenTUI and the ACP SDK to exact versions (no ^ or ~ ranges)", () => {
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
})
