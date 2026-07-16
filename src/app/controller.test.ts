// Suite: session controller orchestration
// Invariant: each agent degrades independently while store binding, restore, actions, and telemetry stay ordered.
// Boundary IN: real controller/store/actions over stub connections and in-process ACP transports.
// Boundary OUT: rendered picker/cockpit behavior and real external agent binaries.

import { describe, expect, it } from "bun:test"

import { join } from "node:path"

import {
  createAgentConnection,
  type AgentConnection,
  type AgentPromptInput,
  type PermissionOutcome,
  type PermissionRequest,
  type PromptBlock,
  type ReadyState,
} from "../agent/agentConnection.ts"
import { defaultAppConfig } from "../config/configLoader.ts"
import { HARNESS_CONTRACT_SDK_VERSION, type CertifiedHarnessProfile, type HarnessCapability } from "../config/harnessCapability.ts"
import type { ExploreCapability } from "../config/exploreCapability.ts"
import { evaluateExplorePolicy } from "../core/explorePolicy.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import type {
  AgentConfig,
  AppConfig,
  ClarificationOutcome,
  ClarificationPayload,
  ConfigOption,
  DomainSessionEvent,
  ManagedWorktreeBinding,
  McpServerConfig,
  ProviderKind,
  ResolvedAgentConfig,
  SessionId,
  ShellEvent,
} from "../core/types.ts"
import { selectDelegationAggregateStatus } from "../core/orchestration.ts"
import type {
  HarnessDeliveryCheckpoint,
  PersistedRunRecordV1,
  PersistedRunRecordV2,
  PersistedRunRecordV3,
} from "../persistence/runRecord.ts"
import {
  createInMemoryShellRuntimeFactory,
  type ShellRuntime,
  type ShellRuntimeFactory,
} from "../shell/shellRuntime.ts"
import { selectAgentModel } from "../store/selectors.ts"
import { createAppStore, type AppStore } from "../store/appStore.ts"
import {
  createTelemetryRecorder,
  type TelemetryRecord,
  type TelemetryRecorder,
  type UsageSeenRecord,
  type UsageSeenSink,
} from "../telemetry/recorder.ts"
import { startMockAgent, type MockAgentHandle, type MockAgentOptions } from "../../test/mockAgent.ts"
import { composePromptBlocks, createControllerActions, nextSessionId, type ActionTelemetry } from "./actions.ts"
import {
  createInteractionCoordinator,
  createSessionController,
  type ActiveAgentInteraction,
  type SessionController,
} from "./controller.ts"
import type { RepositoryFileList, RepositoryFileSource } from "./fileDiscovery.ts"
import { createHandoffEdits, createHandoffFlow } from "./handoff.ts"
import { STEERING_FOLLOW_UP_PREFIX } from "./steeringCoordinator.ts"
import type {
  CleanupManagedWorktreeInput,
  CleanupManagedWorktreeResult,
  ManagedWorktreeProvisioner,
  ProvisionManagedWorktreeInput,
  ProvisionManagedWorktreeResult,
} from "./managedWorktree.ts"
import {
  ASK_USER_MCP_SERVER_NAME,
  type AgentRunControl,
  type AgentRunRoute,
  type KittenMcpBridge,
  type KittenMcpBridgeOptions,
  type BridgeRegistration,
} from "./kittenMcpBridge.ts"

/**
 * The controller is verified two ways.
 *
 * Unit tests drive it against stub `AgentConnection`s to pin the orchestration
 * contract: one session per agent opened against the cwd, updates landing in the
 * right slice, the action surface routing to the right connection, permission
 * requests parked in the approval overlay and settled by the user's outcome.
 *
 * Integration tests drive it against two *real* `AgentConnection`s wired over the
 * ndjson wire framing to in-process mock ACP agents, so a genuine prompt turn, a
 * genuine `requestPermission` round-trip, and a genuinely rejected handshake decide
 * the behavior.
 */

const CLAUDE: AgentConfig = { id: "claude-code", displayName: "Claude Code", command: "claude-acp", args: [], env: {} }
const CODEX: AgentConfig = { id: "codex", displayName: "Codex", command: "codex-acp", args: [], env: {} }
const CURSOR: AgentConfig = { id: "cursor", displayName: "Cursor", command: "agent", args: ["acp"], env: {} }
const PROVIDERS = {
  "claude-code": { displayName: CLAUDE.displayName, command: CLAUDE.command, args: CLAUDE.args, env: CLAUDE.env },
  codex: { displayName: CODEX.displayName, command: CODEX.command, args: CODEX.args, env: CODEX.env },
} as AppConfig["providers"]
const APP_CONFIG: AppConfig = {
  providers: PROVIDERS,
  providerDefaults: {},
  sessions: [],
  mcpServers: [],
  shell: { enabled: true, command: "/bin/sh", scrollback: 2_500 },
  clarificationTimeoutSeconds: 300,
  persistenceEnabled: true,
  telemetryEnabled: false,
  transcriptWindowingEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
  statusline: { llmDisclosureAcknowledged: false, layout: null },
}
const CURSOR_APP_CONFIG: AppConfig = {
  ...APP_CONFIG,
  providerDefaults: {},
  providers: {
    ...PROVIDERS,
    cursor: {
      displayName: CURSOR.displayName,
      command: CURSOR.command,
      args: CURSOR.args,
      env: CURSOR.env,
    },
  },
}
const CWD = "/workspace/kitten"

const TEST_HARNESS_CAPABILITY: HarnessCapability = {
  status: "supported",
  profileId: "controller-test-profile",
  encoder: "codex-prompt-meta-v1",
}

function testManagedWorktreeBinding(ownerSessionId: SessionId, ordinal = ownerSessionId): ManagedWorktreeBinding {
  return {
    kind: "managed",
    id: `kw-${ordinal}`,
    repoRoot: CWD,
    worktreePath: `${CWD}/.kitten/worktrees/kw-${ordinal}`,
    branch: `kitten/kw-${ordinal}`,
    baseBranch: "main",
    baseSha: "a".repeat(40),
    ownerSessionId,
    availability: "available",
  }
}

function createTestManagedWorktreeProvisioner(overrides: {
  provision?: (input: ProvisionManagedWorktreeInput) => Promise<ProvisionManagedWorktreeResult>
  cleanup?: (input: CleanupManagedWorktreeInput) => Promise<CleanupManagedWorktreeResult>
} = {}): ManagedWorktreeProvisioner {
  let ordinal = 0
  return {
    async provision(input) {
      if (overrides.provision) return await overrides.provision(input)
      ordinal += 1
      return {
        kind: "provisioned",
        binding: testManagedWorktreeBinding(input.ownerSessionId, `${ordinal}`),
      }
    },
    async reconcile(binding) {
      return { kind: "available", binding }
    },
    async cleanup(input) {
      return await (overrides.cleanup?.(input) ?? Promise.resolve({ kind: "removed" as const }))
    },
  }
}

function testExploreCapability(config: ResolvedAgentConfig, limits = { perParent: 8, global: 16 }): ExploreCapability {
  const decision = evaluateExplorePolicy({
    role: "explore",
    restrictions: {
      filesystem: "read-only",
      shell: false,
      externalMcp: false,
      agentControl: false,
      askUser: true,
      maxDepth: 0,
    },
    limits,
    attestationVersion: "controller-test-v1",
    confirmed: { provider: config.id, model: "test-model", effort: "low" },
  })
  if (decision.kind !== "eligible") throw new Error("invalid test explore policy")
  return {
    status: "supported",
    policy: decision.policy,
    recipe: { ...config, args: [...config.args], env: { ...config.env } },
  }
}

function testHarnessProfile(config: AgentConfig): CertifiedHarnessProfile {
  return {
    profileId: TEST_HARNESS_CAPABILITY.status === "supported"
      ? TEST_HARNESS_CAPABILITY.profileId
      : "controller-test-profile",
    encoder: "codex-prompt-meta-v1",
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: {
      providerKind: config.id,
      command: config.command,
      args: [...config.args],
      env: { ...config.env },
      adapterPackage: "controller-test-adapter",
      adapterVersion: "1.0.0",
    },
  }
}

const PERMISSION_REQUEST: PermissionRequest = {
  sessionId: "claude-code-session",
  toolCall: { toolCallId: "call-1", kind: "edit", title: "Edit src/index.ts" },
  options: [
    { optionId: "allow", name: "Allow once", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
}

const CLARIFICATION_PAYLOAD: ClarificationPayload = {
  prompt: "Choose the implementation boundary",
  fields: [
    {
      id: "boundary",
      label: "Boundary",
      mode: "single",
      allowsCustom: false,
      required: true,
      options: [
        { id: "controller", label: "Controller" },
        { id: "store", label: "Store" },
      ],
    },
  ],
}

describe("interaction coordinator", () => {
  function setupCoordinator() {
    const ids = ["request-1", "request-2", "request-3", "request-4", "request-5"]
    const active: Array<ActiveAgentInteraction | null> = []
    const coordinator = createInteractionCoordinator({
      newRequestId: () => ids.shift()!,
      onActiveChanged: (interaction) => active.push(interaction),
    })
    return { coordinator, active }
  }

  it("keeps permissions FIFO and advances only after the displayed request settles", async () => {
    const { coordinator, active } = setupCoordinator()
    const first = coordinator.enqueuePermission("alpha", 1, PERMISSION_REQUEST)
    const secondRequest = { ...PERMISSION_REQUEST, sessionId: "beta-session" }
    const second = coordinator.enqueuePermission("beta", 1, secondRequest)

    expect(active.at(-1)).toMatchObject({
      kind: "permission",
      requestId: "request-1",
      sessionId: "alpha",
      generation: 1,
      request: PERMISSION_REQUEST,
    })
    expect(coordinator.resolveActive("request-2", 1, { outcome: "cancelled" })).toBe(false)
    expect(active.at(-1)?.requestId).toBe("request-1")

    expect(coordinator.resolveActive("request-1", 1, { outcome: "selected", optionId: "allow" })).toBe(true)
    expect(await first).toEqual({ outcome: "selected", optionId: "allow" })
    expect(active.at(-1)).toMatchObject({
      kind: "permission",
      requestId: "request-2",
      sessionId: "beta",
      request: secondRequest,
    })

    expect(coordinator.resolveActive("request-2", 1, { outcome: "cancelled" })).toBe(true)
    expect(await second).toEqual({ outcome: "cancelled" })
    expect(active.at(-1)).toBeNull()
  })

  it("integrates permission preemption and unchanged resumption through the active projection", async () => {
    const { coordinator, active } = setupCoordinator()
    const permission = coordinator.enqueuePermission("alpha", 7, PERMISSION_REQUEST)
    const originalPermission = active.at(-1)
    const clarification = coordinator.enqueueClarification("beta", 3, CLARIFICATION_PAYLOAD)

    expect(active.at(-1)).toMatchObject({
      kind: "clarification",
      requestId: "request-2",
      sessionId: "beta",
      generation: 3,
      payload: CLARIFICATION_PAYLOAD,
    })
    let permissionSettled = false
    void permission.then(() => {
      permissionSettled = true
    })
    await Bun.sleep(0)
    expect(permissionSettled).toBe(false)

    const answer: ClarificationOutcome = {
      kind: "submitted",
      answers: { boundary: { selectedOptionIds: ["controller"] } },
    }
    expect(coordinator.resolveActive("request-2", 3, answer)).toBe(true)
    expect(await clarification.outcome).toEqual(answer)
    expect(active.at(-1)).toEqual(originalPermission)

    expect(coordinator.resolveActive("request-1", 7, { outcome: "cancelled" })).toBe(true)
    expect(await permission).toEqual({ outcome: "cancelled" })
  })

  it("rejects wrong request IDs, old generations, wrong outcome kinds, and duplicate answers", async () => {
    const { coordinator, active } = setupCoordinator()
    const clarification = coordinator.enqueueClarification("alpha", 4, CLARIFICATION_PAYLOAD)
    const answer: ClarificationOutcome = {
      kind: "submitted",
      answers: { boundary: { selectedOptionIds: ["controller"] } },
    }

    expect(coordinator.resolveActive("missing", 4, answer)).toBe(false)
    expect(coordinator.resolveActive("request-1", 3, answer)).toBe(false)
    expect(coordinator.resolveActive("request-1", 4, { outcome: "cancelled" })).toBe(false)
    expect(active.at(-1)?.requestId).toBe("request-1")

    expect(coordinator.resolveActive("request-1", 4, answer)).toBe(true)
    expect(await clarification.outcome).toEqual(answer)
    expect(coordinator.resolveActive("request-1", 4, { kind: "cancelled" })).toBe(false)
  })

  it("cancels matching active, queued, and suspended entries once while a sibling stays usable", async () => {
    const { coordinator, active } = setupCoordinator()
    const suspended = coordinator.enqueuePermission("alpha", 9, PERMISSION_REQUEST)
    const sibling = coordinator.enqueuePermission("beta", 2, {
      ...PERMISSION_REQUEST,
      sessionId: "beta-session",
    })
    const queued = coordinator.enqueuePermission("alpha", 9, {
      ...PERMISSION_REQUEST,
      sessionId: "alpha-queued",
    })
    const clarification = coordinator.enqueueClarification("alpha", 9, CLARIFICATION_PAYLOAD)
    const settlementCounts = { suspended: 0, queued: 0, clarification: 0, sibling: 0 }
    void suspended.then(() => settlementCounts.suspended += 1)
    void queued.then(() => settlementCounts.queued += 1)
    void clarification.outcome.then(() => settlementCounts.clarification += 1)
    void sibling.then(() => settlementCounts.sibling += 1)

    coordinator.cancelSession("alpha", 8)
    expect(active.at(-1)).toMatchObject({ kind: "clarification", sessionId: "alpha", generation: 9 })
    coordinator.cancelSession("alpha", 9)
    coordinator.cancelSession("alpha", 9)
    await Bun.sleep(0)

    expect(await suspended).toEqual({ outcome: "cancelled" })
    expect(await queued).toEqual({ outcome: "cancelled" })
    expect(await clarification.outcome).toEqual({ kind: "cancelled" })
    expect(settlementCounts).toEqual({ suspended: 1, queued: 1, clarification: 1, sibling: 0 })
    expect(active.at(-1)).toMatchObject({ kind: "permission", sessionId: "beta", generation: 2 })

    expect(coordinator.resolveActive("request-2", 2, { outcome: "selected", optionId: "allow" })).toBe(true)
    expect(await sibling).toEqual({ outcome: "selected", optionId: "allow" })
    expect(settlementCounts.sibling).toBe(1)

    const afterDispose = coordinator.enqueueClarification("beta", 2, CLARIFICATION_PAYLOAD)
    coordinator.dispose()
    coordinator.dispose()
    expect(await afterDispose.outcome).toEqual({ kind: "cancelled" })
    expect(await coordinator.enqueuePermission("beta", 2, PERMISSION_REQUEST)).toEqual({ outcome: "cancelled" })
  })

  it("settles submission and timeout races exactly once in either order", async () => {
    const { coordinator } = setupCoordinator()
    const submitted = { kind: "submitted", answers: {} } as const

    const timeoutWins = coordinator.enqueueClarification("alpha", 1, CLARIFICATION_PAYLOAD)
    expect(timeoutWins.requestId).toBe("request-1")
    expect(timeoutWins.timeout()).toBe(true)
    expect(coordinator.resolveActive(timeoutWins.requestId, 1, submitted)).toBe(false)
    expect(timeoutWins.timeout()).toBe(false)
    expect(await timeoutWins.outcome).toEqual({ kind: "timed_out" })

    const submissionWins = coordinator.enqueueClarification("alpha", 1, CLARIFICATION_PAYLOAD)
    expect(coordinator.resolveActive(submissionWins.requestId, 1, submitted)).toBe(true)
    expect(submissionWins.timeout()).toBe(false)
    expect(await submissionWins.outcome).toEqual(submitted)
  })

  it("times out a suspended clarification without reviving it before the prior permission", async () => {
    const { coordinator, active } = setupCoordinator()
    const permission = coordinator.enqueuePermission("alpha", 1, PERMISSION_REQUEST)
    const first = coordinator.enqueueClarification("alpha", 1, CLARIFICATION_PAYLOAD)
    const second = coordinator.enqueueClarification("beta", 2, {
      ...CLARIFICATION_PAYLOAD,
      prompt: "Choose the test boundary",
    })

    expect(active.at(-1)?.requestId).toBe(second.requestId)
    expect(first.timeout()).toBe(true)
    expect(await first.outcome).toEqual({ kind: "timed_out" })
    expect(active.at(-1)?.requestId).toBe(second.requestId)

    expect(coordinator.resolveActive(second.requestId, 2, { kind: "skipped" })).toBe(true)
    expect(await second.outcome).toEqual({ kind: "skipped" })
    expect(active.at(-1)).toMatchObject({ kind: "permission", requestId: "request-1" })

    expect(coordinator.resolveActive("request-1", 1, { outcome: "cancelled" })).toBe(true)
    expect(await permission).toEqual({ outcome: "cancelled" })
  })
})

/** A `model`-category config option with the given confirmed value, for seeding/switch tests. */
function modelOption(currentValue: string): ConfigOption {
  return {
    id: "model",
    category: "model",
    label: "Model",
    currentValue,
    options: [
      { value: "opus", name: "Opus" },
      { value: "sonnet", name: "Sonnet" },
    ],
  }
}

function effortOption(currentValue: string, values = ["low", "high"]): ConfigOption {
  return {
    id: "effort",
    category: "thought_level",
    label: "Effort",
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  }
}

/** A stub `AgentConnection` recording what the controller asked of it. */
interface StubConnection extends AgentConnection {
  /** Push a domain event as if the agent had streamed it. */
  emit(event: DomainSessionEvent): void
  /** Raise a permission request through the handler the controller registered. */
  ask(request: PermissionRequest): Promise<PermissionOutcome>
  /** Raise a normalized clarification through the handler the controller registered. */
  clarify(payload: ClarificationPayload): Promise<ClarificationOutcome>
  readonly prompts: Array<{ sessionId: string; blocks: PromptBlock[] }>
  readonly promptInputs: Array<{ sessionId: string; input: AgentPromptInput }>
  readonly cancels: string[]
  readonly newSessionCwds: string[]
  readonly newSessionMcpServers: McpServerConfig[][]
  readonly loadSessionCalls: Array<{ sessionId: string; cwd: string }>
  readonly loadSessionMcpServers: McpServerConfig[][]
  /** Every `setSessionConfigOption` call the controller made, in order. */
  readonly configCalls: Array<{ sessionId: string; configId: string; value: string }>
  readonly isDisposed: () => boolean
  readonly disposeCalls: () => number
  readonly subscriberCount: () => number
}

interface StubOptions {
  ready?: ReadyState
  sessionId?: string
  connectThrows?: unknown
  newSessionThrows?: unknown
  newSessionWait?: Promise<void>
  loadSessionThrows?: unknown
  loadSessionEvents?: DomainSessionEvent[]
  loadSessionWait?: Promise<void>
  promptThrows?: unknown
  promptWait?: Promise<void>
  cancelThrows?: unknown
  cancelWait?: Promise<void>
  disposeThrows?: unknown
  disposeWait?: Promise<void>
  /** The full option set `setSessionConfigOption` echoes back (the confirmed state). */
  configResponse?: ConfigOption[]
  /** Make `setSessionConfigOption` reject, to exercise the action's error path. */
  setConfigThrows?: unknown
  /** Per-call confirmed responses or failures for ordered default application. */
  setConfig?: (sessionId: string, configId: string, value: string, callIndex: number) => Promise<ConfigOption[]> | ConfigOption[]
  /** Options the agent advertises during `newSession`, emitted so the controller can seed them. */
  newSessionConfig?: ConfigOption[]
}

interface StubShellRuntime extends ShellRuntime {
  emit(event: ShellEvent): void
  subscriberCount(): number
  isDisposed(): boolean
}

function createStubShellRuntime(): StubShellRuntime {
  const subscribers = new Set<(event: ShellEvent) => void>()
  let disposed = false
  return {
    onEvent(cb) {
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },
    onBufferChange() {
      return () => {}
    },
    bufferType: () => "normal",
    write() {},
    paste() {},
    interrupt() {},
    resize() {},
    view: () => [],
    snapshot: () => ({ cwd: CWD, commands: [] }),
    async dispose() {
      disposed = true
    },
    emit(event) {
      for (const subscriber of subscribers) subscriber(event)
    },
    subscriberCount: () => subscribers.size,
    isDisposed: () => disposed,
  }
}

function createTestShellFactory(): ShellRuntimeFactory {
  return createInMemoryShellRuntimeFactory().factory
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function deferredValue<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createStubConnection(id: ProviderKind, options: StubOptions = {}): StubConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  const prompts: Array<{ sessionId: string; blocks: PromptBlock[] }> = []
  const promptInputs: Array<{ sessionId: string; input: AgentPromptInput }> = []
  const cancels: string[] = []
  const newSessionCwds: string[] = []
  const newSessionMcpServers: McpServerConfig[][] = []
  const loadSessionCalls: Array<{ sessionId: string; cwd: string }> = []
  const loadSessionMcpServers: McpServerConfig[][] = []
  const configCalls: Array<{ sessionId: string; configId: string; value: string }> = []
  let permissionHandler: ((request: PermissionRequest) => Promise<PermissionOutcome>) | null = null
  let clarificationHandler: ((payload: ClarificationPayload) => Promise<ClarificationOutcome>) | null = null
  let disposed = false
  let disposals = 0

  const emit = (event: DomainSessionEvent): void => {
    for (const subscriber of subscribers) subscriber(event)
  }

  return {
    id,
    prompts,
    promptInputs,
    cancels,
    newSessionCwds,
    newSessionMcpServers,
    loadSessionCalls,
    loadSessionMcpServers,
    configCalls,
    isDisposed: () => disposed,
    disposeCalls: () => disposals,
    subscriberCount: () => subscribers.size,
    async connect() {
      if (options.connectThrows !== undefined) throw options.connectThrows
      return options.ready ?? { ready: true, protocolVersion: 1, canLoadSession: false }
    },
    async newSession(cwd, mcpServers = []) {
      newSessionCwds.push(cwd)
      newSessionMcpServers.push(mcpServers)
      await options.newSessionWait
      if (options.newSessionThrows !== undefined) throw options.newSessionThrows
      // Mirror the adapter: an agent that advertises config at session start emits it
      // as a `config_options` event during `newSession`, before the controller binds
      // its permanent subscription - the seed the controller must capture and replay.
      if (options.newSessionConfig !== undefined) emit({ kind: "config_options", options: options.newSessionConfig })
      return options.sessionId ?? `${id}-session`
    },
    async loadSession(sessionId, cwd, mcpServers = []) {
      loadSessionCalls.push({ sessionId, cwd })
      loadSessionMcpServers.push(mcpServers)
      for (const event of options.loadSessionEvents ?? []) emit(event)
      await options.loadSessionWait
      if (options.loadSessionThrows !== undefined) throw options.loadSessionThrows
    },
    async prompt(sessionId, input) {
      promptInputs.push({ sessionId, input })
      prompts.push({ sessionId, blocks: Array.isArray(input) ? input : [...input.userBlocks] })
      await options.promptWait
      if (options.promptThrows !== undefined) throw options.promptThrows
      return { stopReason: "end_turn" }
    },
    async cancel(sessionId) {
      cancels.push(sessionId)
      await options.cancelWait
      if (options.cancelThrows !== undefined) throw options.cancelThrows
    },
    async setSessionConfigOption(sessionId, configId, value) {
      configCalls.push({ sessionId, configId, value })
      if (options.setConfig) return options.setConfig(sessionId, configId, value, configCalls.length - 1)
      if (options.setConfigThrows !== undefined) throw options.setConfigThrows
      return options.configResponse ?? []
    },
    onUpdate(cb) {
      subscribers.add(cb)
      return () => {
        subscribers.delete(cb)
      }
    },
    onPermission(handler) {
      permissionHandler = handler
    },
    onClarification(handler) {
      clarificationHandler = handler
      return () => {
        if (clarificationHandler === handler) clarificationHandler = null
      }
    },
    async dispose() {
      disposals += 1
      await options.disposeWait
      if (options.disposeThrows !== undefined) throw options.disposeThrows
      disposed = true
    },
    emit,
    ask(request) {
      if (!permissionHandler) throw new Error("no permission handler registered")
      return permissionHandler(request)
    },
    clarify(payload) {
      if (!clarificationHandler) throw new Error("no clarification handler registered")
      return clarificationHandler(payload)
    },
  }
}

interface RecordingBridge {
  readonly factory: (options: KittenMcpBridgeOptions) => KittenMcpBridge
  readonly registrations: BridgeRegistration[]
  readonly cancellations: Array<BridgeRegistration & { reason: string }>
  readonly declarations: McpServerConfig[]
  request(sessionId: SessionId, generation: number, payload: ClarificationPayload): Promise<ClarificationOutcome>
  agentRunControl(): AgentRunControl
  disposeCalls(): number
}

function createRecordingBridge(): RecordingBridge {
  const registrations: BridgeRegistration[] = []
  const cancellations: Array<BridgeRegistration & { reason: string }> = []
  const declarations: McpServerConfig[] = []
  const live = new Map<SessionId, BridgeRegistration>()
  let callbacks: KittenMcpBridgeOptions | null = null
  let disposals = 0

  return {
    registrations,
    cancellations,
    declarations,
    factory(options) {
      callbacks = options
      return {
        register(input) {
          const previous = live.get(input.sessionId)
          if (previous) {
            cancellations.push({ ...previous, reason: "session_replaced" })
            options.cancelClarifications(previous.sessionId, previous.generation, "session_replaced")
          }
          const registration = { ...input }
          registrations.push(registration)
          live.set(input.sessionId, registration)
          const declaration: McpServerConfig = {
            name: ASK_USER_MCP_SERVER_NAME,
            command: `/bridge/${input.sessionId}`,
            args: [`generation-${input.generation}`],
            env: { KITTEN_TEST_BRIDGE: `${input.sessionId}:${input.generation}` },
          }
          declarations.push(declaration)
          return declaration
        },
        async ask() {
          return { kind: "cancelled" }
        },
        cancelSession(sessionId, generation, reason) {
          const route = live.get(sessionId)
          if (!route || route.generation !== generation) return
          live.delete(sessionId)
          cancellations.push({ ...route, reason })
          options.cancelClarifications(sessionId, generation, reason)
        },
        async dispose() {
          disposals += 1
          for (const route of [...live.values()]) {
            live.delete(route.sessionId)
            cancellations.push({ ...route, reason: "controller_disposed" })
            options.cancelClarifications(route.sessionId, route.generation, "controller_disposed")
          }
        },
      }
    },
    request(sessionId, generation, payload) {
      if (!callbacks) throw new Error("bridge not created")
      return callbacks.requestClarification(sessionId, generation, payload).outcome
    },
    agentRunControl() {
      if (!callbacks?.agentRunControl) throw new Error("agent-run control not created")
      return callbacks.agentRunControl
    },
    disposeCalls: () => disposals,
  }
}

function recordedAgentRunRoute(bridge: RecordingBridge, parentId: SessionId): AgentRunRoute {
  const registration = bridge.registrations.findLast((entry) => entry.sessionId === parentId)
  if (!registration) throw new Error(`No recorded route for ${parentId}`)
  return { parentId, parentGeneration: registration.generation }
}

/** Build a controller over one stub connection per configured agent. */
async function controllerWithStubs(
  stubs: Partial<Record<ProviderKind, StubOptions>> = {},
  overrides: {
    config?: AppConfig
    onError?: (sessionId: SessionId, error: unknown) => void
    recorder?: ActionTelemetry
    usageSeenSink?: UsageSeenSink
    readBranch?: (cwd: string) => Promise<string | null>
    createShellRuntime?: ShellRuntimeFactory
    store?: AppStore
    newInteractionId?: () => string
    newSteeringId?: () => string
    /** Exercise the controller's real default-store construction. */
    useProductionStore?: boolean
    resolveHarnessCapability?: (config: ResolvedAgentConfig) => HarnessCapability
    scheduleClarificationTimeout?: (callback: () => void, timeoutMs: number) => () => void
    scheduleSteeringSettlementTimeout?: (callback: () => void, timeoutMs: number) => () => void
    bridge?: RecordingBridge
    newSessionId?: () => SessionId
  } = {},
): Promise<{ controller: SessionController; connections: Record<ProviderKind, StubConnection>; bridge: RecordingBridge }> {
  const connections = {
    "claude-code": createStubConnection("claude-code", stubs["claude-code"]),
    codex: createStubConnection("codex", stubs.codex),
  } as Record<ProviderKind, StubConnection>

  const bridge = overrides.bridge ?? createRecordingBridge()
  const controller = await createSessionController({
    config: overrides.config ?? APP_CONFIG,
    cwd: CWD,
    store: overrides.useProductionStore ? undefined : overrides.store ?? createAppStore({ selectedVisibleId: "claude-code" }),
    createConnection: (config) => connections[config.id],
    newMessageId: () => "msg-1",
    newInteractionId: overrides.newInteractionId,
    newSteeringId: overrides.newSteeringId,
    onError: overrides.onError,
    recorder: overrides.recorder,
    usageSeenSink: overrides.usageSeenSink,
    readBranch: overrides.readBranch ?? (async () => null),
    createShellRuntime: overrides.createShellRuntime ?? createTestShellFactory(),
    resolveHarnessCapability: overrides.resolveHarnessCapability ?? (() => TEST_HARNESS_CAPABILITY),
    scheduleClarificationTimeout: overrides.scheduleClarificationTimeout,
    scheduleSteeringSettlementTimeout: overrides.scheduleSteeringSettlementTimeout,
    createKittenMcpBridge: bridge.factory,
    newSessionId: overrides.newSessionId,
  })
  return { controller, connections, bridge }
}

/**
 * Three declared sessions in three real, distinct directories inside this repository,
 * two of them sharing the `claude-code` provider - the multi-session fleet task_03
 * generalizes the controller to. Real directories so {@link resolveSessions}' existence
 * probe passes.
 */
const FLEET_DIRS = {
  alpha: process.cwd(),
  beta: join(process.cwd(), "src"),
  gamma: join(process.cwd(), "test"),
} as const
const THREE_SESSION_CONFIG: AppConfig = {
  providers: PROVIDERS,
  providerDefaults: {},
  sessions: [
    { provider: "claude-code", cwd: FLEET_DIRS.alpha, title: "Alpha" },
    { provider: "claude-code", cwd: FLEET_DIRS.beta, title: "Beta" },
    { provider: "codex", cwd: FLEET_DIRS.gamma, title: "Gamma" },
  ],
  mcpServers: [],
  shell: APP_CONFIG.shell,
  clarificationTimeoutSeconds: 300,
  persistenceEnabled: true,
  telemetryEnabled: false,
  transcriptWindowingEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
  statusline: { llmDisclosureAcknowledged: false, layout: null },
}

/**
 * Build a controller over a fresh stub per session, capturing every stub created in
 * plan order. Lets a test inspect the `newSession` directory and permission handler of
 * each individual session - including two sessions that share a provider kind.
 */
async function controllerOverFleet(
  config: AppConfig,
  optionsFor: (index: number) => StubOptions = () => ({}),
  overrides: {
    readBranch?: (cwd: string) => Promise<string | null>
    repositoryFileSource?: RepositoryFileSource
    createShellRuntime?: ShellRuntimeFactory
    sendInitialTasks?: boolean
    applyProviderDefaultsOnFreshSession?: boolean
    resolveHarnessCapability?: (config: ResolvedAgentConfig) => HarnessCapability
    bridge?: RecordingBridge
  } = {},
): Promise<{ controller: SessionController; created: StubConnection[]; bridge: RecordingBridge }> {
  const created: StubConnection[] = []
  const bridge = overrides.bridge ?? createRecordingBridge()
  const controller = await createSessionController({
    config,
    cwd: process.cwd(),
    createConnection: (agentConfig) => {
      const stub = createStubConnection(agentConfig.id, { sessionId: `acp-${created.length}`, ...optionsFor(created.length) })
      created.push(stub)
      return stub
    },
    newMessageId: () => "msg-1",
    readBranch: overrides.readBranch ?? (async () => null),
    repositoryFileSource: overrides.repositoryFileSource,
    createShellRuntime: overrides.createShellRuntime ?? createTestShellFactory(),
    sendInitialTasks: overrides.sendInitialTasks,
    applyProviderDefaultsOnFreshSession: overrides.applyProviderDefaultsOnFreshSession,
    resolveHarnessCapability: overrides.resolveHarnessCapability ?? (() => TEST_HARNESS_CAPABILITY),
    createKittenMcpBridge: bridge.factory,
  })
  return { controller, created, bridge }
}

function persistedRun(focusedAgentId: SessionId = "codex"): PersistedRunRecordV1 {
  return {
    version: 1,
    runId: "run-07",
    cwd: CWD,
    gitBranch: "feat/session-resume",
    focusedAgentId,
    createdAt: 1_000,
    updatedAt: 2_000,
    agents: {
      "claude-code": {
        sessionId: "claude-stored",
        lastPrompt: "continue claude",
        messageCount: 1,
        status: "finished",
      },
      codex: {
        sessionId: "codex-stored",
        lastPrompt: "continue codex",
        messageCount: 1,
        status: "idle",
      },
    },
    handoffBundle: null,
  }
}

function persistedRunV3(
  harnessDeliveries: Record<string, HarnessDeliveryCheckpoint>,
): PersistedRunRecordV3 {
  const conversations = {
    "claude-code": {
      sessionId: "claude-code",
      providerKind: "claude-code" as const,
      cwd: CWD,
      initialTitle: "Claude Code",
      acpSessionId: "claude-stored",
      lastPrompt: "continue claude",
      messageCount: 1,
      status: "finished" as const,
    },
    codex: {
      sessionId: "codex",
      providerKind: "codex" as const,
      cwd: CWD,
      initialTitle: "Codex",
      acpSessionId: "codex-stored",
      lastPrompt: "continue codex",
      messageCount: 1,
      status: "idle" as const,
    },
  }
  return {
    version: 3,
    runId: "run-v3",
    cwd: CWD,
    gitBranch: "feat/harness-restore",
    createdAt: 1_000,
    updatedAt: 2_000,
    conversations,
    workspace: {
      conversations: {
        "claude-code": {
          sessionId: "claude-code",
          displayName: "Claude Code",
          lifecycle: "visible",
          createdOrdinal: 0,
          attention: { seen: true, sequence: 0 },
        },
        codex: {
          sessionId: "codex",
          displayName: "Codex",
          lifecycle: "visible",
          createdOrdinal: 1,
          attention: { seen: true, sequence: 0 },
        },
      },
      order: ["claude-code", "codex"],
      selectedVisibleId: "codex",
    },
    handoffBundle: null,
    harnessDeliveries,
  }
}

function dynamicPersistedRun(): PersistedRunRecordV2 {
  return {
    version: 2,
    runId: "dynamic-run",
    cwd: CWD,
    gitBranch: "feat/dynamic-restore",
    createdAt: 1_000,
    updatedAt: 2_000,
    conversations: {
      "codex-review": {
        sessionId: "codex-review",
        providerKind: "codex",
        cwd: FLEET_DIRS.alpha,
        initialTitle: "Review",
        acpSessionId: "acp-review",
        lastPrompt: "review",
        messageCount: 1,
        status: "finished",
      },
      "codex-build": {
        sessionId: "codex-build",
        providerKind: "codex",
        cwd: FLEET_DIRS.beta,
        initialTitle: "Build",
        acpSessionId: "acp-build",
        lastPrompt: "build",
        messageCount: 1,
        status: "idle",
      },
    },
    workspace: {
      conversations: {
        "codex-review": {
          sessionId: "codex-review",
          displayName: "Review API",
          lifecycle: "background",
          createdOrdinal: 4,
          attention: { seen: false, sequence: 3 },
        },
        "codex-build": {
          sessionId: "codex-build",
          displayName: "Build CLI",
          lifecycle: "visible",
          createdOrdinal: 8,
          attention: { seen: true, sequence: 2 },
        },
      },
      order: ["codex-review", "codex-build"],
      selectedVisibleId: "codex-build",
    },
    handoffBundle: null,
  }
}

async function controllerForRestore(
  restoreOptions: Partial<Record<ProviderKind, StubOptions>> = {},
  onError?: (sessionId: SessionId, error: unknown) => void,
  recorder?: TelemetryRecorder,
  config: AppConfig = APP_CONFIG,
): Promise<{
  controller: SessionController
  startup: Record<ProviderKind, StubConnection>
  restored: Record<ProviderKind, StubConnection>
  bridge: RecordingBridge
}> {
  const startup = {
    "claude-code": createStubConnection("claude-code"),
    codex: createStubConnection("codex"),
  } as Record<ProviderKind, StubConnection>
  const restored = {
    "claude-code": createStubConnection("claude-code", restoreOptions["claude-code"]),
    codex: createStubConnection("codex", restoreOptions.codex),
  } as Record<ProviderKind, StubConnection>
  const queues = {
    "claude-code": [startup["claude-code"], restored["claude-code"]],
    codex: [startup.codex, restored.codex],
  } as Record<ProviderKind, StubConnection[]>

  const bridge = createRecordingBridge()
  const controller = await createSessionController({
    config,
    cwd: CWD,
    store: createAppStore({ selectedVisibleId: "claude-code" }),
    createConnection: (config) => queues[config.id].shift()!,
    onError,
    recorder,
    readBranch: async () => null,
    createShellRuntime: createTestShellFactory(),
    resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    createKittenMcpBridge: bridge.factory,
  })
  return { controller, startup, restored, bridge }
}

/** Poll until `predicate` holds, so a test can await an async round-trip. */
async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await Bun.sleep(1)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

describe("composePromptBlocks", () => {
  it("Should wrap raw text in a single text block", () => {
    expect(composePromptBlocks("fix the bug")).toEqual([{ type: "text", text: "fix the bug" }])
  })

  it("Should drop blank blocks so an empty prompt never starts a turn", () => {
    expect(composePromptBlocks("   \n ")).toEqual([])
    expect(composePromptBlocks([{ type: "text", text: "" }, { type: "text", text: "keep" }])).toEqual([
      { type: "text", text: "keep" },
    ])
  })
})

describe("createSessionController - steering orchestration", () => {
  it("drains the targeted interaction and coalesces ordered direction into one follow-up", async () => {
    const turn = deferred()
    const ids = ["turn-alpha", "steer-1", "steer-2"]
    const { controller, connections } = await controllerWithStubs(
      { "claude-code": { promptWait: turn.promise } },
      { newSteeringId: () => ids.shift()! },
    )

    const original = controller.actions.sendPrompt("original task", "claude-code")
    await waitFor(() => connections["claude-code"].prompts.length === 1, "original prompt dispatch")
    connections["claude-code"].emit({ kind: "status", status: "working" })
    const permission = connections["claude-code"].ask(PERMISSION_REQUEST)
    await waitFor(
      () => controller.store.getState().overlays.approval?.sessionId === "claude-code",
      "targeted permission boundary",
    )

    expect(controller.actions.steer("first direction", "claude-code")).toEqual({
      kind: "queued",
      requestId: "steer-1",
    })
    expect(controller.actions.steer("second direction", "claude-code")).toEqual({
      kind: "queued",
      requestId: "steer-2",
    })
    expect(connections["claude-code"].cancels).toEqual([])
    expect(controller.store.getState().sessions["claude-code"]!.steering.queue[0]?.phase).toBe("waiting")

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    await expect(permission).resolves.toEqual({ outcome: "selected", optionId: "allow" })
    await waitFor(() => connections["claude-code"].cancels.length === 1, "fallback cancellation")
    turn.resolve()
    await original
    await waitFor(() => connections["claude-code"].prompts.length === 2, "coalesced follow-up")
    await waitFor(
      () => controller.store.getState().sessions["claude-code"]!.steering.queue.length === 0,
      "confirmed steering delivery",
    )

    expect(connections["claude-code"].prompts[1]?.blocks).toEqual([
      { type: "text", text: STEERING_FOLLOW_UP_PREFIX },
      { type: "text", text: "first direction" },
      { type: "text", text: "second direction" },
    ])
    expect(
      controller.store.getState().sessions["claude-code"]!.turns.filter((entry) => entry.kind === "user"),
    ).toHaveLength(2)
    expect(connections.codex.prompts).toEqual([])
    await controller.dispose()
  })

  it("recovers a provider-error queue exactly once without disturbing a working sibling", async () => {
    const claudeTurn = deferred()
    const codexTurn = deferred()
    const ids = ["turn-alpha", "steer-error", "turn-beta"]
    const { controller, connections } = await controllerWithStubs(
      {
        "claude-code": { promptWait: claudeTurn.promise },
        codex: { promptWait: codexTurn.promise },
      },
      { newSteeringId: () => ids.shift()! },
    )

    const alpha = controller.actions.sendPrompt("alpha task", "claude-code")
    const beta = controller.actions.sendPrompt("beta task", "codex")
    await waitFor(() => connections["claude-code"].prompts.length === 1, "alpha prompt")
    await waitFor(() => connections.codex.prompts.length === 1, "beta prompt")
    connections["claude-code"].emit({ kind: "status", status: "working" })
    connections.codex.emit({ kind: "status", status: "working" })
    expect(controller.actions.steer("recover this exactly  ", "claude-code").kind).toBe("queued")
    await waitFor(
      () => controller.store.getState().sessions["claude-code"]!.steering.queue[0]?.phase === "settling",
      "alpha cancellation settlement",
    )

    connections["claude-code"].emit({ kind: "status", status: "error" })
    expect(controller.store.getState().sessions["claude-code"]!.steering.recovery).toEqual([
      { type: "text", text: "recover this exactly  " },
    ])
    expect(controller.store.getState().sessions.codex!.status).toBe("working")

    claudeTurn.resolve()
    codexTurn.resolve()
    await Promise.all([alpha, beta])
    expect(controller.store.getState().sessions["claude-code"]!.steering.recovery).toEqual([
      { type: "text", text: "recover this exactly  " },
    ])
    expect(connections["claude-code"].prompts).toHaveLength(1)
    expect(connections.codex.prompts).toHaveLength(1)
    await controller.dispose()
  })

  it("carries exact live recovery across generation replacement and fences the old prompt", async () => {
    const oldTurn = deferred()
    const startup = {
      "claude-code": createStubConnection("claude-code", { promptWait: oldTurn.promise }),
      codex: createStubConnection("codex"),
    } as Record<ProviderKind, StubConnection>
    const replacements = {
      "claude-code": createStubConnection("claude-code"),
      codex: createStubConnection("codex"),
    } as Record<ProviderKind, StubConnection>
    const queues = {
      "claude-code": [startup["claude-code"], replacements["claude-code"]],
      codex: [startup.codex, replacements.codex],
    } as Record<ProviderKind, StubConnection[]>
    const ids = ["turn-old", "steer-replaced", "turn-new"]
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      store: createAppStore({ selectedVisibleId: "claude-code" }),
      createConnection: (config) => queues[config.id].shift()!,
      newSteeringId: () => ids.shift()!,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    const original = controller.actions.sendPrompt("old task", "claude-code")
    await waitFor(() => startup["claude-code"].prompts.length === 1, "old generation prompt")
    startup["claude-code"].emit({ kind: "status", status: "working" })
    expect(controller.actions.steer("survive replacement", "claude-code").kind).toBe("queued")
    await waitFor(
      () => controller.store.getState().sessions["claude-code"]!.steering.queue[0]?.phase === "settling",
      "old generation settlement",
    )

    await controller.restore(persistedRunV3({}))
    expect(controller.store.getState().sessions["claude-code"]!.steering.recovery).toEqual([
      { type: "text", text: "survive replacement" },
    ])
    expect(controller.isReady("codex")).toBe(true)
    await expect(controller.actions.sendPrompt("new generation task", "claude-code")).resolves.toEqual({
      stopReason: "end_turn",
    })
    expect(replacements["claude-code"].prompts).toHaveLength(1)

    oldTurn.resolve()
    await original
    expect(startup["claude-code"].prompts).toHaveLength(1)
    expect(replacements["claude-code"].prompts).toHaveLength(1)
    expect(controller.store.getState().sessions["claude-code"]!.steering.recovery).toEqual([
      { type: "text", text: "survive replacement" },
    ])
    await controller.dispose()
  })
})

describe("nextSessionId", () => {
  it("Should cycle through the sessions in display order", () => {
    const order = ["claude-code", "codex"]
    expect(nextSessionId(order, "claude-code")).toBe("codex")
    expect(nextSessionId(order, "codex")).toBe("claude-code")
  })
})

describe("createSessionController - startup", () => {
  it.each([
    ["claude-code", "claude-code-acp-0.57.0"],
    ["codex", "codex-acp-1.1.2"],
  ] as const)("dispatches a fresh default %s session through its production harness profile", async (provider, profileId) => {
    const config = defaultAppConfig()
    config.sessions = [{ provider, cwd: process.cwd() }]
    const connection = createStubConnection(provider)
    const controller = await createSessionController({
      config,
      cwd: CWD,
      createConnection: () => connection,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      sendInitialTasks: false,
    })

    expect(await controller.actions.sendPrompt("default production task", provider)).toEqual({
      stopReason: "end_turn",
    })
    const input = connection.promptInputs[0]!.input
    expect(Array.isArray(input)).toBe(false)
    if (!Array.isArray(input)) {
      expect(input).toMatchObject({
        userBlocks: [{ type: "text", text: "default production task" }],
        profileId,
        harness: { version: "v1" },
      })
    }

    await controller.dispose()
  })

  it("fails closed before recording a fresh first task when no harness profile is certified", async () => {
    const { controller, connections } = await controllerWithStubs({}, {
      resolveHarnessCapability: () => ({ status: "unsupported", reason: "unknown_recipe" }),
    })

    expect(await controller.actions.sendPrompt("must stay recoverable", "claude-code")).toBeNull()
    expect(connections["claude-code"].prompts).toHaveLength(0)
    expect(controller.store.getState().sessions["claude-code"]!.turns).toHaveLength(0)

    await controller.dispose()
  })

  it("sends one harness envelope for a fresh first task and original blocks for follow-ups", async () => {
    const { controller, connections } = await controllerWithStubs()
    const firstBlocks: PromptBlock[] = [
      { type: "text", text: "first visible block" },
      { type: "text", text: "second visible block" },
    ]

    expect(await controller.actions.sendPrompt(firstBlocks, "claude-code")).toEqual({ stopReason: "end_turn" })
    const firstInput = connections["claude-code"].promptInputs[0]!.input
    expect(Array.isArray(firstInput)).toBe(false)
    if (!Array.isArray(firstInput)) {
      expect(firstInput.userBlocks).toEqual(firstBlocks)
      expect(firstInput.profileId).toBe("controller-test-profile")
      expect(firstInput.harness).toMatchObject({ version: "v1" })
      expect(firstInput.harness?.text).toContain("<kitten_harness version=\"v1\">")
    }
    expect(controller.store.getState().sessions["claude-code"]!.turns).toEqual([
      { kind: "user", messageId: "msg-1", text: "first visible block\nsecond visible block" },
    ])
    expect(controller.store.getState().harnessDeliveries["claude-code"]).toEqual({
      version: "v1",
      generation: 1,
      state: "delivered",
    })

    expect(await controller.actions.sendPrompt("follow-up", "claude-code")).toEqual({ stopReason: "end_turn" })
    expect(connections["claude-code"].promptInputs[1]!.input).toEqual([
      { type: "text", text: "follow-up" },
    ])
    expect(JSON.stringify(controller.store.getState().sessions["claude-code"]!.turns)).not.toContain("kitten_harness")

    await controller.dispose()
  })

  it("routes fresh-context recovery through a new harness delivery generation", async () => {
    const { controller, connections } = await controllerWithStubs()

    expect(await controller.actions.startFreshFromContext("saved visible context", "codex")).toEqual({
      stopReason: "end_turn",
    })
    const input = connections.codex.promptInputs[0]!.input
    expect(Array.isArray(input)).toBe(false)
    if (!Array.isArray(input)) {
      expect(input.userBlocks).toEqual([{ type: "text", text: "saved visible context" }])
      expect(input.harness).toMatchObject({ version: "v1" })
    }
    expect(controller.store.getState().harnessDeliveries.codex).toEqual({
      version: "v1",
      generation: 2,
      state: "delivered",
    })
    expect(controller.store.getState().sessions.codex!.turns).toEqual([
      { kind: "user", messageId: "msg-1", text: "saved visible context" },
    ])

    await controller.dispose()
  })

  it("Should log one content-free usage record with the emitting provider before store dispatch", async () => {
    const records: UsageSeenRecord[] = []
    const { controller, connections } = await controllerWithStubs({}, {
      config: { ...APP_CONFIG, telemetryEnabled: true },
      usageSeenSink: { write: (record) => records.push(record) },
    })

    connections["claude-code"].emit({ kind: "usage", used: 124_000, size: 200_000 })

    expect(records).toEqual([
      { evt: "usage_seen", provider: "claude-code", used: 124_000, size: 200_000 },
    ])
    expect(controller.store.getState().sessions["claude-code"]!.usage).toEqual({
      used: 124_000,
      size: 200_000,
    })
    await controller.dispose()
  })

  it("Should pass resolved command and scrollback config to the shell runtime factory", async () => {
    let received: Parameters<ShellRuntimeFactory>[0] | undefined
    const shell = createStubShellRuntime()
    const { controller } = await controllerWithStubs(
      {},
      {
        createShellRuntime: (options) => {
          received = options
          return shell
        },
      },
    )

    expect(received).toEqual({ cwd: CWD, command: "/bin/sh", scrollback: 2_500 })
    await controller.dispose()
  })

  it("Should connect every agent and open one session against the cwd", async () => {
    const { controller, connections } = await controllerWithStubs()

    expect(connections["claude-code"].newSessionCwds).toEqual([CWD])
    expect(connections.codex.newSessionCwds).toEqual([CWD])
    expect(controller.store.getState().sessions["claude-code"]!.acpSessionId).toBe("claude-code-session")
    expect(controller.store.getState().sessions.codex!.acpSessionId).toBe("codex-session")
    expect(controller.runtimes()).toEqual([
      {
        sessionId: "codex",
        providerKind: "codex",
        displayName: "Codex",
        title: "Codex",
        cwd: CWD,
        ready: true,
        acpSessionId: "codex-session",
        mcp: { loaded: [], skipped: [], askUser: "attached" },
      },
      {
        sessionId: "claude-code",
        providerKind: "claude-code",
        displayName: "Claude Code",
        title: "Claude Code",
        cwd: CWD,
        ready: true,
        acpSessionId: "claude-code-session",
        mcp: { loaded: [], skipped: [], askUser: "attached" },
      },
    ])
    expect(controller.isReady("claude-code")).toBe(true)

    await controller.dispose()
  })

  it("appends a distinct generated bridge after ordered user MCP servers for every fresh session", async () => {
    const mcp: McpServerConfig = {
      name: "fixture",
      command: process.execPath,
      args: ["--stdio"],
      env: { FIXTURE: "enabled" },
    }
    const { controller, connections } = await controllerWithStubs({}, {
      config: { ...APP_CONFIG, mcpServers: [mcp] },
    })

    const claudeServers = connections["claude-code"].newSessionMcpServers[0]!
    const codexServers = connections.codex.newSessionMcpServers[0]!
    expect(claudeServers.slice(0, -1)).toEqual([{ ...mcp, command: process.execPath }])
    expect(codexServers.slice(0, -1)).toEqual([{ ...mcp, command: process.execPath }])
    expect(claudeServers.at(-1)).toMatchObject({ name: ASK_USER_MCP_SERVER_NAME })
    expect(codexServers.at(-1)).toMatchObject({ name: ASK_USER_MCP_SERVER_NAME })
    expect(claudeServers.at(-1)).not.toEqual(codexServers.at(-1))
    expect(controller.runtime("claude-code")?.mcp).toEqual({ loaded: ["fixture"], skipped: [], askUser: "attached" })
    expect(controller.runtime("codex")?.mcp).toEqual({ loaded: ["fixture"], skipped: [], askUser: "attached" })
    await controller.dispose()
  })

  it("keeps skipped MCP declarations visible while starting sessions without them", async () => {
    const mcp: McpServerConfig = {
      name: "unavailable",
      command: "/definitely/not/a/kitten-mcp-server",
      args: [],
      env: {},
    }
    const { controller, connections } = await controllerWithStubs({}, {
      config: { ...APP_CONFIG, mcpServers: [mcp] },
    })

    const expected = {
      loaded: [],
      skipped: [{ name: "unavailable", reason: 'command not found: "/definitely/not/a/kitten-mcp-server"' }],
      askUser: "attached" as const,
    }
    expect(connections["claude-code"].newSessionMcpServers[0]?.map((server) => server.name)).toEqual([
      ASK_USER_MCP_SERVER_NAME,
    ])
    expect(connections.codex.newSessionMcpServers[0]?.map((server) => server.name)).toEqual([
      ASK_USER_MCP_SERVER_NAME,
    ])
    expect(controller.runtime("claude-code")?.mcp).toEqual(expected)
    expect(controller.runtime("codex")?.mcp).toEqual(expected)
    await controller.dispose()
  })

  it("provisions a distinct generated bridge for a dynamically created conversation", async () => {
    const userServers: McpServerConfig[] = [
      { name: "first", command: process.execPath, args: ["one"], env: {} },
      { name: "second", command: process.execPath, args: ["two"], env: {} },
    ]
    const { controller, connections, bridge } = await controllerWithStubs({}, {
      config: { ...APP_CONFIG, mcpServers: userServers },
      newSessionId: () => "dynamic-codex",
    })

    controller.store.setFocus("codex")
    expect(await controller.actions.createConversation()).toBe("dynamic-codex")
    const dynamicServers = connections.codex.newSessionMcpServers[1]!
    expect(dynamicServers.map((server) => server.name)).toEqual([
      "first",
      "second",
      ASK_USER_MCP_SERVER_NAME,
    ])
    expect(bridge.registrations).toContainEqual({ sessionId: "dynamic-codex", generation: 1 })
    expect(dynamicServers.at(-1)).not.toEqual(connections.codex.newSessionMcpServers[0]!.at(-1))

    await controller.dispose()
  })

  it("degrades only the session whose bridge registration fails before ACP session creation", async () => {
    const recording = createRecordingBridge()
    const bridge: RecordingBridge = {
      ...recording,
      factory(options) {
        const delegate = recording.factory(options)
        return {
          ...delegate,
          register(input) {
            if (input.sessionId === "claude-code") throw new Error("bridge registration unavailable")
            return delegate.register(input)
          },
        }
      },
    }
    const errors: Array<{ sessionId: SessionId; error: unknown }> = []
    const { controller, connections } = await controllerWithStubs({}, {
      bridge,
      onError: (sessionId, error) => errors.push({ sessionId, error }),
    })

    expect(controller.isReady("claude-code")).toBe(false)
    expect(controller.isReady("codex")).toBe(true)
    expect(connections["claude-code"].newSessionCwds).toEqual([])
    expect(connections.codex.newSessionMcpServers[0]?.at(-1)?.name).toBe(ASK_USER_MCP_SERVER_NAME)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.sessionId).toBe("claude-code")

    await controller.dispose()
  })

  it("invalidates replacement, close, provider-failure, and disposal routes without cross-session settlement", async () => {
    const { controller, connections, bridge } = await controllerWithStubs()
    const failedSettlements: ClarificationOutcome[] = []
    const disposedSettlements: ClarificationOutcome[] = []
    const failed = bridge.request("claude-code", 1, CLARIFICATION_PAYLOAD).then((outcome) => {
      failedSettlements.push(outcome)
      return outcome
    })

    connections["claude-code"].emit({ kind: "status", status: "error" })
    expect(await failed).toEqual({ kind: "cancelled" })
    expect(failedSettlements).toHaveLength(1)
    expect(bridge.cancellations.filter((entry) => entry.sessionId === "claude-code")).toEqual([
      { sessionId: "claude-code", generation: 1, reason: "connection_error" },
    ])
    expect(bridge.cancellations.some((entry) => entry.sessionId === "codex")).toBe(false)

    await controller.actions.startFreshFromContext("saved context", "codex")
    expect(bridge.cancellations).toContainEqual({
      sessionId: "codex",
      generation: 1,
      reason: "session_replaced",
    })
    expect(bridge.registrations).toContainEqual({ sessionId: "codex", generation: 2 })

    expect(await controller.closeConversation("codex", "close")).toEqual({ outcome: "closed" })
    expect(bridge.cancellations).toContainEqual({
      sessionId: "codex",
      generation: 2,
      reason: "conversation_closed",
    })

    const { controller: disposalController, bridge: disposalBridge } = await controllerWithStubs()
    const pending = disposalBridge.request("codex", 1, CLARIFICATION_PAYLOAD).then((outcome) => {
      disposedSettlements.push(outcome)
      return outcome
    })
    await disposalController.dispose()
    expect(await pending).toEqual({ kind: "cancelled" })
    expect(disposedSettlements).toHaveLength(1)
    expect(disposalBridge.disposeCalls()).toBe(1)
    expect(disposalBridge.cancellations).toContainEqual({
      sessionId: "codex",
      generation: 1,
      reason: "controller_disposed",
    })

    await controller.dispose()
  })

  it("Should retain an initial focus supplied by the caller's store", async () => {
    const { controller } = await controllerWithStubs()
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
    await controller.dispose()
  })

  it("Should default the built-in zero-config cockpit to Codex", async () => {
    const { controller } = await controllerWithStubs({}, { useProductionStore: true })

    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    expect(controller.store.getState().workspace.order).toEqual(["codex", "claude-code"])

    await controller.dispose()
  })

  it("Should seed the session-start config options into the store as a config_options event", async () => {
    const { controller } = await controllerWithStubs({
      "claude-code": { newSessionConfig: [modelOption("opus")] },
    })

    // The options the agent advertised during newSession populate the selector before
    // first use, surviving the transcript reset startSession performs.
    expect(controller.store.getState().sessions["claude-code"]!.configOptions).toEqual([modelOption("opus")])
    // A session that advertised none stays empty rather than fabricating options.
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([])

    await controller.dispose()
  })

  it("Should dispatch each agent's updates into that agent's slice only", async () => {
    const { controller, connections } = await controllerWithStubs()

    connections["claude-code"].emit({ kind: "agent_message", messageId: "m1", textDelta: "hello" })

    const state = controller.store.getState()
    expect(state.sessions["claude-code"]!.turns).toEqual([{ kind: "agent", messageId: "m1", text: "hello" }])
    expect(state.sessions.codex!.turns).toEqual([])

    await controller.dispose()
  })

  it("Should route scripted shell events into the store shell slice", async () => {
    const shell = createStubShellRuntime()
    const { controller } = await controllerWithStubs({}, { createShellRuntime: () => shell })

    shell.emit({ kind: "cwd_changed", cwd: "/workspace/kitten/packages/app" })

    expect(controller.shell).toEqual({ ready: true, runtime: shell })
    expect(controller.store.getState().shell.cwd).toBe("/workspace/kitten/packages/app")

    await controller.dispose()
  })

  it("Should read and store the branch for every session cwd at boot", async () => {
    const calls: string[] = []
    const branches = new Map([
      [FLEET_DIRS.alpha, "branch-alpha"],
      [FLEET_DIRS.beta, "branch-beta"],
      [FLEET_DIRS.gamma, "branch-gamma"],
    ])
    const { controller } = await controllerOverFleet(THREE_SESSION_CONFIG, undefined, {
      readBranch: async (cwd) => {
        calls.push(cwd)
        return branches.get(cwd) ?? null
      },
    })

    await waitFor(() => controller.store.getState().sessions.codex?.branch === "branch-gamma", "boot branch reads")

    expect(calls).toEqual([FLEET_DIRS.alpha, FLEET_DIRS.beta, FLEET_DIRS.gamma])
    expect(controller.store.getState().sessions["claude-code"]!.branch).toBe("branch-alpha")
    expect(controller.store.getState().sessions["claude-code-2"]!.branch).toBe("branch-beta")
    expect(controller.store.getState().sessions.codex!.branch).toBe("branch-gamma")

    await controller.dispose()
  })

  it("Should keep branch slots hidden when the reader returns null", async () => {
    const { controller } = await controllerWithStubs({}, { readBranch: async () => null })

    expect(controller.store.getState().sessions["claude-code"]!.branch).toBeUndefined()
    expect(controller.store.getState().sessions.codex!.branch).toBeUndefined()

    await controller.dispose()
  })
})

describe("createSessionController - harness delivery lifecycle", () => {
  it("keeps handoff preview confirm-only and sends curated blocks in one fresh envelope", async () => {
    const { controller, connections } = await controllerWithStubs()
    controller.store.setFocus("claude-code")
    controller.store.applyEvent("claude-code", {
      kind: "user_message",
      messageId: "source-user",
      text: "review the controller",
    })
    controller.store.applyEvent("claude-code", {
      kind: "agent_message",
      messageId: "source-agent",
      textDelta: "I found the delivery seam.",
    })
    const flow = createHandoffFlow({ controller })

    expect(flow.begin()).toEqual({ ok: true })
    const preview = controller.store.getState().overlays.handoffPreview
    expect(preview?.targetSessionId).toBe("codex")
    expect(connections.codex.promptInputs).toHaveLength(0)

    const result = await flow.confirm(createHandoffEdits(preview!.bundle))
    expect(result).toEqual({ stopReason: "end_turn" })
    expect(connections.codex.promptInputs).toHaveLength(1)
    const input = connections.codex.promptInputs[0]!.input
    expect(Array.isArray(input)).toBe(false)
    if (!Array.isArray(input)) {
      expect(input.harness).toMatchObject({ version: "v1" })
      expect(input.userBlocks.every((block) => !block.text.includes("kitten_harness"))).toBe(true)
    }
    expect(JSON.stringify(controller.store.getState().sessions.codex!.turns)).not.toContain("kitten_harness")

    await controller.dispose()
  })

  it("ignores an old-generation completion after replacement and grants the new generation one opportunity", async () => {
    const oldTurn = deferred()
    const byProvider: Record<ProviderKind, StubConnection[]> = {
      "claude-code": [],
      codex: [],
      cursor: [],
    }
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const prior = byProvider[config.id].length
        const connection = createStubConnection(config.id, prior === 0 && config.id === "claude-code"
          ? { promptWait: oldTurn.promise }
          : {})
        byProvider[config.id].push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })

    const oldPrompt = controller.actions.sendPrompt("old generation", "claude-code")
    await Bun.sleep(0)
    expect(controller.store.getState().harnessDeliveries["claude-code"]?.state).toBe("in_flight")

    await controller.actions.startNewRun()
    expect(controller.store.getState().harnessDeliveries["claude-code"]).toMatchObject({
      generation: 2,
      state: "pending",
    })

    oldTurn.resolve()
    await oldPrompt
    expect(controller.store.getState().harnessDeliveries["claude-code"]).toMatchObject({
      generation: 2,
      state: "pending",
    })

    expect(await controller.actions.sendPrompt("new generation", "claude-code")).toEqual({ stopReason: "end_turn" })
    expect(byProvider["claude-code"][0]!.promptInputs).toHaveLength(1)
    expect(byProvider["claude-code"][1]!.promptInputs).toHaveLength(1)
    expect(Array.isArray(byProvider["claude-code"][1]!.promptInputs[0]!.input)).toBe(false)
    expect(controller.store.getState().harnessDeliveries["claude-code"]).toMatchObject({
      generation: 2,
      state: "delivered",
    })

    await controller.dispose()
  })

  it("terminalizes a partial first turn that throws and never resubmits it", async () => {
    const turn = deferred()
    const { controller, connections } = await controllerWithStubs({
      "claude-code": { promptWait: turn.promise, promptThrows: new Error("transport lost") },
    })

    const prompt = controller.actions.sendPrompt("possibly sent once", "claude-code")
    await Bun.sleep(0)
    connections["claude-code"].emit({ kind: "agent_message", messageId: "partial", textDelta: "partial" })
    turn.resolve()
    expect(await prompt).toBeNull()
    expect(controller.store.getState().harnessDeliveries["claude-code"]).toEqual({
      version: "v1",
      generation: 1,
      state: "failed",
      failureCategory: "dispatch_indeterminate",
    })
    expect(await controller.actions.sendPrompt("possibly sent once", "claude-code")).toBeNull()
    expect(connections["claude-code"].promptInputs).toHaveLength(1)

    await controller.dispose()
  })

  it("terminalizes cancellation and close while a fresh first dispatch is in flight", async () => {
    const cancelTurn = deferred()
    const { controller, connections } = await controllerWithStubs({
      "claude-code": { promptWait: cancelTurn.promise },
    })
    const seenStates: string[] = []
    const unsubscribe = controller.store.subscribe((state) => {
      const delivery = state.harnessDeliveries["claude-code"]
      if (delivery) seenStates.push(delivery.state)
    })

    const prompt = controller.actions.sendPrompt("cancel once", "claude-code")
    await Bun.sleep(0)
    await controller.actions.cancel("claude-code")
    expect(controller.store.getState().harnessDeliveries["claude-code"]?.state).toBe("failed")
    cancelTurn.resolve()
    await prompt
    expect(connections["claude-code"].promptInputs).toHaveLength(1)
    expect(await controller.actions.sendPrompt("cancel once", "claude-code")).toBeNull()

    const closeTurn = deferred()
    const fresh = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => createStubConnection(config.id, config.id === "claude-code"
        ? { promptWait: closeTurn.promise }
        : {}),
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    const closeStates: string[] = []
    fresh.store.subscribe((state) => {
      const delivery = state.harnessDeliveries["claude-code"]
      if (delivery) closeStates.push(delivery.state)
    })
    const closingPrompt = fresh.actions.sendPrompt("close once", "claude-code")
    await Bun.sleep(0)
    fresh.store.applyEvent("claude-code", { kind: "status", status: "working" })
    expect(await fresh.closeConversation("claude-code", "cancel")).toEqual({ outcome: "closed" })
    expect(closeStates).toContain("failed")
    closeTurn.resolve()
    await closingPrompt

    unsubscribe()
    await controller.dispose()
    await fresh.dispose()
    expect(seenStates).toContain("failed")
  })

  it("keeps disposal terminal after a late first-prompt completion", async () => {
    const turn = deferred()
    const { controller, connections } = await controllerWithStubs({
      codex: { promptWait: turn.promise },
    })
    const prompt = controller.actions.sendPrompt("dispose once", "codex")
    await Bun.sleep(0)

    await controller.dispose()
    expect(controller.store.getState().harnessDeliveries.codex).toEqual({
      version: "v1",
      generation: 1,
      state: "failed",
      failureCategory: "dispatch_indeterminate",
    })
    turn.resolve()
    await prompt
    expect(connections.codex.promptInputs).toHaveLength(1)
    expect(controller.store.getState().harnessDeliveries.codex?.state).toBe("failed")
  })
})

describe("createSessionController - persisted restore", () => {
  it("appends a fresh per-generation bridge after ordered user servers on session/load", async () => {
    const userServers: McpServerConfig[] = [
      { name: "alpha-user", command: process.execPath, args: ["alpha"], env: {} },
      { name: "beta-user", command: process.execPath, args: ["beta"], env: {} },
    ]
    const readyToLoad: ReadyState = { ready: true, protocolVersion: 1, canLoadSession: true }
    const { controller, startup, restored, bridge } = await controllerForRestore(
      { "claude-code": { ready: readyToLoad }, codex: { ready: readyToLoad } },
      undefined,
      undefined,
      { ...APP_CONFIG, mcpServers: userServers },
    )

    await controller.restore(persistedRun())
    for (const provider of ["claude-code", "codex"] as const) {
      expect(restored[provider].loadSessionMcpServers[0]?.map((server) => server.name)).toEqual([
        "alpha-user",
        "beta-user",
        ASK_USER_MCP_SERVER_NAME,
      ])
      expect(restored[provider].loadSessionMcpServers[0]!.at(-1)).not.toEqual(
        startup[provider].newSessionMcpServers[0]!.at(-1),
      )
    }
    const restoredRegistrations = bridge.registrations.filter((entry) => entry.generation === 2)
    expect(restoredRegistrations).toHaveLength(2)
    expect(restoredRegistrations).toEqual(expect.arrayContaining([
      { sessionId: "claude-code", generation: 2 },
      { sessionId: "codex", generation: 2 },
    ]))

    await controller.dispose()
  })

  it("keeps a successfully loaded session harness-free on its first post-load prompt", async () => {
    const { controller, restored } = await controllerForRestore({
      "claude-code": { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
      codex: { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
    })

    await controller.restore(persistedRun())
    expect(controller.store.getState().harnessDeliveries.codex).toMatchObject({
      state: "not_required",
      version: "v1",
    })
    expect(await controller.actions.sendPrompt("continue loaded work", "codex")).toEqual({ stopReason: "end_turn" })
    expect(restored.codex.promptInputs[0]!.input).toEqual([
      { type: "text", text: "continue loaded work" },
    ])

    await controller.dispose()
  })

  it("restores unresolved V3 delivery as recovery-required without replay while a loaded sibling stays live", async () => {
    const readyToLoad: ReadyState = { ready: true, protocolVersion: 1, canLoadSession: true }
    const { controller, restored } = await controllerForRestore({
      "claude-code": { ready: readyToLoad },
      codex: { ready: readyToLoad },
    })
    await controller.restore(persistedRunV3({
      "claude-code": { version: "v1", generation: 8, state: "in_flight" },
      codex: { version: "v1", generation: 5, state: "delivered" },
    }))

    expect(controller.store.getState().harnessDeliveries["claude-code"]).toEqual({
      version: "v1",
      generation: 2,
      state: "failed",
      failureCategory: "dispatch_indeterminate",
    })
    expect(await controller.actions.sendPrompt("must not replay", "claude-code")).toBeNull()
    expect(restored["claude-code"].promptInputs).toHaveLength(0)

    expect(controller.store.getState().harnessDeliveries.codex).toEqual({
      version: "v1",
      generation: 2,
      state: "not_required",
    })
    expect(await controller.actions.sendPrompt("continue sibling", "codex")).toEqual({ stopReason: "end_turn" })
    expect(restored.codex.promptInputs[0]!.input).toEqual([{ type: "text", text: "continue sibling" }])
    await controller.dispose()
  })

  it("preserves an explicit V3 failure category and never retries its first task", async () => {
    const readyToLoad: ReadyState = { ready: true, protocolVersion: 1, canLoadSession: true }
    const { controller, restored } = await controllerForRestore({
      "claude-code": { ready: readyToLoad },
      codex: { ready: readyToLoad },
    })
    await controller.restore(persistedRunV3({
      "claude-code": {
        version: "v1",
        generation: 3,
        state: "failed",
        failureCategory: "harness_render_failed",
      },
    }))

    expect(controller.store.getState().harnessDeliveries["claude-code"]).toMatchObject({
      state: "failed",
      failureCategory: "harness_render_failed",
    })
    expect(await controller.actions.sendPrompt("original task", "claude-code")).toBeNull()
    expect(restored["claude-code"].promptInputs).toHaveLength(0)
    await controller.dispose()
  })

  it("binds clarification callbacks on a loaded replacement generation", async () => {
    const readyToLoad: ReadyState = { ready: true, protocolVersion: 1, canLoadSession: true }
    const { controller, restored } = await controllerForRestore({
      "claude-code": { ready: readyToLoad },
      codex: { ready: readyToLoad },
    })
    await controller.restore(persistedRun())

    const pending = restored["claude-code"].clarify(CLARIFICATION_PAYLOAD)
    const overlay = controller.store.getState().overlays.clarification
    expect(overlay).toMatchObject({ sessionId: "claude-code", generation: 2 })

    controller.actions.respondClarification(overlay!.requestId, overlay!.generation, { kind: "cancelled" })
    expect(await pending).toEqual({ kind: "cancelled" })
    await controller.dispose()
  })

  it("terminally cancels the replaced connection generation and keeps restored siblings usable", async () => {
    const { controller, startup, restored } = await controllerForRestore()
    const settlements = { claude: 0, codex: 0 }
    const oldClaude = startup["claude-code"].ask(PERMISSION_REQUEST).then((outcome) => {
      settlements.claude += 1
      return outcome
    })
    const oldCodex = startup.codex.ask({ ...PERMISSION_REQUEST, sessionId: "codex-session" }).then((outcome) => {
      settlements.codex += 1
      return outcome
    })

    await controller.restore(persistedRun())

    expect(await oldClaude).toEqual({ outcome: "cancelled" })
    expect(await oldCodex).toEqual({ outcome: "cancelled" })
    expect(settlements).toEqual({ claude: 1, codex: 1 })

    const restoredCodex = restored.codex.ask({ ...PERMISSION_REQUEST, sessionId: "codex-restored" })
    expect(controller.store.getState().overlays.approval?.sessionId).toBe("codex")
    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    expect(await restoredCodex).toEqual({ outcome: "selected", optionId: "allow" })

    await controller.dispose()
  })

  it("Should restore record-only conversations in persisted order with isolated same-provider runtimes", async () => {
    const created: StubConnection[] = []
    const branchReads: string[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const index = created.length
        const connection = createStubConnection(config.id, {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
          sessionId: `fresh-${index}`,
          loadSessionEvents:
            index < 2
              ? []
              : [{ kind: "agent_message", messageId: `replay-${index}`, textDelta: `restored-${index}` }],
        })
        created.push(connection)
        return connection
      },
      readBranch: async (sessionCwd) => {
        branchReads.push(sessionCwd)
        return `branch-${sessionCwd.split("/").at(-1)}`
      },
      createShellRuntime: createTestShellFactory(),
    })

    await controller.restore(dynamicPersistedRun())
    await waitFor(() => branchReads.includes(FLEET_DIRS.beta), "dynamic restore branch refresh")

    const state = controller.store.getState()
    expect(controller.runtimes().map((runtime) => runtime.sessionId)).toEqual(["codex-review", "codex-build"])
    expect(controller.runtime("codex-review")).toMatchObject({
      providerKind: "codex",
      cwd: FLEET_DIRS.alpha,
      ready: true,
      acpSessionId: "acp-review",
    })
    expect(controller.runtime("codex-build")).toMatchObject({
      providerKind: "codex",
      cwd: FLEET_DIRS.beta,
      ready: true,
      acpSessionId: "acp-build",
    })
    expect(created[2]!.loadSessionCalls).toEqual([{ sessionId: "acp-review", cwd: FLEET_DIRS.alpha }])
    expect(created[3]!.loadSessionCalls).toEqual([{ sessionId: "acp-build", cwd: FLEET_DIRS.beta }])
    expect(state.workspace.order).toEqual(["codex-review", "codex-build"])
    expect(state.workspace.selectedVisibleId).toBe("codex-build")
    expect(state.workspace.conversations["codex-review"]).toMatchObject({
      displayName: "Review API",
      lifecycle: "background",
      createdOrdinal: 4,
      attention: { seen: false, sequence: 3 },
      availability: { kind: "ready" },
    })
    expect(state.sessions["codex-review"]!.turns).toEqual([
      { kind: "agent", messageId: "replay-2", text: "restored-2" },
    ])
    expect(state.sessions["codex-build"]!.turns).toEqual([
      { kind: "agent", messageId: "replay-3", text: "restored-3" },
    ])

    await controller.dispose()
    expect(created[2]!.isDisposed()).toBe(true)
    expect(created[3]!.isDisposed()).toBe(true)
  })

  it("Should retain one failed dynamic restore as retryable while its sibling remains usable", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const index = created.length
        const connection = createStubConnection(config.id, {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
          sessionId: `fresh-${index}`,
          ...(index === 2 ? { loadSessionThrows: new Error("review history missing") } : {}),
        })
        created.push(connection)
        return connection
      },
      readBranch: async () => null,
      createShellRuntime: createTestShellFactory(),
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    await controller.restore(dynamicPersistedRun())

    expect(controller.isReady("codex-review")).toBe(false)
    expect(controller.isReady("codex-build")).toBe(true)
    expect(controller.store.getState().workspace.conversations["codex-review"]?.availability).toEqual({
      kind: "unavailable",
      reasonCode: "restore-unavailable",
      retryable: true,
    })
    expect(await controller.actions.sendPrompt("continue", "codex-build")).toEqual({ stopReason: "end_turn" })
    expect(created[3]!.prompts).toHaveLength(1)

    const recovered = await controller.actions.startFreshFromContext("recover", "codex-review")
    expect(recovered).toEqual({ stopReason: "end_turn" })
    expect(controller.isReady("codex-review")).toBe(true)
    expect(controller.store.getState().workspace.conversations["codex-review"]?.availability).toEqual({ kind: "ready" })
    expect(created[4]!.newSessionCwds).toEqual([FLEET_DIRS.alpha])

    await controller.dispose()
  })

  it("Should retain a record-only conversation when its provider recipe is unavailable", async () => {
    const config: AppConfig = {
      ...APP_CONFIG,
      providerDefaults: {},
      providers: { codex: PROVIDERS.codex } as AppConfig["providers"],
    }
    const record = dynamicPersistedRun()
    record.conversations["codex-review"] = {
      ...record.conversations["codex-review"]!,
      providerKind: "claude-code",
    }
    const controller = await createSessionController({
      config,
      cwd: CWD,
      createConnection: (agentConfig) =>
        createStubConnection(agentConfig.id, {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
        }),
      readBranch: async () => null,
      createShellRuntime: createTestShellFactory(),
    })

    await controller.restore(record)

    expect(controller.runtime("codex-review")).toMatchObject({
      providerKind: "claude-code",
      ready: false,
      error: "Provider unavailable",
    })
    expect(controller.store.getState().workspace.conversations["codex-review"]?.availability).toEqual({
      kind: "unavailable",
      reasonCode: "provider-unavailable",
      retryable: false,
    })
    expect(controller.isReady("codex-build")).toBe(true)

    await controller.dispose()
  })

  it("Should constrain V1 restore to matching resolved descriptors and ignore unmatched pointers", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (agentConfig) => {
        const connection = createStubConnection(agentConfig.id, {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
        })
        created.push(connection)
        return connection
      },
      readBranch: async () => null,
      createShellRuntime: createTestShellFactory(),
    })
    const record = persistedRun("unmatched")
    record.agents = {
      codex: record.agents.codex!,
      unmatched: {
        sessionId: "acp-unmatched",
        lastPrompt: "must not fabricate a descriptor",
        messageCount: 1,
        status: "idle",
      },
    }

    await controller.restore(record)

    expect(controller.runtimes().map((runtime) => runtime.sessionId)).toEqual(["codex"])
    expect(controller.runtime("unmatched")).toBeUndefined()
    expect(controller.store.getState().workspace.order).toEqual(["codex"])
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    expect(created.at(-1)!.loadSessionCalls).toEqual([{ sessionId: "codex-stored", cwd: CWD }])

    await controller.dispose()
  })

  it("Should record a picker resume with both panes live", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 1000,
      sessionRef: "resume-run",
    })
    const { controller } = await controllerForRestore(
      {
        "claude-code": { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
        codex: { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
      },
      undefined,
      recorder,
    )

    await controller.restore(persistedRun(), "picker")

    expect(records.find((record) => record.type === "session_resumed")).toMatchObject({
      mode: "picker",
      liveCount: 2,
    })
    expect(records.filter((record) => record.type === "resume_pane_unavailable")).toHaveLength(0)
    expect(records.find((record) => record.type === "tab_restore")).toMatchObject({
      visibleCountBucket: "two_to_four",
      backgroundCountBucket: "zero",
      unavailableCountBucket: "zero",
    })
    await controller.dispose()
  })

  it("Should record the unavailable Codex pane without including persisted prompt text", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
    })
    const { controller } = await controllerForRestore(
      {
        "claude-code": { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
        codex: {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
          loadSessionThrows: new Error("gone"),
        },
      },
      undefined,
      recorder,
    )

    await controller.restore(persistedRun(), "last-run")

    expect(records.find((record) => record.type === "resume_pane_unavailable")).toMatchObject({ agent: "codex" })
    expect(records.find((record) => record.type === "session_resumed")).toMatchObject({
      mode: "last-run",
      liveCount: 1,
    })
    expect(records.find((record) => record.type === "tab_restore")).toMatchObject({
      visibleCountBucket: "two_to_four",
      backgroundCountBucket: "zero",
      unavailableCountBucket: "one",
    })
    expect(JSON.stringify(records)).not.toContain("continue codex")
    await controller.dispose()
  })

  it("Should emit nothing across a full restore when telemetry is disabled", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: false,
      sink: { write: (record) => records.push(record) },
    })
    const { controller } = await controllerForRestore(
      {
        "claude-code": { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
        codex: {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
          loadSessionThrows: new Error("gone"),
        },
      },
      undefined,
      recorder,
    )

    await controller.restore(persistedRun(), "picker")

    expect(records).toHaveLength(0)
    await controller.dispose()
  })

  it("Should load stored sessions and replay their streamed history into both panes", async () => {
    const { controller, restored } = await controllerForRestore({
      "claude-code": {
        ready: { ready: true, protocolVersion: 1, canLoadSession: true },
        loadSessionEvents: [{ kind: "user_message", messageId: "claude-replay", text: "restored claude" }],
      },
      codex: {
        ready: { ready: true, protocolVersion: 1, canLoadSession: true },
        loadSessionEvents: [{ kind: "agent_message", messageId: "codex-replay", textDelta: "restored codex" }],
      },
    })

    await controller.restore(persistedRun())

    expect(restored["claude-code"].loadSessionCalls).toEqual([{ sessionId: "claude-stored", cwd: CWD }])
    expect(restored.codex.loadSessionCalls).toEqual([{ sessionId: "codex-stored", cwd: CWD }])
    expect(controller.store.getState().sessions["claude-code"]!.turns).toEqual([
      { kind: "user", messageId: "claude-replay", text: "restored claude" },
    ])
    expect(controller.store.getState().sessions.codex!.turns).toEqual([
      { kind: "agent", messageId: "codex-replay", text: "restored codex" },
    ])
    expect(controller.store.getState().restoration).toMatchObject({ "claude-code": "live", codex: "live" })
    await controller.dispose()
  })

  it("Should retain config options emitted while restoring a stored session", async () => {
    const { controller } = await controllerForRestore({
      "claude-code": { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
      codex: {
        ready: { ready: true, protocolVersion: 1, canLoadSession: true },
        loadSessionEvents: [{ kind: "config_options", options: [modelOption("gpt-5.6-terra")] }],
      },
    })

    await controller.restore(persistedRun())

    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([modelOption("gpt-5.6-terra")])
    await controller.dispose()
  })

  it("Should bind and subscribe before loadSession emits its first replay update", async () => {
    const { controller } = await controllerForRestore({
      "claude-code": {
        ready: { ready: true, protocolVersion: 1, canLoadSession: true },
        loadSessionEvents: [{ kind: "agent_message", messageId: "immediate", textDelta: "not dropped" }],
      },
      codex: { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
    })
    controller.store.applyEvent("claude-code", { kind: "agent_message", messageId: "stale", textDelta: "old" })

    await controller.restore(persistedRun())

    expect(controller.store.getState().sessions["claude-code"]!.turns).toEqual([
      { kind: "agent", messageId: "immediate", text: "not dropped" },
    ])
    await controller.dispose()
  })

  it("Should isolate a rejected load while the other session restores live", async () => {
    const errors: Array<{ sessionId: SessionId; error: unknown }> = []
    const { controller } = await controllerForRestore(
      {
        "claude-code": {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
          loadSessionThrows: new Error("stored transcript is gone"),
        },
        codex: {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
          loadSessionEvents: [{ kind: "agent_message", messageId: "codex-live", textDelta: "still restored" }],
        },
      },
      (sessionId, error) => errors.push({ sessionId, error }),
    )

    await expect(controller.restore(persistedRun())).resolves.toBeUndefined()

    expect(controller.store.getState().restoration).toMatchObject({ "claude-code": "unavailable", codex: "live" })
    expect(controller.isReady("claude-code")).toBe(false)
    expect(controller.isReady("codex")).toBe(true)
    expect(controller.store.getState().sessions.codex!.turns.at(-1)).toMatchObject({ text: "still restored" })
    expect(errors).toHaveLength(1)
    await controller.dispose()
  })

  it("Should recover a stale Codex rollout into a fresh usable session", async () => {
    const errors: Array<{ sessionId: SessionId; error: unknown }> = []
    const missingRollout = Object.assign(new Error("Internal error"), {
      data: { details: "no rollout found for thread id codex-stored" },
    })
    const { controller, restored } = await controllerForRestore(
      {
        "claude-code": { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
        codex: {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
          sessionId: "codex-fresh",
          newSessionConfig: [modelOption("sonnet")],
          loadSessionThrows: missingRollout,
        },
      },
      (sessionId, error) => errors.push({ sessionId, error }),
    )

    await controller.restore(persistedRun())

    expect(restored.codex.loadSessionCalls).toEqual([{ sessionId: "codex-stored", cwd: CWD }])
    expect(restored.codex.newSessionCwds).toEqual([CWD])
    expect(controller.store.getState().sessions.codex!.acpSessionId).toBe("codex-fresh")
    expect(controller.store.getState().sessions.codex!.turns).toEqual([])
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([modelOption("sonnet")])
    expect(controller.store.getState().restoration.codex).toBe("unavailable")
    expect(controller.isReady("codex")).toBe(true)
    expect(errors).toEqual([])
    expect(await controller.actions.sendPrompt("recover fallback", "codex")).toEqual({ stopReason: "end_turn" })
    const fallbackInput = restored.codex.promptInputs[0]!.input
    expect(Array.isArray(fallbackInput)).toBe(false)
    if (!Array.isArray(fallbackInput)) {
      expect(fallbackInput.userBlocks).toEqual([{ type: "text", text: "recover fallback" }])
      expect(fallbackInput.harness).toMatchObject({ version: "v1" })
    }
    await controller.dispose()
  })

  it("Should start fresh and mark unavailable when loadSession is not advertised", async () => {
    const { controller, restored } = await controllerForRestore({
      "claude-code": {
        ready: { ready: true, protocolVersion: 1, canLoadSession: false },
        sessionId: "claude-fresh",
      },
      codex: { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
    })

    await controller.restore(persistedRun())

    expect(restored["claude-code"].loadSessionCalls).toEqual([])
    expect(restored["claude-code"].newSessionCwds).toEqual([CWD])
    expect(controller.store.getState().sessions["claude-code"]!.acpSessionId).toBe("claude-fresh")
    expect(controller.store.getState().restoration["claude-code"]).toBe("unavailable")
    expect(controller.isReady("claude-code")).toBe(true)
    await controller.dispose()
  })

  it("Should start fresh for an empty stored session that has no history to restore", async () => {
    const { controller, restored } = await controllerForRestore({
      "claude-code": { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
      codex: {
        ready: { ready: true, protocolVersion: 1, canLoadSession: true },
        sessionId: "codex-fresh",
      },
    })
    const record = persistedRun()
    record.agents.codex = { ...record.agents.codex!, lastPrompt: "", messageCount: 0 }

    await controller.restore(record)

    expect(restored.codex.loadSessionCalls).toEqual([])
    expect(restored.codex.newSessionCwds).toEqual([CWD])
    expect(controller.store.getState().sessions.codex!.acpSessionId).toBe("codex-fresh")
    expect(controller.store.getState().restoration.codex).toBe("unavailable")
    expect(controller.isReady("codex")).toBe(true)
    await controller.dispose()
  })

  it("Should commit persisted selection before replay and retain it after restore settles", async () => {
    let releaseClaude!: () => void
    const claudeLoad = new Promise<void>((resolve) => {
      releaseClaude = resolve
    })
    const { controller, restored } = await controllerForRestore({
      "claude-code": {
        ready: { ready: true, protocolVersion: 1, canLoadSession: true },
        loadSessionWait: claudeLoad,
      },
      codex: { ready: { ready: true, protocolVersion: 1, canLoadSession: true } },
    })

    const restoring = controller.restore(persistedRun("codex"))
    await waitFor(() => restored["claude-code"].loadSessionCalls.length === 1, "claude restore to begin")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

    releaseClaude()
    await restoring

    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    await controller.dispose()
  })

  it("Should replace a restored run with fresh sessions and clear the resumed indicator", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const phase = Math.floor(created.length / 2)
        const connection = createStubConnection(config.id, {
          ready: { ready: true, protocolVersion: 1, canLoadSession: true },
          sessionId: `${config.id}-fresh-${phase}`,
        })
        created.push(connection)
        return connection
      },
      readBranch: async () => null,
      createShellRuntime: createTestShellFactory(),
    })

    await controller.restore(persistedRun())
    expect(controller.store.getState().restoration).toMatchObject({ "claude-code": "live", codex: "live" })

    await controller.actions.startNewRun()

    expect(created.slice(4).map((connection) => connection.newSessionCwds)).toEqual([[CWD], [CWD]])
    expect(controller.store.getState().restoration).toMatchObject({ "claude-code": null, codex: null })
    expect(controller.store.getState().sessions["claude-code"]!.acpSessionId).toBe("claude-code-fresh-2")
    expect(controller.store.getState().sessions.codex!.acpSessionId).toBe("codex-fresh-2")
    await controller.dispose()
  })
})

describe("createSessionController - Cursor preflight and readiness telemetry", () => {
  it("preflights before constructing exactly one long-lived Cursor connection and keeps all three providers live", async () => {
    const events: Array<{ kind: "preflight" | "create"; config: unknown }> = []
    const connections = new Map<ProviderKind, StubConnection>()
    const controller = await createSessionController({
      config: CURSOR_APP_CONFIG,
      cwd: CWD,
      preflightAgentReadiness: async (config) => {
        events.push({ kind: "preflight", config })
        return { ready: true }
      },
      createConnection: (config) => {
        events.push({ kind: "create", config })
        const connection = createStubConnection(config.id)
        connections.set(config.id, connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    const cursorEvents = events.filter(({ config }) => (config as { id: ProviderKind }).id === "cursor")
    expect(cursorEvents.map(({ kind }) => kind)).toEqual(["preflight", "create"])
    expect(cursorEvents[0]!.config).toBe(cursorEvents[1]!.config)
    expect(cursorEvents[0]!.config).toHaveProperty("runtimeProfile")
    expect(controller.runtimes().map(({ providerKind, ready }) => ({ providerKind, ready }))).toEqual([
      { providerKind: "codex", ready: true },
      { providerKind: "claude-code", ready: true },
      { providerKind: "cursor", ready: true },
    ])
    expect(await controller.actions.sendPrompt("sibling prompt", "codex")).toEqual({ stopReason: "end_turn" })
    expect(connections.get("codex")?.prompts).toHaveLength(1)
    await controller.dispose()
  })

  it.each([
    ["binary_not_found", "binary_missing"],
    ["version_mismatch", "version_mismatch"],
    ["uncertified_recipe", "uncertified_recipe"],
  ] as const)("isolates Cursor %s before construction and emits only %s", async (reason, outcome) => {
    const sinkRecords: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => sinkRecords.push(record) },
      sessionRef: "cursor-preflight",
    })
    const created: ProviderKind[] = []
    const connections = new Map<ProviderKind, StubConnection>()
    const controller = await createSessionController({
      config: CURSOR_APP_CONFIG,
      cwd: CWD,
      recorder,
      preflightAgentReadiness: async () => ({
        ready: false,
        reason,
        message: `Cursor recovery for ${reason}`,
      }),
      createConnection: (config) => {
        created.push(config.id)
        const connection = createStubConnection(config.id)
        connections.set(config.id, connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    expect(created).not.toContain("cursor")
    expect(controller.runtime("cursor")).toMatchObject({ ready: false, error: `Cursor recovery for ${reason}` })
    expect(controller.isReady("codex")).toBe(true)
    expect(await controller.actions.sendPrompt("still usable", "codex")).toEqual({ stopReason: "end_turn" })
    expect(connections.get("codex")?.prompts).toHaveLength(1)
    expect(sinkRecords).toContainEqual(expect.objectContaining({
      type: "provider_readiness",
      provider: "cursor",
      readinessOutcome: outcome,
    }))
    await controller.dispose()
  })

  it("normalizes Cursor authentication failure without disturbing a ready sibling", async () => {
    const records: TelemetryRecord[] = []
    const connections = new Map<ProviderKind, StubConnection>()
    const controller = await createSessionController({
      config: CURSOR_APP_CONFIG,
      cwd: CWD,
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
      }),
      preflightAgentReadiness: async () => ({ ready: true }),
      createConnection: (config) => {
        const connection = createStubConnection(config.id, config.id === "cursor"
          ? { ready: { ready: false, reason: "authentication_required", error: "login rejected" } }
          : {})
        connections.set(config.id, connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    expect(controller.runtime("cursor")).toMatchObject({
      ready: false,
      error: "Cursor: authentication is required: login rejected. Sign in to Cursor, then restart Kitten.",
    })
    expect(records).toContainEqual(expect.objectContaining({
      type: "provider_readiness",
      provider: "cursor",
      readinessOutcome: "authentication_required",
    }))
    expect(await controller.actions.sendPrompt("continue", "claude-code")).toEqual({ stopReason: "end_turn" })
    expect(connections.get("claude-code")?.prompts).toHaveLength(1)
    await controller.dispose()
  })

  it("preflights dynamic, fresh-run, fresh-context, and restored Cursor replacements and emits Cursor tab creation", async () => {
    const cursorOnly: AppConfig = {
      ...CURSOR_APP_CONFIG,
      providerDefaults: {},
      sessions: [{ provider: "cursor", cwd: process.cwd(), title: "Cursor" }],
    }
    const lifecycle: Array<{ kind: "preflight" | "create"; config: unknown }> = []
    const records: TelemetryRecord[] = []
    const ids = ["cursor-dynamic"]
    const controller = await createSessionController({
      config: cursorOnly,
      cwd: CWD,
      recorder: createTelemetryRecorder({ enabled: true, sink: { write: (record) => records.push(record) } }),
      preflightAgentReadiness: async (config) => {
        lifecycle.push({ kind: "preflight", config })
        return { ready: true }
      },
      createConnection: (config) => {
        lifecycle.push({ kind: "create", config })
        return createStubConnection(config.id, { sessionId: `cursor-acp-${lifecycle.length}` })
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    expect(await controller.actions.createConversation()).toBe("cursor-dynamic")
    expect(await controller.actions.startFreshFromContext("saved", "cursor-dynamic")).toEqual({ stopReason: "end_turn" })
    await controller.actions.startNewRun()
    await controller.restore({
      version: 2,
      runId: "cursor-run",
      cwd: CWD,
      gitBranch: "feat/cursor",
      createdAt: 1,
      updatedAt: 2,
      conversations: {
        cursor: {
          sessionId: "cursor",
          providerKind: "cursor",
          cwd: process.cwd(),
          initialTitle: "Cursor",
          acpSessionId: "cursor-stored",
          lastPrompt: "continue",
          messageCount: 1,
          status: "idle",
        },
      },
      workspace: {
        conversations: {
          cursor: {
            sessionId: "cursor",
            displayName: "Cursor",
            lifecycle: "visible",
            createdOrdinal: 1,
            attention: { seen: true, sequence: 0 },
          },
        },
        order: ["cursor"],
        selectedVisibleId: "cursor",
      },
      handoffBundle: null,
    })

    const preflights = lifecycle.filter(({ kind }) => kind === "preflight")
    const constructions = lifecycle.filter(({ kind }) => kind === "create")
    expect(preflights).toHaveLength(constructions.length)
    for (const construction of constructions) {
      const index = lifecycle.indexOf(construction)
      expect(lifecycle.slice(0, index).filter(({ kind }) => kind === "preflight").length)
        .toBeGreaterThan(lifecycle.slice(0, index).filter(({ kind }) => kind === "create").length)
      expect(construction.config).toHaveProperty("runtimeProfile")
    }
    expect(records).toContainEqual(expect.objectContaining({
      type: "tab_created",
      provider: "cursor",
      creationSource: "inherited",
    }))
    await controller.dispose()
  })
})

describe("createSessionController - degraded startup", () => {
  it("Should not create a runtime when the shell is disabled in config", async () => {
    let factoryCalls = 0
    const { controller } = await controllerOverFleet(
      { ...APP_CONFIG, shell: { ...APP_CONFIG.shell, enabled: false } },
      undefined,
      {
        createShellRuntime: () => {
          factoryCalls += 1
          return createStubShellRuntime()
        },
      },
    )

    expect(factoryCalls).toBe(0)
    expect(controller.shell).toEqual({ ready: false, error: "The integrated shell is disabled in config" })
    expect(controller.isReady("claude-code")).toBe(true)

    await controller.dispose()
  })

  it("Should keep agents usable and expose shell unavailability when shell creation fails", async () => {
    const { controller, connections } = await controllerWithStubs(
      {},
      {
        createShellRuntime: () => {
          throw new Error("PTY unavailable")
        },
      },
    )

    expect(controller.shell).toEqual({ ready: false, error: "PTY unavailable" })
    expect(controller.isReady("claude-code")).toBe(true)
    expect(controller.isReady("codex")).toBe(true)
    expect(await controller.actions.sendPrompt("agents remain usable", "codex")).toEqual({ stopReason: "end_turn" })
    expect(connections.codex.prompts).toHaveLength(1)

    await controller.dispose()
  })

  it("Should report a rejected handshake as not-ready and keep the other agent usable", async () => {
    const { controller, connections } = await controllerWithStubs({
      "claude-code": { ready: { ready: false, error: "not logged in" } },
    })

    expect(controller.runtime("claude-code")).toEqual({
      sessionId: "claude-code",
      providerKind: "claude-code",
      displayName: "Claude Code",
      title: "Claude Code",
      cwd: CWD,
      ready: false,
      error: "not logged in",
      mcp: { loaded: [], skipped: [], askUser: "unavailable" },
    })
    expect(controller.isReady("claude-code")).toBe(false)
    expect(controller.isReady("codex")).toBe(true)
    // The connection that never came up is released, not leaked.
    expect(connections["claude-code"].isDisposed()).toBe(true)
    expect(connections["claude-code"].newSessionCwds).toEqual([])

    // Focus falls through to the agent that did come up.
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    await controller.actions.sendPrompt("still works")
    expect(connections.codex.prompts).toHaveLength(1)

    await controller.dispose()
  })

  it("Should report a thrown connect as not-ready without rejecting", async () => {
    const errors: Array<[SessionId, unknown]> = []
    const { controller } = await controllerWithStubs(
      { codex: { connectThrows: new Error("spawn ENOENT") } },
      { onError: (sessionId, error) => errors.push([sessionId, error]) },
    )

    expect(controller.runtime("codex")).toMatchObject({ ready: false, error: "spawn ENOENT" })
    expect(controller.isReady("claude-code")).toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0]![0]).toBe("codex")

    await controller.dispose()
  })

  it("Should report a failed session/new as not-ready, stringifying a non-Error throw", async () => {
    const { controller } = await controllerWithStubs({ codex: { newSessionThrows: "no session for you" } })

    expect(controller.runtime("codex")).toMatchObject({ ready: false, error: "no session for you" })
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    await controller.dispose()
  })

  it("Should leave focus alone when no agent is ready", async () => {
    const { controller } = await controllerWithStubs({
      "claude-code": { ready: { ready: false, error: "down" } },
      codex: { ready: { ready: false, error: "down" } },
    })

    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
    expect(controller.runtimes().every((runtime) => !runtime.ready)).toBe(true)
    // A not-ready agent has no session, so the action surface is inert rather than fatal.
    expect(await controller.actions.sendPrompt("hello")).toBeNull()
    await controller.actions.cancel()

    await controller.dispose()
  })

  it("Should not know an agent the config never named", async () => {
    const { controller } = await controllerWithStubs()
    expect(controller.runtime("nope" as SessionId)).toBeUndefined()
    expect(controller.isReady("nope" as SessionId)).toBe(false)
    await controller.dispose()
  })
})

describe("createSessionController - multi-session fleet", () => {
  it("Should start one runtime per session, keyed by SessionId, in three distinct directories", async () => {
    const { controller, created } = await controllerOverFleet(THREE_SESSION_CONFIG)

    // Two sessions share the claude-code provider; each still gets its own SessionId.
    expect(controller.runtimes().map((runtime) => runtime.sessionId)).toEqual(["claude-code", "claude-code-2", "codex"])
    expect(controller.runtimes().every((runtime) => runtime.ready)).toBe(true)

    // Each session opened its ACP session against its own working directory.
    const cwds = created.map((stub) => stub.newSessionCwds)
    expect(cwds).toEqual([[FLEET_DIRS.alpha], [FLEET_DIRS.beta], [FLEET_DIRS.gamma]])
    expect(new Set(cwds.flat()).size).toBe(3)

    // The store carries each session's own directory.
    const state = controller.store.getState()
    expect(state.sessions["claude-code"]!.cwd).toBe(FLEET_DIRS.alpha)
    expect(state.sessions["claude-code-2"]!.cwd).toBe(FLEET_DIRS.beta)
    expect(state.sessions.codex!.cwd).toBe(FLEET_DIRS.gamma)

    // No descriptor carries a task, so no opening prompt is sent.
    expect(created.every((stub) => stub.prompts.length === 0)).toBe(true)

    await controller.dispose()
  })

  it("Should record one session not-ready with its reason while the rest of the fleet stays usable", async () => {
    const { controller } = await controllerOverFleet(THREE_SESSION_CONFIG, (index) =>
      index === 1 ? { connectThrows: new Error("spawn ENOENT") } : {},
    )

    expect(controller.runtime("claude-code-2")).toMatchObject({ ready: false, error: "spawn ENOENT" })
    expect(controller.isReady("claude-code")).toBe(true)
    expect(controller.isReady("codex")).toBe(true)

    // A sibling session is fully usable despite the one that failed to spawn.
    expect(await controller.actions.sendPrompt("carry on", "codex")).toEqual({ stopReason: "end_turn" })

    await controller.dispose()
  })

  it("Should label a parked approval with its session's id, title, and directory", async () => {
    const { controller, created } = await controllerOverFleet(THREE_SESSION_CONFIG)

    // The second claude-code session (title Beta, dir src) raises the request.
    const pending = created[1]!.ask(PERMISSION_REQUEST)

    expect(controller.store.getState().overlays.approval).toMatchObject({
      sessionId: "claude-code-2",
      title: "Beta",
      cwd: FLEET_DIRS.beta,
      request: PERMISSION_REQUEST,
    })

    controller.actions.respondPermission({ outcome: "cancelled" })
    await pending
    await controller.dispose()
  })

  it("Should send a session's optional first task as its opening prompt", async () => {
    const config: AppConfig = {
      providers: PROVIDERS,
      providerDefaults: {},
      sessions: [{ provider: "codex", cwd: process.cwd(), title: "Worker", task: "start the build" }],
      mcpServers: [],
      shell: APP_CONFIG.shell,
      clarificationTimeoutSeconds: 300,
      persistenceEnabled: true,
      telemetryEnabled: false,
      transcriptWindowingEnabled: false,
      theme: "auto",
      welcomeBanner: "auto",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    }
    const { controller, created } = await controllerOverFleet(config)

    await waitFor(() => created[0]!.prompts.length === 1, "the opening task prompt to be sent")
    expect(created[0]!.prompts[0]!.blocks).toEqual([{ type: "text", text: "start the build" }])
    const openingInput = created[0]!.promptInputs[0]!.input
    expect(Array.isArray(openingInput)).toBe(false)
    if (!Array.isArray(openingInput)) {
      expect(openingInput.userBlocks).toEqual([{ type: "text", text: "start the build" }])
      expect(openingInput.harness).toMatchObject({ version: "v1" })
    }
    // The opening prompt is recorded as the session's first user turn.
    expect(controller.store.getState().sessions.codex!.turns).toEqual([
      { kind: "user", messageId: "msg-1", text: "start the build" },
    ])
    expect(controller.store.getState().sessions.codex!.promptHistory.entries).toEqual([])

    await controller.dispose()
  })

  it("applies saved defaults before sending a fresh session's configured startup task", async () => {
    const config: AppConfig = {
      providers: PROVIDERS,
      providerDefaults: { codex: { model: "opus", effort: "high" } },
      sessions: [{ provider: "codex", cwd: process.cwd(), title: "Worker", task: "start the build" }],
      mcpServers: [],
      shell: APP_CONFIG.shell,
      clarificationTimeoutSeconds: 300,
      persistenceEnabled: true,
      telemetryEnabled: false,
      transcriptWindowingEnabled: false,
      theme: "auto",
      welcomeBanner: "auto",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    }
    const { controller, created } = await controllerOverFleet(
      config,
      () => ({
        newSessionConfig: [modelOption("sonnet"), effortOption("low")],
        setConfig: (_sessionId, configId, value) => configId === "model"
          ? [modelOption(value), effortOption("low")]
          : [modelOption("opus"), effortOption(value)],
      }),
      { applyProviderDefaultsOnFreshSession: true },
    )

    expect(created[0]!.configCalls).toEqual([
      { sessionId: "acp-0", configId: "model", value: "opus" },
      { sessionId: "acp-0", configId: "effort", value: "high" },
    ])
    await waitFor(() => created[0]!.prompts.length === 1, "the defaulted opening task prompt to be sent")
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([
      modelOption("opus"),
      effortOption("high"),
    ])

    await controller.dispose()
  })

  it("does not send an initial task when boot has a persisted run to restore", async () => {
    const config: AppConfig = {
      providers: PROVIDERS,
      providerDefaults: {},
      sessions: [{ provider: "codex", cwd: process.cwd(), title: "Worker", task: "start the build" }],
      mcpServers: [],
      shell: APP_CONFIG.shell,
      clarificationTimeoutSeconds: 300,
      persistenceEnabled: true,
      telemetryEnabled: false,
      transcriptWindowingEnabled: false,
      theme: "auto",
      welcomeBanner: "auto",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    }
    const { controller, created } = await controllerOverFleet(config, undefined, { sendInitialTasks: false })

    expect(created[0]!.prompts).toEqual([])
    expect(controller.store.getState().sessions.codex!.turns).toEqual([])

    await controller.dispose()
  })
})

describe("actions - sendPrompt", () => {
  it("Should prompt the focused agent's connection with the composed blocks", async () => {
    const { controller, connections } = await controllerWithStubs()

    const result = await controller.actions.sendPrompt("refactor the reducer")

    expect(result).toEqual({ stopReason: "end_turn" })
    expect(connections["claude-code"].prompts).toEqual([
      { sessionId: "claude-code-session", blocks: [{ type: "text", text: "refactor the reducer" }] },
    ])
    expect(connections.codex.prompts).toEqual([])
    // The user's turn is recorded: ACP never echoes the prompt back.
    expect(controller.store.getState().sessions["claude-code"]!.turns).toEqual([
      { kind: "user", messageId: "msg-1", text: "refactor the reducer" },
    ])

    await controller.dispose()
  })

  it("Should prompt an explicitly addressed agent that does not hold focus", async () => {
    const { controller, connections } = await controllerWithStubs()

    await controller.actions.sendPrompt([{ type: "text", text: "continue this" }], "codex")

    expect(connections.codex.prompts).toEqual([
      { sessionId: "codex-session", blocks: [{ type: "text", text: "continue this" }] },
    ])
    expect(connections["claude-code"].prompts).toEqual([])
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    await controller.dispose()
  })

  it("Should send nothing for a blank prompt", async () => {
    const { controller, connections } = await controllerWithStubs()

    expect(await controller.actions.sendPrompt("  \n  ")).toBeNull()
    expect(connections["claude-code"].prompts).toEqual([])
    expect(controller.store.getState().sessions["claude-code"]!.turns).toEqual([])

    await controller.dispose()
  })

  it("Should report a failing prompt through onError instead of rejecting", async () => {
    const errors: unknown[] = []
    const { controller } = await controllerWithStubs(
      { "claude-code": { promptThrows: new Error("broken pipe") } },
      { onError: (_agentId, error) => errors.push(error) },
    )

    expect(await controller.actions.sendPrompt("hi")).toBeNull()
    expect(errors).toEqual([new Error("broken pipe")])

    await controller.dispose()
  })

  it("Should swallow a failing prompt when no error reporter is configured", async () => {
    const connection = createStubConnection("claude-code", { promptThrows: new Error("broken pipe") })
    const controller = await createSessionController({
      config: {
        providers: PROVIDERS,
        providerDefaults: {},
        sessions: [{ provider: "claude-code", cwd: process.cwd() }],
        mcpServers: [],
        shell: APP_CONFIG.shell,
        clarificationTimeoutSeconds: 300,
        persistenceEnabled: true,
        telemetryEnabled: false,
        transcriptWindowingEnabled: false,
        theme: "auto",
        welcomeBanner: "auto",
        statusline: { llmDisclosureAcknowledged: false, layout: null },
      },
      cwd: CWD,
      createConnection: () => connection,
      createShellRuntime: createTestShellFactory(),
    })

    expect(await controller.actions.sendPrompt("hi")).toBeNull()
    await controller.dispose()
  })

  it("Should refresh the addressed session branch after a turn completes without waiting for git", async () => {
    let readCount = 0
    let resolveTurnRead!: (branch: string | null) => void
    const turnRead = new Promise<string | null>((resolve) => {
      resolveTurnRead = resolve
    })
    const { controller } = await controllerWithStubs({}, {
      readBranch: async () => {
        readCount += 1
        return readCount <= 2 ? "main" : turnRead
      },
    })
    await waitFor(() => controller.store.getState().sessions["claude-code"]?.branch === "main", "boot branch read")

    const result = await controller.actions.sendPrompt("finish this turn")

    expect(result).toEqual({ stopReason: "end_turn" })
    await waitFor(() => readCount === 3, "turn-completion branch refresh to start")
    expect(controller.store.getState().sessions["claude-code"]!.branch).toBe("main")

    resolveTurnRead("feature/after-turn")
    await waitFor(
      () => controller.store.getState().sessions["claude-code"]?.branch === "feature/after-turn",
      "turn-completion branch refresh to finish",
    )

    await controller.dispose()
  })
})

describe("actions - cancel", () => {
  it("Should interrupt the focused agent's session", async () => {
    const { controller, connections } = await controllerWithStubs()

    await controller.actions.cancel()

    expect(connections["claude-code"].cancels).toEqual(["claude-code-session"])
    expect(connections.codex.cancels).toEqual([])

    await controller.dispose()
  })

  it("Should report a failing cancel through onError instead of rejecting", async () => {
    const errors: unknown[] = []
    const { controller } = await controllerWithStubs(
      { codex: { cancelThrows: new Error("already gone") } },
      { onError: (_agentId, error) => errors.push(error) },
    )

    await controller.actions.cancel("codex")
    expect(errors).toEqual([new Error("already gone")])

    await controller.dispose()
  })
})

describe("actions - setSessionConfigOption", () => {
  it("Should target an explicitly addressed session and call the adapter with the args", async () => {
    const { controller, connections } = await controllerWithStubs({
      codex: { configResponse: [modelOption("opus")] },
    })

    expect(await controller.actions.setSessionConfigOption("model", "opus", "codex")).toBe(true)

    expect(connections.codex.configCalls).toEqual([{ sessionId: "codex-session", configId: "model", value: "opus" }])
    expect(connections["claude-code"].configCalls).toEqual([])
    // The store reflects the adapter-reported set.
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([modelOption("opus")])

    await controller.dispose()
  })

  it("records a model switch as confirmed only when the adapter reports the requested value", async () => {
    const switches: Array<{ sessionId: SessionId; kind: "model" | "effort"; confirmed: boolean; effortChanged: boolean }> = []
    const recorder: ActionTelemetry = {
      focusSwitch() {},
      recordSwitch: (sessionId, kind, confirmed, effortChanged) => switches.push({ sessionId, kind, confirmed, effortChanged }),
    }
    const { controller } = await controllerWithStubs(
      { codex: { configResponse: [modelOption("opus")] } },
      { recorder },
    )

    expect(await controller.actions.setSessionConfigOption("model", "opus", "codex")).toBe(true)

    expect(switches).toEqual([{ sessionId: "codex", kind: "model", confirmed: true, effortChanged: false }])
    await controller.dispose()
  })

  it("records an adapter-reported mismatch as unverified rather than confirmed", async () => {
    const switches: Array<{ sessionId: SessionId; kind: "model" | "effort"; confirmed: boolean; effortChanged: boolean }> = []
    const recorder: ActionTelemetry = {
      focusSwitch() {},
      recordSwitch: (sessionId, kind, confirmed, effortChanged) => switches.push({ sessionId, kind, confirmed, effortChanged }),
    }
    const { controller } = await controllerWithStubs(
      { codex: { configResponse: [modelOption("sonnet")] } },
      { recorder },
    )

    expect(await controller.actions.setSessionConfigOption("model", "opus", "codex")).toBe(false)

    expect(switches).toEqual([{ sessionId: "codex", kind: "model", confirmed: false, effortChanged: false }])
    await controller.dispose()
  })

  it("Should default to the focused session when no session id is given", async () => {
    const { controller, connections } = await controllerWithStubs({
      "claude-code": { configResponse: [modelOption("sonnet")] },
    })

    await controller.actions.setSessionConfigOption("model", "sonnet")

    expect(connections["claude-code"].configCalls).toEqual([
      { sessionId: "claude-code-session", configId: "model", value: "sonnet" },
    ])
    expect(connections.codex.configCalls).toEqual([])

    await controller.dispose()
  })

  it("Should no-op without throwing when the session has no live connection", async () => {
    const { controller } = await controllerWithStubs({
      "claude-code": { ready: { ready: false, error: "down" } },
    })

    // The not-ready claude-code session resolves to no live session, so this is inert.
    expect(await controller.actions.setSessionConfigOption("model", "opus", "claude-code")).toBe(false)
    expect(controller.store.getState().sessions["claude-code"]!.configOptions).toEqual([])

    await controller.dispose()
  })

  it("Should route an adapter error to onError and leave the store's confirmed state intact", async () => {
    const errors: Array<[SessionId, unknown]> = []
    const switches: Array<{ sessionId: SessionId; kind: "model" | "effort"; confirmed: boolean; effortChanged: boolean }> = []
    const recorder: ActionTelemetry = {
      focusSwitch() {},
      recordSwitch: (sessionId, kind, confirmed, effortChanged) => switches.push({ sessionId, kind, confirmed, effortChanged }),
    }
    const { controller, connections } = await controllerWithStubs(
      { "claude-code": { newSessionConfig: [modelOption("opus")], setConfigThrows: new Error("switch failed") } },
      { onError: (sessionId, error) => errors.push([sessionId, error]), recorder },
    )

    expect(await controller.actions.setSessionConfigOption("model", "sonnet", "claude-code")).toBe(false)

    // The adapter was called, but its failure never reached the store.
    expect(connections["claude-code"].configCalls).toHaveLength(1)
    expect(errors).toEqual([["claude-code", new Error("switch failed")]])
    // The last confirmed value survives, so the overlay can mark the option unverified.
    expect(controller.store.getState().sessions["claude-code"]!.configOptions).toEqual([modelOption("opus")])
    expect(switches).toEqual([{ sessionId: "claude-code", kind: "model", confirmed: false, effortChanged: false }])

    await controller.dispose()
  })

  it("Should reflect the adapter-reported value through selectAgentModel, not the requested one", async () => {
    // The agent honors the switch with a different value than requested (asked opus,
    // confirmed sonnet); the store must follow the confirmed state, never the request.
    const { controller } = await controllerWithStubs({
      "claude-code": { newSessionConfig: [modelOption("opus")], configResponse: [modelOption("sonnet")] },
    })

    await controller.actions.setSessionConfigOption("model", "opus", "claude-code")

    expect(selectAgentModel("claude-code")(controller.store.getState())).toBe("sonnet")

    await controller.dispose()
  })
})

describe("actions - applyProviderDefaults", () => {
  it("records none exactly once without touching confirmed options or the adapter", async () => {
    const outcomes: string[] = []
    const { controller, connections } = await controllerWithStubs(
      { codex: { newSessionConfig: [modelOption("sonnet"), effortOption("low")] } },
      {
        recorder: {
          focusSwitch() {},
          recordProviderDefaultOutcome: (outcome) => outcomes.push(outcome),
        },
      },
    )
    const before = controller.store.getState().sessions.codex!.configOptions
    let terminalChanges = 0
    const unsubscribe = controller.store.subscribe((state, previous) => {
      if (state.sessions.codex?.defaultApplyResult !== previous.sessions.codex?.defaultApplyResult) terminalChanges += 1
    })

    expect(await controller.actions.applyProviderDefaults("codex")).toEqual({ kind: "none" })

    expect(connections.codex.configCalls).toEqual([])
    expect(controller.store.getState().sessions.codex!.configOptions).toBe(before)
    expect(controller.store.getState().sessions.codex!.defaultApplyResult).toEqual({ kind: "none" })
    expect(terminalChanges).toBe(1)
    expect(outcomes).toEqual(["none"])
    unsubscribe()
    await controller.dispose()
  })

  it("reports a stale model unavailable without making an adapter call", async () => {
    const config = { ...APP_CONFIG, providerDefaults: { codex: { model: "missing" } } }
    const { controller, connections } = await controllerWithStubs(
      { codex: { newSessionConfig: [modelOption("sonnet"), effortOption("low")] } },
      { config },
    )

    expect(await controller.actions.applyProviderDefaults("codex")).toEqual({
      kind: "unavailable",
      unavailable: "model",
    })
    expect(connections.codex.configCalls).toEqual([])
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([
      modelOption("sonnet"),
      effortOption("low"),
    ])
    await controller.dispose()
  })

  it("applies model before effort and resolves effort from the refreshed confirmed options", async () => {
    const config = { ...APP_CONFIG, providerDefaults: { codex: { model: "opus", effort: "high" } } }
    const { controller, connections } = await controllerWithStubs(
      {
        codex: {
          newSessionConfig: [modelOption("sonnet"), effortOption("low")],
          setConfig: (_sessionId, configId) => configId === "model"
            ? [modelOption("opus"), effortOption("low", ["low", "high"])]
            : [modelOption("opus"), effortOption("high", ["low", "high"])],
        },
      },
      { config },
    )

    expect(await controller.actions.applyProviderDefaults("codex")).toEqual({
      kind: "applied",
      model: "opus",
      effort: "high",
    })
    expect(connections.codex.configCalls).toEqual([
      { sessionId: "codex-session", configId: "model", value: "opus" },
      { sessionId: "codex-session", configId: "effort", value: "high" },
    ])
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([
      modelOption("opus"),
      effortOption("high", ["low", "high"]),
    ])
    await controller.dispose()
  })

  it("applies a valid effort-only default when the provider advertises no model option", async () => {
    const config = { ...APP_CONFIG, providerDefaults: { codex: { effort: "high" } } }
    const { controller, connections } = await controllerWithStubs(
      {
        codex: {
          newSessionConfig: [effortOption("low")],
          setConfig: (_sessionId, _configId, value) => [effortOption(value)],
        },
      },
      { config },
    )

    expect(await controller.actions.applyProviderDefaults("codex")).toEqual({ kind: "applied", effort: "high" })
    expect(connections.codex.configCalls).toEqual([
      { sessionId: "codex-session", configId: "effort", value: "high" },
    ])
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([effortOption("high")])
    await controller.dispose()
  })

  it("keeps the confirmed model and reports partial when refreshed effort is unavailable", async () => {
    const config = { ...APP_CONFIG, providerDefaults: { codex: { model: "opus", effort: "high" } } }
    const { controller, connections } = await controllerWithStubs(
      {
        codex: {
          newSessionConfig: [modelOption("sonnet"), effortOption("low")],
          setConfig: () => [modelOption("opus"), effortOption("low", ["low"])],
        },
      },
      { config },
    )

    expect(await controller.actions.applyProviderDefaults("codex")).toEqual({
      kind: "partial",
      model: "opus",
      unavailable: "effort",
    })
    expect(connections.codex.configCalls).toEqual([
      { sessionId: "codex-session", configId: "model", value: "opus" },
    ])
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([
      modelOption("opus"),
      effortOption("low", ["low"]),
    ])
    await controller.dispose()
  })

  it("does not roll back or substitute when the effort request is rejected", async () => {
    const config = { ...APP_CONFIG, providerDefaults: { codex: { model: "opus", effort: "high" } } }
    const { controller, connections } = await controllerWithStubs(
      {
        codex: {
          newSessionConfig: [modelOption("sonnet"), effortOption("low")],
          setConfig: (_sessionId, configId) => configId === "model"
            ? [modelOption("opus"), effortOption("low")]
            : [modelOption("opus"), effortOption("low")],
        },
      },
      { config },
    )

    expect(await controller.actions.applyProviderDefaults("codex")).toEqual({
      kind: "partial",
      model: "opus",
      unavailable: "effort",
    })
    expect(connections.codex.configCalls).toHaveLength(2)
    expect(connections.codex.configCalls.filter((call) => call.configId === "model")).toHaveLength(1)
    expect(controller.store.getState().sessions.codex!.configOptions).toEqual([
      modelOption("opus"),
      effortOption("low"),
    ])
    await controller.dispose()
  })

  it("fails softly for a not-ready session and a model transport failure", async () => {
    const config = { ...APP_CONFIG, providerDefaults: { "claude-code": { model: "opus" }, codex: { model: "opus" } } }
    const errors: Array<[SessionId, unknown]> = []
    const { controller } = await controllerWithStubs(
      {
        "claude-code": { ready: { ready: false, error: "down" } },
        codex: { newSessionConfig: [modelOption("sonnet")], setConfigThrows: new Error("transport secret") },
      },
      { config, onError: (sessionId, error) => errors.push([sessionId, error]) },
    )

    expect(await controller.actions.applyProviderDefaults("claude-code")).toEqual({
      kind: "unavailable",
      unavailable: "session",
    })
    expect(await controller.actions.applyProviderDefaults("codex")).toEqual({
      kind: "unavailable",
      unavailable: "model",
    })
    expect(errors).toEqual([["codex", new Error("transport secret")]])
    await controller.dispose()
  })

  it("replaces the snapshot without mutating a session and uses it on the next explicit attempt", async () => {
    const config = { ...APP_CONFIG, providerDefaults: { codex: { model: "opus" } } }
    const { controller, connections } = await controllerWithStubs(
      {
        codex: {
          newSessionConfig: [modelOption("opus")],
          setConfig: (_sessionId, _configId, value) => [modelOption(value)],
        },
      },
      { config },
    )
    const before = controller.store.getState().sessions.codex

    controller.updateProviderDefaults({ codex: { model: "sonnet" } })

    expect(controller.store.getState().sessions.codex).toBe(before)
    expect(connections.codex.configCalls).toEqual([])
    expect(await controller.actions.applyProviderDefaults("codex")).toEqual({ kind: "applied", model: "sonnet" })
    expect(connections.codex.configCalls).toEqual([
      { sessionId: "codex-session", configId: "model", value: "sonnet" },
    ])
    await controller.dispose()
  })

  it("shares a provider default but targets only the addressed duplicate-provider runtime", async () => {
    const config: AppConfig = {
      ...THREE_SESSION_CONFIG,
      providerDefaults: { "claude-code": { model: "opus" } },
    }
    const { controller, created } = await controllerOverFleet(config, () => ({
      newSessionConfig: [modelOption("sonnet")],
      setConfig: (_sessionId, _configId, value) => [modelOption(value)],
    }))

    expect(await controller.actions.applyProviderDefaults("claude-code-2")).toEqual({
      kind: "applied",
      model: "opus",
    })
    expect(created[0]!.configCalls).toEqual([])
    expect(created[1]!.configCalls).toEqual([
      { sessionId: "acp-1", configId: "model", value: "opus" },
    ])
    expect(created[2]!.configCalls).toEqual([])
    await controller.dispose()
  })
})

describe("actions - switchFocus", () => {
  it("Should move focus and leave both sessions live and addressable", async () => {
    const { controller, connections } = await controllerWithStubs()
    const before = controller.store.getState().sessions

    controller.actions.switchFocus("codex")

    const state = controller.store.getState()
    expect(state.workspace.selectedVisibleId).toBe("codex")
    expect(state.sessions["claude-code"]).toBe(before["claude-code"])
    expect(state.sessions["claude-code"]!.acpSessionId).toBe("claude-code-session")
    expect(state.sessions.codex!.acpSessionId).toBe("codex-session")

    // Both connections still accept work after the switch.
    await controller.actions.sendPrompt("now you")
    await controller.actions.sendPrompt("and you", "claude-code")
    expect(connections.codex.prompts).toHaveLength(1)
    expect(connections["claude-code"].prompts).toHaveLength(1)

    await controller.dispose()
  })

  it("Should cycle to the next agent when called without a target", async () => {
    const { controller } = await controllerWithStubs()

    controller.actions.switchFocus()
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    controller.actions.switchFocus()
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    await controller.dispose()
  })

  it("Should re-read the focused session branch and store the changed value", async () => {
    let branch = "main"
    let readCount = 0
    const { controller } = await controllerWithStubs({}, {
      readBranch: async () => {
        readCount += 1
        return branch
      },
    })
    await waitFor(
      () => controller.store.getState().sessions.codex?.branch === "main" && readCount === 2,
      "both boot branch reads",
    )

    branch = "feature/focus-refresh"
    controller.actions.switchFocus("codex")

    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    await waitFor(
      () => controller.store.getState().sessions.codex?.branch === "feature/focus-refresh",
      "focus-switch branch refresh",
    )
    expect(readCount).toBe(3)
    expect(controller.store.getState().sessions["claude-code"]!.branch).toBe("main")

    await controller.dispose()
  })

  it("Should hide a previously stored branch when a focus refresh returns null", async () => {
    let readCount = 0
    const { controller } = await controllerWithStubs({}, {
      readBranch: async () => {
        readCount += 1
        return readCount <= 2 ? "main" : null
      },
    })
    await waitFor(
      () => controller.store.getState().sessions.codex?.branch === "main" && readCount === 2,
      "both boot branch reads",
    )

    controller.actions.switchFocus("codex")

    await waitFor(
      () => readCount === 3 && controller.store.getState().sessions.codex?.branch === undefined,
      "null focus refresh to hide the branch",
    )

    await controller.dispose()
  })
})

describe("actions - respondPermission", () => {
  it("Should open the approval overlay with the requesting agent's request", async () => {
    const { controller, connections } = await controllerWithStubs()

    const pending = connections["claude-code"].ask(PERMISSION_REQUEST)

    expect(controller.store.getState().overlays.approval).toEqual({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: CWD,
      request: PERMISSION_REQUEST,
    })

    controller.actions.respondPermission({ outcome: "cancelled" })
    await pending
    await controller.dispose()
  })

  it("Should resolve the pending request with the chosen outcome and close the overlay", async () => {
    const { controller, connections } = await controllerWithStubs()

    const pending = connections["claude-code"].ask(PERMISSION_REQUEST)
    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })

    expect(await pending).toEqual({ outcome: "selected", optionId: "allow" })
    expect(controller.store.getState().overlays.approval).toBeNull()

    await controller.dispose()
  })

  it("Should queue a concurrent request behind the one on screen", async () => {
    const { controller, connections } = await controllerWithStubs()

    const first = connections["claude-code"].ask(PERMISSION_REQUEST)
    const second = connections.codex.ask({ ...PERMISSION_REQUEST, sessionId: "codex-session" })

    expect(controller.store.getState().overlays.approval?.sessionId).toBe("claude-code")

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    expect(await first).toEqual({ outcome: "selected", optionId: "allow" })
    expect(controller.store.getState().overlays.approval?.sessionId).toBe("codex")

    controller.actions.respondPermission({ outcome: "cancelled" })
    expect(await second).toEqual({ outcome: "cancelled" })
    expect(controller.store.getState().overlays.approval).toBeNull()

    await controller.dispose()
  })

  it("Should ignore a response when nothing is pending", async () => {
    const { controller } = await controllerWithStubs()

    controller.actions.respondPermission({ outcome: "cancelled" })
    expect(controller.store.getState().overlays.approval).toBeNull()

    await controller.dispose()
  })

  it("cancels a disconnected generation and advances a sibling permission", async () => {
    const { controller, connections } = await controllerWithStubs()
    const disconnected = connections["claude-code"].ask(PERMISSION_REQUEST)
    const sibling = connections.codex.ask({ ...PERMISSION_REQUEST, sessionId: "codex-session" })

    connections["claude-code"].emit({ kind: "status", status: "error" })

    expect(await disconnected).toEqual({ outcome: "cancelled" })
    expect(controller.store.getState().overlays.approval?.sessionId).toBe("codex")
    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    expect(await sibling).toEqual({ outcome: "selected", optionId: "allow" })

    await controller.dispose()
  })

  it("Should settle only the answered same-provider session and keep the other's request pending (task_07)", async () => {
    const { controller, created } = await controllerOverFleet(THREE_SESSION_CONFIG)

    // The two claude-code sessions - identical provider, distinct identity - both ask.
    let betaSettled = false
    const askAlpha = created[0]!.ask(PERMISSION_REQUEST)
    const askBeta = created[1]!.ask(PERMISSION_REQUEST).then((outcome) => {
      betaSettled = true
      return outcome
    })

    // Alpha is on screen, labeled unmistakably as itself and not its same-provider sibling.
    expect(controller.store.getState().overlays.approval).toMatchObject({
      sessionId: "claude-code",
      title: "Alpha",
      cwd: FLEET_DIRS.alpha,
    })

    // Answering Alpha settles Alpha alone.
    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    expect(await askAlpha).toEqual({ outcome: "selected", optionId: "allow" })

    // Beta's request was never auto-approved by Alpha's decision: it is still waiting on
    // its own explicit answer, and it - not Alpha - now owns the slot.
    await Bun.sleep(1)
    expect(betaSettled).toBe(false)
    expect(controller.store.getState().overlays.approval).toMatchObject({
      sessionId: "claude-code-2",
      title: "Beta",
      cwd: FLEET_DIRS.beta,
    })

    controller.actions.respondPermission({ outcome: "cancelled" })
    expect(await askBeta).toEqual({ outcome: "cancelled" })

    await controller.dispose()
  })
})

describe("actions - respondClarification", () => {
  it("contains resolver failures instead of throwing into the UI", () => {
    const actions = createControllerActions({
      store: createAppStore(),
      getSession: () => undefined,
      resolvePermission: () => {},
      resolveClarification: () => {
        throw new Error("stale resolver")
      },
    })

    expect(() => actions.respondClarification("request-1", 1, { kind: "cancelled" })).not.toThrow()
  })

  it("projects session attribution and preserves a suspended approval by reference", async () => {
    const ids = ["permission-1", "clarification-1"]
    const { controller, connections } = await controllerWithStubs({}, {
      newInteractionId: () => ids.shift()!,
    })
    const permission = connections["claude-code"].ask(PERMISSION_REQUEST)
    const approval = controller.store.getState().overlays.approval

    const clarification = connections.codex.clarify(CLARIFICATION_PAYLOAD)
    const projected = controller.store.getState().overlays.clarification

    expect(projected).toEqual({
      requestId: "clarification-1",
      generation: 1,
      sessionId: "codex",
      title: "Codex",
      cwd: CWD,
      payload: CLARIFICATION_PAYLOAD,
    })
    expect(controller.store.getState().overlays.approval).toBe(approval)
    expect(controller.store.getState().sessions.codex?.status).toBe("awaiting_clarification")

    const answer: ClarificationOutcome = {
      kind: "submitted",
      answers: { boundary: { selectedOptionIds: ["controller"] } },
    }
    controller.actions.respondClarification(projected!.requestId, projected!.generation, answer)

    expect(await clarification).toEqual(answer)
    expect(controller.store.getState().overlays.clarification).toBeNull()
    expect(controller.store.getState().overlays.approval).toBe(approval)
    expect(controller.store.getState().sessions.codex?.status).toBe("working")
    expect(controller.store.getState().sessions["claude-code"]?.status).toBe("awaiting_approval")

    controller.actions.respondPermission({ outcome: "cancelled" })
    expect(await permission).toEqual({ outcome: "cancelled" })
    await controller.dispose()
  })

  it("starts the fixed timeout at acceptance and isolates a suspended request from its active sibling", async () => {
    const scheduled: Array<{ callback: () => void; timeoutMs: number; cancelled: boolean }> = []
    const { controller, connections } = await controllerWithStubs({}, {
      newInteractionId: (() => {
        const ids = ["permission-1", "clarification-1", "clarification-2"]
        return () => ids.shift()!
      })(),
      scheduleClarificationTimeout(callback, timeoutMs) {
        const timeout = { callback, timeoutMs, cancelled: false }
        scheduled.push(timeout)
        return () => {
          timeout.cancelled = true
        }
      },
    })
    const permission = connections["claude-code"].ask(PERMISSION_REQUEST)
    const first = connections["claude-code"].clarify(CLARIFICATION_PAYLOAD)
    const second = connections.codex.clarify({
      ...CLARIFICATION_PAYLOAD,
      prompt: "Choose the test boundary",
    })

    expect(scheduled.map((timeout) => timeout.timeoutMs)).toEqual([300_000, 300_000])
    expect(controller.store.getState().overlays.clarification?.requestId).toBe("clarification-2")

    scheduled[0]!.callback()
    expect(await first).toEqual({ kind: "timed_out" })
    expect(scheduled[0]!.cancelled).toBe(true)
    expect(controller.store.getState().overlays.clarification?.requestId).toBe("clarification-2")

    const active = controller.store.getState().overlays.clarification!
    controller.actions.respondClarification(active.requestId, active.generation, { kind: "skipped" })
    expect(await second).toEqual({ kind: "skipped" })
    expect(scheduled[1]!.cancelled).toBe(true)
    expect(controller.store.getState().overlays.approval?.sessionId).toBe("claude-code")

    controller.actions.respondPermission({ outcome: "cancelled" })
    expect(await permission).toEqual({ outcome: "cancelled" })
    await controller.dispose()
  })

  it("cancels clarifications once on replacement, close, provider error, and disposal", async () => {
    const lifecycleCases: Array<{
      name: string
      end: (controller: SessionController, connection: StubConnection) => Promise<void> | void
    }> = [
      {
        name: "session replacement",
        end: async (controller) => {
          await controller.restore(persistedRun())
        },
      },
      {
        name: "conversation close",
        end: async (controller) => {
          expect(await controller.closeConversation("claude-code", "cancel")).toEqual({ outcome: "closed" })
        },
      },
      {
        name: "provider error",
        end: (_controller, connection) => {
          connection.emit({ kind: "status", status: "error" })
        },
      },
      {
        name: "controller disposal",
        end: async (controller) => {
          await controller.dispose()
        },
      },
    ]

    for (const lifecycle of lifecycleCases) {
      let timeoutCallback: (() => void) | undefined
      let timeoutCancellations = 0
      let settlements = 0
      const { controller, connections } = await controllerWithStubs({}, {
        newInteractionId: () => `clarification-${lifecycle.name}`,
        scheduleClarificationTimeout(callback) {
          timeoutCallback = callback
          return () => {
            timeoutCancellations += 1
          }
        },
      })
      const pending = connections["claude-code"].clarify(CLARIFICATION_PAYLOAD).then((outcome) => {
        settlements += 1
        return outcome
      })

      await lifecycle.end(controller, connections["claude-code"])
      expect(await pending).toEqual({ kind: "cancelled" })
      expect(settlements).toBe(1)
      expect(timeoutCancellations).toBe(1)

      timeoutCallback?.()
      await Bun.sleep(0)
      expect(settlements).toBe(1)
      await controller.dispose()
    }
  })

  it("ignores wrong and duplicate responses without settling the resumed request", async () => {
    const ids = ["clarification-1", "clarification-2"]
    const { controller, connections } = await controllerWithStubs({}, {
      newInteractionId: () => ids.shift()!,
    })
    let firstSettled = false
    const first = connections["claude-code"].clarify(CLARIFICATION_PAYLOAD).then((outcome) => {
      firstSettled = true
      return outcome
    })
    const secondPayload = { ...CLARIFICATION_PAYLOAD, prompt: "Choose the test boundary" }
    const second = connections.codex.clarify(secondPayload)
    const active = controller.store.getState().overlays.clarification!
    const secondAnswer: ClarificationOutcome = {
      kind: "submitted",
      answers: { boundary: { selectedOptionIds: ["store"] } },
    }

    controller.actions.respondClarification("missing", active.generation, secondAnswer)
    controller.actions.respondClarification(active.requestId, active.generation + 1, secondAnswer)
    expect(controller.store.getState().overlays.clarification).toBe(active)

    controller.actions.respondClarification(active.requestId, active.generation, secondAnswer)
    expect(await second).toEqual(secondAnswer)
    expect(controller.store.getState().overlays.clarification).toMatchObject({
      requestId: "clarification-1",
      sessionId: "claude-code",
      payload: CLARIFICATION_PAYLOAD,
    })

    controller.actions.respondClarification(active.requestId, active.generation, { kind: "cancelled" })
    await Bun.sleep(0)
    expect(firstSettled).toBe(false)
    expect(controller.store.getState().overlays.clarification?.requestId).toBe("clarification-1")

    const resumed = controller.store.getState().overlays.clarification!
    controller.actions.respondClarification(resumed.requestId, resumed.generation, { kind: "cancelled" })
    expect(await first).toEqual({ kind: "cancelled" })
    expect(controller.store.getState().overlays.clarification).toBeNull()
    await controller.dispose()
  })

  it("publishes the resolved capability for every configured session", async () => {
    const { controller } = await controllerWithStubs()

    expect(controller.store.getState().clarificationCapabilities).toEqual({
      "claude-code": { status: "unsupported", reason: "unknown_recipe" },
      codex: { status: "unsupported", reason: "unknown_recipe" },
    })

    await controller.dispose()
  })

  it("emits one ordered content-free lifecycle from projection through settlement", async () => {
    const records: TelemetryRecord[] = []
    let now = 1_000
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => now,
      sessionRef: "run-fixed",
    })
    const ids = ["permission-private", "clarification-private"]
    const { controller, connections } = await controllerWithStubs({}, {
      recorder,
      newInteractionId: () => ids.shift()!,
    })
    const permission = connections["claude-code"].ask(PERMISSION_REQUEST)
    const mixedPayload: ClarificationPayload = {
      prompt: "secret prompt",
      fields: [
        ...CLARIFICATION_PAYLOAD.fields,
        {
          id: "compatible",
          label: "secret options",
          mode: "multi",
          allowsCustom: false,
          required: false,
          options: [{ id: "yes", label: "secret selected value" }],
        },
        {
          id: "details",
          label: "secret answer",
          mode: "text",
          required: false,
        },
      ],
    }

    const clarification = connections.codex.clarify(mixedPayload)
    const overlay = controller.store.getState().overlays.clarification!
    now += 8_000
    controller.actions.respondClarification(overlay.requestId, overlay.generation, {
      kind: "submitted",
      answers: {
        boundary: { selectedOptionIds: ["controller"] },
        compatible: { selectedOptionIds: ["yes"] },
        details: { selectedOptionIds: [], customText: "private text" },
      },
    })

    expect(await clarification).toEqual({
      kind: "submitted",
      answers: {
        boundary: { selectedOptionIds: ["controller"] },
        compatible: { selectedOptionIds: ["yes"] },
        details: { selectedOptionIds: [], customText: "private text" },
      },
    })
    const lifecycle = records.filter((record) => record.type.startsWith("clarification_"))
    expect(lifecycle.map((record) => record.type)).toEqual([
      "clarification_capability_classified",
      "clarification_capability_classified",
      "clarification_preempted",
      "clarification_presented",
      "clarification_settled",
      "clarification_resumed",
    ])
    expect(lifecycle.find((record) => record.type === "clarification_presented")).toMatchObject({
      capability: "unsupported",
      focused: false,
    })
    expect(lifecycle.find((record) => record.type === "clarification_settled")).toMatchObject({
      terminalKind: "submitted",
      durationBucket: "5_to_30s",
    })
    const serialized = JSON.stringify(lifecycle)
    expect(serialized).not.toContain("secret prompt")
    expect(serialized).not.toContain("secret options")
    expect(serialized).not.toContain("private text")
    expect(serialized).not.toContain(CWD)

    controller.actions.respondPermission({ outcome: "cancelled" })
    expect(await permission).toEqual({ outcome: "cancelled" })
    await controller.dispose()
  })

  it("records session-loss cancellation and terminal settlement exactly once", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 1_000,
      sessionRef: "run-fixed",
    })
    const { controller, connections } = await controllerWithStubs({}, {
      recorder,
      newInteractionId: () => "clarification-loss",
    })
    const clarification = connections.codex.clarify(CLARIFICATION_PAYLOAD)

    await controller.dispose()
    await controller.dispose()

    expect(await clarification).toEqual({ kind: "cancelled" })
    expect(records.filter((record) => record.type === "clarification_session_loss_cancelled")).toEqual([
      expect.objectContaining({ lossReason: "controller_disposed" }),
    ])
    expect(records.filter((record) => record.type === "clarification_settled")).toEqual([
      expect.objectContaining({ terminalKind: "cancelled", durationBucket: "under_5s" }),
    ])
  })
})

describe("createSessionController - per-conversation close", () => {
  it("closes one idle conversation only after its runtime is disposed and selects the next visible sibling", async () => {
    const { controller, connections } = await controllerWithStubs()
    const siblingBefore = controller.store.getState().sessions.codex

    const result = await controller.closeConversation("claude-code", "close")

    expect(result).toEqual({ outcome: "closed" })
    expect(connections["claude-code"].isDisposed()).toBe(true)
    expect(connections.codex.isDisposed()).toBe(false)
    expect(controller.store.getState().sessions["claude-code"]).toBeUndefined()
    expect(controller.store.getState().sessions.codex).toBe(siblingBefore)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

    await controller.dispose()
  })

  it("backgrounds or keeps active work open without touching ACP or subscriptions", async () => {
    const { controller, connections } = await controllerWithStubs()
    const target = connections["claude-code"]
    target.emit({ kind: "status", status: "working" })

    expect(await controller.closeConversation("claude-code", "background")).toEqual({
      outcome: "backgrounded",
    })
    expect(controller.store.getState().workspace.conversations["claude-code"]?.lifecycle).toBe("background")
    expect(target.cancels).toEqual([])
    expect(target.disposeCalls()).toBe(0)
    expect(target.subscriberCount()).toBe(1)

    controller.store.reopenConversation("claude-code")
    expect(await controller.closeConversation("claude-code", "keep-open")).toEqual({
      outcome: "kept-open",
    })
    expect(controller.store.getState().workspace.conversations["claude-code"]?.lifecycle).toBe("visible")
    expect(target.cancels).toEqual([])
    expect(target.disposeCalls()).toBe(0)
    expect(target.subscriberCount()).toBe(1)

    await controller.dispose()
  })

  it("rejects a direct active close and an idle deliberate-cancel outcome without side effects", async () => {
    const { controller, connections } = await controllerWithStubs()
    const target = connections["claude-code"]
    target.emit({ kind: "status", status: "working" })

    expect(await controller.closeConversation("claude-code", "close")).toEqual({ outcome: "ignored" })
    target.emit({ kind: "status", status: "idle" })
    expect(await controller.closeConversation("claude-code", "cancel")).toEqual({ outcome: "ignored" })

    expect(controller.store.getState().sessions["claude-code"]).toBeDefined()
    expect(controller.store.getState().workspace.conversations["claude-code"]).toMatchObject({
      lifecycle: "visible",
      teardownState: "open",
    })
    expect(target.cancels).toEqual([])
    expect(target.disposeCalls()).toBe(0)

    await controller.dispose()
  })

  it.each([
    ["working", "working", true],
    ["awaiting approval", "awaiting_approval", true],
    ["error", "error", false],
    ["finished", "finished", false],
  ] as const)("deliberately closes %s work with only the required targeted cancellation", async (_name, status, shouldCancel) => {
    const { controller, connections } = await controllerWithStubs()
    const target = connections["claude-code"]
    target.emit({ kind: "status", status })

    expect(await controller.closeConversation("claude-code", "cancel")).toEqual({ outcome: "closed" })
    expect(target.cancels).toEqual(shouldCancel ? ["claude-code-session"] : [])
    expect(target.disposeCalls()).toBe(1)
    expect(connections.codex.disposeCalls()).toBe(0)

    await controller.dispose()
  })

  it("shares one in-flight close promise and performs cancellation and disposal at most once", async () => {
    const disposal = deferred()
    const { controller, connections } = await controllerWithStubs({
      "claude-code": { disposeWait: disposal.promise },
    })
    const target = connections["claude-code"]
    target.emit({ kind: "status", status: "working" })

    const first = controller.closeConversation("claude-code", "cancel")
    const second = controller.closeConversation("claude-code", "cancel")

    expect(second).toBe(first)
    expect(controller.store.getState().workspace.conversations["claude-code"]).toMatchObject({
      lifecycle: "visible",
      teardownState: "closing",
    })
    expect(controller.store.getState().sessions["claude-code"]).toBeDefined()
    expect(target.cancels).toEqual(["claude-code-session"])
    await waitFor(() => target.disposeCalls() === 1, "the targeted runtime disposal to begin")
    expect(target.disposeCalls()).toBe(1)

    disposal.resolve()
    expect(await first).toEqual({ outcome: "closed" })
    expect(target.cancels).toHaveLength(1)
    expect(target.disposeCalls()).toBe(1)

    await controller.dispose()
  })

  it("retains a visible conversation as retryable unavailable when targeted cancellation fails", async () => {
    const errors: Array<{ sessionId: SessionId; error: unknown }> = []
    const { controller, connections } = await controllerWithStubs(
      { "claude-code": { cancelThrows: new Error("cancel failed") } },
      { onError: (sessionId, error) => errors.push({ sessionId, error }) },
    )
    const target = connections["claude-code"]
    const siblingBefore = controller.store.getState().sessions.codex
    target.emit({ kind: "status", status: "working" })

    expect(await controller.closeConversation("claude-code", "cancel")).toEqual({
      outcome: "teardown-failed",
    })
    expect(controller.store.getState().workspace.conversations["claude-code"]).toMatchObject({
      lifecycle: "visible",
      teardownState: "open",
      availability: { kind: "unavailable", reasonCode: "teardown-failed", retryable: true },
    })
    expect(controller.store.getState().sessions["claude-code"]?.status).toBe("working")
    expect(controller.store.getState().sessions.codex).toBe(siblingBefore)
    expect(target.disposeCalls()).toBe(0)
    expect(errors.map(({ sessionId }) => sessionId)).toEqual(["claude-code"])

    target.emit({ kind: "agent_message", messageId: "late", textDelta: "ignored" })
    expect(controller.store.getState().sessions["claude-code"]?.turns).toEqual([])
    await controller.actions.sendPrompt("sibling remains usable", "codex")
    expect(connections.codex.prompts).toHaveLength(1)

    await controller.dispose()
  })

  it("retains a background conversation and ignores late events when disposal fails", async () => {
    const { controller, connections } = await controllerWithStubs({
      "claude-code": { disposeThrows: new Error("dispose failed") },
    })
    const target = connections["claude-code"]
    controller.store.backgroundConversation("claude-code")

    expect(await controller.closeConversation("claude-code", "close")).toEqual({
      outcome: "teardown-failed",
    })
    expect(controller.store.getState().workspace.conversations["claude-code"]).toMatchObject({
      lifecycle: "background",
      teardownState: "open",
      availability: { kind: "unavailable", reasonCode: "teardown-failed", retryable: true },
    })
    expect(controller.store.getState().sessions["claude-code"]).toBeDefined()
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    expect(target.subscriberCount()).toBe(0)

    target.emit({ kind: "agent_message", messageId: "late", textDelta: "ignored" })
    expect(controller.store.getState().sessions["claude-code"]?.turns).toEqual([])

    await controller.dispose()
  })

  it("settles only owned queued permissions and advances sibling requests in FIFO order", async () => {
    const { controller, created } = await controllerOverFleet(THREE_SESSION_CONFIG)
    created[0]!.emit({ kind: "status", status: "awaiting_approval" })
    const alphaVisible = created[0]!.ask({ ...PERMISSION_REQUEST, sessionId: "alpha-visible" })
    const betaQueued = created[1]!.ask({ ...PERMISSION_REQUEST, sessionId: "beta-queued" })
    const alphaQueued = created[0]!.ask({ ...PERMISSION_REQUEST, sessionId: "alpha-queued" })

    expect(controller.store.getState().overlays.approval?.sessionId).toBe("claude-code")
    expect(await controller.closeConversation("claude-code", "cancel")).toEqual({ outcome: "closed" })
    expect(await alphaVisible).toEqual({ outcome: "cancelled" })
    expect(await alphaQueued).toEqual({ outcome: "cancelled" })
    expect(controller.store.getState().overlays.approval?.sessionId).toBe("claude-code-2")
    expect(created[1]!.isDisposed()).toBe(false)

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    expect(await betaQueued).toEqual({ outcome: "selected", optionId: "allow" })
    expect(controller.store.getState().overlays.approval).toBeNull()

    expect(await created[0]!.ask(PERMISSION_REQUEST)).toEqual({ outcome: "cancelled" })
    created[0]!.emit({ kind: "agent_message", messageId: "late", textDelta: "ignored" })
    expect(controller.store.getState().sessions["claude-code-2"]?.turns).toEqual([])

    await controller.dispose()
  })
})

describe("createSessionController - route-authorized agent runs", () => {
  it("records only settled operation outcomes, bounded sizes, and controller duration", async () => {
    const bridge = createRecordingBridge()
    const records: TelemetryRecord[] = []
    const privateSentinel = "TASK:OUTCOME:CHILD:PARENT:CAPABILITY:ENDPOINT:/private/path:PROMPT:TRANSCRIPT:RAW_ERROR:STATUS"
    const ids = [`${privateSentinel}-one`, `${privateSentinel}-two`]
    let controlNow = 1_000
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 77,
      sessionRef: "anonymous-agent-run",
    })
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => createStubConnection(config.id),
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      now: () => controlNow,
      recorder,
      sendInitialTasks: false,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner({
        provision: async (input) => {
          controlNow += 75
          return { kind: "provisioned", binding: testManagedWorktreeBinding(input.ownerSessionId) }
        },
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const route = recordedAgentRunRoute(bridge, parentId)
    const control = bridge.agentRunControl()
    const tasks = [
      { task: `${privateSentinel}-task-one`, desiredOutcome: `${privateSentinel}-outcome-one` },
      { task: `${privateSentinel}-task-two`, desiredOutcome: `${privateSentinel}-outcome-two` },
    ]

    const snapshots = await control.start(route, tasks)
    expect(control.poll(route, snapshots.map((snapshot) => snapshot.childId))).toHaveLength(2)
    await expect(control.start(route, [])).rejects.toThrow()
    expect(() => control.poll({ ...route, parentGeneration: route.parentGeneration + 1 }, [snapshots[0]!.childId])).toThrow()

    const agentRunRecords = records.filter((record) => record.type === "agent_run_control")
    expect(agentRunRecords).toEqual([
      expect.objectContaining({
        operation: "start",
        outcome: "accepted",
        batchSizeBucket: "two",
        durationBucket: "100_to_499ms",
      }),
      expect.objectContaining({
        operation: "poll",
        outcome: "accepted",
        batchSizeBucket: "two",
        durationBucket: "under_100ms",
      }),
      expect.objectContaining({
        operation: "start",
        outcome: "rejected",
        batchSizeBucket: "zero",
        durationBucket: "under_100ms",
      }),
      expect.objectContaining({
        operation: "poll",
        outcome: "unavailable",
        batchSizeBucket: "one",
        durationBucket: "under_100ms",
      }),
    ])
    const allowed = new Set([
      "type", "at", "sessionRef", "operation", "outcome", "batchSizeBucket", "durationBucket",
    ])
    expect(agentRunRecords.every((record) => Object.keys(record).every((key) => allowed.has(key)))).toBe(true)
    expect(JSON.stringify(agentRunRecords)).not.toContain(privateSentinel)
    await controller.dispose()
  })

  it("rejects invalid batches and stale routes before allocating any child-side effect", async () => {
    const bridge = createRecordingBridge()
    const created: StubConnection[] = []
    let childIdsRequested = 0
    let provisions = 0
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id)
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => {
        childIdsRequested += 1
        return `invalid-child-${childIdsRequested}`
      },
      sendInitialTasks: false,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner({
        provision: async (input) => {
          provisions += 1
          return { kind: "provisioned", binding: testManagedWorktreeBinding(input.ownerSessionId) }
        },
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const route = recordedAgentRunRoute(bridge, parentId)
    const control = bridge.agentRunControl()
    const initialConnections = created.length
    const initialRegistrations = bridge.registrations.length
    const before = controller.store.getState()
    const validTask = { task: "Inspect", desiredOutcome: "Report" }

    for (const attempt of [
      control.start(route, []),
      control.start(route, Array.from({ length: 5 }, (_, index) => ({
        task: `Task ${index}`,
        desiredOutcome: `Outcome ${index}`,
      }))),
      control.start(route, [validTask, { ...validTask }]),
      control.start(route, [{ task: "   ", desiredOutcome: "Report" }]),
      control.start({ ...route, parentGeneration: route.parentGeneration + 1 }, [validTask]),
    ]) {
      await expect(attempt).rejects.toBeInstanceOf(Error)
    }

    expect(childIdsRequested).toBe(0)
    expect(provisions).toBe(0)
    expect(created).toHaveLength(initialConnections)
    expect(bridge.registrations).toHaveLength(initialRegistrations)
    expect(controller.store.getState()).toBe(before)
    expect(created.flatMap((connection) => connection.prompts)).toEqual([])
    await controller.dispose()
  })

  it("rejects unready, recursive, and closing route parents without extending child state", async () => {
    const unreadyBridge = createRecordingBridge()
    let unreadyIds = 0
    const unreadyController = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => createStubConnection(config.id, config.id === "claude-code"
        ? { ready: { ready: false, reason: "authentication_required", error: "not ready" } }
        : {}),
      createKittenMcpBridge: unreadyBridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => `unready-child-${++unreadyIds}`,
      sendInitialTasks: false,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    await expect(unreadyBridge.agentRunControl().start(
      { parentId: "claude-code", parentGeneration: 1 },
      [{ task: "Reject", desiredOutcome: "No child" }],
    )).rejects.toThrow()
    expect(unreadyIds).toBe(0)
    await unreadyController.dispose()

    const bridge = createRecordingBridge()
    const ids = ["accepted-child", "must-not-exist"]
    let requestedIds = 0
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => createStubConnection(config.id),
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids[requestedIds++]!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const control = bridge.agentRunControl()
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const parentRoute = recordedAgentRunRoute(bridge, parentId)
    await control.start(parentRoute, [{ task: "Accepted", desiredOutcome: "Visible" }])
    const baseline = controller.store.getState()

    await expect(control.start(
      recordedAgentRunRoute(bridge, "accepted-child"),
      [{ task: "Nested", desiredOutcome: "Rejected" }],
    )).rejects.toThrow()
    controller.store.markDelegationParentClosing(parentId, parentRoute.parentGeneration)
    const closingState = controller.store.getState()
    await expect(control.start(
      parentRoute,
      [{ task: "Closing", desiredOutcome: "Rejected" }],
    )).rejects.toThrow()

    expect(requestedIds).toBe(1)
    expect(controller.store.getState()).toBe(closingState)
    expect(controller.store.getState().sessions["must-not-exist"]).toBeUndefined()
    expect(baseline.delegation.children["accepted-child"]).toBeDefined()
    await controller.dispose()
  })

  it("registers four visible children before starting every child concurrently", async () => {
    const bridge = createRecordingBridge()
    const startupGate = deferred()
    const childIds = ["route-child-1", "route-child-2", "route-child-3", "route-child-4"]
    const pendingIds = [...childIds]
    const created: StubConnection[] = []
    const visibleCountsAtConnection: number[] = []
    let controller!: SessionController
    controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        if (created.length >= 2) {
          visibleCountsAtConnection.push(childIds.filter((id) =>
            controller.store.getState().workspace.conversations[id] !== undefined
          ).length)
        }
        const connection = createStubConnection(config.id, created.length >= 2
          ? { newSessionWait: startupGate.promise }
          : {})
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => pendingIds.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const control = bridge.agentRunControl()
    const route = recordedAgentRunRoute(bridge, parentId)
    const launch = control.start(
      route,
      childIds.map((_, index) => ({ task: `Task ${index}`, desiredOutcome: `Outcome ${index}` })),
    )

    await waitFor(() => created.length === 6, "all route child connections")
    await expect(control.start(
      route,
      [{ task: "Overlap", desiredOutcome: "Must report busy" }],
    )).rejects.toThrow("busy")
    expect(visibleCountsAtConnection).toEqual([4, 4, 4, 4])
    expect(childIds.map((id) => controller.store.getState().delegation.children[id]?.status)).toEqual([
      "starting",
      "starting",
      "starting",
      "starting",
    ])
    expect(controller.store.getState().workspace.selectedVisibleId).toBe(parentId)

    startupGate.resolve()
    expect(await launch).toEqual(childIds.map((childId) => ({ childId, status: "running" })))
    expect(created.slice(2).every((connection) => connection.prompts.length === 1)).toBe(true)
    await controller.dispose()
  })

  it("terminalizes startup and prompt failures per child while accepted siblings remain visible", async () => {
    const bridge = createRecordingBridge()
    const ids = ["healthy-child", "startup-failed-child", "prompt-failed-child"]
    const pendingIds = [...ids]
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const childIndex = created.length - 2
        const connection = createStubConnection(config.id,
          childIndex === 1
            ? { newSessionThrows: new Error("session start failed") }
            : childIndex === 2
              ? { promptThrows: new Error("prompt failed") }
              : {})
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => pendingIds.shift()!,
      now: () => 4242,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const snapshots = await bridge.agentRunControl().start(
      recordedAgentRunRoute(bridge, parentId),
      ids.map((id) => ({ task: id, desiredOutcome: `${id} outcome` })),
    )

    expect(snapshots).toEqual([
      { childId: "healthy-child", status: "running" },
      { childId: "startup-failed-child", status: "failed", terminalAt: 4242 },
      { childId: "prompt-failed-child", status: "running" },
    ])
    await waitFor(
      () => controller.store.getState().delegation.children["prompt-failed-child"]?.status === "failed",
      "the asynchronously rejected child prompt to terminalize",
    )
    for (const id of ids) {
      expect(controller.store.getState().workspace.conversations[id]).toBeDefined()
      expect(controller.store.getState().sessions[id]?.worktreeBinding).toMatchObject({ ownerSessionId: id })
    }
    expect(controller.store.getState().delegation.children["healthy-child"]?.terminal).toBeUndefined()
    await controller.dispose()
  })

  it("returns agent-run snapshots after dispatch rather than waiting for child turns", async () => {
    const bridge = createRecordingBridge()
    const childTurn = deferred()
    const ids = ["detached-child"]
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, created.length >= 2
          ? { promptWait: childTurn.promise }
          : {})
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const snapshots = await bridge.agentRunControl().start(
      recordedAgentRunRoute(bridge, parentId),
      [{ task: "Long-running child task", desiredOutcome: "Remain pollable" }],
    )

    expect(snapshots).toEqual([{ childId: "detached-child", status: "running" }])
    expect(created[2]!.prompts).toHaveLength(1)
    expect(bridge.agentRunControl().poll(recordedAgentRunRoute(bridge, parentId), ["detached-child"])).toEqual([
      { childId: "detached-child", status: "running" },
    ])

    childTurn.resolve()
    await controller.dispose()
  })

  it("allows an authorized background parent without changing selection but keeps the UI guard", async () => {
    const bridge = createRecordingBridge()
    const ids = ["route-background-child", "ui-must-not-launch"]
    let childIdsRequested = 0
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => createStubConnection(config.id),
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids[childIdsRequested++]!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    controller.actions.selectConversation("codex")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

    expect(await bridge.agentRunControl().start(
      recordedAgentRunRoute(bridge, "claude-code"),
      [{ task: "Background route", desiredOutcome: "Stay background" }],
    )).toEqual([{ childId: "route-background-child", status: "running" }])
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

    expect(await controller.actions.startDelegatedChild({
      parentId: "claude-code",
      task: "Forbidden UI route",
      desiredOutcome: "No launch",
    })).toBeNull()
    expect(childIdsRequested).toBe(1)
    expect(controller.store.getState().sessions["ui-must-not-launch"]).toBeUndefined()
    await controller.dispose()
  })

  it("polls exact owned order and fails closed for every invalid identity set", async () => {
    const bridge = createRecordingBridge()
    const ids = ["claude-one", "claude-two", "codex-one"]
    const pendingIds = [...ids]
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id)
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => pendingIds.shift()!,
      now: () => 9090,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const control = bridge.agentRunControl()
    const claudeRoute = recordedAgentRunRoute(bridge, "claude-code")
    const codexRoute = recordedAgentRunRoute(bridge, "codex")
    await control.start(claudeRoute, [
      { task: "One", desiredOutcome: "One" },
      { task: "Two", desiredOutcome: "Two" },
    ])
    await control.start(codexRoute, [{ task: "Other", desiredOutcome: "Other" }])
    created[2]!.emit({ kind: "status", status: "awaiting_approval" })
    created[3]!.emit({ kind: "status", status: "finished" })

    expect(control.poll(claudeRoute, ["claude-two", "claude-one"])).toEqual([
      { childId: "claude-two", status: "finished", terminalAt: 9090 },
      { childId: "claude-one", status: "needs_input" },
    ])
    for (const childIds of [
      [],
      ["claude-one", "claude-one"],
      ["claude-one", "missing"],
      ["claude-one", "codex-one"],
    ]) {
      expect(() => control.poll(claudeRoute, childIds)).toThrow()
    }
    expect(() => control.poll(
      { ...claudeRoute, parentGeneration: claudeRoute.parentGeneration + 1 },
      ["claude-one"],
    )).toThrow()
    const staleChild = controller.store.getState().delegation.children["claude-two"]!
    controller.store.removeDelegationChild({
      parentId: staleChild.parentId,
      childId: staleChild.childId,
      parentGeneration: staleChild.parentGeneration,
      childGeneration: staleChild.childGeneration,
    })
    expect(() => control.poll(claudeRoute, ["claude-two"])).toThrow()
    await controller.dispose()
  })

  it("invalidates the prior route generation for both start and poll after parent replacement", async () => {
    const bridge = createRecordingBridge()
    const ids = ["old-generation-child", "must-not-start"]
    let childIdsRequested = 0
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => createStubConnection(config.id),
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids[childIdsRequested++]!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const oldRoute = recordedAgentRunRoute(bridge, parentId)
    const control = bridge.agentRunControl()
    await control.start(oldRoute, [{ task: "Old", desiredOutcome: "Old" }])

    await controller.actions.startFreshFromContext(undefined, parentId)
    const replacementRoute = recordedAgentRunRoute(bridge, parentId)
    expect(replacementRoute.parentGeneration).toBeGreaterThan(oldRoute.parentGeneration)
    expect(() => control.poll(oldRoute, ["old-generation-child"])).toThrow()
    await expect(control.start(oldRoute, [{ task: "Stale", desiredOutcome: "Reject" }])).rejects.toThrow()
    expect(childIdsRequested).toBe(1)
    expect(controller.store.getState().sessions["must-not-start"]).toBeUndefined()
    await controller.dispose()
  })
})

describe("createSessionController - dynamic conversation actions", () => {
  it("keeps delegated launch side effects behind successful provisioning", async () => {
    const provision = deferredValue<ProvisionManagedWorktreeResult>()
    const events: string[] = []
    const created: StubConnection[] = []
    const bridge = createRecordingBridge()
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        if (created.length >= 2) events.push("connection")
        const connection = createStubConnection(config.id)
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: (options) => {
        const live = bridge.factory(options)
        return {
          ...live,
          register(input) {
            if (input.sessionId === "transactional-child") events.push("bridge")
            return live.register(input)
          },
        }
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "transactional-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner({
        provision: async () => {
          events.push("provision")
          return await provision.promise
        },
      }),
      recorder: {
        focusSwitch() {},
        managedWorktreeRequested: () => events.push("worktree-requested"),
        managedWorktreeProvisioned: () => events.push("worktree-provisioned"),
        delegatedLaunchRequested: () => events.push("launch-requested"),
        delegatedLaunchSucceeded: () => events.push("launch-succeeded"),
      },
    })
    controller.store.subscribe((state) => {
      if (state.sessions["transactional-child"] && !events.includes("store")) events.push("store")
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const initialConnections = created.length
    const initialBridgeCount = bridge.registrations.length

    const launch = controller.actions.startDelegatedChild({
      parentId,
      task: "Wait for isolation",
      desiredOutcome: "No early side effects",
    })
    await Bun.sleep(0)

    expect(events).toEqual(["worktree-requested", "provision"])
    expect(created).toHaveLength(initialConnections)
    expect(controller.store.getState().sessions["transactional-child"]).toBeUndefined()
    expect(controller.runtime("transactional-child")).toBeUndefined()
    expect(bridge.registrations).toHaveLength(initialBridgeCount)

    const binding = testManagedWorktreeBinding("transactional-child", "transactional")
    provision.resolve({ kind: "provisioned", binding })
    expect(await launch).toBe("transactional-child")
    expect(events).toEqual([
      "worktree-requested",
      "provision",
      "worktree-provisioned",
      "store",
      "launch-requested",
      "bridge",
      "connection",
      "launch-succeeded",
    ])
    expect(created.at(-1)?.newSessionCwds).toEqual([binding.worktreePath])
    await controller.dispose()
  })

  it("returns null on provisioning failure without registering child artifacts", async () => {
    const created: StubConnection[] = []
    const records: TelemetryRecord[] = []
    const bridge = createRecordingBridge()
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id)
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "provision-failure-child",
      sendInitialTasks: false,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner({
        provision: async () => ({ kind: "failed", reason: "verification_failed" }),
      }),
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
        sessionRef: "managed-provision-failure",
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const before = controller.store.getState()
    const initialConnections = created.length
    const initialBridgeCount = bridge.registrations.length

    expect(await controller.actions.startDelegatedChild({
      parentId,
      task: "Must not start",
      desiredOutcome: "No child artifacts",
    })).toBeNull()
    expect(controller.store.getState()).toBe(before)
    expect(controller.runtime("provision-failure-child")).toBeUndefined()
    expect(created).toHaveLength(initialConnections)
    expect(bridge.registrations).toHaveLength(initialBridgeCount)
    expect(records.filter((record) => record.type.startsWith("managed_worktree_"))).toEqual([
      expect.objectContaining({ type: "managed_worktree_requested" }),
      expect.objectContaining({
        type: "managed_worktree_provision_failed",
        managedWorktreeReason: "verification_failed",
      }),
    ])
    await controller.dispose()
  })

  it("rolls back only the provisioned binding when parent ownership changes before registration", async () => {
    const provision = deferredValue<ProvisionManagedWorktreeResult>()
    const cleanupInputs: CleanupManagedWorktreeInput[] = []
    const binding = testManagedWorktreeBinding("stale-parent-child", "stale-parent")
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => createStubConnection(config.id),
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "stale-parent-child",
      sendInitialTasks: false,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner({
        provision: async () => await provision.promise,
        cleanup: async (input) => {
          cleanupInputs.push(input)
          return { kind: "removed" }
        },
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const siblingId = controller.store.getState().workspace.order.find((id) => id !== parentId)!
    const launch = controller.actions.startDelegatedChild({
      parentId,
      task: "Lose parent ownership",
      desiredOutcome: "Rollback before registration",
    })
    await Bun.sleep(0)
    controller.actions.selectConversation(siblingId)
    provision.resolve({ kind: "provisioned", binding })

    expect(await launch).toBeNull()
    expect(cleanupInputs).toEqual([{ binding, ownerTerminal: true, ownerLive: false }])
    expect(controller.store.getState().sessions["stale-parent-child"]).toBeUndefined()
    expect(controller.runtime("stale-parent-child")).toBeUndefined()
    await controller.dispose()
  })

  it("denies production explore before allocating connection, bridge, ACP, store, reservation, or prompt state", async () => {
    const created: StubConnection[] = []
    const records: TelemetryRecord[] = []
    const bridge = createRecordingBridge()
    let childIdsRequested = 0
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id)
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => {
        childIdsRequested += 1
        return "must-not-exist"
      },
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
        sessionRef: "denied-explore-run",
      }),
      sendInitialTasks: false,
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const beforeConnections = created.length
    const beforeRegistrations = bridge.registrations.length

    expect(controller.actions.exploreAvailability(parentId)).toEqual({
      kind: "denied",
      reason: "missing-attestation",
    })
    expect(await controller.actions.startExploreChild({ parentId, task: "Inspect", desiredOutcome: "Report" })).toEqual({
      kind: "denied",
      reason: "missing-attestation",
    })
    expect(childIdsRequested).toBe(0)
    expect(created).toHaveLength(beforeConnections)
    expect(bridge.registrations).toHaveLength(beforeRegistrations)
    expect(controller.store.getState().delegation).toEqual({ parents: {}, children: {} })
    expect(Object.keys(controller.store.getState().sessions)).not.toContain("must-not-exist")
    expect(created.flatMap((connection) => connection.prompts)).toEqual([])
    expect(records.filter((record) => record.type.startsWith("explore_"))).toEqual([
      expect.objectContaining({
        type: "explore_launch_denied",
        denialReason: "missing-attestation",
        count: 1,
      }),
    ])
    await controller.dispose()
  })

  it("starts an injected attested recipe with only its scoped ask-user bridge", async () => {
    const external: McpServerConfig = {
      name: "external-fixture",
      command: process.execPath,
      args: ["external"],
      env: {},
    }
    const created: Array<{ config: ResolvedAgentConfig; connection: StubConnection }> = []
    const bridge = createRecordingBridge()
    const controller = await createSessionController({
      config: { ...APP_CONFIG, mcpServers: [external] },
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id)
        created.push({ config, connection })
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "attested-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: (config) => {
        const accepted = testExploreCapability(config)
        if (accepted.status !== "supported") return accepted
        return {
          ...accepted,
          recipe: {
            ...accepted.recipe,
            command: "reviewed-restricted-child",
            args: ["--read-only"],
            env: { KITTEN_RESTRICTED: "1" },
          },
        }
      },
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!

    expect(controller.actions.exploreAvailability(parentId)).toEqual({ kind: "available" })
    expect(await controller.actions.startExploreChild({ parentId, task: "Inspect", desiredOutcome: "Report" })).toEqual({
      kind: "started",
      childId: "attested-child",
    })

    const child = created.at(-1)!
    expect(child.config).toMatchObject({
      command: "reviewed-restricted-child",
      args: ["--read-only"],
      env: { KITTEN_RESTRICTED: "1" },
    })
    expect(child.connection.newSessionMcpServers).toHaveLength(1)
    expect(child.connection.newSessionMcpServers[0]?.map((server) => server.name)).toEqual([
      ASK_USER_MCP_SERVER_NAME,
    ])
    expect(child.connection.newSessionMcpServers[0]?.[0]).toBe(bridge.declarations.at(-1))
    expect(created[0]?.connection.newSessionMcpServers[0]?.map((server) => server.name)).toEqual([
      "external-fixture",
      ASK_USER_MCP_SERVER_NAME,
    ])
    expect(controller.store.getState().delegation.children["attested-child"]?.policy?.role).toBe("explore")
    await controller.dispose()
  })

  it("retains an admitted managed child when scoped bridge provisioning fails", async () => {
    const created: StubConnection[] = []
    const records: TelemetryRecord[] = []
    const bridge = createRecordingBridge()
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id)
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: (options) => {
        const live = bridge.factory(options)
        return {
          ...live,
          register(input) {
            if (input.sessionId === "bridge-failure-child") throw new Error("bridge unavailable")
            return live.register(input)
          },
        }
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "bridge-failure-child",
      sendInitialTasks: false,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
        sessionRef: "bridge-failure-run",
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const initialConnections = created.length

    expect(await controller.actions.startExploreChild({ parentId, task: "Inspect", desiredOutcome: "Report" })).toEqual({
      kind: "denied",
      reason: "bridge-unavailable",
    })
    expect(created).toHaveLength(initialConnections)
    expect(controller.store.getState().delegation.children["bridge-failure-child"]).toMatchObject({
      status: "failed",
      terminal: { status: "failed" },
    })
    expect(controller.store.getState().sessions["bridge-failure-child"]?.worktreeBinding).toMatchObject({
      ownerSessionId: "bridge-failure-child",
      availability: "available",
    })
    expect(records.filter((record) => record.type.startsWith("explore_"))).toEqual([
      expect.objectContaining({ type: "explore_launch_eligible", count: 1 }),
      expect.objectContaining({
        type: "explore_start_failed",
        failureCategory: "bridge-unavailable",
        count: 1,
      }),
    ])
    await controller.dispose()
  })

  it("denies capacity synchronously before a second bridge or connection is created", async () => {
    const created: StubConnection[] = []
    const records: TelemetryRecord[] = []
    const bridge = createRecordingBridge()
    const ids = ["capacity-one", "capacity-two"]
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id)
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: (config) => testExploreCapability(config, { perParent: 1, global: 1 }),
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
        sessionRef: "capacity-explore-run",
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!

    expect((await controller.actions.startExploreChild({ parentId, task: "One", desiredOutcome: "One" })).kind).toBe("started")
    const connectionCount = created.length
    const bridgeCount = bridge.registrations.length
    expect(await controller.actions.startExploreChild({ parentId, task: "Two", desiredOutcome: "Two" })).toEqual({
      kind: "denied",
      reason: "capacity-exhausted",
      scope: "per-parent",
    })
    expect(created).toHaveLength(connectionCount)
    expect(bridge.registrations).toHaveLength(bridgeCount)
    expect(controller.store.getState().sessions["capacity-two"]).toBeUndefined()
    expect(records.filter((record) => record.type === "explore_capacity_denied")).toEqual([
      expect.objectContaining({ capacityScope: "per-parent", count: 1 }),
    ])
    expect(records.filter((record) =>
      record.type === "explore_launch_denied" && record.denialReason === "capacity-exhausted"
    )).toEqual([])
    await controller.dispose()
  })

  it("prevents a stale child startup generation from becoming runnable", async () => {
    const childStartup = deferred()
    const created: StubConnection[] = []
    const bridge = createRecordingBridge()
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, created.length === 2
          ? { newSessionWait: childStartup.promise }
          : {})
        created.push(connection)
        return connection
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "stale-start-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const launch = controller.actions.startExploreChild({ parentId, task: "Inspect", desiredOutcome: "Report" })
    await waitFor(() => created.length === 3, "child connection creation")

    await controller.actions.startFreshFromContext(undefined, parentId)
    childStartup.resolve()

    expect(await launch).toEqual({ kind: "denied", reason: "parent-closing" })
    expect(controller.store.getState().sessions["stale-start-child"]).toBeUndefined()
    expect(controller.store.getState().delegation.children["stale-start-child"]).toBeUndefined()
    expect(created[2]?.prompts).toEqual([])
    expect(created[2]?.disposeCalls()).toBe(1)
    await controller.dispose()
  })

  it("emits delegated lifecycle telemetry only for accepted transitions and deduplicates callbacks", async () => {
    const records: TelemetryRecord[] = []
    let telemetryNow = 100
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => telemetryNow++,
      sessionRef: "delegation-run",
    })
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "telemetry-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      recorder,
      now: () => 900,
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!

    telemetryNow = 110
    const childId = await controller.actions.startDelegatedChild({
      parentId,
      task: "TASK_SENTINEL must never serialize",
      desiredOutcome: "OUTCOME_SENTINEL must never serialize",
    })
    telemetryNow = 125
    created[2]!.emit({ kind: "status", status: "finished" })
    created[2]!.emit({ kind: "status", status: "error" })
    const firstClose = controller.closeConversation(parentId, "cancel")
    const duplicateClose = controller.closeConversation(parentId, "cancel")

    expect(childId).toBe("telemetry-child")
    expect(duplicateClose).toBe(firstClose)
    expect(await firstClose).toEqual({ outcome: "closed" })
    const delegatedRecords = records.filter((record) => record.type.startsWith("delegated_"))
    expect(delegatedRecords.map((record) => record.type)).toEqual([
      "delegated_launch_requested",
      "delegated_launch_succeeded",
      "delegated_visible_running_ms",
      "delegated_child_terminal",
      "delegated_cascade_requested",
      "delegated_cascade_completed",
    ])
    expect(delegatedRecords.find((record) => record.type === "delegated_visible_running_ms")?.durationMs).toBeGreaterThan(0)
    expect(delegatedRecords.find((record) => record.type === "delegated_child_terminal")?.delegatedStatus).toBe("finished")
    expect(records.filter((record) => record.type.startsWith("explore_"))).toEqual([
      expect.objectContaining({
        type: "explore_launch_eligible",
        policyVersion: "explore-v1",
        provider: "codex",
        count: 1,
      }),
      expect.objectContaining({ type: "explore_terminal", terminalStatus: "finished", count: 1 }),
    ])
    const serialized = JSON.stringify(delegatedRecords)
    expect(serialized).not.toContain("TASK_SENTINEL")
    expect(serialized).not.toContain("OUTCOME_SENTINEL")
    expect(serialized).not.toContain("telemetry-child")
    expect(serialized).not.toContain('"agent"')
    await controller.dispose()
  })

  it("launches a delegated child in the parent provider and cwd without moving focus", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `${config.id}-${created.length + 1}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "delegated-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const parent = controller.store.getState().sessions[parentId]!

    const childId = await controller.actions.startDelegatedChild({
      parentId,
      task: "Inspect the controller boundary",
      desiredOutcome: "Report the exact lifecycle invariants",
    })

    expect(childId).toBe("delegated-child")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe(parentId)
    expect(controller.store.getState().workspace.conversations[childId!]?.lifecycle).toBe("background")
    const binding = controller.store.getState().sessions[childId!]?.worktreeBinding!
    expect(controller.store.getState().sessions[childId!]).toMatchObject({
      providerKind: parent.providerKind,
      cwd: binding.worktreePath,
      worktreeBinding: binding,
    })
    expect(binding.worktreePath).not.toBe(parent.cwd)
    expect(created.at(-1)?.newSessionCwds).toEqual([binding.worktreePath])
    expect(created.at(-1)?.prompts.at(-1)?.blocks).toEqual([
      {
        type: "text",
        text: "Task:\nInspect the controller boundary\n\nDesired outcome:\nReport the exact lifecycle invariants",
      },
    ])
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("running")
  })

  it("creates distinct background runtimes for two delegated children", async () => {
    const created: StubConnection[] = []
    const ids = ["delegated-one", "delegated-two"]
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const initialConnectionCount = created.length

    const first = await controller.actions.startDelegatedChild({
      parentId,
      task: "Research the lifecycle",
      desiredOutcome: "List the races",
    })
    const second = await controller.actions.startDelegatedChild({
      parentId,
      task: "Verify the boundary",
      desiredOutcome: "Produce passing evidence",
    })

    expect([first, second]).toEqual(["delegated-one", "delegated-two"])
    expect(created).toHaveLength(initialConnectionCount + 2)
    expect(created.at(-2)).not.toBe(created.at(-1))
    expect(created.at(-2)?.newSessionCwds[0]).not.toBe(created.at(-1)?.newSessionCwds[0])
    expect(created.at(-2)?.newSessionCwds[0]).not.toBe(CWD)
    expect(created.at(-1)?.newSessionCwds[0]).not.toBe(CWD)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe(parentId)
    expect(controller.store.getState().delegation.parents[parentId]?.childIds).toEqual([
      "delegated-one",
      "delegated-two",
    ])
  })

  it("settles one finished and one failed child exactly once before the group settles", async () => {
    const created: StubConnection[] = []
    const ids = ["finished-child", "failed-child"]
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      now: () => 77,
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    await controller.actions.startDelegatedChild({ parentId, task: "Finish", desiredOutcome: "Done" })
    await controller.actions.startDelegatedChild({ parentId, task: "Fail", desiredOutcome: "Visible error" })

    created[2]!.emit({ kind: "status", status: "finished" })
    expect(selectDelegationAggregateStatus(controller.store.getState().delegation, parentId)).toBe("active")
    created[2]!.emit({ kind: "status", status: "error" })
    created[3]!.emit({ kind: "status", status: "error" })
    created[3]!.emit({ kind: "status", status: "finished" })

    const delegation = controller.store.getState().delegation
    expect(selectDelegationAggregateStatus(delegation, parentId)).toBe("settled")
    expect(delegation.children["finished-child"]?.terminal).toEqual({ status: "finished", at: 77 })
    expect(delegation.children["failed-child"]?.terminal).toEqual({ status: "failed", at: 77 })
    await controller.dispose()
  })

  it("closes a settled idle delegated parent through the ordinary close policy", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "settled-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    await controller.actions.startDelegatedChild({ parentId, task: "Finish", desiredOutcome: "Done" })
    created[2]!.emit({ kind: "status", status: "finished" })

    expect(await controller.closeConversation(parentId, "close")).toEqual({ outcome: "closed" })
    expect(created[2]!.cancels).toEqual([])
    expect(controller.store.getState().sessions[parentId]).toBeUndefined()
    expect(controller.store.getState().sessions["settled-child"]).toBeUndefined()
    expect(controller.store.getState().delegation).toEqual({ parents: {}, children: {} })
    await controller.dispose()
  })

  it("removes a directly closed terminal child from its delegation ownership", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "terminal-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    await controller.actions.startDelegatedChild({ parentId, task: "Finish", desiredOutcome: "Done" })
    created[2]!.emit({ kind: "status", status: "finished" })

    expect(await controller.closeConversation("terminal-child", "cancel")).toEqual({ outcome: "closed" })
    expect(created[2]!.cancels).toEqual([])
    expect(controller.store.getState().sessions["terminal-child"]).toBeUndefined()
    expect(controller.store.getState().workspace.conversations["terminal-child"]).toBeUndefined()
    expect(controller.store.getState().sessions[parentId]).toBeDefined()
    expect(controller.store.getState().delegation).toEqual({ parents: {}, children: {} })
    await controller.dispose()
  })

  it("shares one parent close operation and tears down every owned child once", async () => {
    const childDisposal = deferred()
    const created: StubConnection[] = []
    const ids = ["close-child-one", "close-child-two"]
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, {
          sessionId: `acp-${created.length}`,
          ...(created.length >= 2 ? { disposeWait: childDisposal.promise } : {}),
        })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    await controller.actions.startDelegatedChild({ parentId, task: "One", desiredOutcome: "Stopped" })
    await controller.actions.startDelegatedChild({ parentId, task: "Two", desiredOutcome: "Stopped" })

    const first = controller.closeConversation(parentId, "cancel")
    const second = controller.closeConversation(parentId, "cancel")
    expect(second).toBe(first)
    expect(controller.store.getState().delegation.parents[parentId]?.closeState).toBe("closing")
    await waitFor(
      () => created[2]!.disposeCalls() === 1 && created[3]!.disposeCalls() === 1,
      "both delegated disposals to begin",
    )
    expect(created[2]!.cancels).toHaveLength(1)
    expect(created[3]!.cancels).toHaveLength(1)

    childDisposal.resolve()
    expect(await first).toEqual({ outcome: "closed" })
    expect(created[2]!.disposeCalls()).toBe(1)
    expect(created[3]!.disposeCalls()).toBe(1)
    expect(controller.store.getState().sessions[parentId]).toBeUndefined()
    expect(controller.store.getState().delegation).toEqual({ parents: {}, children: {} })
    const afterClose = controller.store.getState()
    created[2]!.emit({ kind: "status", status: "finished" })
    created[2]!.emit({ kind: "agent_message", messageId: "late", textDelta: "ignored" })
    expect(await created[2]!.ask(PERMISSION_REQUEST)).toEqual({ outcome: "cancelled" })
    expect(await created[2]!.clarify(CLARIFICATION_PAYLOAD)).toEqual({ kind: "cancelled" })
    expect(controller.store.getState()).toBe(afterClose)
    await controller.dispose()
  })

  it("preserves a finished terminal snapshot during a racing parent close", async () => {
    const created: StubConnection[] = []
    const observedTerminals: string[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "terminal-race-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      now: () => 44,
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    await controller.actions.startDelegatedChild({ parentId, task: "Finish", desiredOutcome: "Stable" })
    controller.store.subscribe((state) => {
      const terminal = state.delegation.children["terminal-race-child"]?.terminal
      if (terminal) observedTerminals.push(`${terminal.status}:${terminal.at}`)
    })

    created[2]!.emit({ kind: "status", status: "finished" })
    expect(await controller.closeConversation(parentId, "cancel")).toEqual({ outcome: "closed" })

    expect(created[2]!.cancels).toEqual([])
    expect(new Set(observedTerminals)).toEqual(new Set(["finished:44"]))
    expect(controller.store.getState().sessions[parentId]).toBeUndefined()
    await controller.dispose()
  })

  it.each([
    ["cancellation", { cancelThrows: new Error("child cancel failed") }, 0],
    ["disposal", { disposeThrows: new Error("child dispose failed") }, 1],
  ] as const)("retains visible delegated failure after throwing %s and ignores every late callback", async (_kind, failure, disposalCalls) => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, {
          sessionId: `acp-${created.length}`,
          ...(created.length === 2 ? failure : {}),
        })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "failing-close-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      now: () => 77,
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    await controller.actions.startDelegatedChild({ parentId, task: "Fail teardown", desiredOutcome: "Visible" })
    const child = created[2]!
    const pendingPermission = child.ask(PERMISSION_REQUEST)

    expect(await controller.closeConversation(parentId, "cancel")).toEqual({ outcome: "teardown-failed" })
    expect(await pendingPermission).toEqual({ outcome: "cancelled" })
    const retained = controller.store.getState()
    expect(retained.delegation.children["failing-close-child"]).toMatchObject({
      status: "failed",
      terminal: { status: "failed", at: 77 },
    })
    expect(retained.workspace.conversations["failing-close-child"]).toMatchObject({
      availability: { kind: "unavailable", reasonCode: "teardown-failed", retryable: true },
    })
    expect(child.disposeCalls()).toBe(disposalCalls)
    const childSession = retained.sessions["failing-close-child"]

    child.emit({ kind: "status", status: "finished" })
    child.emit({ kind: "agent_message", messageId: "late", textDelta: "ignored" })
    expect(await child.ask(PERMISSION_REQUEST)).toEqual({ outcome: "cancelled" })
    expect(await child.clarify(CLARIFICATION_PAYLOAD)).toEqual({ kind: "cancelled" })
    expect(controller.store.getState().sessions["failing-close-child"]).toBe(childSession)
    expect(await controller.actions.sendPrompt("ordinary sibling stays usable", "codex")).toEqual({ stopReason: "end_turn" })
    await controller.dispose()
  })

  it("retains failed managed children for review without breaking parent or sibling work", async () => {
    const created: StubConnection[] = []
    const records: TelemetryRecord[] = []
    const ids = ["startup-failure", "prompt-failure", "healthy-child"]
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const dynamicIndex = Math.max(0, created.length - 2)
        const options = created.length === 2
          ? { newSessionThrows: new Error("child startup failed") }
          : created.length === 3
            ? { promptThrows: new Error("child prompt failed") }
            : {}
        const connection = createStubConnection(config.id, { sessionId: `acp-dynamic-${dynamicIndex}`, ...options })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      now: () => 1234,
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
        sessionRef: "delegation-failure-run",
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!

    expect(await controller.actions.startExploreChild({
      parentId,
      task: "Fail during startup",
      desiredOutcome: "Inspectable startup failure",
    })).toEqual({ kind: "denied", reason: "startup-failed" })
    expect(await controller.actions.startExploreChild({
      parentId,
      task: "Fail during prompt",
      desiredOutcome: "Inspectable prompt failure",
    })).toEqual({ kind: "started", childId: "prompt-failure" })
    await waitFor(
      () => controller.store.getState().delegation.children["prompt-failure"]?.status === "failed",
      "the detached explore prompt failure to terminalize",
    )
    expect(await controller.actions.startExploreChild({
      parentId,
      task: "Stay healthy",
      desiredOutcome: "Accept follow-up direction",
    })).toEqual({ kind: "started", childId: "healthy-child" })

    expect(controller.store.getState().delegation.children["startup-failure"]).toMatchObject({
      status: "failed",
      terminal: { status: "failed", at: 1234 },
    })
    expect(controller.store.getState().delegation.children["prompt-failure"]).toMatchObject({
      status: "failed",
      terminal: { status: "failed", at: 1234 },
    })
    expect(controller.store.getState().sessions["startup-failure"]?.worktreeBinding).toMatchObject({
      ownerSessionId: "startup-failure",
      availability: "available",
    })
    expect(controller.store.getState().sessions["prompt-failure"]?.worktreeBinding).toMatchObject({
      ownerSessionId: "prompt-failure",
      availability: "available",
    })
    expect(JSON.stringify(records)).not.toContain("Fail during startup")
    expect(JSON.stringify(records)).not.toContain("Fail during prompt")
    expect(records.filter((record) => record.type === "explore_start_failed")).toEqual([
      expect.objectContaining({ failureCategory: "session-start-failed", count: 1 }),
      expect.objectContaining({ failureCategory: "prompt-dispatch-failed", count: 1 }),
    ])
    expect(controller.store.getState().delegation.children["healthy-child"]).toMatchObject({
      status: "running",
    })
    expect(created[4]!.prompts).toHaveLength(1)
    expect(await controller.actions.sendPrompt("Parent remains usable", parentId)).toEqual({ stopReason: "end_turn" })
  })

  it("gates cleanup to managed terminal non-live children and publishes bounded refusal state", async () => {
    const created: StubConnection[] = []
    const records: TelemetryRecord[] = []
    const cleanupInputs: CleanupManagedWorktreeInput[] = []
    const cleanupErrors: Array<{ sessionId: SessionId; error: unknown }> = []
    const ids = ["failed-review-child", "live-terminal-child"]
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, created.length === 2
          ? { newSessionThrows: new Error("startup failed") }
          : {})
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => ids.shift()!,
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner({
        cleanup: async (input) => {
          cleanupInputs.push(input)
          if (cleanupInputs.length === 2) throw new Error("cleanup exploded")
          return { kind: "refused", reason: "dirty" }
        },
      }),
      onError: (sessionId, error) => cleanupErrors.push({ sessionId, error }),
      now: () => 55,
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
        sessionRef: "managed-cleanup-run",
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    expect(await controller.actions.startDelegatedChild({
      parentId,
      task: "Fail after registration",
      desiredOutcome: "Retain review binding",
    })).toBeNull()
    expect(cleanupInputs).toHaveLength(0)

    expect(await controller.actions.cleanupManagedWorktree("missing")).toEqual({
      kind: "refused",
      reason: "not_managed",
    })
    expect(await controller.actions.cleanupManagedWorktree(parentId)).toEqual({
      kind: "refused",
      reason: "not_managed",
    })
    expect(records.filter((record) => record.type.startsWith("managed_worktree_cleanup"))).toEqual([])

    expect(await controller.actions.startDelegatedChild({
      parentId,
      task: "Finish while ACP remains live",
      desiredOutcome: "Refuse live cleanup",
    })).toBe("live-terminal-child")
    created.at(-1)!.emit({ kind: "status", status: "finished" })
    expect(await controller.actions.cleanupManagedWorktree("live-terminal-child")).toEqual({
      kind: "refused",
      reason: "live_owned",
    })
    expect(cleanupInputs).toHaveLength(0)
    expect(records.filter((record) => record.type.startsWith("managed_worktree_cleanup"))).toEqual([])

    controller.store.addDelegatedSession({
      seed: {
        id: "mismatched-child",
        providerKind: "codex",
        title: "Mismatched child",
        cwd: `${CWD}/mismatched`,
        worktreeBinding: testManagedWorktreeBinding("different-owner", "mismatched"),
      },
      parentId,
      parentGeneration: 1,
      childGeneration: 90,
      task: "Mismatch",
      desiredOutcome: "Refuse",
    })
    controller.store.addDelegatedSession({
      seed: {
        id: "non-terminal-child",
        providerKind: "codex",
        title: "Non-terminal child",
        cwd: `${CWD}/non-terminal`,
        worktreeBinding: testManagedWorktreeBinding("non-terminal-child", "non-terminal"),
      },
      parentId,
      parentGeneration: 1,
      childGeneration: 91,
      task: "Still active",
      desiredOutcome: "Refuse",
    })
    expect(await controller.actions.cleanupManagedWorktree("mismatched-child")).toEqual({
      kind: "refused",
      reason: "not_managed",
    })
    expect(await controller.actions.cleanupManagedWorktree("non-terminal-child")).toEqual({
      kind: "refused",
      reason: "live_owned",
    })

    expect(await controller.closeConversation("live-terminal-child", "cancel")).toEqual({ outcome: "closed" })
    expect(cleanupInputs).toHaveLength(0)

    expect(await controller.actions.cleanupManagedWorktree("failed-review-child")).toEqual({
      kind: "refused",
      reason: "dirty",
    })
    expect(cleanupInputs).toHaveLength(1)
    expect(controller.store.getState().sessions["failed-review-child"]?.worktreeBinding).toMatchObject({
      availability: "cleanup_refused",
      reason: "dirty",
    })
    expect(records.filter((record) => record.type.startsWith("managed_worktree_cleanup"))).toEqual([
      expect.objectContaining({
        type: "managed_worktree_cleanup_refused",
        managedWorktreeReason: "dirty",
      }),
    ])
    expect(await controller.actions.cleanupManagedWorktree("failed-review-child")).toEqual({
      kind: "failed",
      reason: "git_failed",
    })
    expect(cleanupErrors.at(-1)).toEqual({
      sessionId: "failed-review-child",
      error: expect.objectContaining({ message: "cleanup exploded" }),
    })
    expect(controller.store.getState().sessions["failed-review-child"]?.worktreeBinding).toMatchObject({
      availability: "cleanup_refused",
      reason: "git_failed",
    })
    expect(records.filter((record) => record.type.startsWith("managed_worktree_cleanup"))).toHaveLength(1)
    await controller.dispose()
  })

  it("emits cleaned only after the service removes an accepted terminal binding", async () => {
    const created: StubConnection[] = []
    const records: TelemetryRecord[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, created.length === 2
          ? { newSessionThrows: new Error("startup failed") }
          : {})
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "clean-review-child",
      sendInitialTasks: false,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner({
        cleanup: async () => ({ kind: "removed" }),
      }),
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
        sessionRef: "managed-cleaned-run",
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!

    expect(await controller.actions.startDelegatedChild({
      parentId,
      task: "Retain a clean review artifact",
      desiredOutcome: "Remove only after explicit cleanup",
    })).toBeNull()
    expect(await controller.actions.cleanupManagedWorktree("clean-review-child")).toEqual({ kind: "removed" })
    expect(controller.store.getState().sessions["clean-review-child"]?.worktreeBinding).toMatchObject({
      availability: "unavailable",
      reason: "missing",
    })
    expect(records.filter((record) => record.type === "managed_worktree_cleaned")).toEqual([
      expect.objectContaining({ type: "managed_worktree_cleaned" }),
    ])
    await controller.dispose()
  })

  it("treats unknown, ordinary, terminal, and stale delegated controls as fail-soft no-ops", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "controlled-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      now: () => 55,
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const childId = await controller.actions.startDelegatedChild({
      parentId,
      task: "Exercise controls",
      desiredOutcome: "No leaked failures",
    })
    const childConnection = created.at(-1)!

    expect(await controller.actions.steerDelegatedChild("missing", "direction")).toBeNull()
    expect(await controller.actions.steerDelegatedChild(parentId, "direction")).toBeNull()
    await controller.actions.cancelDelegatedChild("missing")
    await controller.actions.cancelDelegatedChild(parentId)
    expect(childConnection.cancels).toEqual([])

    await controller.actions.cancelDelegatedChild(childId!)
    await controller.actions.cancelDelegatedChild(childId!)
    expect(childConnection.cancels).toEqual([childConnection.prompts[0]!.sessionId])
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("cancelled")
    expect(await controller.actions.steerDelegatedChild(childId!, "late direction")).toBeNull()

    const promptsBeforeReplacement = childConnection.prompts.length
    await controller.actions.startFreshFromContext(undefined, childId!)
    expect(await controller.actions.steerDelegatedChild(childId!, "stale direction")).toBeNull()
    await controller.actions.cancelDelegatedChild(childId!)
    expect(childConnection.prompts).toHaveLength(promptsBeforeReplacement)
  })

  it("cascades parent replacement and ignores every old child callback", async () => {
    const created: StubConnection[] = []
    const bridge = createRecordingBridge()
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "generation-child",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      createKittenMcpBridge: bridge.factory,
      now: () => 99,
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const childId = await controller.actions.startDelegatedChild({
      parentId,
      task: "Watch generations",
      desiredOutcome: "Ignore stale terminal events",
    })
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("running")
    const oldChild = created[2]!
    const clarification = oldChild.clarify(CLARIFICATION_PAYLOAD)

    await controller.actions.startFreshFromContext(undefined, parentId)
    expect(await clarification).toEqual({ kind: "cancelled" })
    oldChild.emit({ kind: "status", status: "finished" })
    oldChild.emit({ kind: "agent_message", messageId: "late", textDelta: "ignored" })
    expect(controller.store.getState().delegation.children[childId!]).toBeUndefined()
    expect(controller.store.getState().sessions[childId!]).toBeUndefined()
    expect(oldChild.cancels).toHaveLength(1)
    expect(oldChild.disposeCalls()).toBe(1)
    expect(bridge.cancellations.filter(({ sessionId }) => sessionId === childId)).toHaveLength(1)
    expect(await controller.actions.steerDelegatedChild(childId!, "stale steer")).toBeNull()
    await controller.actions.cancelDelegatedChild(childId!)
    expect(controller.isReady(parentId)).toBe(true)
  })

  it("fences old and replacement child generations from a captured delegation identity", async () => {
    const created: StubConnection[] = []
    const records: TelemetryRecord[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `acp-${created.length}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "generation-child-only",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
      resolveExploreCapability: testExploreCapability,
      managedWorktreeProvisioner: createTestManagedWorktreeProvisioner(),
      recorder: createTelemetryRecorder({
        enabled: true,
        sink: { write: (record) => records.push(record) },
        sessionRef: "stale-delegation-run",
      }),
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const childId = await controller.actions.startDelegatedChild({
      parentId,
      task: "Watch child generations",
      desiredOutcome: "Ignore replacements",
    })
    const oldChild = created[2]!

    await controller.actions.startFreshFromContext(undefined, childId!)
    const replacement = created.at(-1)!
    oldChild.emit({ kind: "status", status: "finished" })
    replacement.emit({ kind: "status", status: "error" })
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("running")
    expect(records.filter((record) => record.type === "delegated_child_terminal")).toEqual([])
    expect(records.filter((record) => record.type === "explore_terminal")).toEqual([])
    expect(await controller.actions.steerDelegatedChild(childId!, "stale steer")).toBeNull()
    await controller.actions.cancelDelegatedChild(childId!)
    expect(replacement.prompts).toEqual([])
    expect(replacement.cancels).toEqual([])
    await controller.dispose()
  })

  it("inherits the selected provider and cwd into an independent runtime", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id, { sessionId: `${config.id}-${created.length + 1}` })
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "fresh-conversation",
      sendInitialTasks: false,
    })
    const selected = controller.store.getState().workspace.selectedVisibleId!
    const source = controller.store.getState().sessions[selected]!

    const sessionId = await controller.actions.createConversation()

    expect(sessionId).toBe("fresh-conversation")
    expect(controller.store.getState().sessions[sessionId!]).toMatchObject({
      providerKind: source.providerKind,
      cwd: source.cwd,
      turns: [],
    })
    expect(controller.store.getState().workspace.selectedVisibleId).toBe(sessionId)
    expect(created.at(-1)?.newSessionCwds).toEqual([source.cwd])
    expect(created.at(-1)).not.toBe(created.find((connection) => connection !== created.at(-1) && connection.id === source.providerKind))
  })

  it("uses the configured default from an empty workspace and reports no-provider without throwing", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const connection = createStubConnection(config.id)
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "default-conversation",
      sendInitialTasks: false,
    })
    for (const id of [...controller.store.getState().workspace.order]) {
      controller.actions.backgroundConversation(id)
    }

    const sessionId = await controller.actions.createConversation()

    expect(sessionId).toBe("default-conversation")
    expect(controller.store.getState().sessions[sessionId!]).toMatchObject({
      providerKind: "codex",
      cwd: CWD,
    })
    expect(created.at(-1)?.id).toBe("codex")
    expect(controller.store.getState().workspaceNotice).toBeNull()

    const noProviderConfig = {
      ...APP_CONFIG,
      providers: {} as AppConfig["providers"],
      sessions: [],
    }
    const empty = await createSessionController({
      config: noProviderConfig,
      cwd: CWD,
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "never-created",
      sendInitialTasks: false,
    })
    expect(await empty.actions.createConversation()).toBeNull()
    expect(empty.store.getState().workspaceNotice).toEqual({ code: "no-provider-available" })
    expect(empty.store.getState().workspace.order).toEqual([])
  })

  it("retains a failed creation as unavailable while a sibling remains promptable", async () => {
    const created: StubConnection[] = []
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => {
        const dynamic = created.length >= 2
        const connection = createStubConnection(config.id, dynamic ? { newSessionThrows: new Error("fresh failed") } : {})
        created.push(connection)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
      readBranch: async () => null,
      newSessionId: () => "failed-conversation",
      sendInitialTasks: false,
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })
    const sibling = controller.store.getState().workspace.selectedVisibleId!

    expect(await controller.actions.createConversation()).toBe("failed-conversation")
    expect(controller.store.getState().workspace.conversations["failed-conversation"]?.availability).toEqual({
      kind: "unavailable",
      reasonCode: "connection-failed",
      retryable: true,
    })
    expect(await controller.actions.sendPrompt("sibling still works", sibling)).toEqual({ stopReason: "end_turn" })
  })

  it("normalizes names and treats unknown lifecycle targets as no-ops without ACP effects", async () => {
    const { controller, connections } = await controllerWithStubs()
    const before = controller.store.getState()

    controller.actions.renameConversation("claude-code", "   ")
    expect(controller.store.getState()).toBe(before)
    controller.actions.renameConversation("claude-code", "  Primary task  ")
    expect(controller.store.getState().workspace.conversations["claude-code"]?.displayName).toBe("Primary task")
    controller.actions.selectConversation("missing")
    controller.actions.backgroundConversation("missing")
    controller.actions.reopenConversation("missing")
    expect(await controller.actions.closeConversation("missing", "close")).toEqual({ outcome: "ignored" })

    controller.actions.backgroundConversation("claude-code")
    expect(connections["claude-code"].cancels).toEqual([])
    expect(connections["claude-code"].disposeCalls()).toBe(0)
    expect(connections["claude-code"].subscriberCount()).toBe(1)
  })
})

describe("delegated action facade", () => {
  it("forwards narrow delegated commands and converts dependency failures to fail-soft outcomes", async () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const calls: string[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      startDelegatedChild: async (input) => {
        calls.push(`start:${input.parentId}:${input.task}:${input.desiredOutcome}`)
        return "child"
      },
      steerDelegatedChild: async (childId, text) => {
        calls.push(`steer:${childId}:${text}`)
        return { stopReason: "end_turn" }
      },
      cancelDelegatedChild: async (childId) => {
        calls.push(`cancel:${childId}`)
      },
    })

    expect(await actions.startDelegatedChild({
      parentId: "parent",
      task: "task",
      desiredOutcome: "outcome",
    })).toBe("child")
    expect(await actions.steerDelegatedChild("child", "direction")).toEqual({ stopReason: "end_turn" })
    await actions.cancelDelegatedChild("child")
    expect(calls).toEqual([
      "start:parent:task:outcome",
      "steer:child:direction",
      "cancel:child",
    ])

    const failing = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      startDelegatedChild: async () => { throw new Error("start failed") },
      steerDelegatedChild: async () => { throw new Error("steer failed") },
      cancelDelegatedChild: async () => { throw new Error("cancel failed") },
      cleanupManagedWorktree: async () => { throw new Error("cleanup failed") },
      onError: (sessionId, error) => calls.push(`error:${sessionId}:${String(error)}`),
    })
    expect(await failing.startDelegatedChild({ parentId: "parent", task: "task", desiredOutcome: "outcome" })).toBeNull()
    expect(await failing.steerDelegatedChild("child", "direction")).toBeNull()
    expect(await failing.cancelDelegatedChild("child")).toBeUndefined()
    expect(await failing.cleanupManagedWorktree("child")).toEqual({ kind: "failed", reason: "git_failed" })
    expect(calls.at(-1)).toBe("error:child:Error: cleanup failed")
  })
})

describe("createSessionController - dispose", () => {
  it("Should unsubscribe and dispose the owned shell before late events can reach the store", async () => {
    const shell = createStubShellRuntime()
    const { controller } = await controllerWithStubs({}, { createShellRuntime: () => shell })
    shell.emit({ kind: "cwd_changed", cwd: "/before-dispose" })

    expect(shell.subscriberCount()).toBe(1)
    await controller.dispose()

    expect(shell.subscriberCount()).toBe(0)
    expect(shell.isDisposed()).toBe(true)
    shell.emit({ kind: "cwd_changed", cwd: "/after-dispose" })
    expect(controller.store.getState().shell.cwd).toBe("/before-dispose")
  })

  it("Should cancel pending approvals, unsubscribe streams, and dispose connections", async () => {
    const { controller, connections } = await controllerWithStubs()
    const pending = connections["claude-code"].ask(PERMISSION_REQUEST)

    await controller.dispose()

    expect(await pending).toEqual({ outcome: "cancelled" })
    expect(controller.store.getState().overlays.approval).toBeNull()
    expect(connections["claude-code"].isDisposed()).toBe(true)
    expect(connections.codex.isDisposed()).toBe(true)

    // A late update from a disposed connection reaches no slice.
    connections.codex.emit({ kind: "agent_message", messageId: "late", textDelta: "ignored" })
    expect(controller.store.getState().sessions.codex!.turns).toEqual([])
  })

  it("Should cancel a permission request raised after dispose", async () => {
    const { controller, connections } = await controllerWithStubs()
    await controller.dispose()

    expect(await connections["claude-code"].ask(PERMISSION_REQUEST)).toEqual({ outcome: "cancelled" })
    expect(controller.store.getState().overlays.approval).toBeNull()
  })

  it("Should survive a connection that throws while being disposed", async () => {
    const connection = createStubConnection("claude-code")
    connection.dispose = async () => {
      throw new Error("kill failed")
    }
    const controller = await createSessionController({
      config: {
        providers: PROVIDERS,
        providerDefaults: {},
        sessions: [{ provider: "claude-code", cwd: process.cwd() }],
        mcpServers: [],
        shell: APP_CONFIG.shell,
        clarificationTimeoutSeconds: 300,
        persistenceEnabled: true,
        telemetryEnabled: false,
        transcriptWindowingEnabled: false,
        theme: "auto",
        welcomeBanner: "auto",
        statusline: { llmDisclosureAcknowledged: false, layout: null },
      },
      cwd: CWD,
      createConnection: () => connection,
      createShellRuntime: createTestShellFactory(),
    })

    await controller.dispose()
    expect(controller.runtime("claude-code")).toMatchObject({ ready: true })
  })
})

describe("file-selector telemetry action facade", () => {
  it("forwards an addressed fixed fact through a controller with enabled telemetry", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 42,
      sessionRef: "run-1",
    })
    const { controller } = await controllerWithStubs({}, {
      config: { ...APP_CONFIG, telemetryEnabled: true },
      recorder,
      usageSeenSink: { write() {} },
    })

    controller.actions.fileSelectorDiscovery("codex", "ready", 18)

    expect(records.filter((record) => record.type === "file_selector_discovery")).toEqual([
      {
        type: "file_selector_discovery",
        agent: "codex",
        outcome: "ready",
        durationMs: 18,
        at: 42,
        sessionRef: "run-1",
      },
    ])
    await controller.dispose()
  })

  it("emits nothing when disabled while ordinary controller actions remain functional", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: false,
      sink: { write: (record) => records.push(record) },
    })
    const { controller } = await controllerWithStubs({}, {
      config: { ...APP_CONFIG, telemetryEnabled: false },
      recorder,
    })

    controller.actions.fileSelectorOpened("claude-code")
    controller.actions.fileSelectorDiscovery("claude-code", "unavailable", 20)
    controller.actions.fileSelectorQueryRendered("claude-code", "empty", 3)
    controller.actions.fileSelectorSelected("claude-code", 100)
    controller.actions.fileSelectorCorrected("claude-code")
    controller.actions.switchFocus("codex")

    expect(records).toHaveLength(0)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    await controller.dispose()
  })
})

describe("createControllerActions", () => {
  it("records accepted composer history before the agent prompt settles", async () => {
    const store = createAppStore()
    const turn = deferred()
    const connection = createStubConnection("claude-code", { promptWait: turn.promise })
    const actions = createControllerActions({
      store,
      getSession: () => ({ sessionId: "claude-code", acpSessionId: "s1", connection }),
      resolvePermission: () => {},
    })

    actions.recordPromptHistory("retry this")
    const prompt = actions.sendPrompt("retry this")

    expect(store.getState().sessions["claude-code"]!.promptHistory.entries).toEqual(["retry this"])
    expect(actions.navigatePromptHistory("previous")).toEqual({
      text: "retry this",
      historyIndex: 0,
      total: 1,
    })

    turn.resolve()
    await prompt
  })

  it("keeps a composer prompt recallable after the addressed agent rejects", async () => {
    const store = createAppStore()
    const connection = createStubConnection("claude-code", { promptThrows: new Error("agent failed") })
    const actions = createControllerActions({
      store,
      getSession: () => ({ sessionId: "claude-code", acpSessionId: "s1", connection }),
      resolvePermission: () => {},
    })

    actions.recordPromptHistory("recover me")
    expect(await actions.sendPrompt("recover me")).toBeNull()

    expect(actions.navigatePromptHistory("previous")).toEqual({
      text: "recover me",
      historyIndex: 0,
      total: 1,
    })
  })

  it("navigates an explicit session without changing focused-session history", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const actions = createControllerActions({ store, getSession: () => undefined, resolvePermission: () => {} })
    actions.recordPromptHistory("focused", "claude-code")
    actions.recordPromptHistory("older", "codex")
    actions.recordPromptHistory("newer", "codex")

    expect(actions.navigatePromptHistory("previous", "codex")).toEqual({
      text: "newer",
      historyIndex: 1,
      total: 2,
    })
    expect(store.getState().sessions["claude-code"]!.promptHistory).toEqual({
      entries: ["focused"],
      cursor: null,
    })
    expect(store.getState().workspace.selectedVisibleId).toBe("claude-code")
  })

  it("returns no replacement for empty history and next from idle", () => {
    const store = createAppStore()
    const actions = createControllerActions({ store, getSession: () => undefined, resolvePermission: () => {} })

    expect(actions.navigatePromptHistory("previous")).toEqual({ text: null, historyIndex: null, total: 0 })
    actions.recordPromptHistory("  \n  ")
    expect(actions.navigatePromptHistory("previous")).toEqual({ text: null, historyIndex: null, total: 0 })
    actions.recordPromptHistory("one")
    expect(actions.navigatePromptHistory("next")).toEqual({ text: null, historyIndex: null, total: 1 })
  })

  it("integrates controller history actions with the real content-free recorder", () => {
    const records: TelemetryRecord[] = []
    const store = createAppStore()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 42,
      sessionRef: "run-1",
    })
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      recorder,
    })

    actions.recordPromptHistory("first secret prompt")
    actions.recordPromptHistory("second secret prompt")
    actions.navigatePromptHistory("previous")
    actions.recordPromptHistory("changed secret prompt")
    actions.navigatePromptHistory("previous")
    actions.navigatePromptHistory("next")

    expect(records).toEqual([
      { type: "prompt_history_eligible", agent: "claude-code", at: 42, sessionRef: "run-1" },
      { type: "prompt_history_recalled", agent: "claude-code", at: 42, sessionRef: "run-1" },
      { type: "prompt_history_edited_resend", agent: "claude-code", at: 42, sessionRef: "run-1" },
      { type: "prompt_history_recalled", agent: "claude-code", at: 42, sessionRef: "run-1" },
      { type: "prompt_history_cleared", agent: "claude-code", at: 42, sessionRef: "run-1" },
    ])
    expect(JSON.stringify(records)).not.toContain("secret prompt")
  })

  it("does not record history for direct, handoff-block, or fresh-context send paths", async () => {
    const store = createAppStore()
    const connection = createStubConnection("claude-code")
    const historyEvents: string[] = []
    const actions = createControllerActions({
      store,
      getSession: () => ({ sessionId: "claude-code", acpSessionId: "s1", connection }),
      resolvePermission: () => {},
      startFreshSession: async () => true,
      recorder: {
        focusSwitch() {},
        promptHistorySubmitted: () => historyEvents.push("submitted"),
        promptHistoryRecalled: () => historyEvents.push("recalled"),
        promptHistoryCleared: () => historyEvents.push("cleared"),
        promptHistoryEditedResend: () => historyEvents.push("edited"),
      },
    })

    await actions.sendPrompt("initial task")
    await actions.sendPrompt([{ type: "text", text: "handoff bundle" }])
    await actions.startFreshFromContext("restored context")

    expect(store.getState().sessions["claude-code"]!.promptHistory.entries).toEqual([])
    expect(historyEvents).toEqual([])
  })

  it("exposes fail-soft conversation lifecycle actions", async () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      createConversation: async () => "fresh",
      closeConversation: async () => ({ outcome: "ignored" }),
    })

    expect(await actions.createConversation()).toBe("fresh")
    actions.renameConversation("claude-code", "  Renamed  ")
    expect(store.getState().workspace.conversations["claude-code"]?.displayName).toBe("Renamed")
    actions.backgroundConversation("claude-code")
    expect(store.getState().workspace.conversations["claude-code"]?.lifecycle).toBe("background")
    actions.reopenConversation("claude-code")
    expect(store.getState().workspace.selectedVisibleId).toBe("claude-code")
    expect(await actions.closeConversation("missing", "close")).toEqual({ outcome: "ignored" })
  })

  it("contains creation and close seam failures instead of rejecting into UI", async () => {
    const errors: Array<{ sessionId: SessionId; error: unknown }> = []
    const actions = createControllerActions({
      store: createAppStore({ selectedVisibleId: "claude-code" }),
      getSession: () => undefined,
      resolvePermission: () => {},
      createConversation: async () => {
        throw new Error("create exploded")
      },
      closeConversation: async () => {
        throw new Error("close exploded")
      },
      onError: (sessionId, error) => errors.push({ sessionId, error }),
    })

    expect(await actions.createConversation()).toBeNull()
    expect(await actions.closeConversation("claude-code", "close")).toEqual({ outcome: "teardown-failed" })
    expect(errors).toEqual([{ sessionId: "claude-code", error: expect.any(Error) }])
  })

  it("keeps focused actions inert when no Visible conversation is selected", async () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.backgroundConversation("claude-code")
    store.backgroundConversation("codex")
    store.backgroundConversation("cursor")
    let lookups = 0
    const actions = createControllerActions({
      store,
      getSession: () => {
        lookups += 1
        return undefined
      },
      resolvePermission: () => {},
    })

    expect(store.getState().workspace.selectedVisibleId).toBeNull()
    expect(await actions.sendPrompt("ignored")).toBeNull()
    await actions.cancel()
    expect(await actions.setSessionConfigOption("model", "opus")).toBe(false)
    actions.switchFocus()
    expect(lookups).toBe(0)
    expect(store.getState().workspace.selectedVisibleId).toBeNull()
  })

  it("reopens and selects background attention even from an empty Visible workspace", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.backgroundConversation("claude-code")
    store.backgroundConversation("codex")
    store.applyEvent("codex", { kind: "status", status: "error" })
    const actions = createControllerActions({ store, getSession: () => undefined, resolvePermission: () => {} })

    actions.jumpToNextAttention()

    expect(store.getState().workspace.conversations.codex?.lifecycle).toBe("visible")
    expect(store.getState().workspace.selectedVisibleId).toBe("codex")
    actions.jumpToNextAttention()
    expect(store.getState().workspace.selectedVisibleId).toBe("codex")
  })

  it("Should start a fresh session before sending persisted context to that session", async () => {
    const store = createAppStore()
    const connection = createStubConnection("codex")
    const starts: string[] = []
    const actions = createControllerActions({
      store,
      getSession: () => ({ sessionId: "codex", acpSessionId: "fresh-codex", connection }),
      resolvePermission: () => {},
      startFreshSession: async (sessionId) => {
        starts.push(sessionId)
        return true
      },
    })
    const blocks: PromptBlock[] = [{ type: "text", text: "saved context" }]

    await actions.startFreshFromContext(blocks, "codex")

    expect(starts).toEqual(["codex"])
    expect(connection.prompts).toEqual([{ sessionId: "fresh-codex", blocks }])
  })

  it("retains a definitely-unsent failed first task and dispatches it only after explicit fresh recovery", async () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const dispatched: PromptBlock[][] = []
    const starts: SessionId[] = []
    let replacementReady = false
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      preparePromptDispatch: (sessionId, blocks) => {
        if (!replacementReady) {
          store.setHarnessDelivery(sessionId, {
            version: "v1",
            generation: 1,
            state: "failed",
            failureCategory: "unsupported_profile",
          })
          return null
        }
        return {
          async invoke() {
            dispatched.push(blocks)
            return { stopReason: "end_turn" }
          },
        }
      },
      startFreshSession: async (sessionId) => {
        starts.push(sessionId)
        replacementReady = true
        store.setHarnessDelivery(sessionId, { version: "v1", generation: 2, state: "pending" })
        return true
      },
    })
    const task = "original rejected task"

    actions.recordPromptHistory(task, "claude-code")
    expect(await actions.sendPrompt(task, "claude-code")).toBeNull()
    expect(dispatched).toEqual([])
    expect(store.getState().sessions["claude-code"]?.turns).toEqual([])

    expect(await actions.startFreshFromContext(undefined, "claude-code")).toEqual({ stopReason: "end_turn" })
    expect(starts).toEqual(["claude-code"])
    expect(dispatched).toEqual([[{ type: "text", text: task }]])
    expect(store.getState().sessions["claude-code"]?.turns).toEqual([
      expect.objectContaining({ kind: "user", text: task }),
    ])
    expect(store.getState().sessions["claude-code"]?.promptHistory.entries).toEqual([task])
    expect(store.getState().harnessDeliveryNotices["claude-code"]).toBeUndefined()
  })

  it("Should not send persisted context when a fresh session cannot start", async () => {
    const store = createAppStore()
    const connection = createStubConnection("codex")
    const actions = createControllerActions({
      store,
      getSession: () => ({ sessionId: "codex", acpSessionId: "stale-codex", connection }),
      resolvePermission: () => {},
      startFreshSession: async () => false,
    })

    expect(await actions.startFreshFromContext("saved context", "codex")).toBeNull()
    expect(connection.prompts).toHaveLength(0)
  })

  it("replaces a restored failed generation even when content-free persistence retained no task", async () => {
    const store = createAppStore({ selectedVisibleId: "codex" })
    store.setHarnessDelivery("codex", {
      version: "v1",
      generation: 4,
      state: "failed",
      failureCategory: "dispatch_indeterminate",
    })
    const starts: SessionId[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      startFreshSession: async (sessionId) => {
        starts.push(sessionId)
        store.setHarnessDelivery(sessionId, { version: "v1", generation: 5, state: "pending" })
        return true
      },
    })

    expect(await actions.startFreshFromContext(undefined, "codex")).toBeNull()
    expect(starts).toEqual(["codex"])
    expect(store.getState().harnessDeliveryNotices.codex).toBeUndefined()
    expect(store.getState().sessions.codex?.turns).toEqual([])
  })

  it("Should default the message id to a fresh uuid per user turn", async () => {
    const store = createAppStore()
    const connection = createStubConnection("claude-code")
    const actions = createControllerActions({
      store,
      getSession: () => ({ sessionId: "claude-code", acpSessionId: "s1", connection }),
      resolvePermission: () => {},
    })

    await actions.sendPrompt("one")
    await actions.sendPrompt("two")

    const messageIds = store
      .getState()
      .sessions["claude-code"]!.turns.map((turn) => (turn.kind === "user" ? turn.messageId : null))
    expect(messageIds).toHaveLength(2)
    expect(messageIds[0]).toBeString()
    expect(messageIds[0]).not.toBe(messageIds[1]!)
  })

  it("Should swallow a connection failure when no reporter is supplied", async () => {
    const store = createAppStore()
    const connection = createStubConnection("codex", {
      promptThrows: new Error("gone"),
      cancelThrows: new Error("gone"),
    })
    const actions = createControllerActions({
      store,
      getSession: () => ({ sessionId: "codex", acpSessionId: "s1", connection }),
      resolvePermission: () => {},
    })

    expect(await actions.sendPrompt("x", "codex")).toBeNull()
    await actions.cancel("codex")
  })

  it("Should jump focus to the session selectNextNeedy returns", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/w" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/w" },
        { id: "c", providerKind: "claude-code", title: "C", cwd: "/w" },
      ],
    })
    // From focused "a": a finished "b" and an awaiting_approval "c"; the approval outranks.
    store.applyEvent("b", { kind: "status", status: "finished" })
    store.applyEvent("c", { kind: "status", status: "awaiting_approval" })
    const actions = createControllerActions({ store, getSession: () => undefined, resolvePermission: () => {} })

    actions.jumpToNextNeedy()

    expect(store.getState().workspace.selectedVisibleId).toBe("c")
  })

  it("Should leave focus alone when no other session needs attention", () => {
    const store = createAppStore()
    const actions = createControllerActions({ store, getSession: () => undefined, resolvePermission: () => {} })

    actions.jumpToNextNeedy()

    expect(store.getState().workspace.selectedVisibleId).toBe("claude-code")
  })

  it("Should count an overview switch through the numerator but a direct /switch only through the denominator", () => {
    const store = createAppStore()
    const switches: { sessionId: string; viaOverview: boolean }[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      recorder: { focusSwitch: (sessionId, viaOverview) => switches.push({ sessionId, viaOverview }) },
    })

    // A direct /switch cycle from "claude-code" to "codex": denominator only.
    actions.switchFocus()
    // An overview jump-into back to "claude-code": denominator and numerator.
    actions.switchFocus("claude-code", { viaOverview: true })

    expect(switches).toEqual([
      { sessionId: "codex", viaOverview: false },
      { sessionId: "claude-code", viaOverview: true },
    ])
  })

  it("Should record a jump-to-next as an overview switch", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/w" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/w" },
      ],
    })
    store.applyEvent("b", { kind: "status", status: "finished" })
    const switches: { sessionId: string; viaOverview: boolean }[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      recorder: { focusSwitch: (sessionId, viaOverview) => switches.push({ sessionId, viaOverview }) },
    })

    actions.jumpToNextNeedy()

    expect(switches).toEqual([{ sessionId: "b", viaOverview: true }])
  })

  it("Should not record a focus switch that does not move focus", () => {
    const store = createAppStore()
    const switches: { sessionId: string; viaOverview: boolean }[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      recorder: { focusSwitch: (sessionId, viaOverview) => switches.push({ sessionId, viaOverview }) },
    })

    // "claude-code" already holds focus, so this is a no-op that must count nothing.
    actions.switchFocus("claude-code", { viaOverview: true })

    expect(switches).toHaveLength(0)
  })
})

/** Wire a real `AgentConnection` to a fresh in-process mock ACP agent. */
function connectionToMockAgent(
  config: AgentConfig,
  mockOptions: MockAgentOptions = {},
): { connection: AgentConnection; agent: MockAgentHandle } {
  const pair = createInMemoryTransportPair()
  const agent = startMockAgent(pair.agent, mockOptions)
  const connection = createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    // Flush streamed deltas immediately: coalescing timing is task_03's contract,
    // not this test's subject.
    scheduler: { schedule: (flush) => flush(), dispose: () => {} },
    harnessProfiles: [testHarnessProfile(config)],
  })
  return { connection, agent }
}

describe("integration - two mock ACP agents", () => {
  it("round-trips ACP elicitation through the controller projection and dedicated response action", async () => {
    const supportedConfig = {
      ...CLAUDE,
      clarificationCapability: {
        status: "supported" as const,
        adapterPackage: "@agentclientprotocol/claude-agent-acp",
        adapterVersion: "0.57.0",
      },
    }
    const claude = connectionToMockAgent(supportedConfig, {
      sessionId: "claude-session",
      onPrompt: async (request, ctx) => {
        await ctx.createElicitation({
          mode: "form",
          sessionId: request.sessionId,
          message: "Choose the implementation boundary",
          requestedSchema: {
            type: "object",
            required: ["boundary"],
            properties: {
              boundary: {
                type: "string",
                title: "Boundary",
                oneOf: [
                  { const: "controller", title: "Controller" },
                  { const: "store", title: "Store" },
                ],
              },
            },
          },
        })
      },
    })
    const config: AppConfig = {
      ...APP_CONFIG,
      providerDefaults: {},
      providers: PROVIDERS,
      sessions: [{ provider: "claude-code", cwd: process.cwd(), title: "Planner" }],
    }
    const controller = await createSessionController({
      config,
      cwd: CWD,
      createConnection: () => claude.connection,
      createShellRuntime: createTestShellFactory(),
      newInteractionId: () => "clarification-integration",
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    const prompt = controller.actions.sendPrompt("ask me", "claude-code")
    await waitFor(
      () => controller.store.getState().overlays.clarification !== null,
      "the clarification overlay to open",
    )
    const overlay = controller.store.getState().overlays.clarification!
    expect(overlay).toMatchObject({
      requestId: "clarification-integration",
      sessionId: "claude-code",
      title: "Planner",
      payload: { prompt: "Choose the implementation boundary" },
    })

    controller.actions.respondClarification(overlay.requestId, overlay.generation, {
      kind: "submitted",
      answers: { boundary: { selectedOptionIds: ["controller"] } },
    })
    await prompt

    expect(claude.agent.elicitationOutcomes).toEqual([{
      action: "accept",
      content: { boundary: "controller" },
    }])
    expect(controller.store.getState().overlays.clarification).toBeNull()
    expect(controller.store.getState().sessions["claude-code"]?.status).toBe("finished")
    await controller.dispose()
  })

  it("Should stream a prompt into the addressed agent's slice while the other stays idle", async () => {
    const claude = connectionToMockAgent(CLAUDE, {
      sessionId: "claude-session",
      onPrompt: async (_request, ctx) => {
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "on " } })
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "it" } })
      },
    })
    const codex = connectionToMockAgent(CODEX, { sessionId: "codex-session" })
    const connections = {
      "claude-code": claude.connection,
      codex: codex.connection,
    } as Record<ProviderKind, AgentConnection>

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => connections[config.id],
      createShellRuntime: createTestShellFactory(),
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    const result = await controller.actions.sendPrompt("do the thing", "claude-code")
    expect(result).toEqual({ stopReason: "end_turn" })

    const state = controller.store.getState()
    expect(state.sessions["claude-code"]!.turns.at(-1)).toEqual({ kind: "agent", messageId: "", text: "on it" })
    // The prompt ran to `end_turn`, so the session is `finished` (your move), not idle.
    expect(state.sessions["claude-code"]!.status).toBe("finished")

    // B never saw the prompt, stayed idle, and is still addressable.
    expect(codex.agent.prompts).toHaveLength(0)
    expect(state.sessions.codex!.turns).toEqual([])
    expect(state.sessions.codex!.status).toBe("idle")
    expect(state.sessions.codex!.acpSessionId).toBe("codex-session")

    controller.actions.switchFocus("codex")
    await controller.actions.sendPrompt("your turn")
    expect(codex.agent.prompts).toHaveLength(1)
    expect(controller.store.getState().sessions.codex!.turns.at(0)).toMatchObject({ kind: "user", text: "your turn" })

    await controller.dispose()
  })

  it("Should route an agent's permission request through the overlay back to that agent", async () => {
    const claude = connectionToMockAgent(CLAUDE, {
      sessionId: "claude-session",
      onPrompt: async (_request, ctx) => {
        await ctx.requestPermission({ toolCallId: "call-1", kind: "edit", title: "Edit README.md" }, [
          { optionId: "allow", name: "Allow once", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ])
      },
    })
    const codex = connectionToMockAgent(CODEX, { sessionId: "codex-session" })
    const connections = {
      "claude-code": claude.connection,
      codex: codex.connection,
    } as Record<ProviderKind, AgentConnection>

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => connections[config.id],
      createShellRuntime: createTestShellFactory(),
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    const prompt = controller.actions.sendPrompt("edit the readme", "claude-code")
    await waitFor(() => controller.store.getState().overlays.approval !== null, "the approval overlay to open")

    const approval = controller.store.getState().overlays.approval!
    expect(approval.sessionId).toBe("claude-code")
    expect(approval.request.toolCall).toMatchObject({ toolCallId: "call-1", kind: "edit", title: "Edit README.md" })
    expect(approval.request.options.map((option) => option.optionId)).toEqual(["allow", "reject"])
    expect(controller.store.getState().sessions["claude-code"]!.status).toBe("awaiting_approval")

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    await prompt

    expect(claude.agent.permissionOutcomes).toEqual([{ outcome: "selected", optionId: "allow" }])
    expect(controller.store.getState().overlays.approval).toBeNull()
    // After the approval the turn ran to `end_turn`, so the session is `finished`.
    expect(controller.store.getState().sessions["claude-code"]!.status).toBe("finished")

    await controller.dispose()
  })

  it("closes an approval-blocked ACP conversation without leaking its permission or late stream into a sibling", async () => {
    const claude = connectionToMockAgent(CLAUDE, {
      sessionId: "claude-session",
      onPrompt: async (_request, ctx) => {
        await ctx.requestPermission({ toolCallId: "call-close", kind: "edit", title: "Edit close.ts" }, [
          { optionId: "allow", name: "Allow once", kind: "allow_once" },
        ])
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "late" } })
      },
    })
    const codex = connectionToMockAgent(CODEX, { sessionId: "codex-session" })
    const connections = {
      "claude-code": claude.connection,
      codex: codex.connection,
    } as Record<ProviderKind, AgentConnection>
    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => connections[config.id],
      createShellRuntime: createTestShellFactory(),
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    const blockedPrompt = controller.actions.sendPrompt("edit then stream", "claude-code")
    await waitFor(
      () => controller.store.getState().overlays.approval?.sessionId === "claude-code",
      "the closing conversation approval to become visible",
    )

    expect(await controller.closeConversation("claude-code", "cancel")).toEqual({ outcome: "closed" })
    await blockedPrompt

    expect(claude.agent.permissionOutcomes).toEqual([{ outcome: "cancelled" }])
    expect(controller.store.getState().sessions["claude-code"]).toBeUndefined()
    expect(controller.store.getState().overlays.approval).toBeNull()

    expect(await controller.actions.sendPrompt("sibling turn", "codex")).toEqual({ stopReason: "end_turn" })
    expect(codex.agent.prompts).toHaveLength(1)
    expect(controller.store.getState().sessions.codex?.turns).toEqual([
      { kind: "user", messageId: expect.any(String), text: "sibling turn" },
    ])

    await controller.dispose()
  })

  it("Should boot a three-session fleet, focus the first ready session, and open each against its own directory", async () => {
    const agents: MockAgentHandle[] = []
    const controller = await createSessionController({
      config: THREE_SESSION_CONFIG,
      cwd: process.cwd(),
      createConnection: (config) => {
        const { connection, agent } = connectionToMockAgent(config, { sessionId: `acp-${agents.length}` })
        agents.push(agent)
        return connection
      },
      createShellRuntime: createTestShellFactory(),
    })

    // Three live runtimes, two sharing a provider, each with a distinct SessionId.
    expect(controller.runtimes().map((runtime) => runtime.sessionId)).toEqual(["claude-code", "claude-code-2", "codex"])
    expect(controller.runtimes().every((runtime) => runtime.ready)).toBe(true)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    // Each mock agent opened its session against its descriptor's own directory.
    expect(agents.map((agent) => agent.newSessionCwds)).toEqual([[FLEET_DIRS.alpha], [FLEET_DIRS.beta], [FLEET_DIRS.gamma]])

    await controller.dispose()
  })

  it("Should mark an agent whose handshake is rejected not-ready while the other stays usable", async () => {
    const claude = connectionToMockAgent(CLAUDE, {
      onInitialize: () => {
        throw new Error("authenticate first")
      },
    })
    const codex = connectionToMockAgent(CODEX, { sessionId: "codex-session" })
    const connections = {
      "claude-code": claude.connection,
      codex: codex.connection,
    } as Record<ProviderKind, AgentConnection>

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => connections[config.id],
      createShellRuntime: createTestShellFactory(),
      resolveHarnessCapability: () => TEST_HARNESS_CAPABILITY,
    })

    const claudeRuntime = controller.runtime("claude-code")!
    expect(claudeRuntime.ready).toBe(false)
    expect(claudeRuntime.ready === false && claudeRuntime.error).toContain("authenticate first")

    expect(controller.isReady("codex")).toBe(true)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

    const result = await controller.actions.sendPrompt("carry on")
    expect(result).toEqual({ stopReason: "end_turn" })
    expect(codex.agent.prompts).toHaveLength(1)

    await controller.dispose()
  })
})
