import { describe, expect, it } from "bun:test"

import type { ContextBuildOperation, ResolvedAgentConfig } from "../core/types.ts"
import {
  CERTIFIED_CONTEXT_BUILD_PROFILES,
  CERTIFIED_RECIPIENT_PROFILES,
  CONTEXT_BUILD_CAPABILITY_VERSION,
  CONTEXT_BUILD_OPERATIONS,
  RECIPIENT_PROFILE_VERSION,
  resolveContextBuildCapability,
  resolveContextPackCapabilities,
  resolveRecipientProfile,
  type CertifiedContextBuildProfile,
  type CertifiedRecipientProfile,
  type ContextBuildRuntimeEvidence,
  type ExactContextPackRecipeIdentity,
  type RecipientProfileRuntimeEvidence,
} from "./contextPackCapability.ts"

const NOW = 1_000
const CONFIG: ResolvedAgentConfig = {
  id: "claude-code",
  displayName: "Claude Code",
  command: "context-pack-acp",
  args: ["--profile", "explore-v2"],
  env: { KITTEN_CONTEXT_MODE: "closed", PROVIDER_TOKEN_MODE: "native" },
  clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
  steeringCapability: { status: "unavailable" },
  runtimeProfile: { kind: "standard" },
}

const RECIPE: ExactContextPackRecipeIdentity = {
  providerKind: CONFIG.id,
  command: CONFIG.command,
  args: [...CONFIG.args],
  env: { ...CONFIG.env },
  adapterPackage: "context-pack-acp",
  adapterVersion: "1.2.3",
  runtimeVersion: "4.5.6",
  model: "reviewed-context-model",
}

const REVIEW = {
  reviewed: true,
  reviewId: "independent-review-7",
  validFrom: NOW - 100,
  validUntil: NOW + 100,
} as const

const BUILD_PROFILE: CertifiedContextBuildProfile = {
  capabilityVersion: CONTEXT_BUILD_CAPABILITY_VERSION,
  evidenceVersion: "context-build-evidence-v1",
  recipe: RECIPE,
  operations: [...CONTEXT_BUILD_OPERATIONS],
  review: REVIEW,
}

const BUILD_EVIDENCE: ContextBuildRuntimeEvidence = {
  capabilityVersion: CONTEXT_BUILD_CAPABILITY_VERSION,
  evidenceVersion: BUILD_PROFILE.evidenceVersion,
  adapterPackage: RECIPE.adapterPackage,
  adapterVersion: RECIPE.adapterVersion,
  runtimeVersion: RECIPE.runtimeVersion,
  model: RECIPE.model,
  operations: [...CONTEXT_BUILD_OPERATIONS],
  observedAt: NOW - 10,
  validUntil: NOW + 10,
}

const RECIPIENT_PROFILE: CertifiedRecipientProfile = {
  profileVersion: RECIPIENT_PROFILE_VERSION,
  evidenceVersion: "recipient-evidence-v1",
  recipe: RECIPE,
  freshSessionCapacity: 200_000,
  reserve: 16_000,
  counterVersion: "exact-counter-v3",
  review: REVIEW,
}

const RECIPIENT_EVIDENCE: RecipientProfileRuntimeEvidence = {
  profileVersion: RECIPIENT_PROFILE_VERSION,
  evidenceVersion: RECIPIENT_PROFILE.evidenceVersion,
  adapterPackage: RECIPE.adapterPackage,
  adapterVersion: RECIPE.adapterVersion,
  runtimeVersion: RECIPE.runtimeVersion,
  model: RECIPE.model,
  freshSessionCapacity: RECIPIENT_PROFILE.freshSessionCapacity,
  reserve: RECIPIENT_PROFILE.reserve,
  counterVersion: RECIPIENT_PROFILE.counterVersion,
  observedAt: NOW - 10,
  validUntil: NOW + 10,
}

describe("closed explore-v2 capability evidence", () => {
  it("keeps both production registries empty and unavailable", () => {
    expect(CERTIFIED_CONTEXT_BUILD_PROFILES).toEqual([])
    expect(CERTIFIED_RECIPIENT_PROFILES).toEqual([])
    expect(resolveContextBuildCapability(CONFIG, BUILD_EVIDENCE, NOW)).toEqual({
      status: "unavailable",
      reason: "unsupported_recipe",
    })
    expect(resolveRecipientProfile(CONFIG, RECIPIENT_EVIDENCE, NOW)).toEqual({
      status: "unavailable",
      reason: "unsupported_recipe",
    })
  })

  it("resolves only a complete current reviewed recipe and returns a fresh closed recipe", () => {
    const result = resolveContextBuildCapability(CONFIG, BUILD_EVIDENCE, NOW, [BUILD_PROFILE])
    expect(result).toEqual({
      status: "available",
      capabilityVersion: "explore-v2",
      evidenceVersion: BUILD_PROFILE.evidenceVersion,
      operations: CONTEXT_BUILD_OPERATIONS,
      recipe: {
        ...CONFIG,
        args: CONFIG.args,
        env: CONFIG.env,
      },
      model: RECIPE.model,
    })
    if (result.status !== "available") return
    expect(result.recipe).not.toBe(CONFIG)
    expect(result.recipe.args).not.toBe(CONFIG.args)
    expect(result.recipe.env).not.toBe(CONFIG.env)
    expect(result.operations).not.toBe(CONTEXT_BUILD_OPERATIONS)
  })

  it.each([
    ["command", { ...CONFIG, command: "other-acp" }],
    ["argument order", { ...CONFIG, args: [...CONFIG.args].reverse() }],
    ["complete environment", { ...CONFIG, env: { ...CONFIG.env, KITTEN_CONTEXT_BUILD: "1" } }],
  ] as const)("denies a changed exact %s", (_name, changed) => {
    expect(resolveContextBuildCapability(changed as ResolvedAgentConfig, BUILD_EVIDENCE, NOW, [BUILD_PROFILE])).toEqual({
      status: "unavailable",
      reason: "recipe_mismatch",
    })
  })

  it("denies missing, malformed, unknown, and stale evidence with closed reasons", () => {
    expect(resolveContextBuildCapability(CONFIG, undefined, NOW, [BUILD_PROFILE])).toEqual({
      status: "unavailable",
      reason: "missing_evidence",
    })
    expect(resolveContextBuildCapability(CONFIG, {
      ...BUILD_EVIDENCE,
      adapterVersion: "latest",
    }, NOW, [BUILD_PROFILE])).toEqual({ status: "unavailable", reason: "malformed_evidence" })
    expect(resolveContextBuildCapability({ ...CONFIG, id: "codex" }, BUILD_EVIDENCE, NOW, [BUILD_PROFILE])).toEqual({
      status: "unavailable",
      reason: "unsupported_recipe",
    })
    expect(resolveContextBuildCapability(CONFIG, {
      ...BUILD_EVIDENCE,
      validUntil: NOW - 1,
    }, NOW, [BUILD_PROFILE])).toEqual({ status: "unavailable", reason: "stale_evidence" })
    expect(resolveContextBuildCapability(CONFIG, BUILD_EVIDENCE, NOW + 101, [BUILD_PROFILE])).toEqual({
      status: "unavailable",
      reason: "stale_evidence",
    })
    expect(resolveContextBuildCapability(CONFIG, {
      ...BUILD_EVIDENCE,
      validUntil: NOW + 200,
    }, NOW + 101, [BUILD_PROFILE])).toEqual({ status: "unavailable", reason: "stale_evidence" })
  })

  it("rejects every partial, reordered, or widened authority claim", () => {
    const attempts: readonly (readonly ContextBuildOperation[])[] = [
      CONTEXT_BUILD_OPERATIONS.slice(0, -1),
      [...CONTEXT_BUILD_OPERATIONS].reverse(),
      [...CONTEXT_BUILD_OPERATIONS, "agent:control" as ContextBuildOperation],
    ]
    for (const operations of attempts) {
      expect(resolveContextBuildCapability(CONFIG, { ...BUILD_EVIDENCE, operations }, NOW, [BUILD_PROFILE])).toEqual({
        status: "unavailable",
        reason: "malformed_evidence",
      })
    }
  })

  it("rejects malformed or widened reviewed profiles", () => {
    const malformedReview = {
      ...BUILD_PROFILE,
      review: { ...REVIEW, reviewed: false },
    } as unknown as CertifiedContextBuildProfile
    const widened = {
      ...BUILD_PROFILE,
      operations: [...CONTEXT_BUILD_OPERATIONS, "agent:control" as ContextBuildOperation],
    }
    expect(resolveContextBuildCapability(CONFIG, BUILD_EVIDENCE, NOW, [malformedReview])).toEqual({
      status: "unavailable",
      reason: "malformed_evidence",
    })
    expect(resolveContextBuildCapability(CONFIG, BUILD_EVIDENCE, NOW, [widened])).toEqual({
      status: "unavailable",
      reason: "malformed_evidence",
    })
  })
})

describe("closed Recipient Profile evidence", () => {
  it("resolves exact capacity, reserve, counter, model, recipe, and freshness", () => {
    const result = resolveRecipientProfile(CONFIG, RECIPIENT_EVIDENCE, NOW, [RECIPIENT_PROFILE])
    expect(result).toEqual({
      status: "available",
      profile: {
        profileVersion: RECIPIENT_PROFILE_VERSION,
        evidenceVersion: RECIPIENT_PROFILE.evidenceVersion,
        recipe: CONFIG,
        model: RECIPE.model,
        freshSessionCapacity: 200_000,
        reserve: 16_000,
        counterVersion: "exact-counter-v3",
        validUntil: NOW + 10,
      },
    })
    if (result.status !== "available") return
    expect(result.profile.recipe).not.toBe(CONFIG)
    expect(result.profile.recipe.args).not.toBe(CONFIG.args)
    expect(result.profile.recipe.env).not.toBe(CONFIG.env)
  })

  it("denies absent, stale, partial, and unsafe capacity evidence", () => {
    expect(resolveRecipientProfile(CONFIG, undefined, NOW, [RECIPIENT_PROFILE])).toEqual({
      status: "unavailable",
      reason: "missing_evidence",
    })
    expect(resolveRecipientProfile(CONFIG, { ...RECIPIENT_EVIDENCE, validUntil: NOW - 1 }, NOW, [RECIPIENT_PROFILE])).toEqual({
      status: "unavailable",
      reason: "stale_evidence",
    })
    const partial = {
      ...RECIPIENT_EVIDENCE,
      freshSessionCapacity: undefined,
      genericEstimate: 184_000,
    } as unknown as RecipientProfileRuntimeEvidence
    expect(resolveRecipientProfile(CONFIG, partial, NOW, [RECIPIENT_PROFILE])).toEqual({
      status: "unavailable",
      reason: "malformed_evidence",
    })
    expect(resolveRecipientProfile(CONFIG, {
      ...RECIPIENT_EVIDENCE,
      reserve: RECIPIENT_EVIDENCE.freshSessionCapacity,
    }, NOW, [RECIPIENT_PROFILE])).toEqual({ status: "unavailable", reason: "malformed_evidence" })
    const malformedReview = {
      ...RECIPIENT_PROFILE,
      review: { ...REVIEW, reviewId: "" },
    }
    expect(resolveRecipientProfile(CONFIG, RECIPIENT_EVIDENCE, NOW, [malformedReview])).toEqual({
      status: "unavailable",
      reason: "malformed_evidence",
    })
    expect(resolveRecipientProfile(CONFIG, {
      ...RECIPIENT_EVIDENCE,
      validUntil: NOW + 200,
    }, NOW + 101, [RECIPIENT_PROFILE])).toEqual({ status: "unavailable", reason: "stale_evidence" })
  })

  it.each([
    ["capacity", { freshSessionCapacity: RECIPIENT_EVIDENCE.freshSessionCapacity + 1 }],
    ["reserve", { reserve: RECIPIENT_EVIDENCE.reserve + 1 }],
    ["counter", { counterVersion: "generic-estimator-v1" }],
    ["model", { model: "inferred-model" }],
  ] as const)("denies mismatched %s evidence", (_name, override) => {
    expect(resolveRecipientProfile(CONFIG, { ...RECIPIENT_EVIDENCE, ...override }, NOW, [RECIPIENT_PROFILE])).toEqual({
      status: "unavailable",
      reason: "stale_evidence",
    })
  })

  it("does not treat an environment switch or generic estimate as evidence", () => {
    const overridden = {
      ...CONFIG,
      env: { ...CONFIG.env, KITTEN_RECIPIENT_PROFILE: "enabled" },
    }
    expect(resolveRecipientProfile(overridden, RECIPIENT_EVIDENCE, NOW, [RECIPIENT_PROFILE])).toEqual({
      status: "unavailable",
      reason: "recipe_mismatch",
    })
    expect(resolveContextPackCapabilities(CONFIG, {}, NOW, [BUILD_PROFILE], [RECIPIENT_PROFILE])).toEqual({
      contextBuild: { status: "unavailable", reason: "missing_evidence" },
      recipientProfile: { status: "unavailable", reason: "missing_evidence" },
    })
  })
})
