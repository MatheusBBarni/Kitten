import type { ResolvedAgentConfig } from "../core/types.ts"
import {
  CERTIFIED_CONTEXT_BUILD_PROFILES,
  CERTIFIED_RECIPIENT_PROFILES,
  resolveContextPackCapabilities,
  type CertifiedContextBuildProfile,
  type CertifiedRecipientProfile,
  type ContextPackCapabilityComposition,
  type ContextPackRuntimeEvidence,
} from "./contextPackCapability.ts"

/** The exact ACP SDK release covered by harness adapter certification. */
export const HARNESS_CONTRACT_SDK_VERSION = "1.2.1"

export type HarnessProfileId = string

export type HarnessEncoderKind =
  | "claude-code-prompt-meta-v1"
  | "codex-prompt-meta-v1"
  | "cursor-prompt-meta-v1"

/** Every identity-bearing field required to certify one runtime recipe. */
export interface ExactHarnessRecipeIdentity {
  readonly providerKind: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly adapterPackage: string
  readonly adapterVersion: string
}

/** One reviewed profile that the adapter boundary is allowed to encode. */
export interface CertifiedHarnessProfile {
  readonly profileId: HarnessProfileId
  readonly encoder: HarnessEncoderKind
  readonly sdkVersion: string
  readonly recipe: ExactHarnessRecipeIdentity
}

/** Complete credentialed evidence required to create a certified profile. */
export type HarnessContractResult =
  | {
      readonly status: "passed"
      readonly credentialed: true
      readonly profileId: HarnessProfileId
      readonly encoder: HarnessEncoderKind
      readonly sdkVersion: string
      readonly recipe: ExactHarnessRecipeIdentity
      readonly checks: {
        readonly harnessSeparated: true
        readonly userBlocksPreserved: true
        readonly harnessNotUserText: true
        readonly terminalResult: true
        readonly disposedCleanly: true
      }
    }
  | {
      readonly status: "skipped" | "failed"
      readonly credentialed: boolean
      readonly profileId: HarnessProfileId
      readonly encoder: HarnessEncoderKind
      readonly sdkVersion: string
      readonly recipe?: ExactHarnessRecipeIdentity
    }

export type HarnessCapability =
  | {
      readonly status: "supported"
      readonly profileId: HarnessProfileId
      readonly encoder: HarnessEncoderKind
    }
  | {
      readonly status: "unsupported"
      readonly reason:
        | "incomplete_evidence"
        | "unknown_recipe"
        | "recipe_mismatch"
        | "sdk_version_mismatch"
        | "unverified_profile"
    }

export interface HarnessRuntimeEvidence {
  readonly sdkVersion: string
  readonly adapterPackage: string
  readonly adapterVersion: string
}

export interface HarnessRecipe {
  readonly id: string
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export interface HarnessCapabilityComposition extends ContextPackCapabilityComposition {
  readonly harness: HarnessCapability
}

const EXACT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/u

/**
 * Reviewed credentialed contract results for the two pinned default adapter
 * recipes. A package, version, command, argument, or environment change no
 * longer matches these results and therefore remains fail-closed. Cursor stays
 * absent until its opt-in native contract records an exact CLI version.
 */
const BUILT_IN_CONTRACT_RESULTS: readonly HarnessContractResult[] = [
  {
    status: "passed",
    credentialed: true,
    profileId: "claude-code-acp-0.57.0",
    encoder: "claude-code-prompt-meta-v1",
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: {
      providerKind: "claude-code",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp@0.57.0"],
      env: {},
      adapterPackage: "@agentclientprotocol/claude-agent-acp",
      adapterVersion: "0.57.0",
    },
    checks: {
      harnessSeparated: true,
      userBlocksPreserved: true,
      harnessNotUserText: true,
      terminalResult: true,
      disposedCleanly: true,
    },
  },
  {
    status: "passed",
    credentialed: true,
    profileId: "codex-acp-1.1.2",
    encoder: "codex-prompt-meta-v1",
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: {
      providerKind: "codex",
      command: "npx",
      args: ["-y", "@agentclientprotocol/codex-acp@1.1.2"],
      env: { INITIAL_AGENT_MODE: "agent-full-access" },
      adapterPackage: "@agentclientprotocol/codex-acp",
      adapterVersion: "1.1.2",
    },
    checks: {
      harnessSeparated: true,
      userBlocksPreserved: true,
      harnessNotUserText: true,
      terminalResult: true,
      disposedCleanly: true,
    },
  },
]

export const CERTIFIED_HARNESS_PROFILES: readonly CertifiedHarnessProfile[] =
  certifiedProfilesFromContractResults(BUILT_IN_CONTRACT_RESULTS)

/** Convert only complete credentialed passes for the pinned SDK into profiles. */
export function certifiedProfilesFromContractResults(
  results: readonly HarnessContractResult[],
): CertifiedHarnessProfile[] {
  return results
    .filter(
      (result): result is Extract<HarnessContractResult, { status: "passed" }> =>
        result.status === "passed" &&
        result.credentialed &&
        result.sdkVersion === HARNESS_CONTRACT_SDK_VERSION &&
        result.checks.harnessSeparated &&
        result.checks.userBlocksPreserved &&
        result.checks.harnessNotUserText &&
        result.checks.terminalResult &&
        result.checks.disposedCleanly &&
        isCompleteIdentity(result.recipe),
    )
    .map((result) => ({
      profileId: result.profileId,
      encoder: result.encoder,
      sdkVersion: result.sdkVersion,
      recipe: cloneIdentity(result.recipe),
    }))
}

/** Resolve one fully merged recipe and its independently observed version facts. */
export function resolveHarnessCapability(
  recipe: HarnessRecipe,
  evidence: HarnessRuntimeEvidence | undefined,
  profiles: readonly CertifiedHarnessProfile[] = CERTIFIED_HARNESS_PROFILES,
): HarnessCapability {
  if (!evidence || !isExactVersion(evidence.adapterVersion) || !isExactVersion(evidence.sdkVersion)) {
    return { status: "unsupported", reason: "incomplete_evidence" }
  }
  if (evidence.sdkVersion !== HARNESS_CONTRACT_SDK_VERSION) {
    return { status: "unsupported", reason: "sdk_version_mismatch" }
  }

  const releaseMatches = profiles.filter(
    (profile) =>
      profile.sdkVersion === evidence.sdkVersion &&
      profile.recipe.providerKind === recipe.id &&
      profile.recipe.adapterPackage === evidence.adapterPackage &&
      profile.recipe.adapterVersion === evidence.adapterVersion,
  )
  if (releaseMatches.length === 0) {
    const providerKnown = profiles.some((profile) => profile.recipe.providerKind === recipe.id)
    return { status: "unsupported", reason: providerKnown ? "unverified_profile" : "unknown_recipe" }
  }

  const profile = releaseMatches.find((candidate) => sameRecipe(candidate.recipe, recipe))
  if (!profile) return { status: "unsupported", reason: "recipe_mismatch" }
  return { status: "supported", profileId: profile.profileId, encoder: profile.encoder }
}

/**
 * Resolve the ordinary prompt harness beside the separately certified Context
 * Pack capabilities. A supported ordinary harness never implies build or
 * recipient authority.
 */
export function resolveHarnessCapabilityComposition(
  recipe: ResolvedAgentConfig,
  harnessEvidence: HarnessRuntimeEvidence | undefined,
  contextPackEvidence: ContextPackRuntimeEvidence,
  now: number,
  harnessProfiles: readonly CertifiedHarnessProfile[] = CERTIFIED_HARNESS_PROFILES,
  buildProfiles: readonly CertifiedContextBuildProfile[] = CERTIFIED_CONTEXT_BUILD_PROFILES,
  recipientProfiles: readonly CertifiedRecipientProfile[] = CERTIFIED_RECIPIENT_PROFILES,
): HarnessCapabilityComposition {
  return {
    harness: resolveHarnessCapability(recipe, harnessEvidence, harnessProfiles),
    ...resolveContextPackCapabilities(recipe, contextPackEvidence, now, buildProfiles, recipientProfiles),
  }
}

/** Adapter-side exact match. Envelope profile IDs alone never grant capability. */
export function matchCertifiedHarnessProfile(
  recipe: HarnessRecipe,
  profileId: HarnessProfileId,
  profiles: readonly CertifiedHarnessProfile[] = CERTIFIED_HARNESS_PROFILES,
): CertifiedHarnessProfile | undefined {
  const profile = profiles.find(
    (candidate) =>
      candidate.profileId === profileId &&
      candidate.sdkVersion === HARNESS_CONTRACT_SDK_VERSION &&
      sameRecipe(candidate.recipe, recipe),
  )
  if (!profile) return undefined
  return {
    ...profile,
    recipe: cloneIdentity(profile.recipe),
  }
}

function isCompleteIdentity(identity: ExactHarnessRecipeIdentity): boolean {
  return (
    identity.providerKind.length > 0 &&
    identity.command.length > 0 &&
    identity.adapterPackage.length > 0 &&
    isExactVersion(identity.adapterVersion)
  )
}

function isExactVersion(version: string): boolean {
  return EXACT_SEMVER.test(version)
}

function sameRecipe(
  expected: ExactHarnessRecipeIdentity,
  actual: HarnessRecipe,
): boolean {
  return (
    expected.providerKind === actual.id &&
    expected.command === actual.command &&
    sameArray(expected.args, actual.args) &&
    sameEnvironment(expected.env, actual.env)
  )
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameEnvironment(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return sameArray(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key])
}

function cloneIdentity(identity: ExactHarnessRecipeIdentity): ExactHarnessRecipeIdentity {
  return { ...identity, args: [...identity.args], env: { ...identity.env } }
}
