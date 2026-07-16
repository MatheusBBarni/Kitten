import type { ResolvedAgentConfig } from "../core/types.ts"
import {
  EXPLORE_RESTRICTIONS,
  evaluateExplorePolicy,
  type ExploreCapacityLimits,
  type ExploreDenialReason,
  type ExplorePolicySnapshot,
  type ExploreRestrictions,
} from "../core/explorePolicy.ts"

/** App-owned contract version. Changing its semantics invalidates every prior result. */
export const EXPLORE_ATTESTATION_VERSION = "explore-v1"

export interface ExactExploreRecipeIdentity {
  readonly providerKind: ResolvedAgentConfig["id"]
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly adapterPackage: string
  readonly adapterVersion: string
  readonly runtimeVersion: string
}

/** Restriction facts observed by a reviewed execution-time contract run. */
export interface ExploreRestrictionEvidence extends ExploreRestrictions {}

export interface CertifiedExploreProfile {
  readonly attestationVersion: string
  readonly recipe: ExactExploreRecipeIdentity
  readonly restrictions: ExploreRestrictionEvidence
  readonly limits: ExploreCapacityLimits
  readonly model: string
  readonly effort: string
}

/** Current independently observed facts. Configuration alone is never evidence. */
export interface ExploreRuntimeEvidence {
  readonly adapterPackage: string
  readonly adapterVersion: string
  readonly runtimeVersion: string
  readonly restrictions: ExploreRestrictionEvidence
}

export type ExploreCapability =
  | {
      readonly status: "supported"
      readonly policy: ExplorePolicySnapshot
      readonly recipe: ResolvedAgentConfig
    }
  | { readonly status: "unsupported"; readonly reason: ExploreDenialReason }

/**
 * Production starts closed. A provider enters this list only with reviewed,
 * credentialed execution-time evidence for its exact restricted child recipe.
 */
export const CERTIFIED_EXPLORE_PROFILES: readonly CertifiedExploreProfile[] = []

export function resolveExploreCapability(
  config: ResolvedAgentConfig,
  evidence: ExploreRuntimeEvidence | undefined,
  profiles: readonly CertifiedExploreProfile[] = CERTIFIED_EXPLORE_PROFILES,
): ExploreCapability {
  if (!evidence) return denied("missing-attestation")
  if (!completeEvidence(evidence)) return denied("missing-attestation")
  if (!sameRestrictions(evidence.restrictions, EXPLORE_RESTRICTIONS)) {
    return denied("stale-attestation")
  }

  const providerProfiles = profiles.filter((profile) => profile.recipe.providerKind === config.id)
  if (providerProfiles.length === 0) return denied("unsupported-provider")

  const releaseProfiles = providerProfiles.filter((profile) =>
    profile.attestationVersion === EXPLORE_ATTESTATION_VERSION &&
    profile.recipe.adapterPackage === evidence.adapterPackage &&
    profile.recipe.adapterVersion === evidence.adapterVersion &&
    profile.recipe.runtimeVersion === evidence.runtimeVersion
  )
  if (releaseProfiles.length === 0) return denied("stale-attestation")

  const profile = releaseProfiles.find((candidate) =>
    sameRecipe(candidate.recipe, config) &&
    sameRestrictions(candidate.restrictions, evidence.restrictions) &&
    validProfile(candidate)
  )
  if (!profile) return denied("stale-attestation")

  const decision = evaluateExplorePolicy({
    role: "explore",
    restrictions: profile.restrictions,
    limits: profile.limits,
    attestationVersion: profile.attestationVersion,
    confirmed: { provider: profile.recipe.providerKind, model: profile.model, effort: profile.effort },
  })
  if (decision.kind === "denied") return { status: "unsupported", reason: decision.reason }

  // Build a new recipe object from the certified identity. No parent config object,
  // argument array, or environment object crosses into the child runtime.
  return {
    status: "supported",
    policy: decision.policy,
    recipe: {
      id: profile.recipe.providerKind,
      displayName: config.displayName,
      command: profile.recipe.command,
      args: [...profile.recipe.args],
      env: { ...profile.recipe.env },
      clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
      steeringCapability: { status: "unavailable" },
      runtimeProfile: { kind: "standard" },
    },
  }
}

function denied(reason: ExploreDenialReason): ExploreCapability {
  return { status: "unsupported", reason }
}

function validProfile(profile: CertifiedExploreProfile): boolean {
  return profile.attestationVersion === EXPLORE_ATTESTATION_VERSION &&
    typeof profile.model === "string" && profile.model.trim().length > 0 &&
    typeof profile.effort === "string" && profile.effort.trim().length > 0 &&
    Number.isSafeInteger(profile.limits.perParent) && profile.limits.perParent > 0 &&
    Number.isSafeInteger(profile.limits.global) && profile.limits.global > 0 &&
    completeIdentity(profile.recipe) &&
    sameRestrictions(profile.restrictions, EXPLORE_RESTRICTIONS)
}

function completeEvidence(evidence: ExploreRuntimeEvidence): boolean {
  return typeof evidence.adapterPackage === "string" && evidence.adapterPackage.trim().length > 0 &&
    typeof evidence.adapterVersion === "string" &&
    typeof evidence.runtimeVersion === "string" &&
    exactVersion(evidence.adapterVersion) &&
    exactVersion(evidence.runtimeVersion)
}

function completeIdentity(identity: ExactExploreRecipeIdentity): boolean {
  return typeof identity.command === "string" && identity.command.trim().length > 0 &&
    typeof identity.adapterPackage === "string" && identity.adapterPackage.trim().length > 0 &&
    typeof identity.adapterVersion === "string" &&
    typeof identity.runtimeVersion === "string" &&
    exactVersion(identity.adapterVersion) &&
    exactVersion(identity.runtimeVersion)
}

function exactVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/u.test(value)
}

function sameRecipe(expected: ExactExploreRecipeIdentity, actual: ResolvedAgentConfig): boolean {
  return expected.providerKind === actual.id &&
    expected.command === actual.command &&
    sameArray(expected.args, actual.args) &&
    sameEnvironment(expected.env, actual.env)
}

function sameRestrictions(left: unknown, right: ExploreRestrictions): left is ExploreRestrictionEvidence {
  if (typeof left !== "object" || left === null) return false
  const candidate = left as Record<string, unknown>
  return candidate.filesystem === right.filesystem &&
    candidate.shell === right.shell &&
    candidate.externalMcp === right.externalMcp &&
    candidate.agentControl === right.agentControl &&
    candidate.askUser === right.askUser &&
    candidate.maxDepth === right.maxDepth &&
    Object.keys(candidate).length === Object.keys(right).length
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameEnvironment(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return sameArray(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key])
}
