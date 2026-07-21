import { describe, expect, it } from "bun:test"

import { EXPLORE_RESTRICTIONS } from "../core/explorePolicy.ts"
import type { ResolvedAgentConfig } from "../core/types.ts"
import {
  CERTIFIED_EXPLORE_PROFILES,
  EXPLORE_ATTESTATION_VERSION,
  resolveExploreCapability,
  type CertifiedExploreProfile,
  type ExploreRuntimeEvidence,
} from "./exploreCapability.ts"
import {
  CERTIFIED_CONTEXT_BUILD_PROFILES,
  CONTEXT_BUILD_CAPABILITY_VERSION,
} from "./contextPackCapability.ts"

const CONFIG: ResolvedAgentConfig = {
  id: "claude-code",
  displayName: "Claude Code",
  command: "restricted-acp",
  args: ["--mode", "explore"],
  env: { KITTEN_POLICY: "read-only" },
  clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
  hardStopContinuationCapability: { status: "unavailable", reason: "unknown_recipe" },
  steeringCapability: { status: "unavailable" },
  runtimeProfile: { kind: "standard" },
}

const EVIDENCE: ExploreRuntimeEvidence = {
  adapterPackage: "restricted-acp",
  adapterVersion: "1.2.3",
  runtimeVersion: "4.5.6",
  restrictions: { ...EXPLORE_RESTRICTIONS },
}

const PROFILE: CertifiedExploreProfile = {
  attestationVersion: EXPLORE_ATTESTATION_VERSION,
  recipe: {
    providerKind: "claude-code",
    command: CONFIG.command,
    args: [...CONFIG.args],
    env: { ...CONFIG.env },
    adapterPackage: EVIDENCE.adapterPackage,
    adapterVersion: EVIDENCE.adapterVersion,
    runtimeVersion: EVIDENCE.runtimeVersion,
  },
  restrictions: { ...EXPLORE_RESTRICTIONS },
  limits: { perParent: 2, global: 4 },
  model: "reviewed-model",
  effort: "low",
}

describe("explore capability attestation", () => {
  it("keeps report-only explore-v1 isolated from the closed explore-v2 registry", () => {
    expect(EXPLORE_ATTESTATION_VERSION).toBe("explore-v1")
    expect(CONTEXT_BUILD_CAPABILITY_VERSION).toBe("explore-v2")
    expect(CERTIFIED_CONTEXT_BUILD_PROFILES).toEqual([])
    expect(resolveExploreCapability(CONFIG, EVIDENCE, [PROFILE]).status).toBe("supported")
  })

  it("keeps the production eligible-provider allowlist empty", () => {
    expect(CERTIFIED_EXPLORE_PROFILES).toEqual([])
    expect(resolveExploreCapability(CONFIG, EVIDENCE)).toEqual({
      status: "unsupported",
      reason: "unsupported-provider",
    })
  })

  it("accepts only complete exact current evidence and returns a fresh recipe", () => {
    const result = resolveExploreCapability(CONFIG, EVIDENCE, [PROFILE])
    expect(result.status).toBe("supported")
    if (result.status !== "supported") return
    expect(result.policy).toMatchObject({
      role: "explore",
      restrictions: EXPLORE_RESTRICTIONS,
      limits: { perParent: 2, global: 4 },
      attestationVersion: EXPLORE_ATTESTATION_VERSION,
      confirmed: { provider: "claude-code", model: "reviewed-model", effort: "low" },
    })
    expect(result.recipe).toMatchObject({
      id: "claude-code",
      command: "restricted-acp",
      args: ["--mode", "explore"],
      env: { KITTEN_POLICY: "read-only" },
    })
    expect(result.recipe).not.toBe(CONFIG)
    expect(result.recipe.args).not.toBe(CONFIG.args)
    expect(result.recipe.env).not.toBe(CONFIG.env)
  })

  it.each([
    ["command", { ...CONFIG, command: "other" }],
    ["ordered arguments", { ...CONFIG, args: ["explore", "--mode"] }],
    ["full environment", { ...CONFIG, env: { ...CONFIG.env, EXTRA: "1" } }],
  ] as const)("denies a changed %s", (_name, config) => {
    expect(resolveExploreCapability(config as ResolvedAgentConfig, EVIDENCE, [PROFILE])).toEqual({
      status: "unsupported",
      reason: "stale-attestation",
    })
  })

  it("denies missing, unknown, and stale runtime evidence with closed reasons", () => {
    expect(resolveExploreCapability(CONFIG, undefined, [PROFILE])).toEqual({
      status: "unsupported",
      reason: "missing-attestation",
    })
    expect(resolveExploreCapability({ ...CONFIG, id: "codex" }, EVIDENCE, [PROFILE])).toEqual({
      status: "unsupported",
      reason: "unsupported-provider",
    })
    expect(resolveExploreCapability(CONFIG, { ...EVIDENCE, runtimeVersion: "4.5.7" }, [PROFILE])).toEqual({
      status: "unsupported",
      reason: "stale-attestation",
    })
    expect(resolveExploreCapability(CONFIG, { ...EVIDENCE, adapterVersion: "latest" }, [PROFILE])).toEqual({
      status: "unsupported",
      reason: "missing-attestation",
    })
    expect(resolveExploreCapability(CONFIG, {
      ...EVIDENCE,
      restrictions: { filesystem: "read-only" } as unknown as ExploreRuntimeEvidence["restrictions"],
    }, [PROFILE])).toEqual({ status: "unsupported", reason: "stale-attestation" })
  })

  it.each([
    ["write", { filesystem: "read-write" }],
    ["shell", { shell: true }],
    ["recursion", { maxDepth: 1 }],
    ["external MCP", { externalMcp: true }],
    ["agent control", { agentControl: true }],
  ] as const)("denies evidence that permits %s", (_name, override) => {
    const restrictions = { ...EXPLORE_RESTRICTIONS, ...override } as unknown as ExploreRuntimeEvidence["restrictions"]
    expect(resolveExploreCapability(CONFIG, { ...EVIDENCE, restrictions }, [PROFILE])).toEqual({
      status: "unsupported",
      reason: "stale-attestation",
    })
  })
})
