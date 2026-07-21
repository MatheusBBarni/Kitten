import type {
  AgentConfig,
  HardStopContinuationCapability,
  ProviderKind,
} from "../core/types.ts"

/** Every identity-bearing field in one reviewed safe-continuation recipe. */
export interface CertifiedHardStopContinuationRecipe {
  readonly implementationId: string
  readonly providerKind: ProviderKind
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly adapterPackage: string
  readonly adapterVersion: string
  readonly reviewed: boolean
}

/**
 * Adapter-local proof that one implementation observes both required boundaries.
 * Boolean fields are validated at runtime so partial evidence fails closed.
 */
export interface HardStopContinuationAdapterImplementation {
  readonly implementationId: string
  readonly providerKind: ProviderKind
  readonly adapterPackage: string
  readonly adapterVersion: string
  readonly cancellationAccepted: boolean
  readonly terminalSettlement: boolean
}

/** No provider recipe is enabled until reviewed evidence is committed. */
export const CERTIFIED_HARD_STOP_CONTINUATION_RECIPES: readonly CertifiedHardStopContinuationRecipe[] = []

const BUILT_IN_ADAPTER_PACKAGES: Readonly<Record<ProviderKind, string | null>> = {
  "claude-code": "@agentclientprotocol/claude-agent-acp",
  codex: "@agentclientprotocol/codex-acp",
  cursor: null,
}

const EXACT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

interface AdapterReleaseIdentity {
  readonly providerKind: ProviderKind
  readonly adapterPackage: string
  readonly adapterVersion: string
}

/**
 * Classify a fully merged recipe using independent reviewed recipe evidence and
 * adapter-local cancellation-plus-settlement proof. Every ambiguity fails closed.
 */
export function classifyHardStopContinuationCapability(
  recipe: Pick<AgentConfig, "id" | "command" | "args" | "env">,
  certifiedRecipes: readonly CertifiedHardStopContinuationRecipe[] =
    CERTIFIED_HARD_STOP_CONTINUATION_RECIPES,
  implementations: readonly HardStopContinuationAdapterImplementation[] = [],
): HardStopContinuationCapability {
  const release = adapterReleaseIdentity(recipe)
  if (release === null) return { status: "unavailable", reason: "unknown_recipe" }

  const packageCandidates = certifiedRecipes.filter(
    (candidate) =>
      candidate.providerKind === release.providerKind &&
      candidate.adapterPackage === release.adapterPackage,
  )
  if (packageCandidates.length === 0) {
    return { status: "unavailable", reason: "unreviewed_recipe" }
  }

  const releaseCandidates = packageCandidates.filter(
    (candidate) => candidate.adapterVersion === release.adapterVersion,
  )
  if (releaseCandidates.length === 0) {
    return { status: "unavailable", reason: "adapter_release_mismatch" }
  }

  const completeCandidates = releaseCandidates.filter(completeCertification)
  if (completeCandidates.length === 0) {
    return { status: "unavailable", reason: "unreviewed_recipe" }
  }

  const matchingCertifications = completeCandidates.filter((candidate) => sameRecipe(candidate, recipe))
  if (matchingCertifications.length !== 1) {
    return { status: "unavailable", reason: "recipe_mismatch" }
  }
  const certification = matchingCertifications[0]!

  const matchingImplementations = implementations.filter(
    (candidate) => candidate.implementationId === certification.implementationId,
  )
  if (matchingImplementations.length === 0) {
    return { status: "unavailable", reason: "missing_implementation" }
  }
  if (matchingImplementations.length !== 1) {
    return { status: "unavailable", reason: "attestation_mismatch" }
  }
  const implementation = matchingImplementations[0]!

  if (
    implementation.providerKind !== certification.providerKind ||
    implementation.adapterPackage !== certification.adapterPackage ||
    implementation.adapterVersion !== certification.adapterVersion
  ) {
    return { status: "unavailable", reason: "attestation_mismatch" }
  }

  if (!implementation.cancellationAccepted || !implementation.terminalSettlement) {
    return { status: "unavailable", reason: "incomplete_attestation" }
  }

  return { status: "supported" }
}

function adapterReleaseIdentity(
  recipe: Pick<AgentConfig, "id" | "args">,
): AdapterReleaseIdentity | null {
  const adapterPackage = BUILT_IN_ADAPTER_PACKAGES[recipe.id]
  if (adapterPackage === null) return null

  const prefix = `${adapterPackage}@`
  const packageSpecs = recipe.args.filter((arg) => arg.startsWith(prefix))
  if (packageSpecs.length !== 1) return null

  const adapterVersion = packageSpecs[0]!.slice(prefix.length)
  if (!EXACT_SEMVER.test(adapterVersion)) return null

  return { providerKind: recipe.id, adapterPackage, adapterVersion }
}

function completeCertification(candidate: CertifiedHardStopContinuationRecipe): boolean {
  if (
    !candidate.reviewed ||
    candidate.implementationId.length === 0 ||
    candidate.adapterPackage.length === 0 ||
    !EXACT_SEMVER.test(candidate.adapterVersion)
  ) {
    return false
  }

  const expectedPackageSpec = `${candidate.adapterPackage}@${candidate.adapterVersion}`
  return candidate.args.filter((arg) => arg.startsWith(`${candidate.adapterPackage}@`)).length === 1 &&
    candidate.args.includes(expectedPackageSpec)
}

function sameRecipe(
  expected: CertifiedHardStopContinuationRecipe,
  actual: Pick<AgentConfig, "id" | "command" | "args" | "env">,
): boolean {
  return (
    expected.providerKind === actual.id &&
    expected.command === actual.command &&
    sameOrderedValues(expected.args, actual.args) &&
    sameEnvironment(expected.env, actual.env)
  )
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameEnvironment(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return sameOrderedValues(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key])
}
