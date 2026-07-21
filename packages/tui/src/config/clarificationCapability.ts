import type { AgentConfig, ClarificationCapability, ProviderKind } from "../core/types.ts"

/** The exact ACP SDK release whose unstable elicitation surface is contract-tested. */
export const CLARIFICATION_CONTRACT_SDK_VERSION = "1.2.1"

/** All identity-bearing parts of one built-in adapter recipe. */
export interface ExactClarificationRecipeIdentity {
  providerKind: ProviderKind
  command: string
  args: readonly string[]
  env: Readonly<Record<string, string>>
  adapterPackage: string
  adapterVersion: string
}

/** Evidence required before an exact recipe may enter the verified allowlist. */
export type ClarificationContractResult =
  | {
      status: "passed"
      credentialed: true
      sdkVersion: string
      recipe: ExactClarificationRecipeIdentity
      checks: {
        advertised: true
        requestDelivered: true
        acceptedResponse: true
        cancellation: true
        cleanCompletion: true
      }
    }
  | {
      status: "skipped" | "failed"
      credentialed: boolean
      sdkVersion: string
      recipe: ExactClarificationRecipeIdentity
    }

const BUILT_IN_ADAPTER_PACKAGES: Readonly<Record<ProviderKind, string | null>> = {
  "claude-code": "@agentclientprotocol/claude-agent-acp",
  codex: "@agentclientprotocol/codex-acp",
  cursor: null,
}

const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

/**
 * Credentialed contract results committed after a real adapter run.
 *
 * V1 deliberately starts empty. Running or skipping the opt-in contract test does
 * not mutate this source file; a recipe is added only in a reviewed change that
 * carries a complete passing result for the exact SDK and recipe identity.
 */
const BUILT_IN_CONTRACT_RESULTS: readonly ClarificationContractResult[] = []

/** The production allowlist. It can contain only complete, credentialed passes. */
export const VERIFIED_CLARIFICATION_RECIPES: readonly ExactClarificationRecipeIdentity[] =
  verifiedRecipesFromContractResults(BUILT_IN_CONTRACT_RESULTS)

/**
 * Convert contract evidence into allowlist entries. Skips, failures, partial
 * checks, and results from another SDK release fail closed.
 */
export function verifiedRecipesFromContractResults(
  results: readonly ClarificationContractResult[],
): ExactClarificationRecipeIdentity[] {
  return results
    .filter(
      (result): result is Extract<ClarificationContractResult, { status: "passed" }> =>
        result.status === "passed" &&
        result.credentialed &&
        result.sdkVersion === CLARIFICATION_CONTRACT_SDK_VERSION &&
        result.checks.advertised &&
        result.checks.requestDelivered &&
        result.checks.acceptedResponse &&
        result.checks.cancellation &&
        result.checks.cleanCompletion,
    )
    .map((result) => cloneIdentity(result.recipe))
}

/**
 * Classify a fully merged spawn recipe. Display metadata is intentionally absent
 * from the input identity, while command, ordered args, full env, provider kind,
 * package, and exact version must all match a verified entry.
 */
export function classifyClarificationCapability(
  recipe: Pick<AgentConfig, "id" | "command" | "args" | "env">,
  verifiedRecipes: readonly ExactClarificationRecipeIdentity[] = VERIFIED_CLARIFICATION_RECIPES,
): ClarificationCapability {
  const identity = exactRecipeIdentity(recipe)
  if (identity === null) return { status: "unsupported", reason: "unknown_recipe" }

  const sameAdapterRelease = verifiedRecipes.filter(
    (candidate) =>
      candidate.providerKind === identity.providerKind &&
      candidate.adapterPackage === identity.adapterPackage &&
      candidate.adapterVersion === identity.adapterVersion,
  )
  if (sameAdapterRelease.length === 0) {
    return { status: "unsupported", reason: "unverified_recipe" }
  }

  const verified = sameAdapterRelease.find((candidate) => sameIdentity(candidate, identity))
  if (!verified) return { status: "unsupported", reason: "recipe_overridden" }

  return {
    status: "supported",
    adapterPackage: verified.adapterPackage,
    adapterVersion: verified.adapterVersion,
  }
}

/** Resolve the package/version embedded in a built-in provider's command line. */
export function exactRecipeIdentity(
  recipe: Pick<AgentConfig, "id" | "command" | "args" | "env">,
): ExactClarificationRecipeIdentity | null {
  const adapterPackage = BUILT_IN_ADAPTER_PACKAGES[recipe.id]
  if (adapterPackage === null) return null
  const prefix = `${adapterPackage}@`
  const packageSpec = recipe.args.find((arg) => arg.startsWith(prefix))
  if (!packageSpec) return null

  const adapterVersion = packageSpec.slice(prefix.length)
  if (!EXACT_SEMVER.test(adapterVersion)) return null

  return {
    providerKind: recipe.id,
    command: recipe.command,
    args: [...recipe.args],
    env: { ...recipe.env },
    adapterPackage,
    adapterVersion,
  }
}

function sameIdentity(left: ExactClarificationRecipeIdentity, right: ExactClarificationRecipeIdentity): boolean {
  return (
    left.providerKind === right.providerKind &&
    left.command === right.command &&
    sameArray(left.args, right.args) &&
    sameEnvironment(left.env, right.env) &&
    left.adapterPackage === right.adapterPackage &&
    left.adapterVersion === right.adapterVersion
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

function cloneIdentity(identity: ExactClarificationRecipeIdentity): ExactClarificationRecipeIdentity {
  return {
    ...identity,
    args: [...identity.args],
    env: { ...identity.env },
  }
}
