/**
 * Pure, protocol-free V1 policy for one attested `explore` child.
 *
 * This module owns values only. Runtime attestation, capacity reservation, child
 * startup, persistence, telemetry, and presentation remain in their owning layers.
 */

import type { ProviderKind } from "./types.ts"

export const EXPLORE_ROLE = "explore" as const
export type ExploreRole = typeof EXPLORE_ROLE

/** The complete and non-configurable V1 authority boundary. */
export interface ExploreRestrictions {
  readonly filesystem: "read-only"
  readonly shell: false
  readonly externalMcp: false
  readonly agentControl: false
  readonly askUser: true
  readonly maxDepth: 0
}

export const EXPLORE_RESTRICTIONS: ExploreRestrictions = Object.freeze({
  filesystem: "read-only",
  shell: false,
  externalMcp: false,
  agentControl: false,
  askUser: true,
  maxDepth: 0,
})

/** Host-supplied admission limits. V1 deliberately defines no defaults or storage. */
export interface ExploreCapacityLimits {
  readonly perParent: number
  readonly global: number
}

/** Display facts confirmed by the selected runtime, with no provider recipe data. */
export interface ConfirmedAgentConfig {
  readonly provider: ProviderKind
  readonly model: string
  readonly effort: string
}

/** One accepted launch-time fact, copied and deeply frozen by the policy evaluator. */
export interface ExplorePolicySnapshot {
  readonly role: ExploreRole
  readonly restrictions: ExploreRestrictions
  readonly limits: ExploreCapacityLimits
  readonly attestationVersion: string
  readonly confirmed: ConfirmedAgentConfig
}

/** Every V1 refusal category. No variant can carry provider output or user content. */
export const EXPLORE_DENIAL_REASONS = Object.freeze([
  "unsupported-provider",
  "missing-attestation",
  "stale-attestation",
  "parent-ineligible",
  "parent-closing",
  "capacity-exhausted",
  "bridge-unavailable",
  "startup-failed",
] as const)

export type ExploreDenialReason = (typeof EXPLORE_DENIAL_REASONS)[number]

const CONFIRMED_PROVIDER_KINDS: Readonly<Record<ProviderKind, true>> = Object.freeze({
  "claude-code": true,
  codex: true,
  cursor: true,
})

export type ExploreLaunchDecision =
  | { readonly kind: "eligible"; readonly policy: ExplorePolicySnapshot }
  | { readonly kind: "denied"; readonly reason: ExploreDenialReason }

/**
 * Untrusted policy evidence supplied by a later provider verifier.
 * Unknown fields are intentional: core validates the complete value before accepting it.
 */
export interface ExplorePolicyInput {
  readonly role: unknown
  readonly restrictions: unknown
  readonly limits: unknown
  readonly attestationVersion: unknown
  readonly confirmed: unknown
}

/** Resolve untrusted launch evidence into either one immutable fact or a closed refusal. */
export function evaluateExplorePolicy(input: ExplorePolicyInput): ExploreLaunchDecision
export function evaluateExplorePolicy(input: unknown): ExploreLaunchDecision {
  if (
    !hasExactKeys(input, [
      "role",
      "restrictions",
      "limits",
      "attestationVersion",
      "confirmed",
    ])
  ) {
    return createExploreDenial("missing-attestation")
  }
  if (input.role !== EXPLORE_ROLE) return createExploreDenial("parent-ineligible")
  if (!hasExactExploreRestrictions(input.restrictions)) {
    return createExploreDenial("stale-attestation")
  }
  if (!hasValidCapacityLimits(input.limits)) return createExploreDenial("capacity-exhausted")
  if (!isNonblankString(input.attestationVersion)) {
    return createExploreDenial("missing-attestation")
  }
  if (!hasExactConfirmedAgentConfigShape(input.confirmed)) {
    return createExploreDenial("missing-attestation")
  }
  if (!isProviderKind(input.confirmed.provider)) {
    return createExploreDenial("unsupported-provider")
  }
  if (!isNonblankString(input.confirmed.model) || !isNonblankString(input.confirmed.effort)) {
    return createExploreDenial("missing-attestation")
  }

  const policy: ExplorePolicySnapshot = Object.freeze({
    role: EXPLORE_ROLE,
    restrictions: Object.freeze({ ...EXPLORE_RESTRICTIONS }),
    limits: Object.freeze({
      perParent: input.limits.perParent,
      global: input.limits.global,
    }),
    attestationVersion: input.attestationVersion.trim(),
    confirmed: Object.freeze({
      provider: input.confirmed.provider,
      model: input.confirmed.model.trim(),
      effort: input.confirmed.effort.trim(),
    }),
  })

  return Object.freeze({ kind: "eligible", policy })
}

/** Construct a denied decision while preventing forged runtime string values. */
export function createExploreDenial(reason: ExploreDenialReason): ExploreLaunchDecision
export function createExploreDenial(reason: unknown): ExploreLaunchDecision {
  return Object.freeze({
    kind: "denied",
    reason: isExploreDenialReason(reason) ? reason : "missing-attestation",
  })
}

export function isExploreDenialReason(value: unknown): value is ExploreDenialReason {
  return typeof value === "string" && (EXPLORE_DENIAL_REASONS as readonly string[]).includes(value)
}

/**
 * Recognize only the canonical, deeply frozen snapshot produced by
 * {@link evaluateExplorePolicy}. Registration uses this guard so a structurally
 * similar mutable object cannot become a live safety claim.
 */
export function isAcceptedExplorePolicySnapshot(
  value: unknown,
): value is ExplorePolicySnapshot {
  if (
    !hasExactKeys(value, [
      "role",
      "restrictions",
      "limits",
      "attestationVersion",
      "confirmed",
    ]) ||
    !Object.isFrozen(value) ||
    !Object.isFrozen(value.restrictions) ||
    !Object.isFrozen(value.limits) ||
    !Object.isFrozen(value.confirmed)
  ) {
    return false
  }

  const decision = evaluateExplorePolicy(value)
  if (decision.kind !== "eligible") return false
  return (
    value.role === decision.policy.role &&
    value.attestationVersion === decision.policy.attestationVersion &&
    hasSameExploreRestrictions(value.restrictions, decision.policy.restrictions) &&
    hasSameCapacityLimits(value.limits, decision.policy.limits) &&
    hasSameConfirmedAgentConfig(value.confirmed, decision.policy.confirmed)
  )
}

function hasExactExploreRestrictions(value: unknown): value is ExploreRestrictions {
  return (
    hasExactKeys(value, [
      "filesystem",
      "shell",
      "externalMcp",
      "agentControl",
      "askUser",
      "maxDepth",
    ]) &&
    value.filesystem === EXPLORE_RESTRICTIONS.filesystem &&
    value.shell === EXPLORE_RESTRICTIONS.shell &&
    value.externalMcp === EXPLORE_RESTRICTIONS.externalMcp &&
    value.agentControl === EXPLORE_RESTRICTIONS.agentControl &&
    value.askUser === EXPLORE_RESTRICTIONS.askUser &&
    value.maxDepth === EXPLORE_RESTRICTIONS.maxDepth
  )
}

function hasSameExploreRestrictions(
  left: unknown,
  right: ExploreRestrictions,
): boolean {
  return hasExactExploreRestrictions(left) &&
    left.filesystem === right.filesystem &&
    left.shell === right.shell &&
    left.externalMcp === right.externalMcp &&
    left.agentControl === right.agentControl &&
    left.askUser === right.askUser &&
    left.maxDepth === right.maxDepth
}

function hasSameCapacityLimits(left: unknown, right: ExploreCapacityLimits): boolean {
  return hasValidCapacityLimits(left) &&
    left.perParent === right.perParent &&
    left.global === right.global
}

function hasSameConfirmedAgentConfig(left: unknown, right: ConfirmedAgentConfig): boolean {
  return hasExactConfirmedAgentConfigShape(left) &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.effort === right.effort
}

function hasValidCapacityLimits(value: unknown): value is ExploreCapacityLimits {
  return (
    hasExactKeys(value, ["perParent", "global"]) &&
    isPositiveCapacity(value.perParent) &&
    isPositiveCapacity(value.global)
  )
}

function hasExactConfirmedAgentConfigShape(
  value: unknown,
): value is Record<keyof ConfirmedAgentConfig, unknown> {
  return hasExactKeys(value, ["provider", "model", "effort"])
}

function isPositiveCapacity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isNonblankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isProviderKind(value: unknown): value is ProviderKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CONFIRMED_PROVIDER_KINDS, value)
  )
}

function hasExactKeys<K extends string>(
  value: unknown,
  expectedKeys: readonly K[],
): value is Record<K, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key as K))
}
