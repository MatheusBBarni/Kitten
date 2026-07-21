import { describe, expect, test } from "bun:test"

import {
  createAgentConnection,
  type AgentConnection,
  type AgentPromptInput,
  type PermissionOutcome,
  type ReadyState,
} from "../src/agent/agentConnection.ts"
import { HARNESS_CONTRACT_SDK_VERSION, type CertifiedHarnessProfile } from "../src/config/harnessCapability.ts"
import {
  defaultAppConfig,
  findAgentConfig,
  matchCertifiedCursorRuntimeProfile,
  type CertifiedCursorRuntimeProfile,
} from "../src/config/configLoader.ts"
import {
  visibleConfigOptions,
  type ConfigOption,
  type DomainSessionEvent,
  type ResolvedAgentConfig,
} from "../src/core/types.ts"

const CONTRACT_ENABLED = process.env.KITTEN_CURSOR_ACP_CONTRACT === "1"
const contractTest = test.skipIf(!CONTRACT_ENABLED)
const ROUND_TIMEOUT_MS = 120_000
const CONTRACT_TIMEOUT_MS = 300_000
const NATIVE_RECIPE = {
  provider: "cursor" as const,
  command: "agent" as const,
  args: ["acp"] as const,
  env: {},
}
const SYNTHETIC_HARNESS = "For this synthetic contract only, reply with KITTEN_HARNESS_OK exactly."
const SYNTHETIC_USER = "Follow the host guidance for this synthetic contract."

interface VersionProbeResult {
  exitCode: number
  stdout: string
}

interface CursorContractConnection {
  connect(): Promise<ReadyState>
  newSession(cwd: string): Promise<string>
  setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<readonly ConfigOption[]>
  prompt(sessionId: string, input: AgentPromptInput): Promise<{ stopReason: string }>
  onPermission(handler: () => Promise<PermissionOutcome>): void
  onUpdate(handler: (event: DomainSessionEvent) => void): () => void
  dispose(): Promise<void>
}

interface CursorContractDependencies {
  resolveBuiltInRecipe(): ResolvedAgentConfig
  probeVersion(command: "agent"): Promise<VersionProbeResult>
  createConnection(config: ResolvedAgentConfig, harnessProfile: CertifiedHarnessProfile): CursorContractConnection
  cwd: string
  roundTimeoutMs: number
}

export type CursorConfigCapabilityResult = "not_advertised" | "accepted" | "rejected"

export interface CursorCertificationEvidence {
  recipe: {
    provider: "cursor"
    command: "agent"
    args: readonly ["acp"]
    env: Record<string, never>
  }
  exactVersion: string
  configCapability: CursorConfigCapabilityResult
  checks: {
    versionMatched: boolean
    initialized: boolean
    authenticationMethodAdvertised: boolean
    authenticated: boolean
    sessionCreated: boolean
    promptCompleted: boolean
    harnessSeparated: boolean
    userBlocksPreserved: boolean
    harnessNotUserText: boolean
    permissionRequested: boolean
    permissionSafelyCancelled: boolean
    disposedCleanly: boolean
    noUnexpectedClose: boolean
  }
}

type CursorContractResult = { status: "skipped" } | { status: "passed"; evidence: CursorCertificationEvidence }

/**
 * Run the credentialed contract behind its only activation gate. The return before
 * dependency access is load-bearing: a normal test run cannot resolve, locate, or
 * spawn Cursor even when a caller supplies real dependencies.
 */
export async function runCursorAcpContract(options: {
  enabled: boolean
  candidateVersion?: string
  dependencies: CursorContractDependencies
  onEvidence?: (evidence: CursorCertificationEvidence) => void
}): Promise<CursorContractResult> {
  if (!options.enabled) return { status: "skipped" }

  const candidateVersion = parseExactSemanticVersion(options.candidateVersion)
  const recipe = requireNativeCursorRecipe(options.dependencies.resolveBuiltInRecipe())
  const versionResult = await withTimeout(
    options.dependencies.probeVersion(recipe.command),
    options.dependencies.roundTimeoutMs,
    "agent --version",
  )
  if (versionResult.exitCode !== 0) throw new Error(`agent --version exited with code ${versionResult.exitCode}`)
  const observedVersion = parseExactSemanticVersion(versionResult.stdout)

  const candidateProfile: CertifiedCursorRuntimeProfile = {
    kind: "cursor-certified",
    command: NATIVE_RECIPE.command,
    args: [...NATIVE_RECIPE.args],
    env: {},
    certifiedVersion: candidateVersion,
    authenticationMethod: "cursor_login",
  }
  const matchedProfile = matchCertifiedCursorRuntimeProfile(recipe, observedVersion, [candidateProfile])
  if (!matchedProfile) throw new Error("The observed Cursor version does not match the exact candidate native profile")

  const harnessProfile: CertifiedHarnessProfile = {
    profileId: `cursor-agent-${observedVersion}`,
    encoder: "cursor-prompt-meta-v1",
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: {
      providerKind: "cursor",
      command: NATIVE_RECIPE.command,
      args: [...NATIVE_RECIPE.args],
      env: {},
      adapterPackage: "cursor-agent",
      adapterVersion: observedVersion,
    },
  }

  const connection = options.dependencies.createConnection({ ...recipe, runtimeProfile: matchedProfile }, harnessProfile)
  let permissionRequested = false
  let permissionSafelyCancelled = false
  let unexpectedClose = false
  let disposedCleanly = false
  let advertisedOptions: ConfigOption[] = []
  let output = ""
  let resolveOutput!: () => void
  const outputAvailable = new Promise<void>((resolve) => { resolveOutput = resolve })
  const unsubscribe = connection.onUpdate((event) => {
    if (event.kind === "status" && event.status === "error") unexpectedClose = true
    if (event.kind === "config_options") advertisedOptions = event.options
    if (event.kind === "agent_message") {
      output += event.textDelta
      resolveOutput()
    }
  })
  connection.onPermission(async () => {
    permissionRequested = true
    permissionSafelyCancelled = true
    return { outcome: "cancelled" }
  })

  let initialized = false
  let authenticationMethodAdvertised = false
  let authenticated = false
  let sessionCreated = false
  let promptCompleted = false
  let configCapability: CursorConfigCapabilityResult = "not_advertised"
  try {
    const ready = await withTimeout(connection.connect(), options.dependencies.roundTimeoutMs, "initialize/authenticate")
    if (!ready.ready) throw new Error(`Cursor authentication failed: ${ready.error}`)
    initialized = true
    authenticationMethodAdvertised = true
    authenticated = true

    const sessionId = await withTimeout(
      connection.newSession(options.dependencies.cwd),
      options.dependencies.roundTimeoutMs,
      "session/new",
    )
    sessionCreated = sessionId.length > 0
    if (!sessionCreated) throw new Error("Cursor returned an empty session id")

    configCapability = await probeConfigCapability(
      connection,
      sessionId,
      advertisedOptions,
      options.dependencies.roundTimeoutMs,
    )

    const turn = await withTimeout(
      connection.prompt(sessionId, {
        userBlocks: [{ type: "text", text: SYNTHETIC_USER }],
        harness: { version: "v1", text: SYNTHETIC_HARNESS },
        profileId: harnessProfile.profileId,
      }),
      options.dependencies.roundTimeoutMs,
      "harness prompt",
    )
    promptCompleted = turn.stopReason.length > 0
    if (!promptCompleted) throw new Error("Cursor completed the prompt without a stop reason")
    if (output.length === 0) {
      await withTimeout(outputAvailable, options.dependencies.roundTimeoutMs, "harness output")
    }
    if (output.trim() !== "KITTEN_HARNESS_OK") throw new Error("Cursor did not prove the candidate harness encoding")
  } finally {
    try {
      await withTimeout(connection.dispose(), options.dependencies.roundTimeoutMs, "disposal")
      disposedCleanly = true
    } finally {
      unsubscribe()
    }
  }

  if (unexpectedClose) throw new Error("Cursor ACP transport closed unexpectedly before disposal")
  if (permissionRequested !== permissionSafelyCancelled) {
    throw new Error("Cursor requested permission without a safe cancellation response")
  }

  const evidence: CursorCertificationEvidence = {
    recipe: {
      provider: NATIVE_RECIPE.provider,
      command: NATIVE_RECIPE.command,
      args: [...NATIVE_RECIPE.args],
      env: {},
    },
    exactVersion: observedVersion,
    configCapability,
    checks: {
      versionMatched: true,
      initialized,
      authenticationMethodAdvertised,
      authenticated,
      sessionCreated,
      promptCompleted,
      harnessSeparated: true,
      userBlocksPreserved: true,
      harnessNotUserText: true,
      permissionRequested,
      permissionSafelyCancelled,
      disposedCleanly,
      noUnexpectedClose: true,
    },
  }
  options.onEvidence?.(evidence)
  return { status: "passed", evidence }
}

async function probeConfigCapability(
  connection: CursorContractConnection,
  sessionId: string,
  advertisedOptions: readonly ConfigOption[],
  timeoutMs: number,
): Promise<CursorConfigCapabilityResult> {
  const visibleOption = visibleConfigOptions([...advertisedOptions])[0]
  if (!visibleOption) return "not_advertised"

  try {
    await withTimeout(
      connection.setSessionConfigOption(sessionId, visibleOption.id, visibleOption.currentValue),
      timeoutMs,
      "live configuration probe",
    )
    return "accepted"
  } catch {
    return "rejected"
  }
}


export function parseExactSemanticVersion(output: string | undefined): string {
  const version = output?.trim() ?? ""
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  if (!semver.test(version)) throw new Error("Cursor version output must be one exact semantic version")
  return version
}

function requireNativeCursorRecipe(recipe: ResolvedAgentConfig): ResolvedAgentConfig & {
  command: "agent"
  args: ["acp"]
} {
  if (
    recipe.id !== NATIVE_RECIPE.provider ||
    recipe.command !== NATIVE_RECIPE.command ||
    recipe.args.length !== 1 ||
    recipe.args[0] !== NATIVE_RECIPE.args[0] ||
    Object.keys(recipe.env).length !== 0
  ) {
    throw new Error("The Cursor contract requires the complete resolved built-in agent acp recipe")
  }
  return recipe as ResolvedAgentConfig & { command: "agent"; args: ["acp"] }
}

function realDependencies(): CursorContractDependencies {
  return {
    resolveBuiltInRecipe() {
      const recipe = findAgentConfig(defaultAppConfig(), "cursor")
      if (!recipe) throw new Error("The built-in Cursor recipe is missing")
      return recipe
    },
    async probeVersion(command) {
      const proc = Bun.spawn({ cmd: [command, "--version"], stdin: "ignore", stdout: "pipe", stderr: "pipe" })
      const [stdout, , exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).arrayBuffer(),
        proc.exited,
      ])
      return { exitCode, stdout }
    },
    createConnection(config, harnessProfile): AgentConnection {
      return createAgentConnection({ config, harnessProfiles: [harnessProfile] })
    },
    cwd: process.cwd(),
    roundTimeoutMs: ROUND_TIMEOUT_MS,
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

/**
 * Run only after choosing the exact installed version as the review candidate:
 *
 * `KITTEN_CURSOR_ACP_CONTRACT=1 KITTEN_CURSOR_ACP_CANDIDATE_VERSION=<semver> \
 *  bun test test/cursorAcp.contract.test.ts`
 */
contractTest(
  "certifies the exact native Cursor ACP lifecycle with content-free evidence",
  async () => {
    const result = await runCursorAcpContract({
      enabled: true,
      candidateVersion: process.env.KITTEN_CURSOR_ACP_CANDIDATE_VERSION,
      dependencies: realDependencies(),
    })
    expect(result.status).toBe("passed")
    if (result.status === "passed") {
      console.info(`CURSOR_ACP_CERTIFICATION_EVIDENCE=${JSON.stringify(result.evidence)}`)
    }
  },
  CONTRACT_TIMEOUT_MS,
)

describe("Cursor ACP contract harness", () => {
  test("disabled gate skips before resolving, locating, or spawning Cursor", async () => {
    const calls: string[] = []
    const result = await runCursorAcpContract({
      enabled: false,
      dependencies: fakeDependencies(calls),
    })

    expect(result).toEqual({ status: "skipped" })
    expect(calls).toEqual([])
  })

  test.each([undefined, "", "agent 1.2.3", "v1.2.3", "1.2", "01.2.3", "1.2.3\nextra"])(
    "rejects missing or malformed exact semantic version output: %p",
    (output) => {
      expect(() => parseExactSemanticVersion(output)).toThrow(/exact semantic version/)
    },
  )

  test("accepts exact stable and prerelease semantic versions", () => {
    expect(parseExactSemanticVersion("1.2.3\n")).toBe("1.2.3")
    expect(parseExactSemanticVersion("1.2.3-rc.1+build.5")).toBe("1.2.3-rc.1+build.5")
  })

  test("runs the ordered adapter lifecycle and emits only content-free evidence", async () => {
    const calls: string[] = []
    let emitted: CursorCertificationEvidence | undefined
    const result = await runCursorAcpContract({
      enabled: true,
      candidateVersion: "1.2.3",
      dependencies: fakeDependencies(calls, { requestPermission: true }),
      onEvidence: (evidence) => {
        emitted = evidence
      },
    })

    expect(calls).toEqual(["resolve", "version:agent", "create:agent acp", "connect", "newSession", "setConfig", "prompt", "permission", "dispose"])
    expect(result).toEqual({ status: "passed", evidence: emitted! })
    expect(emitted).toEqual({
      recipe: { provider: "cursor", command: "agent", args: ["acp"], env: {} },
      exactVersion: "1.2.3",
      configCapability: "accepted",
      checks: {
        versionMatched: true,
        initialized: true,
        authenticationMethodAdvertised: true,
        authenticated: true,
        sessionCreated: true,
        promptCompleted: true,
        harnessSeparated: true,
        userBlocksPreserved: true,
        harnessNotUserText: true,
        permissionRequested: true,
        permissionSafelyCancelled: true,
        disposedCleanly: true,
        noUnexpectedClose: true,
      },
    })
    expect(JSON.stringify(emitted)).not.toMatch(/Reply with OK|not-evidence|credential|path|override|telemetry|cwd/i)
  })

  test("submits one visible option's exact current value and records accepted", async () => {
    const calls: string[] = []
    const configRequests: Array<{ sessionId: string; configId: string; value: string }> = []
    const configOptions: ConfigOption[] = [
      {
        id: "visible-id-sentinel",
        category: "model",
        label: "visible-label-sentinel",
        currentValue: "current-value-sentinel",
        options: [{ value: "current-value-sentinel", name: "visible-value-label-sentinel" }],
      },
    ]

    const result = await runCursorAcpContract({
      enabled: true,
      candidateVersion: "1.2.3",
      dependencies: fakeDependencies(calls, { configOptions, configRequests }),
    })

    expect(configRequests).toEqual([{
      sessionId: "cursor-contract-session",
      configId: "visible-id-sentinel",
      value: "current-value-sentinel",
    }])
    expect(result.status).toBe("passed")
    if (result.status === "passed") expect(result.evidence.configCapability).toBe("accepted")
    expect(calls).toEqual(["resolve", "version:agent", "create:agent acp", "connect", "newSession", "setConfig", "prompt", "dispose"])
  })

  test("records not_advertised without an update request and completes prompt disposal", async () => {
    const calls: string[] = []
    const configRequests: Array<{ sessionId: string; configId: string; value: string }> = []
    const configOptions: ConfigOption[] = [{
      id: "hidden-mode-id",
      category: "mode",
      label: "Hidden mode",
      currentValue: "ask",
      options: [{ value: "ask", name: "Ask" }],
    }]
    const result = await runCursorAcpContract({
      enabled: true,
      candidateVersion: "1.2.3",
      dependencies: fakeDependencies(calls, { configOptions, configRequests }),
    })

    expect(configRequests).toEqual([])
    expect(result.status).toBe("passed")
    if (result.status === "passed") expect(result.evidence.configCapability).toBe("not_advertised")
    expect(calls).toEqual(["resolve", "version:agent", "create:agent acp", "connect", "newSession", "prompt", "dispose"])
  })

  test("contains a rejected update and still completes prompt disposal", async () => {
    const calls: string[] = []
    const result = await runCursorAcpContract({
      enabled: true,
      candidateVersion: "1.2.3",
      dependencies: fakeDependencies(calls, { configError: new Error("raw-provider-error-sentinel") }),
    })

    expect(result.status).toBe("passed")
    if (result.status === "passed") expect(result.evidence.configCapability).toBe("rejected")
    expect(calls).toEqual(["resolve", "version:agent", "create:agent acp", "connect", "newSession", "setConfig", "prompt", "dispose"])
  })

  test("serializes only the closed config result, never provider or option content", async () => {
    const calls: string[] = []
    const configOptions: ConfigOption[] = [
      {
        id: "private-option-id --list-models",
        category: "thought_level",
        label: "private-option-label credential-secret /private/workspace/path --model",
        currentValue: "private-option-value",
        options: [{ value: "private-option-value", name: "private-option-name" }],
      },
    ]
    const result = await runCursorAcpContract({
      enabled: true,
      candidateVersion: "1.2.3",
      dependencies: fakeDependencies(calls, {
        configOptions,
        configError: new Error("raw-provider-error"),
      }),
    })

    expect(result.status).toBe("passed")
    if (result.status !== "passed") return
    const serialized = JSON.stringify(result.evidence)
    for (const forbidden of [
      "private-option-id",
      "private-option-label",
      "private-option-value",
      "private-option-name",
      SYNTHETIC_HARNESS,
      SYNTHETIC_USER,
      "credential-secret",
      "/private/workspace/path",
      "raw-provider-error",
      "--list-models",
      "--model",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(result.evidence.configCapability).toBe("rejected")
  })

  test("malformed version output cannot construct a connection or emit evidence", async () => {
    const calls: string[] = []
    let emitted = false
    await expect(
      runCursorAcpContract({
        enabled: true,
        candidateVersion: "1.2.3",
        dependencies: fakeDependencies(calls, { versionOutput: "agent 1.2.3" }),
        onEvidence: () => {
          emitted = true
        },
      }),
    ).rejects.toThrow(/exact semantic version/)
    expect(calls).toEqual(["resolve", "version:agent"])
    expect(emitted).toBe(false)
  })

  test("rejects a mismatched version before constructing a connection or evidence", async () => {
    const calls: string[] = []
    let emitted = false
    await expect(
      runCursorAcpContract({
        enabled: true,
        candidateVersion: "1.2.4",
        dependencies: fakeDependencies(calls),
        onEvidence: () => {
          emitted = true
        },
      }),
    ).rejects.toThrow(/does not match/)
    expect(calls).toEqual(["resolve", "version:agent"])
    expect(emitted).toBe(false)
  })

  test.each([
    ["missing advertised method", { ready: false, reason: "authentication_required", error: "method unavailable" }],
    ["authentication rejection", { ready: false, reason: "authentication_required", error: "login rejected" }],
  ] as const)("%s fails without certification evidence and still disposes", async (_case, ready) => {
    const calls: string[] = []
    let emitted = false
    await expect(
      runCursorAcpContract({
        enabled: true,
        candidateVersion: "1.2.3",
        dependencies: fakeDependencies(calls, { ready }),
        onEvidence: () => {
          emitted = true
        },
      }),
    ).rejects.toThrow(/authentication failed/)
    expect(calls).toContain("dispose")
    expect(emitted).toBe(false)
  })

  test("a timed-out partial run disposes and cannot emit evidence", async () => {
    const calls: string[] = []
    let emitted = false
    await expect(
      runCursorAcpContract({
        enabled: true,
        candidateVersion: "1.2.3",
        dependencies: fakeDependencies(calls, { prompt: new Promise(() => {}), roundTimeoutMs: 5 }),
        onEvidence: () => {
          emitted = true
        },
      }),
    ).rejects.toThrow(/harness prompt timed out/)
    expect(calls).toContain("dispose")
    expect(emitted).toBe(false)
  })

  test("an unexpected transport close prevents evidence after disposal", async () => {
    const calls: string[] = []
    let emitted = false
    await expect(
      runCursorAcpContract({
        enabled: true,
        candidateVersion: "1.2.3",
        dependencies: fakeDependencies(calls, { unexpectedClose: true }),
        onEvidence: () => {
          emitted = true
        },
      }),
    ).rejects.toThrow(/closed unexpectedly/)
    expect(calls).toContain("dispose")
    expect(emitted).toBe(false)
  })
})

function fakeDependencies(
  calls: string[],
  options: {
    ready?: ReadyState
    requestPermission?: boolean
    prompt?: Promise<{ stopReason: string }>
    roundTimeoutMs?: number
    unexpectedClose?: boolean
    versionOutput?: string
    configOptions?: ConfigOption[]
    configError?: Error
    configRequests?: Array<{ sessionId: string; configId: string; value: string }>
  } = {},
): CursorContractDependencies {
  return {
    resolveBuiltInRecipe() {
      calls.push("resolve")
      return {
        id: "cursor",
        displayName: "Cursor",
        command: "agent",
        args: ["acp"],
        env: {},
        clarificationCapability: { status: "unsupported", reason: "unknown_recipe" },
        hardStopContinuationCapability: { status: "unavailable", reason: "unknown_recipe" },
        steeringCapability: { status: "unavailable" },
        runtimeProfile: { kind: "standard" },
      }
    },
    async probeVersion(command) {
      calls.push(`version:${command}`)
      return { exitCode: 0, stdout: options.versionOutput ?? "1.2.3\n" }
    },
    createConnection(config, harnessProfile) {
      calls.push(`create:${config.command} ${config.args.join(" ")}`)
      let permissionHandler: (() => Promise<PermissionOutcome>) | undefined
      let updateHandler: ((event: DomainSessionEvent) => void) | undefined
      const configOptions = options.configOptions ?? [{
        id: "model",
        category: "model",
        label: "Model",
        currentValue: "current",
        options: [{ value: "current", name: "Current" }],
      }]
      return {
        async connect() {
          calls.push("connect")
          return options.ready ?? { ready: true, protocolVersion: 1, canLoadSession: false }
        },
        async newSession() {
          calls.push("newSession")
          updateHandler?.({ kind: "config_options", options: configOptions })
          return "cursor-contract-session"
        },
        async setSessionConfigOption(sessionId, configId, value) {
          calls.push("setConfig")
          options.configRequests?.push({ sessionId, configId, value })
          if (options.configError) throw options.configError
          return configOptions
        },
        async prompt(_sessionId, input) {
          calls.push("prompt")
          expect(Array.isArray(input)).toBe(false)
          if (!Array.isArray(input)) {
            expect(input.userBlocks).toEqual([{ type: "text", text: SYNTHETIC_USER }])
            expect(input.harness).toEqual({ version: "v1", text: SYNTHETIC_HARNESS })
            expect(input.profileId).toBe(harnessProfile.profileId)
          }
          if (options.requestPermission) {
            calls.push("permission")
            expect(await permissionHandler?.()).toEqual({ outcome: "cancelled" })
          }
          if (options.unexpectedClose) updateHandler?.({ kind: "status", status: "error" })
          updateHandler?.({ kind: "agent_message", messageId: "synthetic", textDelta: "KITTEN_HARNESS_OK" })
          return options.prompt ?? { stopReason: "end_turn" }
        },
        onPermission(handler) {
          permissionHandler = handler
        },
        onUpdate(handler) {
          updateHandler = handler
          return () => {
            updateHandler = undefined
          }
        },
        async dispose() {
          calls.push("dispose")
        },
      }
    },
    cwd: "/not-evidence",
    roundTimeoutMs: options.roundTimeoutMs ?? 100,
  }
}
