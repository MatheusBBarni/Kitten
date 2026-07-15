import { describe, expect, it } from "bun:test"

import pkg from "../package.json" with { type: "json" }
import { CLAUDE_CODE_ACP_PACKAGE, CODEX_ACP_PACKAGE } from "../src/config/configLoader.ts"

/**
 * TechSpecs require OpenTUI, the ACP SDK, and xterm's headless emulator to be
 * version-pinned exactly because these runtime boundaries are fast-moving.
 */
const EXACT_PIN_REQUIRED = [
  "@opentui/core",
  "@opentui/react",
  "@agentclientprotocol/sdk",
  "@modelcontextprotocol/sdk",
  "@xterm/headless",
] as const
const CONTRACT_ADAPTER_PINS = [
  "@agentclientprotocol/claude-agent-acp",
  "@agentclientprotocol/codex-acp",
] as const

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

  it("pins the MCP child SDK to the reviewed runtime version", () => {
    expect(deps["@modelcontextprotocol/sdk"]).toBe("1.29.0")
  })

  it("pins react to an exact version", () => {
    expect(deps.react).toMatch(EXACT_SEMVER)
  })

  it("pins the real-adapter clarification contract dependencies exactly", () => {
    const devDependencies = pkg.devDependencies as Record<string, string>
    for (const name of CONTRACT_ADAPTER_PINS) {
      expect(devDependencies[name]).toMatch(EXACT_SEMVER)
    }
    expect(`@agentclientprotocol/claude-agent-acp@${devDependencies["@agentclientprotocol/claude-agent-acp"]}`).toBe(
      CLAUDE_CODE_ACP_PACKAGE,
    )
    expect(`@agentclientprotocol/codex-acp@${devDependencies["@agentclientprotocol/codex-acp"]}`).toBe(
      CODEX_ACP_PACKAGE,
    )
  })

  it("does not require Bun to run the published Node launcher", () => {
    expect(pkg).not.toHaveProperty("engines.bun")
  })
})
