import { describe, expect, test } from "bun:test"

import {
  CERTIFIED_HARNESS_PROFILES,
  HARNESS_CONTRACT_SDK_VERSION,
  certifiedProfilesFromContractResults,
  resolveHarnessCapability,
  type CertifiedHarnessProfile,
  type ExactHarnessRecipeIdentity,
  type HarnessContractResult,
  type HarnessEncoderKind,
} from "./harnessCapability.ts"

interface Fixture {
  profileId: string
  encoder: HarnessEncoderKind
  recipe: ExactHarnessRecipeIdentity
}

const FIXTURES: Fixture[] = [
  {
    profileId: "claude-code-acp-0.57.0",
    encoder: "claude-code-prompt-meta-v1",
    recipe: recipe("claude-code", "npx", ["-y", "@agentclientprotocol/claude-agent-acp@0.57.0"], {}, "@agentclientprotocol/claude-agent-acp", "0.57.0"),
  },
  {
    profileId: "codex-acp-1.1.2",
    encoder: "codex-prompt-meta-v1",
    recipe: recipe("codex", "npx", ["-y", "@agentclientprotocol/codex-acp@1.1.2"], { INITIAL_AGENT_MODE: "agent-full-access" }, "@agentclientprotocol/codex-acp", "1.1.2"),
  },
  {
    profileId: "cursor-agent-1.2.3",
    encoder: "cursor-prompt-meta-v1",
    recipe: recipe("cursor", "agent", ["acp"], {}, "cursor-agent", "1.2.3"),
  },
]

const PASSES: readonly HarnessContractResult[] = FIXTURES.map((fixture) => passed(fixture))
const PROFILES = certifiedProfilesFromContractResults(PASSES)
const CLAUDE_FIXTURE = FIXTURES[0]!
const CODEX_FIXTURE = FIXTURES[1]!

describe("certified harness profile evidence", () => {
  test("ships reviewed Claude Code and Codex default recipes while Cursor remains opt-in", () => {
    expect(CERTIFIED_HARNESS_PROFILES).toEqual(PROFILES.slice(0, 2))
  })

  test.each(FIXTURES)("accepts only a complete credentialed $profileId result", (fixture) => {
    expect(certifiedProfilesFromContractResults([passed(fixture)])).toEqual([
      { ...fixture, sdkVersion: HARNESS_CONTRACT_SDK_VERSION },
    ])
  })

  test.each(["skipped", "failed"] as const)("rejects %s evidence", (status) => {
    expect(
      certifiedProfilesFromContractResults([
        {
          status,
          credentialed: status === "failed",
          profileId: CLAUDE_FIXTURE.profileId,
          encoder: CLAUDE_FIXTURE.encoder,
          sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
          recipe: CLAUDE_FIXTURE.recipe,
        },
      ]),
    ).toEqual([])
  })

  test("rejects another SDK, malformed package versions, and partial checks", () => {
    const complete = passed(CLAUDE_FIXTURE)
    const partial = {
      ...complete,
      checks: { ...complete.checks, disposedCleanly: false },
    } as unknown as HarnessContractResult
    const malformed = {
      ...complete,
      recipe: { ...complete.recipe, adapterVersion: "latest" },
    }
    expect(certifiedProfilesFromContractResults([{ ...complete, sdkVersion: "1.2.0" }, partial, malformed])).toEqual([])
  })
})

describe("exact harness capability resolution", () => {
  test.each([CLAUDE_FIXTURE, CODEX_FIXTURE])("resolves exact $profileId through the production registry", (fixture) => {
    expect(resolveHarnessCapability(toRuntimeRecipe(fixture.recipe), evidence(fixture.recipe))).toEqual({
      status: "supported",
      profileId: fixture.profileId,
      encoder: fixture.encoder,
    })
  })

  test.each(FIXTURES)("resolves exact $profileId evidence", (fixture) => {
    expect(
      resolveHarnessCapability(toRuntimeRecipe(fixture.recipe), evidence(fixture.recipe), PROFILES),
    ).toEqual({ status: "supported", profileId: fixture.profileId, encoder: fixture.encoder })
  })

  test("denies missing and incomplete evidence", () => {
    const fixture = CLAUDE_FIXTURE
    expect(resolveHarnessCapability(toRuntimeRecipe(fixture.recipe), undefined, PROFILES)).toEqual({
      status: "unsupported",
      reason: "incomplete_evidence",
    })
    expect(
      resolveHarnessCapability(toRuntimeRecipe(fixture.recipe), { ...evidence(fixture.recipe), adapterVersion: "latest" }, PROFILES),
    ).toEqual({ status: "unsupported", reason: "incomplete_evidence" })
  })

  test("denies changed command, ordered arguments, and complete environment", () => {
    const fixture = CODEX_FIXTURE
    const exact = toRuntimeRecipe(fixture.recipe)
    for (const changed of [
      { ...exact, command: "/opt/bin/npx" },
      { ...exact, args: [...exact.args].reverse() },
      { ...exact, args: [...exact.args, "--debug"] },
      { ...exact, env: { ...exact.env, CODEX_HOME: "/tmp" } },
    ]) {
      expect(resolveHarnessCapability(changed, evidence(fixture.recipe), PROFILES)).toEqual({
        status: "unsupported",
        reason: "recipe_mismatch",
      })
    }
  })

  test("denies wrong SDK, unknown release, unknown provider, and future provider by default", () => {
    const fixture = CLAUDE_FIXTURE
    expect(
      resolveHarnessCapability(toRuntimeRecipe(fixture.recipe), { ...evidence(fixture.recipe), sdkVersion: "1.2.0" }, PROFILES),
    ).toEqual({ status: "unsupported", reason: "sdk_version_mismatch" })
    expect(
      resolveHarnessCapability(toRuntimeRecipe(fixture.recipe), { ...evidence(fixture.recipe), adapterVersion: "0.58.0" }, PROFILES),
    ).toEqual({ status: "unsupported", reason: "unverified_profile" })
    expect(
      resolveHarnessCapability({ id: "gemini", command: "gemini", args: ["acp"], env: {} }, {
        sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
        adapterPackage: "gemini-agent",
        adapterVersion: "1.0.0",
      }, PROFILES),
    ).toEqual({ status: "unsupported", reason: "unknown_recipe" })
  })

  test("admits a future provider only through the same explicit evidence policy", () => {
    const future = {
      profileId: "future-agent-1.0.0",
      encoder: "codex-prompt-meta-v1" as const,
      sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
      recipe: recipe("future", "future-agent", ["acp"], {}, "future-agent", "1.0.0"),
    } satisfies CertifiedHarnessProfile
    expect(resolveHarnessCapability(toRuntimeRecipe(future.recipe), evidence(future.recipe), [...PROFILES, future])).toEqual({
      status: "supported",
      profileId: future.profileId,
      encoder: future.encoder,
    })
  })
})

function recipe(
  providerKind: string,
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  adapterPackage: string,
  adapterVersion: string,
): ExactHarnessRecipeIdentity {
  return { providerKind, command, args, env, adapterPackage, adapterVersion }
}

function passed(fixture: Fixture): Extract<HarnessContractResult, { status: "passed" }> {
  return {
    status: "passed",
    credentialed: true,
    profileId: fixture.profileId,
    encoder: fixture.encoder,
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: fixture.recipe,
    checks: {
      harnessSeparated: true,
      userBlocksPreserved: true,
      harnessNotUserText: true,
      terminalResult: true,
      disposedCleanly: true,
    },
  }
}

function toRuntimeRecipe(identity: ExactHarnessRecipeIdentity) {
  return { id: identity.providerKind, command: identity.command, args: identity.args, env: identity.env }
}

function evidence(identity: ExactHarnessRecipeIdentity) {
  return {
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    adapterPackage: identity.adapterPackage,
    adapterVersion: identity.adapterVersion,
  }
}
