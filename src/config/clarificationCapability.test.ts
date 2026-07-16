import { describe, expect, it } from "bun:test"

import type { AgentConfig, ResolvedAgentConfig } from "../core/types.ts"
import {
  CLARIFICATION_CONTRACT_SDK_VERSION,
  VERIFIED_CLARIFICATION_RECIPES,
  classifyClarificationCapability,
  exactRecipeIdentity,
  verifiedRecipesFromContractResults,
  type ClarificationContractResult,
  type ExactClarificationRecipeIdentity,
} from "./clarificationCapability.ts"

const CODEX_RECIPE = {
  id: "codex",
  displayName: "Codex",
  command: "npx",
  args: ["-y", "@agentclientprotocol/codex-acp@1.1.2"],
  env: { INITIAL_AGENT_MODE: "agent-full-access" },
} satisfies AgentConfig

const CURSOR_RECIPE = {
  id: "cursor",
  displayName: "Cursor",
  command: "agent",
  args: ["acp"],
  env: {},
} satisfies AgentConfig

const VERIFIED_CODEX: ExactClarificationRecipeIdentity = {
  providerKind: "codex",
  command: CODEX_RECIPE.command,
  args: CODEX_RECIPE.args,
  env: CODEX_RECIPE.env,
  adapterPackage: "@agentclientprotocol/codex-acp",
  adapterVersion: "1.1.2",
}

const COMPLETE_PASS: ClarificationContractResult = {
  status: "passed",
  credentialed: true,
  sdkVersion: CLARIFICATION_CONTRACT_SDK_VERSION,
  recipe: VERIFIED_CODEX,
  checks: {
    advertised: true,
    requestDelivered: true,
    acceptedResponse: true,
    cancellation: true,
    cleanCompletion: true,
  },
}

describe("clarification capability classification", () => {
  const verified = verifiedRecipesFromContractResults([COMPLETE_PASS])

  it("supports only the exact recipe backed by complete credentialed contract evidence", () => {
    expect(classifyClarificationCapability(CODEX_RECIPE, verified)).toEqual({
      status: "supported",
      adapterPackage: "@agentclientprotocol/codex-acp",
      adapterVersion: "1.1.2",
    })
  })

  it.each([
    ["command", { ...CODEX_RECIPE, command: "/opt/bin/npx" }],
    ["ordered arguments", { ...CODEX_RECIPE, args: ["-y", "@agentclientprotocol/codex-acp@1.1.2", "--verbose"] }],
    ["environment", { ...CODEX_RECIPE, env: { ...CODEX_RECIPE.env, CODEX_PATH: "/opt/codex" } }],
  ])("fails closed when the resolved %s changes", (_part, recipe) => {
    expect(classifyClarificationCapability(recipe, verified)).toEqual({
      status: "unsupported",
      reason: "recipe_overridden",
    })
  })

  it.each([
    ["package", { ...CODEX_RECIPE, args: ["-y", "@agentclientprotocol/other-acp@1.1.2"] }],
    ["floating version", { ...CODEX_RECIPE, args: ["-y", "@agentclientprotocol/codex-acp@latest"] }],
    ["provider kind", { ...CODEX_RECIPE, id: "claude-code" as const }],
  ])("fails closed for an unknown %s", (_part, recipe) => {
    expect(classifyClarificationCapability(recipe, verified)).toEqual({
      status: "unsupported",
      reason: "unknown_recipe",
    })
  })

  it("fails closed when an exact built-in adapter version has not been verified", () => {
    expect(
      classifyClarificationCapability({
        ...CODEX_RECIPE,
        args: ["-y", "@agentclientprotocol/codex-acp@1.1.3"],
      }, verified),
    ).toEqual({ status: "unsupported", reason: "unverified_recipe" })
  })

  it("ignores cosmetic display-name changes", () => {
    const renamed = { ...CODEX_RECIPE, displayName: "My coding agent" }

    expect(classifyClarificationCapability(renamed, verified)).toEqual(
      classifyClarificationCapability(CODEX_RECIPE, verified),
    )
  })

  it("does not let skipped, failed, uncredentialed, or wrong-SDK results enable a recipe", () => {
    const excluded: ClarificationContractResult[] = [
      { status: "skipped", credentialed: false, sdkVersion: CLARIFICATION_CONTRACT_SDK_VERSION, recipe: VERIFIED_CODEX },
      { status: "failed", credentialed: true, sdkVersion: CLARIFICATION_CONTRACT_SDK_VERSION, recipe: VERIFIED_CODEX },
      { ...COMPLETE_PASS, sdkVersion: "1.2.0" },
    ]

    expect(verifiedRecipesFromContractResults(excluded)).toEqual([])
    expect(classifyClarificationCapability(CODEX_RECIPE, verifiedRecipesFromContractResults(excluded))).toEqual({
      status: "unsupported",
      reason: "unverified_recipe",
    })
  })

  it("ships with no recipe enabled before real credentialed evidence is committed", () => {
    expect(VERIFIED_CLARIFICATION_RECIPES).toEqual([])
    expect(classifyClarificationCapability(CODEX_RECIPE)).toEqual({
      status: "unsupported",
      reason: "unverified_recipe",
    })
  })

  it("keeps native Cursor ACP outside package-backed clarification evidence", () => {
    expect(exactRecipeIdentity(CURSOR_RECIPE)).toBeNull()
    expect(VERIFIED_CLARIFICATION_RECIPES.some((recipe) => recipe.providerKind === "cursor")).toBe(false)
    expect(classifyClarificationCapability(CURSOR_RECIPE, verified)).toEqual({
      status: "unsupported",
      reason: "unknown_recipe",
    })
  })

  it.each([
    ["command", { ...CURSOR_RECIPE, command: "/opt/cursor/agent" }],
    ["arguments", { ...CURSOR_RECIPE, args: ["acp", "--debug"] }],
    ["environment", { ...CURSOR_RECIPE, env: { CURSOR_CONFIG: "/tmp/cursor" } }],
  ])("keeps Cursor unsupported when its %s are overridden", (_part, recipe) => {
    expect(exactRecipeIdentity(recipe)).toBeNull()
    expect(classifyClarificationCapability(recipe, verified)).toEqual({
      status: "unsupported",
      reason: "unknown_recipe",
    })
  })

  it("does not infer Cursor clarification support from display or runtime-profile metadata", () => {
    const resolvedCursor: ResolvedAgentConfig = {
      ...CURSOR_RECIPE,
      displayName: "Verified structured clarification",
      clarificationCapability: {
        status: "supported",
        adapterPackage: "untrusted-display-metadata",
        adapterVersion: "9.9.9",
      },
      steeringCapability: { status: "unavailable" },
      runtimeProfile: {
        kind: "cursor-certified",
        command: "agent",
        args: ["acp"],
        env: {},
        certifiedVersion: "9.9.9",
        authenticationMethod: "cursor_login",
      },
    }

    expect(classifyClarificationCapability(resolvedCursor, verified)).toEqual({
      status: "unsupported",
      reason: "unknown_recipe",
    })
  })

  it("extracts exact package identity defensively", () => {
    expect(exactRecipeIdentity(CODEX_RECIPE)).toEqual(VERIFIED_CODEX)
    expect(exactRecipeIdentity({ ...CODEX_RECIPE, args: [] })).toBeNull()
  })
})
