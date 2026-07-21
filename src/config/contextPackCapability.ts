import type {
  ContextBuildAvailability,
  ContextBuildOperation,
  ContextPackEvidenceDenialReason,
  RecipientProfileAvailability,
  ResolvedAgentConfig,
} from "../core/types.ts"

export const CONTEXT_BUILD_CAPABILITY_VERSION = "explore-v2" as const
export const RECIPIENT_PROFILE_VERSION = "recipient-profile-v1"

export const CONTEXT_BUILD_OPERATIONS: readonly ContextBuildOperation[] = [
  "ask_user:scoped",
  "draft:read-bounded",
  "workspace:read-bounded",
  "draft:mutate-revision-fenced",
]

export interface ExactContextPackRecipeIdentity {
  readonly providerKind: ResolvedAgentConfig["id"]
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly adapterPackage: string
  readonly adapterVersion: string
  readonly runtimeVersion: string
  readonly model: string
}

export interface IndependentEvidenceReview {
  readonly reviewed: true
  readonly reviewId: string
  readonly validFrom: number
  readonly validUntil: number
}

export interface CertifiedContextBuildProfile {
  readonly capabilityVersion: typeof CONTEXT_BUILD_CAPABILITY_VERSION
  readonly evidenceVersion: string
  readonly recipe: ExactContextPackRecipeIdentity
  readonly operations: readonly ContextBuildOperation[]
  readonly review: IndependentEvidenceReview
}

/** Current observed facts; configuration and profile declarations are not runtime evidence. */
export interface ContextBuildRuntimeEvidence {
  readonly capabilityVersion: string
  readonly evidenceVersion: string
  readonly adapterPackage: string
  readonly adapterVersion: string
  readonly runtimeVersion: string
  readonly model: string
  readonly operations: readonly ContextBuildOperation[]
  readonly observedAt: number
  readonly validUntil: number
}

export interface CertifiedRecipientProfile {
  readonly profileVersion: string
  readonly evidenceVersion: string
  readonly recipe: ExactContextPackRecipeIdentity
  readonly freshSessionCapacity: number
  readonly reserve: number
  readonly counterVersion: string
  readonly review: IndependentEvidenceReview
}

/** A current exact counter/capacity observation for one reviewed recipient recipe. */
export interface RecipientProfileRuntimeEvidence {
  readonly profileVersion: string
  readonly evidenceVersion: string
  readonly adapterPackage: string
  readonly adapterVersion: string
  readonly runtimeVersion: string
  readonly model: string
  readonly freshSessionCapacity: number
  readonly reserve: number
  readonly counterVersion: string
  readonly observedAt: number
  readonly validUntil: number
}

export interface ContextPackRuntimeEvidence {
  readonly contextBuild?: ContextBuildRuntimeEvidence
  readonly recipientProfile?: RecipientProfileRuntimeEvidence
}

export interface ContextPackCapabilityComposition {
  readonly contextBuild: ContextBuildAvailability
  readonly recipientProfile: RecipientProfileAvailability
}

/** Production remains intentionally unavailable until reviewed recipes are added. */
export const CERTIFIED_CONTEXT_BUILD_PROFILES: readonly CertifiedContextBuildProfile[] = []
export const CERTIFIED_RECIPIENT_PROFILES: readonly CertifiedRecipientProfile[] = []

export function resolveContextBuildCapability(
  config: ResolvedAgentConfig,
  evidence: ContextBuildRuntimeEvidence | undefined,
  now: number,
  profiles: readonly CertifiedContextBuildProfile[] = CERTIFIED_CONTEXT_BUILD_PROFILES,
): ContextBuildAvailability {
  if (!evidence) return contextBuildDenied("missing_evidence")
  if (!validNow(now) || !validContextBuildEvidence(evidence)) {
    return contextBuildDenied("malformed_evidence")
  }
  if (!currentWindow(evidence.observedAt, evidence.validUntil, now)) {
    return contextBuildDenied("stale_evidence")
  }

  const providerProfiles = profiles.filter((profile) => profile.recipe.providerKind === config.id)
  if (providerProfiles.length === 0) return contextBuildDenied("unsupported_recipe")

  const validProfiles = providerProfiles.filter(validContextBuildProfile)
  if (validProfiles.length === 0) return contextBuildDenied("malformed_evidence")

  const versionProfiles = validProfiles.filter((profile) =>
    profile.capabilityVersion === CONTEXT_BUILD_CAPABILITY_VERSION &&
    profile.evidenceVersion === evidence.evidenceVersion &&
    profile.recipe.adapterPackage === evidence.adapterPackage &&
    profile.recipe.adapterVersion === evidence.adapterVersion &&
    profile.recipe.runtimeVersion === evidence.runtimeVersion &&
    profile.recipe.model === evidence.model
  )
  if (versionProfiles.length === 0) return contextBuildDenied("stale_evidence")

  const currentProfiles = versionProfiles.filter((profile) => validReview(profile.review, now))
  if (currentProfiles.length === 0) return contextBuildDenied("stale_evidence")

  const profile = currentProfiles.find((candidate) =>
    sameOperations(candidate.operations, evidence.operations) &&
    sameRecipe(candidate.recipe, config)
  )
  if (!profile) return contextBuildDenied("recipe_mismatch")

  return {
    status: "available",
    capabilityVersion: CONTEXT_BUILD_CAPABILITY_VERSION,
    evidenceVersion: profile.evidenceVersion,
    operations: [...CONTEXT_BUILD_OPERATIONS],
    recipe: resolvedRecipe(config, profile.recipe),
    model: profile.recipe.model,
  }
}

export function resolveRecipientProfile(
  config: ResolvedAgentConfig,
  evidence: RecipientProfileRuntimeEvidence | undefined,
  now: number,
  profiles: readonly CertifiedRecipientProfile[] = CERTIFIED_RECIPIENT_PROFILES,
): RecipientProfileAvailability {
  if (!evidence) return recipientDenied("missing_evidence")
  if (!validNow(now) || !validRecipientEvidence(evidence)) {
    return recipientDenied("malformed_evidence")
  }
  if (!currentWindow(evidence.observedAt, evidence.validUntil, now)) {
    return recipientDenied("stale_evidence")
  }

  const providerProfiles = profiles.filter((profile) => profile.recipe.providerKind === config.id)
  if (providerProfiles.length === 0) return recipientDenied("unsupported_recipe")

  const validProfiles = providerProfiles.filter(validRecipientProfile)
  if (validProfiles.length === 0) return recipientDenied("malformed_evidence")

  const versionProfiles = validProfiles.filter((profile) =>
    profile.profileVersion === RECIPIENT_PROFILE_VERSION &&
    profile.profileVersion === evidence.profileVersion &&
    profile.evidenceVersion === evidence.evidenceVersion &&
    profile.recipe.adapterPackage === evidence.adapterPackage &&
    profile.recipe.adapterVersion === evidence.adapterVersion &&
    profile.recipe.runtimeVersion === evidence.runtimeVersion &&
    profile.recipe.model === evidence.model &&
    profile.freshSessionCapacity === evidence.freshSessionCapacity &&
    profile.reserve === evidence.reserve &&
    profile.counterVersion === evidence.counterVersion
  )
  if (versionProfiles.length === 0) return recipientDenied("stale_evidence")

  const currentProfiles = versionProfiles.filter((profile) => validReview(profile.review, now))
  if (currentProfiles.length === 0) return recipientDenied("stale_evidence")

  const profile = currentProfiles.find((candidate) => sameRecipe(candidate.recipe, config))
  if (!profile) return recipientDenied("recipe_mismatch")

  return {
    status: "available",
    profile: {
      profileVersion: profile.profileVersion,
      evidenceVersion: profile.evidenceVersion,
      recipe: resolvedRecipe(config, profile.recipe),
      model: profile.recipe.model,
      freshSessionCapacity: profile.freshSessionCapacity,
      reserve: profile.reserve,
      counterVersion: profile.counterVersion,
      validUntil: Math.min(profile.review.validUntil, evidence.validUntil),
    },
  }
}

export function resolveContextPackCapabilities(
  config: ResolvedAgentConfig,
  evidence: ContextPackRuntimeEvidence,
  now: number,
  buildProfiles: readonly CertifiedContextBuildProfile[] = CERTIFIED_CONTEXT_BUILD_PROFILES,
  recipientProfiles: readonly CertifiedRecipientProfile[] = CERTIFIED_RECIPIENT_PROFILES,
): ContextPackCapabilityComposition {
  return {
    contextBuild: resolveContextBuildCapability(config, evidence.contextBuild, now, buildProfiles),
    recipientProfile: resolveRecipientProfile(config, evidence.recipientProfile, now, recipientProfiles),
  }
}

function contextBuildDenied(reason: ContextPackEvidenceDenialReason): ContextBuildAvailability {
  return { status: "unavailable", reason }
}

function recipientDenied(reason: ContextPackEvidenceDenialReason): RecipientProfileAvailability {
  return { status: "unavailable", reason }
}

function validContextBuildEvidence(evidence: ContextBuildRuntimeEvidence): boolean {
  return evidence.capabilityVersion === CONTEXT_BUILD_CAPABILITY_VERSION &&
    nonEmpty(evidence.evidenceVersion) &&
    nonEmpty(evidence.adapterPackage) &&
    exactVersion(evidence.adapterVersion) &&
    exactVersion(evidence.runtimeVersion) &&
    nonEmpty(evidence.model) &&
    sameOperations(evidence.operations, CONTEXT_BUILD_OPERATIONS) &&
    validWindowShape(evidence.observedAt, evidence.validUntil)
}

function validRecipientEvidence(evidence: RecipientProfileRuntimeEvidence): boolean {
  return evidence.profileVersion === RECIPIENT_PROFILE_VERSION &&
    nonEmpty(evidence.evidenceVersion) &&
    nonEmpty(evidence.adapterPackage) &&
    exactVersion(evidence.adapterVersion) &&
    exactVersion(evidence.runtimeVersion) &&
    nonEmpty(evidence.model) &&
    validCapacity(evidence.freshSessionCapacity, evidence.reserve) &&
    nonEmpty(evidence.counterVersion) &&
    validWindowShape(evidence.observedAt, evidence.validUntil)
}

function validContextBuildProfile(profile: CertifiedContextBuildProfile): boolean {
  return profile.capabilityVersion === CONTEXT_BUILD_CAPABILITY_VERSION &&
    nonEmpty(profile.evidenceVersion) &&
    completeIdentity(profile.recipe) &&
    sameOperations(profile.operations, CONTEXT_BUILD_OPERATIONS) &&
    validReviewShape(profile.review)
}

function validRecipientProfile(profile: CertifiedRecipientProfile): boolean {
  return profile.profileVersion === RECIPIENT_PROFILE_VERSION &&
    nonEmpty(profile.evidenceVersion) &&
    completeIdentity(profile.recipe) &&
    validCapacity(profile.freshSessionCapacity, profile.reserve) &&
    nonEmpty(profile.counterVersion) &&
    validReviewShape(profile.review)
}

function completeIdentity(identity: ExactContextPackRecipeIdentity): boolean {
  return nonEmpty(identity.command) &&
    Array.isArray(identity.args) && identity.args.every((argument) => typeof argument === "string") &&
    validEnvironment(identity.env) &&
    nonEmpty(identity.adapterPackage) &&
    exactVersion(identity.adapterVersion) &&
    exactVersion(identity.runtimeVersion) &&
    nonEmpty(identity.model)
}

function sameRecipe(expected: ExactContextPackRecipeIdentity, actual: ResolvedAgentConfig): boolean {
  return completeIdentity(expected) &&
    expected.providerKind === actual.id &&
    expected.command === actual.command &&
    sameArray(expected.args, actual.args) &&
    sameEnvironment(expected.env, actual.env)
}

function sameOperations(left: readonly ContextBuildOperation[], right: readonly ContextBuildOperation[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameEnvironment(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  if (!validEnvironment(left) || !validEnvironment(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return sameArray(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key])
}

function validEnvironment(environment: unknown): environment is Readonly<Record<string, string>> {
  if (typeof environment !== "object" || environment === null || Array.isArray(environment)) return false
  const prototype = Object.getPrototypeOf(environment) as unknown
  if (prototype !== Object.prototype && prototype !== null) return false
  if (Reflect.ownKeys(environment).some((key) => typeof key !== "string")) return false
  return Object.values(environment).every((value) => typeof value === "string")
}

function validReview(review: IndependentEvidenceReview, now: number): boolean {
  return validReviewShape(review) && currentWindow(review.validFrom, review.validUntil, now)
}

function validReviewShape(review: IndependentEvidenceReview): boolean {
  return review.reviewed === true && nonEmpty(review.reviewId) && validWindowShape(review.validFrom, review.validUntil)
}

function validCapacity(capacity: number, reserve: number): boolean {
  return Number.isSafeInteger(capacity) && capacity > 0 &&
    Number.isSafeInteger(reserve) && reserve >= 0 && reserve < capacity
}

function validNow(now: number): boolean {
  return Number.isSafeInteger(now) && now >= 0
}

function validWindowShape(from: number, until: number): boolean {
  return validNow(from) && validNow(until) && from <= until
}

function currentWindow(from: number, until: number, now: number): boolean {
  return from <= now && now <= until
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function exactVersion(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/u.test(value)
}

function resolvedRecipe(
  config: ResolvedAgentConfig,
  identity: ExactContextPackRecipeIdentity,
): ResolvedAgentConfig {
  return {
    id: identity.providerKind,
    displayName: config.displayName,
    command: identity.command,
    args: [...identity.args],
    env: { ...identity.env },
    clarificationCapability: { status: "unsupported", reason: "unverified_recipe" },
    hardStopContinuationCapability: { status: "unavailable", reason: "unknown_recipe" },
    steeringCapability: { status: "unavailable" },
    runtimeProfile: { kind: "standard" },
  }
}
