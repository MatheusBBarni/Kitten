// Suite: Explore-v2 real-adapter certification
// Invariant: one explicitly credentialed pinned adapter can use only the generation-bound Context Pack authority.
// Boundary IN: provider recipe resolution, real ACP stdio, real MCP stdio, AppStore custody, deadlines, and cleanup.
// Boundary OUT: production profile activation and ordinary CI; lower-level schemas/routes remain in their canonical suites.

import { describe, expect, it, test } from "bun:test"
import { join } from "node:path"

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Client as AcpClient,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type McpServer,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js"
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

import pkg from "../package.json" with { type: "json" }
import { ASK_USER_MCP_TOOL_NAME } from "../src/agent/askUserMcp.ts"
import {
  CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
  CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
  CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
  MAX_CONTEXT_PACK_MCP_ARTIFACT_BYTES,
  MAX_CONTEXT_PACK_MCP_TEXT_BYTES,
  type ContextPackWorkspaceRead,
  type ContextPackWorkspaceReadLimits,
} from "../src/agent/contextPackMcp.ts"
import { spawnAgentTransport, type AgentTransport } from "../src/agent/transport.ts"
import {
  createContextPackBridge,
  type ContextPackBridge,
  type ContextPackBridgeAuthorization,
  type ContextPackBridgeDisposalReason,
  type ContextPackBridgeFacade,
  type ContextPackBridgeRoute,
} from "../src/app/contextPackBridge.ts"
import { createContextPackMaterializer } from "../src/app/contextPackMaterializer.ts"
import {
  CERTIFIED_CONTEXT_BUILD_PROFILES,
  CERTIFIED_RECIPIENT_PROFILES,
  CONTEXT_BUILD_OPERATIONS,
} from "../src/config/contextPackCapability.ts"
import {
  CLAUDE_CODE_ACP_PACKAGE,
  CODEX_ACP_PACKAGE,
  defaultAppConfig,
  findAgentConfig,
} from "../src/config/configLoader.ts"
import { assembleCandidate, sealCandidate } from "../src/core/contextPack.ts"
import { createSecretRedactor } from "../src/core/secretRedactor.ts"
import type {
  AgentConfig,
  ContextBuildBinding,
  ContextPackMutationResult,
  McpServerConfig,
  ProviderKind,
} from "../src/core/types.ts"
import { createAppStore, type AppStore } from "../src/store/appStore.ts"

const CONTRACT_ENABLE_ENV = "KITTEN_CREDENTIALED_CONTEXT_PACK_CONTRACT"
const CONTRACT_PROVIDER_ENV = "KITTEN_CONTEXT_PACK_CONTRACT_PROVIDER"
const CONTRACT_ENABLED = process.env[CONTRACT_ENABLE_ENV] === "1"
const contractTest = test.skipIf(!CONTRACT_ENABLED)

const ROUND_TIMEOUT_MS = 120_000
const CONTRACT_TIMEOUT_MS = 300_000
const WORKSPACE_PATH = "src/version.ts"
const WORKSPACE_READ_CAP = 4_096
const CERTIFIED_RELATIONSHIP = "Certified by the real adapter."
const EXPECTED_TOOL_NAMES = [
  ASK_USER_MCP_TOOL_NAME,
  CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
  CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
  CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
] as const
const FORBIDDEN_TOOL_NAMES = [
  "agent_run",
  "shell",
  "git",
  "external_mcp",
  "context_pack.seal",
  "context_pack.send",
  "context_pack.export",
  "approval",
] as const

type ContractProvider = Extract<ProviderKind, "claude-code" | "codex">

interface DeadlineWait {
  readonly promise: Promise<never>
  cancel(): void
}

interface CertificationDeadline {
  run<T>(promise: Promise<T>, label: string): Promise<T>
}

interface CloseGuard {
  attach(transport: AgentTransport): void
  beginDisposal(): void
  assertOpen(): void
}

interface DisposableResource {
  readonly label: string
  dispose(): Promise<void>
}

interface ContractCalls {
  readDraft: number
  readWorkspace: ContextPackWorkspaceRead[]
  mutateDraft: number
  askUser: number
  disposalReasons: ContextPackBridgeDisposalReason[]
}

describe("Context Pack adapter certification harness", () => {
  it("keeps the credentialed test skipped and starts no transport without the opt-in flag", () => {
    let spawns = 0
    const prepared = prepareCredentialedAdapter({}, () => {
      spawns += 1
      throw new Error("transport must not start")
    })

    expect(prepared).toEqual({ kind: "skipped" })
    expect(spawns).toBe(0)
  })

  it("rejects invalid provider input before spawn and resolves exact pinned npx recipes", () => {
    let spawns = 0
    expect(() => prepareCredentialedAdapter({
      [CONTRACT_ENABLE_ENV]: "1",
      [CONTRACT_PROVIDER_ENV]: "local-dev-binary",
    }, () => {
      spawns += 1
      throw new Error("transport must not start")
    })).toThrow(`${CONTRACT_PROVIDER_ENV} must be "claude-code" or "codex"`)
    expect(spawns).toBe(0)

    for (const [provider, packageSpec] of [
      ["claude-code", CLAUDE_CODE_ACP_PACKAGE],
      ["codex", CODEX_ACP_PACKAGE],
    ] as const) {
      const config = verifiedBuiltInRecipe(provider)
      expect(config.command).toBe("npx")
      expect(config.args).toEqual(["-y", packageSpec])
    }
  })

  it("surfaces per-round and total deadline failures deterministically", async () => {
    let roundWaitMs = 0
    const round = createCertificationDeadline({
      roundMs: 120,
      totalMs: 300,
      now: () => 0,
      createWait: (timeoutMs, error) => {
        roundWaitMs = timeoutMs
        return { promise: Promise.reject(error), cancel() {} }
      },
    })
    await expect(round.run(new Promise<never>(() => {}), "prompt")).rejects.toThrow(
      "prompt round deadline exceeded after 120ms",
    )
    expect(roundWaitMs).toBe(120)

    const ticks = [0, 301]
    let totalWaits = 0
    const total = createCertificationDeadline({
      roundMs: 120,
      totalMs: 300,
      now: () => ticks.shift() ?? 301,
      createWait: () => {
        totalWaits += 1
        return { promise: new Promise<never>(() => {}), cancel() {} }
      },
    })
    await expect(total.run(Promise.resolve("late"), "cleanup")).rejects.toThrow(
      "cleanup total deadline exceeded after 300ms",
    )
    expect(totalWaits).toBe(0)
  })

  it("treats an unexpected adapter close and any teardown rejection as certification failures", async () => {
    let closeCallback: ((info: { code: number | null }) => void) | undefined
    const guard = createCloseGuard()
    guard.attach({
      stream: {} as AgentTransport["stream"],
      onClose(callback) { closeCallback = callback },
      async dispose() {},
    })
    closeCallback?.({ code: 17 })
    expect(() => guard.assertOpen()).toThrow("adapter closed unexpectedly with code 17")

    let secondDisposed = false
    await expect(disposeCertificationResources([
      { label: "adapter", async dispose() { throw new Error("adapter teardown failed") } },
      { label: "bridge", async dispose() { secondDisposed = true } },
    ])).rejects.toThrow("Context Pack certification teardown failed")
    expect(secondDisposed).toBe(true)
  })

  it("keeps certification evidence separate from production provider activation", () => {
    expect(CERTIFIED_CONTEXT_BUILD_PROFILES).toEqual([])
    expect(CERTIFIED_RECIPIENT_PROFILES).toEqual([])
  })
})

/**
 * Opt-in certification for one real authenticated built-in adapter recipe.
 *
 * Run explicitly with:
 *
 * `KITTEN_CREDENTIALED_CONTEXT_PACK_CONTRACT=1 \
 *  KITTEN_CONTEXT_PACK_CONTRACT_PROVIDER=claude-code \
 *  bun test ./test/contextPackAdapter.contract.test.ts`
 *
 * The selected provider must already be authenticated. This suite spawns the exact
 * resolved `npx -y package@version` adapter recipe, never a local adapter binary.
 * A pass is certification evidence only; it does not modify either production profile registry.
 */
contractTest(
  "credentialed built-in adapter proves the closed explore-v2 Context Pack authority",
  async () => {
    const deadline = createCertificationDeadline({
      roundMs: ROUND_TIMEOUT_MS,
      totalMs: CONTRACT_TIMEOUT_MS,
    })
    const prepared = prepareCredentialedAdapter(process.env)
    if (prepared.kind !== "started") throw new Error("credentialed contract was not enabled")

    const closeGuard = createCloseGuard()
    closeGuard.attach(prepared.transport)
    const custody = createContractCustody(prepared.provider)
    const bridge = createContextPackBridge({
      executablePath: process.execPath,
      executableArgs: ["run", join(process.cwd(), "src/index.ts")],
    })
    const mcpConfig = bridge.register({ route: custody.route, facade: custody.facade })
    const transcript: string[] = []
    const unauthorizedAcpCallbacks: string[] = []

    const acpClient: AcpClient = {
      sessionUpdate(params: SessionNotification): void {
        const update = params.update
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          transcript.push(update.content.text)
        }
      },
      requestPermission(_params: RequestPermissionRequest): RequestPermissionResponse {
        unauthorizedAcpCallbacks.push("approval")
        throw new Error("approval is outside the Context Pack certification authority")
      },
      readTextFile(_params: ReadTextFileRequest): ReadTextFileResponse {
        unauthorizedAcpCallbacks.push("readTextFile")
        throw new Error("direct ACP filesystem reads are outside the Context Pack authority")
      },
      writeTextFile(_params: WriteTextFileRequest): WriteTextFileResponse {
        unauthorizedAcpCallbacks.push("writeTextFile")
        throw new Error("direct ACP filesystem writes are outside the Context Pack authority")
      },
      unstable_createElicitation(_params: CreateElicitationRequest): CreateElicitationResponse {
        unauthorizedAcpCallbacks.push("directElicitation")
        throw new Error("only the scoped Context Pack ask_user route is authorized")
      },
    }

    try {
      await deadline.run(assertExactMcpContract(mcpConfig, custody), "MCP contract probe")
      custody.resetCalls()

      const connection = new ClientSideConnection(() => acpClient, prepared.transport.stream)
      const initialized = await deadline.run(connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "kitten-context-pack-contract", version: "0.0.0" },
      }), "initialize")
      expect(initialized.protocolVersion).toBe(PROTOCOL_VERSION)

      const session = await deadline.run(connection.newSession({
        cwd: process.cwd(),
        mcpServers: [toAcpMcpServer(mcpConfig)],
      }), "session/new")
      const turn = await deadline.run(connection.prompt({
        sessionId: session.sessionId,
        prompt: [{
          type: "text",
          text: [
            "This is an explore-v2 Context Pack certification round.",
            `Use only the ${mcpConfig.name} MCP tools and perform these steps in order:`,
            `1. Call ${CONTEXT_PACK_READ_DRAFT_TOOL_NAME} and retain its revision.`,
            `2. Call ${CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME} for a full_file read of ${WORKSPACE_PATH} with max_bytes ${WORKSPACE_READ_CAP}.`,
            `3. Call ${ASK_USER_MCP_TOOL_NAME} with one single-choice field asking whether certification should continue; continue even if skipped.`,
            `4. Call ${CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME} once with the retained expected_revision and set relationships to exactly: ${CERTIFIED_RELATIONSHIP}`,
            "Do not use filesystem callbacks, shell, Git, agent control, external MCP, approval, sealing, sending, or export.",
            "After the mutation result, report completion and stop.",
          ].join("\n"),
        }],
      }), "credentialed Context Pack turn")

      closeGuard.assertOpen()
      expect(turn.stopReason).toBeDefined()
      expect(custody.calls.readDraft).toBeGreaterThanOrEqual(1)
      expect(custody.calls.readWorkspace).toEqual([{ kind: "full_file", path: WORKSPACE_PATH }])
      expect(custody.calls.askUser).toBe(1)
      expect(custody.calls.mutateDraft).toBe(1)
      expect(custody.store.getState().contextPacks[custody.parentId]?.draft?.brief.relationships)
        .toBe(CERTIFIED_RELATIONSHIP)
      expect(custody.store.getState().contextPacks[custody.siblingId]).toBe(custody.siblingBefore)
      expect(custody.store.getState().contextPacks[custody.parentId]?.sealed).toBe(custody.sealedBefore)
      expect(custody.store.getState().contextPacks[custody.parentId]?.build).toBe(custody.binding)
      expect(unauthorizedAcpCallbacks).toEqual([])
      expect(transcript.join("").length).toBeGreaterThan(0)

      bridge.revoke(custody.route, "child_settled")
      expect(custody.calls.disposalReasons).toEqual(["child_settled"])
      await deadline.run(assertRouteUnavailable(mcpConfig), "revoked route probe")
      expect(custody.store.releaseContextBuild(custody.parentId, custody.binding)).toBe(true)
      expect(custody.store.getState().contextPacks[custody.parentId]?.build).toBeNull()
    } finally {
      closeGuard.beginDisposal()
      await deadline.run(disposeCertificationResources([
        { label: "adapter", dispose: () => prepared.transport.dispose() },
        { label: "Context Pack bridge", dispose: () => bridge.dispose() },
      ]), "certification teardown")
    }
  },
  CONTRACT_TIMEOUT_MS,
)

function prepareCredentialedAdapter(
  env: NodeJS.ProcessEnv,
  spawn: (config: AgentConfig) => AgentTransport = spawnAgentTransport,
):
  | { readonly kind: "skipped" }
  | {
      readonly kind: "started"
      readonly provider: ContractProvider
      readonly config: AgentConfig
      readonly transport: AgentTransport
    } {
  if (env[CONTRACT_ENABLE_ENV] !== "1") return { kind: "skipped" }
  const provider = parseContractProvider(env[CONTRACT_PROVIDER_ENV])
  const config = verifiedBuiltInRecipe(provider)
  return { kind: "started", provider, config, transport: spawn(config) }
}

function verifiedBuiltInRecipe(provider: ContractProvider): AgentConfig {
  const config = findAgentConfig(defaultAppConfig(), provider)
  if (!config) throw new Error(`Missing built-in provider recipe: ${provider}`)

  const packageSpec = provider === "claude-code" ? CLAUDE_CODE_ACP_PACKAGE : CODEX_ACP_PACKAGE
  const separator = packageSpec.lastIndexOf("@")
  const packageName = packageSpec.slice(0, separator)
  const version = packageSpec.slice(separator + 1)
  const devDependencies = pkg.devDependencies as Record<string, string>
  if (devDependencies[packageName] !== version) {
    throw new Error(`Pinned adapter metadata mismatch for ${packageSpec}`)
  }
  if (config.command !== "npx" || JSON.stringify(config.args) !== JSON.stringify(["-y", packageSpec])) {
    throw new Error(`Built-in provider recipe is not the pinned npx command for ${provider}`)
  }
  return config
}

function parseContractProvider(value: string | undefined): ContractProvider {
  if (value === undefined || value === "") return "claude-code"
  if (value === "claude-code" || value === "codex") return value
  throw new Error(`${CONTRACT_PROVIDER_ENV} must be "claude-code" or "codex", received: ${value}`)
}

function createCertificationDeadline(options: {
  readonly roundMs: number
  readonly totalMs: number
  readonly now?: () => number
  readonly createWait?: (timeoutMs: number, error: Error) => DeadlineWait
}): CertificationDeadline {
  const now = options.now ?? Date.now
  const createWait = options.createWait ?? createDeadlineWait
  const startedAt = now()

  return {
    async run<T>(promise: Promise<T>, label: string): Promise<T> {
      const elapsed = Math.max(0, now() - startedAt)
      const remaining = options.totalMs - elapsed
      if (remaining <= 0) {
        throw new Error(`${label} total deadline exceeded after ${options.totalMs}ms`)
      }
      const timeoutMs = Math.min(options.roundMs, remaining)
      const scope = remaining <= options.roundMs ? "total" : "round"
      const configuredLimit = scope === "total" ? options.totalMs : options.roundMs
      const wait = createWait(
        timeoutMs,
        new Error(`${label} ${scope} deadline exceeded after ${configuredLimit}ms`),
      )
      try {
        return await Promise.race([promise, wait.promise])
      } finally {
        wait.cancel()
      }
    },
  }
}

function createDeadlineWait(timeoutMs: number, error: Error): DeadlineWait {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(error), timeoutMs)
  })
  return {
    promise,
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}

function createCloseGuard(): CloseGuard {
  let disposing = false
  let unexpectedCode: number | null | undefined
  return {
    attach(transport) {
      transport.onClose(({ code }) => {
        if (!disposing) unexpectedCode = code
      })
    },
    beginDisposal() {
      disposing = true
    },
    assertOpen() {
      if (unexpectedCode !== undefined) {
        throw new Error(`adapter closed unexpectedly with code ${unexpectedCode ?? "unknown"}`)
      }
    },
  }
}

async function disposeCertificationResources(resources: readonly DisposableResource[]): Promise<void> {
  const results = await Promise.allSettled(resources.map(async (resource) => {
    try {
      await resource.dispose()
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown teardown failure"
      throw new Error(`${resource.label}: ${message}`, { cause: error })
    }
  }))
  const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : [])
  if (errors.length > 0) throw new AggregateError(errors, "Context Pack certification teardown failed")
}

function createContractCustody(provider: ContractProvider): {
  readonly store: AppStore
  readonly parentId: string
  readonly siblingId: string
  readonly route: ContextPackBridgeRoute
  readonly binding: ContextBuildBinding
  readonly facade: ContextPackBridgeFacade
  readonly calls: ContractCalls
  readonly siblingBefore: ReturnType<AppStore["getState"]>["contextPacks"][string]
  readonly sealedBefore: ReturnType<AppStore["getState"]>["contextPacks"][string]["sealed"]
  resetCalls(): void
} {
  const parentId = "context-pack-parent"
  const siblingId = "context-pack-sibling"
  const store = createAppStore({
    seeds: [
      { id: parentId, providerKind: provider, title: "Parent", cwd: process.cwd() },
      { id: siblingId, providerKind: "codex", title: "Sibling", cwd: process.cwd() },
    ],
    selectedVisibleId: parentId,
  })
  const parentDraft = store.createContextPackDraft(parentId, "Certify the closed real-adapter route")
  const siblingDraft = store.createContextPackDraft(siblingId, "Sibling custody must remain unchanged")
  if (parentDraft?.kind !== "created" || siblingDraft?.kind !== "created") {
    throw new Error("failed to create Context Pack certification fixtures")
  }
  const assembled = assembleCandidate(parentDraft.draft, [], createSecretRedactor())
  if (assembled.kind !== "assembled" || !store.publishContextPackReview(parentId, assembled.candidate)) {
    throw new Error("failed to create Context Pack certification review")
  }
  const sealed = sealCandidate({
    draft: parentDraft.draft,
    candidate: assembled.candidate,
    currentSourceFences: [],
    sealedAt: 1,
  })
  if (sealed.kind !== "sealed" || !store.sealContextPack(parentId, sealed.sealed)) {
    throw new Error("failed to seal Context Pack certification fixture")
  }

  const binding: ContextBuildBinding = {
    parentId,
    childId: "context-pack-child",
    parentGeneration: 1,
    childGeneration: 1,
    draftRevision: parentDraft.draft.revision,
    state: "building",
  }
  if (!store.bindContextBuild(parentId, binding)) throw new Error("failed to bind Context Pack certification fixture")
  const route: ContextPackBridgeRoute = {
    parentId,
    childId: binding.childId,
    parentGeneration: binding.parentGeneration,
    childGeneration: binding.childGeneration,
    draftRevision: binding.draftRevision,
    workspaceRoot: process.cwd(),
  }
  const calls: ContractCalls = {
    readDraft: 0,
    readWorkspace: [],
    mutateDraft: 0,
    askUser: 0,
    disposalReasons: [],
  }
  const siblingBefore = store.getState().contextPacks[siblingId]!
  const sealedBefore = store.getState().contextPacks[parentId]!.sealed
  const materializer = createContextPackMaterializer()
  const ownsRoute = (candidate: ContextPackBridgeRoute): boolean => {
    const current = store.getState().contextPacks[parentId]?.build
    return current === binding && JSON.stringify(candidate) === JSON.stringify(route)
  }
  const facade: ContextPackBridgeFacade = {
    authorize(input: ContextPackBridgeAuthorization): boolean {
      return ownsRoute(input.route)
        && input.workspaceRoot === route.workspaceRoot
        && CONTEXT_BUILD_OPERATIONS.includes(operationFor(input.operation))
    },
    readDraft(candidate) {
      if (!ownsRoute(candidate)) return null
      calls.readDraft += 1
      return store.getState().contextPacks[parentId]?.draft ?? null
    },
    async readWorkspace(candidate, workspaceRoot, request, limits) {
      if (!ownsRoute(candidate)) return { kind: "blocked", reason: "invalid_workspace", path: request.path }
      calls.readWorkspace.push(request)
      return await materializer.read(workspaceRoot, request, limits)
    },
    mutateDraft(candidate, input): ContextPackMutationResult | null {
      if (!ownsRoute(candidate)) return null
      calls.mutateDraft += 1
      return store.applyContextPackBuilderMutation(parentId, input)
    },
    async askUser(candidate) {
      if (!ownsRoute(candidate)) return { kind: "cancelled" }
      calls.askUser += 1
      return { kind: "skipped" }
    },
    dispose(_candidate, reason) {
      calls.disposalReasons.push(reason)
    },
  }

  return {
    store,
    parentId,
    siblingId,
    route,
    binding,
    facade,
    calls,
    siblingBefore,
    sealedBefore,
    resetCalls() {
      calls.readDraft = 0
      calls.readWorkspace.length = 0
      calls.mutateDraft = 0
      calls.askUser = 0
    },
  }
}

function operationFor(operation: ContextPackBridgeAuthorization["operation"]): typeof CONTEXT_BUILD_OPERATIONS[number] {
  switch (operation) {
    case "ask_user": return "ask_user:scoped"
    case "read_draft": return "draft:read-bounded"
    case "read_workspace": return "workspace:read-bounded"
    case "mutate_draft": return "draft:mutate-revision-fenced"
  }
}

async function assertExactMcpContract(
  config: McpServerConfig,
  custody: ReturnType<typeof createContractCustody>,
): Promise<void> {
  const { client } = await connectMcp(config, "context-pack-certification-probe")
  try {
    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual([...EXPECTED_TOOL_NAMES])
    for (const tool of listed.tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false })
    }
    expect(schemaPropertyKeys(listed.tools.find(({ name }) => name === ASK_USER_MCP_TOOL_NAME)?.inputSchema))
      .toEqual(["context", "fields", "title"])
    expect(schemaPropertyKeys(listed.tools.find(({ name }) => name === CONTEXT_PACK_READ_DRAFT_TOOL_NAME)?.inputSchema))
      .toEqual([])
    expect(schemaPropertyKeys(listed.tools.find(({ name }) => name === CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME)?.inputSchema))
      .toEqual(["kind", "max_bytes", "path", "range", "scope"])
    expect(schemaPropertyKeys(listed.tools.find(({ name }) => name === CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME)?.inputSchema))
      .toEqual(["expected_revision", "mutation"])

    for (const forbidden of FORBIDDEN_TOOL_NAMES) {
      expect((await client.callTool({ name: forbidden, arguments: {} })).isError).toBe(true)
    }
    const crossSession = await client.callTool({
      name: CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
      arguments: { parent_id: "other-session" },
    })
    expect(crossSession.isError).toBe(true)
    expect(JSON.stringify(crossSession)).not.toContain("other-session")

    const currentRevision = custody.store.getState().contextPacks[custody.parentId]!.draft!.revision
    expect((await client.callTool({
      name: CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
      arguments: {
        expected_revision: currentRevision + 1,
        mutation: { kind: "set_brief_section", section: "relationships", text: "Wrong revision" },
      },
    })).structuredContent).toEqual({
      result: {
        kind: "stale",
        expected_revision: currentRevision + 1,
        current_revision: currentRevision,
      },
    })

    const source = { identity: "file:contract", digest: "a".repeat(64), bytes: 1 }
    const escapedMutation = await client.callTool({
      name: CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
      arguments: {
        expected_revision: currentRevision,
        mutation: {
          kind: "upsert_selection",
          selection: {
            kind: "full_file",
            path: "../outside",
            source,
            rationale: "escape",
            relationship: "escape",
          },
        },
      },
    })
    expect(escapedMutation.isError).toBe(true)
    expect(JSON.stringify(escapedMutation)).not.toContain("../outside")

    const oversizedMutation = await client.callTool({
      name: CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME,
      arguments: {
        expected_revision: currentRevision,
        mutation: {
          kind: "set_brief_section",
          section: "relationships",
          text: "x".repeat(MAX_CONTEXT_PACK_MCP_TEXT_BYTES + 1),
        },
      },
    })
    expect(oversizedMutation.isError).toBe(true)
    const oversizedRead = await client.callTool({
      name: CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME,
      arguments: {
        kind: "full_file",
        path: WORKSPACE_PATH,
        max_bytes: MAX_CONTEXT_PACK_MCP_ARTIFACT_BYTES + 1,
      },
    })
    expect(oversizedRead.isError).toBe(true)
    expect(custody.calls.mutateDraft).toBe(0)
  } finally {
    await client.close()
  }
}

async function assertRouteUnavailable(config: McpServerConfig): Promise<void> {
  const { client } = await connectMcp(config, "context-pack-revoked-route-probe")
  try {
    expect((await client.callTool({
      name: CONTEXT_PACK_READ_DRAFT_TOOL_NAME,
      arguments: {},
    })).isError).toBe(true)
  } finally {
    await client.close()
  }
}

async function connectMcp(config: McpServerConfig, name: string): Promise<{
  readonly client: McpClient
  readonly transport: StdioClientTransport
}> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: [...config.args],
    cwd: process.cwd(),
    env: { ...getDefaultEnvironment(), ...config.env },
    stderr: "pipe",
  })
  const client = new McpClient({ name, version: "1.0.0" })
  await client.connect(transport)
  return { client, transport }
}

function toAcpMcpServer(config: McpServerConfig): McpServer {
  return {
    name: config.name,
    command: config.command,
    args: [...config.args],
    env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
  }
}

function schemaPropertyKeys(schema: unknown): string[] {
  if (!isRecord(schema) || !isRecord(schema.properties)) return []
  return Object.keys(schema.properties).sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
