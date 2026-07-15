import { describe, expect, test } from "bun:test"

import {
  createAgentConnection,
  type AgentConnection,
  type AgentPromptInput,
  type PromptResult,
  type ReadyState,
} from "../src/agent/agentConnection.ts"
import {
  CLAUDE_CODE_ACP_PACKAGE,
  CODEX_ACP_PACKAGE,
  defaultAppConfig,
  findAgentConfig,
} from "../src/config/configLoader.ts"
import {
  HARNESS_CONTRACT_SDK_VERSION,
  type CertifiedHarnessProfile,
} from "../src/config/harnessCapability.ts"
import type { DomainSessionEvent, ProviderKind, ResolvedAgentConfig } from "../src/core/types.ts"

const CONTRACT_ENABLED = process.env.KITTEN_CREDENTIALED_HARNESS_CONTRACT === "1"
const CONTRACT_PROVIDER = parseProvider(process.env.KITTEN_HARNESS_CONTRACT_PROVIDER)
const contractTest = test.skipIf(!CONTRACT_ENABLED)
const ROUND_TIMEOUT_MS = 120_000
const CONTRACT_TIMEOUT_MS = 300_000
const SYNTHETIC_HARNESS = "For this synthetic contract only, reply with KITTEN_HARNESS_OK exactly."
const SYNTHETIC_USER = "Follow the host guidance for this synthetic contract."

interface ContractConnection {
  connect(): Promise<ReadyState>
  newSession(cwd: string): Promise<string>
  prompt(sessionId: string, input: AgentPromptInput): Promise<PromptResult>
  onUpdate(callback: (event: DomainSessionEvent) => void): () => void
  dispose(): Promise<void>
}

interface ContractDependencies {
  resolveRecipe(provider: Exclude<ProviderKind, "cursor">): ResolvedAgentConfig
  createConnection(config: ResolvedAgentConfig, profile: CertifiedHarnessProfile): ContractConnection
  cwd: string
  roundTimeoutMs: number
}

export interface HarnessAdapterCertificationEvidence {
  readonly profileId: string
  readonly sdkVersion: string
  readonly adapterVersion: string
  readonly checks: {
    readonly initialized: true
    readonly sessionCreated: true
    readonly harnessSeparated: true
    readonly userBlocksPreserved: true
    readonly harnessNotUserText: true
    readonly terminalResult: true
    readonly disposedCleanly: true
  }
}

type ContractResult =
  | { readonly status: "skipped" }
  | { readonly status: "passed"; readonly evidence: HarnessAdapterCertificationEvidence }

export async function runHarnessAdapterContract(options: {
  enabled: boolean
  provider: Exclude<ProviderKind, "cursor">
  dependencies: ContractDependencies
  onEvidence?: (evidence: HarnessAdapterCertificationEvidence) => void
}): Promise<ContractResult> {
  if (!options.enabled) return { status: "skipped" }

  const config = options.dependencies.resolveRecipe(options.provider)
  const profile = candidateProfile(config)
  const connection = options.dependencies.createConnection(config, profile)
  let output = ""
  let resolveOutput!: () => void
  const outputAvailable = new Promise<void>((resolve) => { resolveOutput = resolve })
  let disposedCleanly = false
  const unsubscribe = connection.onUpdate((event) => {
    if (event.kind === "agent_message") {
      output += event.textDelta
      resolveOutput()
    }
  })

  let initialized = false
  let sessionCreated = false
  let terminalResult = false
  try {
    const ready = await withTimeout(connection.connect(), options.dependencies.roundTimeoutMs, "initialize")
    if (!ready.ready) throw new Error("Harness adapter initialization failed")
    initialized = true
    const sessionId = await withTimeout(
      connection.newSession(options.dependencies.cwd),
      options.dependencies.roundTimeoutMs,
      "session/new",
    )
    sessionCreated = sessionId.length > 0
    if (!sessionCreated) throw new Error("Harness adapter returned an empty session id")
    const turn = await withTimeout(
      connection.prompt(sessionId, {
        userBlocks: [{ type: "text", text: SYNTHETIC_USER }],
        harness: { version: "v1", text: SYNTHETIC_HARNESS },
        profileId: profile.profileId,
      }),
      options.dependencies.roundTimeoutMs,
      "harness prompt",
    )
    terminalResult = turn.stopReason.length > 0
    if (output.length === 0) {
      await withTimeout(outputAvailable, options.dependencies.roundTimeoutMs, "harness output")
    }
    if (output.trim() !== "KITTEN_HARNESS_OK") {
      throw new Error("The adapter did not prove the candidate harness encoding")
    }
  } finally {
    try {
      await withTimeout(connection.dispose(), options.dependencies.roundTimeoutMs, "disposal")
      disposedCleanly = true
    } finally {
      unsubscribe()
    }
  }

  const evidence: HarnessAdapterCertificationEvidence = {
    profileId: profile.profileId,
    sdkVersion: profile.sdkVersion,
    adapterVersion: profile.recipe.adapterVersion,
    checks: {
      initialized: true,
      sessionCreated: true,
      harnessSeparated: true,
      userBlocksPreserved: true,
      harnessNotUserText: true,
      terminalResult: true,
      disposedCleanly: true,
    },
  }
  if (!initialized || !sessionCreated || !terminalResult || !disposedCleanly) {
    throw new Error("Harness adapter contract ended without complete evidence")
  }
  options.onEvidence?.(evidence)
  return { status: "passed", evidence }
}


contractTest(
  "credentialed Claude Code or Codex adapter proves its exact harness envelope",
  async () => {
    const result = await runHarnessAdapterContract({
      enabled: true,
      provider: CONTRACT_PROVIDER,
      dependencies: realDependencies(),
    })
    expect(result.status).toBe("passed")
    if (result.status === "passed") {
      console.info(`HARNESS_ADAPTER_CERTIFICATION_EVIDENCE=${JSON.stringify(result.evidence)}`)
    }
  },
  CONTRACT_TIMEOUT_MS,
)

describe("harness adapter contract harness", () => {
  test("disabled gate performs no recipe, connection, or credential access", async () => {
    const calls: string[] = []
    const result = await runHarnessAdapterContract({
      enabled: false,
      provider: "claude-code",
      dependencies: fakeDependencies(calls),
    })
    expect(result).toEqual({ status: "skipped" })
    expect(calls).toEqual([])
  })

  test.each(["claude-code", "codex"] as const)("emits fixed content-free %s evidence", async (provider) => {
    const calls: string[] = []
    let emitted: HarnessAdapterCertificationEvidence | undefined
    const result = await runHarnessAdapterContract({
      enabled: true,
      provider,
      dependencies: fakeDependencies(calls),
      onEvidence: (evidence) => { emitted = evidence },
    })
    expect(calls).toEqual([`resolve:${provider}`, `create:${provider}`, "onUpdate", "connect", "newSession", "prompt", "dispose", "unsubscribe"])
    expect(result).toEqual({ status: "passed", evidence: emitted! })
    expect(JSON.stringify(emitted)).not.toMatch(/KITTEN_HARNESS_OK|Follow the host guidance|credential|cwd|command|args|env/i)
  })

  test("failed candidate behavior emits no evidence and still disposes", async () => {
    const calls: string[] = []
    let emitted = false
    await expect(
      runHarnessAdapterContract({
        enabled: true,
        provider: "codex",
        dependencies: fakeDependencies(calls, false),
        onEvidence: () => { emitted = true },
      }),
    ).rejects.toThrow(/did not prove/)
    expect(calls.at(-2)).toBe("dispose")
    expect(calls.at(-1)).toBe("unsubscribe")
    expect(emitted).toBe(false)
  })
})

function candidateProfile(config: ResolvedAgentConfig): CertifiedHarnessProfile {
  const packageSpec = config.id === "claude-code" ? CLAUDE_CODE_ACP_PACKAGE : CODEX_ACP_PACKAGE
  const separator = packageSpec.lastIndexOf("@")
  const adapterPackage = packageSpec.slice(0, separator)
  const adapterVersion = packageSpec.slice(separator + 1)
  return {
    profileId: `${config.id}-${adapterVersion}`,
    encoder: config.id === "claude-code" ? "claude-code-prompt-meta-v1" : "codex-prompt-meta-v1",
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: {
      providerKind: config.id,
      command: config.command,
      args: [...config.args],
      env: { ...config.env },
      adapterPackage,
      adapterVersion,
    },
  }
}

function realDependencies(): ContractDependencies {
  return {
    resolveRecipe(provider) {
      const config = findAgentConfig(defaultAppConfig(), provider)
      if (!config) throw new Error(`Missing built-in provider recipe: ${provider}`)
      return config
    },
    createConnection(config, profile): AgentConnection {
      return createAgentConnection({ config, harnessProfiles: [profile] })
    },
    cwd: process.cwd(),
    roundTimeoutMs: ROUND_TIMEOUT_MS,
  }
}

function fakeDependencies(calls: string[], provesHarness = true): ContractDependencies {
  return {
    resolveRecipe(provider) {
      calls.push(`resolve:${provider}`)
      const config = findAgentConfig(defaultAppConfig(), provider)
      if (!config) throw new Error("missing fixture")
      return config
    },
    createConnection(config) {
      calls.push(`create:${config.id}`)
      let update: ((event: DomainSessionEvent) => void) | undefined
      return {
        onUpdate(callback) {
          calls.push("onUpdate")
          update = callback
          return () => { calls.push("unsubscribe") }
        },
        async connect() { calls.push("connect"); return { ready: true, protocolVersion: 1, canLoadSession: false } },
        async newSession() { calls.push("newSession"); return "synthetic-session" },
        async prompt(_sessionId, input) {
          calls.push("prompt")
          expect(Array.isArray(input)).toBe(false)
          if (!Array.isArray(input)) {
            expect(input.userBlocks).toEqual([{ type: "text", text: SYNTHETIC_USER }])
            expect(input.harness).toEqual({ version: "v1", text: SYNTHETIC_HARNESS })
          }
          update?.({ kind: "agent_message", messageId: "synthetic", textDelta: provesHarness ? "KITTEN_HARNESS_OK" : "IGNORED" })
          return { stopReason: "end_turn" }
        },
        async dispose() { calls.push("dispose") },
      }
    },
    cwd: "/synthetic",
    roundTimeoutMs: 1_000,
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function parseProvider(value: string | undefined): "claude-code" | "codex" {
  if (value === undefined || value === "") return "claude-code"
  if (value === "claude-code" || value === "codex") return value
  throw new Error(`KITTEN_HARNESS_CONTRACT_PROVIDER must be "claude-code" or "codex", received: ${value}`)
}
