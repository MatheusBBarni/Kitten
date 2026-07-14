// Suite: session controller orchestration
// Invariant: each agent degrades independently while store binding, restore, actions, and telemetry stay ordered.
// Boundary IN: real controller/store/actions over stub connections and in-process ACP transports.
// Boundary OUT: rendered picker/cockpit behavior and real external agent binaries.

import { describe, expect, it } from "bun:test"

import { join } from "node:path"

import {
  createAgentConnection,
  type AgentConnection,
  type PermissionOutcome,
  type PermissionRequest,
  type PromptBlock,
  type ReadyState,
} from "../agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import type {
  AgentConfig,
  AppConfig,
  ClarificationOutcome,
  ClarificationPayload,
  ConfigOption,
  DomainSessionEvent,
  McpServerConfig,
  ProviderKind,
  SessionId,
  ShellEvent,
} from "../core/types.ts"
import type { PersistedRunRecordV1, PersistedRunRecordV2 } from "../persistence/runRecord.ts"
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
const PROVIDERS = {
  "claude-code": { displayName: CLAUDE.displayName, command: CLAUDE.command, args: CLAUDE.args, env: CLAUDE.env },
  codex: { displayName: CODEX.displayName, command: CODEX.command, args: CODEX.args, env: CODEX.env },
} as AppConfig["providers"]
const APP_CONFIG: AppConfig = {
  providers: PROVIDERS,
  sessions: [],
  mcpServers: [],
  shell: { enabled: true, command: "/bin/sh", scrollback: 2_500 },
  persistenceEnabled: true,
  telemetryEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
}
const CWD = "/workspace/kitten"

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
      kind: "answered",
      values: { boundary: "controller" },
    }
    expect(coordinator.resolveActive("request-2", 3, answer)).toBe(true)
    expect(await clarification).toEqual(answer)
    expect(active.at(-1)).toEqual(originalPermission)

    expect(coordinator.resolveActive("request-1", 7, { outcome: "cancelled" })).toBe(true)
    expect(await permission).toEqual({ outcome: "cancelled" })
  })

  it("rejects wrong request IDs, old generations, wrong outcome kinds, and duplicate answers", async () => {
    const { coordinator, active } = setupCoordinator()
    const clarification = coordinator.enqueueClarification("alpha", 4, CLARIFICATION_PAYLOAD)
    const answer: ClarificationOutcome = { kind: "answered", values: { boundary: "controller" } }

    expect(coordinator.resolveActive("missing", 4, answer)).toBe(false)
    expect(coordinator.resolveActive("request-1", 3, answer)).toBe(false)
    expect(coordinator.resolveActive("request-1", 4, { outcome: "cancelled" })).toBe(false)
    expect(active.at(-1)?.requestId).toBe("request-1")

    expect(coordinator.resolveActive("request-1", 4, answer)).toBe(true)
    expect(await clarification).toEqual(answer)
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
    void clarification.then(() => settlementCounts.clarification += 1)
    void sibling.then(() => settlementCounts.sibling += 1)

    coordinator.cancelSession("alpha", 8)
    expect(active.at(-1)).toMatchObject({ kind: "clarification", sessionId: "alpha", generation: 9 })
    coordinator.cancelSession("alpha", 9)
    coordinator.cancelSession("alpha", 9)
    await Bun.sleep(0)

    expect(await suspended).toEqual({ outcome: "cancelled" })
    expect(await queued).toEqual({ outcome: "cancelled" })
    expect(await clarification).toEqual({ kind: "cancelled" })
    expect(settlementCounts).toEqual({ suspended: 1, queued: 1, clarification: 1, sibling: 0 })
    expect(active.at(-1)).toMatchObject({ kind: "permission", sessionId: "beta", generation: 2 })

    expect(coordinator.resolveActive("request-2", 2, { outcome: "selected", optionId: "allow" })).toBe(true)
    expect(await sibling).toEqual({ outcome: "selected", optionId: "allow" })
    expect(settlementCounts.sibling).toBe(1)

    const afterDispose = coordinator.enqueueClarification("beta", 2, CLARIFICATION_PAYLOAD)
    coordinator.dispose()
    coordinator.dispose()
    expect(await afterDispose).toEqual({ kind: "cancelled" })
    expect(await coordinator.enqueuePermission("beta", 2, PERMISSION_REQUEST)).toEqual({ outcome: "cancelled" })
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

/** A stub `AgentConnection` recording what the controller asked of it. */
interface StubConnection extends AgentConnection {
  /** Push a domain event as if the agent had streamed it. */
  emit(event: DomainSessionEvent): void
  /** Raise a permission request through the handler the controller registered. */
  ask(request: PermissionRequest): Promise<PermissionOutcome>
  /** Raise a normalized clarification through the handler the controller registered. */
  clarify(payload: ClarificationPayload): Promise<ClarificationOutcome>
  readonly prompts: Array<{ sessionId: string; blocks: PromptBlock[] }>
  readonly cancels: string[]
  readonly newSessionCwds: string[]
  readonly newSessionMcpServers: McpServerConfig[][]
  readonly loadSessionCalls: Array<{ sessionId: string; cwd: string }>
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

function createStubConnection(id: ProviderKind, options: StubOptions = {}): StubConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  const prompts: Array<{ sessionId: string; blocks: PromptBlock[] }> = []
  const cancels: string[] = []
  const newSessionCwds: string[] = []
  const newSessionMcpServers: McpServerConfig[][] = []
  const loadSessionCalls: Array<{ sessionId: string; cwd: string }> = []
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
    cancels,
    newSessionCwds,
    newSessionMcpServers,
    loadSessionCalls,
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
      if (options.newSessionThrows !== undefined) throw options.newSessionThrows
      // Mirror the adapter: an agent that advertises config at session start emits it
      // as a `config_options` event during `newSession`, before the controller binds
      // its permanent subscription - the seed the controller must capture and replay.
      if (options.newSessionConfig !== undefined) emit({ kind: "config_options", options: options.newSessionConfig })
      return options.sessionId ?? `${id}-session`
    },
    async loadSession(sessionId, cwd) {
      loadSessionCalls.push({ sessionId, cwd })
      for (const event of options.loadSessionEvents ?? []) emit(event)
      await options.loadSessionWait
      if (options.loadSessionThrows !== undefined) throw options.loadSessionThrows
    },
    async prompt(sessionId, blocks) {
      prompts.push({ sessionId, blocks })
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
    /** Exercise the controller's real default-store construction. */
    useProductionStore?: boolean
  } = {},
): Promise<{ controller: SessionController; connections: Record<ProviderKind, StubConnection> }> {
  const connections = {
    "claude-code": createStubConnection("claude-code", stubs["claude-code"]),
    codex: createStubConnection("codex", stubs.codex),
  } as Record<ProviderKind, StubConnection>

  const controller = await createSessionController({
    config: overrides.config ?? APP_CONFIG,
    cwd: CWD,
    store: overrides.useProductionStore ? undefined : overrides.store ?? createAppStore({ selectedVisibleId: "claude-code" }),
    createConnection: (config) => connections[config.id],
    newMessageId: () => "msg-1",
    newInteractionId: overrides.newInteractionId,
    onError: overrides.onError,
    recorder: overrides.recorder,
    usageSeenSink: overrides.usageSeenSink,
    readBranch: overrides.readBranch ?? (async () => null),
    createShellRuntime: overrides.createShellRuntime ?? createTestShellFactory(),
  })
  return { controller, connections }
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
  sessions: [
    { provider: "claude-code", cwd: FLEET_DIRS.alpha, title: "Alpha" },
    { provider: "claude-code", cwd: FLEET_DIRS.beta, title: "Beta" },
    { provider: "codex", cwd: FLEET_DIRS.gamma, title: "Gamma" },
  ],
  mcpServers: [],
  shell: APP_CONFIG.shell,
  persistenceEnabled: true,
  telemetryEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
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
  } = {},
): Promise<{ controller: SessionController; created: StubConnection[] }> {
  const created: StubConnection[] = []
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
  })
  return { controller, created }
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
): Promise<{
  controller: SessionController
  startup: Record<ProviderKind, StubConnection>
  restored: Record<ProviderKind, StubConnection>
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

  const controller = await createSessionController({
    config: APP_CONFIG,
    cwd: CWD,
    store: createAppStore({ selectedVisibleId: "claude-code" }),
    createConnection: (config) => queues[config.id].shift()!,
    onError,
    recorder,
    readBranch: async () => null,
    createShellRuntime: createTestShellFactory(),
  })
  return { controller, startup, restored }
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

describe("nextSessionId", () => {
  it("Should cycle through the sessions in display order", () => {
    const order = ["claude-code", "codex"]
    expect(nextSessionId(order, "claude-code")).toBe("codex")
    expect(nextSessionId(order, "codex")).toBe("claude-code")
  })
})

describe("createSessionController - startup", () => {
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
        mcp: { loaded: [], skipped: [] },
      },
      {
        sessionId: "claude-code",
        providerKind: "claude-code",
        displayName: "Claude Code",
        title: "Claude Code",
        cwd: CWD,
        ready: true,
        acpSessionId: "claude-code-session",
        mcp: { loaded: [], skipped: [] },
      },
    ])
    expect(controller.isReady("claude-code")).toBe(true)

    await controller.dispose()
  })

  it("provisions the shared resolved MCP list into every configured session", async () => {
    const mcp: McpServerConfig = {
      name: "fixture",
      command: process.execPath,
      args: ["--stdio"],
      env: { FIXTURE: "enabled" },
    }
    const { controller, connections } = await controllerWithStubs({}, {
      config: { ...APP_CONFIG, mcpServers: [mcp] },
    })

    const expected = [{ ...mcp, command: process.execPath }]
    expect(connections["claude-code"].newSessionMcpServers).toEqual([expected])
    expect(connections.codex.newSessionMcpServers).toEqual([expected])
    expect(controller.runtime("claude-code")?.mcp).toEqual({ loaded: ["fixture"], skipped: [] })
    expect(controller.runtime("codex")?.mcp).toEqual({ loaded: ["fixture"], skipped: [] })
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
    }
    expect(connections["claude-code"].newSessionMcpServers).toEqual([[]])
    expect(connections.codex.newSessionMcpServers).toEqual([[]])
    expect(controller.runtime("claude-code")?.mcp).toEqual(expected)
    expect(controller.runtime("codex")?.mcp).toEqual(expected)
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

describe("createSessionController - persisted restore", () => {
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
      mcp: { loaded: [], skipped: [] },
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
      sessions: [{ provider: "codex", cwd: process.cwd(), title: "Worker", task: "start the build" }],
      mcpServers: [],
      shell: APP_CONFIG.shell,
      persistenceEnabled: true,
      telemetryEnabled: false,
      theme: "auto",
      welcomeBanner: "auto",
    }
    const { controller, created } = await controllerOverFleet(config)

    await waitFor(() => created[0]!.prompts.length === 1, "the opening task prompt to be sent")
    expect(created[0]!.prompts[0]!.blocks).toEqual([{ type: "text", text: "start the build" }])
    // The opening prompt is recorded as the session's first user turn.
    expect(controller.store.getState().sessions.codex!.turns).toEqual([
      { kind: "user", messageId: "msg-1", text: "start the build" },
    ])
    expect(controller.store.getState().sessions.codex!.promptHistory.entries).toEqual([])

    await controller.dispose()
  })

  it("does not send an initial task when boot has a persisted run to restore", async () => {
    const config: AppConfig = {
      providers: PROVIDERS,
      sessions: [{ provider: "codex", cwd: process.cwd(), title: "Worker", task: "start the build" }],
      mcpServers: [],
      shell: APP_CONFIG.shell,
      persistenceEnabled: true,
      telemetryEnabled: false,
      theme: "auto",
      welcomeBanner: "auto",
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
        sessions: [{ provider: "claude-code", cwd: process.cwd() }],
        mcpServers: [],
        shell: APP_CONFIG.shell,
        persistenceEnabled: true,
        telemetryEnabled: false,
        theme: "auto",
        welcomeBanner: "auto",
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
      kind: "answered",
      values: { boundary: "controller" },
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
      kind: "answered",
      values: { boundary: "store" },
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
      kind: "answered",
      values: { boundary: "controller", compatible: ["yes"], details: "private text" },
    })

    expect(await clarification).toEqual({
      kind: "answered",
      values: { boundary: "controller", compatible: ["yes"], details: "private text" },
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
      terminalKind: "answered",
      hasSingle: true,
      hasMulti: true,
      hasText: true,
      fieldCountBucket: "two_to_three",
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

describe("createSessionController - dynamic conversation actions", () => {
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
        sessions: [{ provider: "claude-code", cwd: process.cwd() }],
        mcpServers: [],
        shell: APP_CONFIG.shell,
        persistenceEnabled: true,
        telemetryEnabled: false,
        theme: "auto",
        welcomeBanner: "auto",
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
      providers: PROVIDERS,
      sessions: [{ provider: "claude-code", cwd: process.cwd(), title: "Planner" }],
    }
    const controller = await createSessionController({
      config,
      cwd: CWD,
      createConnection: () => claude.connection,
      createShellRuntime: createTestShellFactory(),
      newInteractionId: () => "clarification-integration",
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
      kind: "answered",
      values: { boundary: "controller" },
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
