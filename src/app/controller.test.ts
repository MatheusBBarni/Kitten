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
import type { AgentConfig, AppConfig, ConfigOption, DomainSessionEvent, ProviderKind, SessionId } from "../core/types.ts"
import { selectAgentModel } from "../store/selectors.ts"
import { createAppStore } from "../store/appStore.ts"
import { startMockAgent, type MockAgentHandle, type MockAgentOptions } from "../../test/mockAgent.ts"
import { composePromptBlocks, createControllerActions, nextSessionId, type ActionTelemetry } from "./actions.ts"
import { createSessionController, type SessionController } from "./controller.ts"

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
const PROVIDERS: AppConfig["providers"] = {
  "claude-code": { displayName: CLAUDE.displayName, command: CLAUDE.command, args: CLAUDE.args, env: CLAUDE.env },
  codex: { displayName: CODEX.displayName, command: CODEX.command, args: CODEX.args, env: CODEX.env },
}
const APP_CONFIG: AppConfig = { providers: PROVIDERS, sessions: [], telemetryEnabled: false }
const CWD = "/workspace/kitten"

const PERMISSION_REQUEST: PermissionRequest = {
  sessionId: "claude-code-session",
  toolCall: { toolCallId: "call-1", kind: "edit", title: "Edit src/index.ts" },
  options: [
    { optionId: "allow", name: "Allow once", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
}

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
  readonly prompts: Array<{ sessionId: string; blocks: PromptBlock[] }>
  readonly cancels: string[]
  readonly newSessionCwds: string[]
  /** Every `setSessionConfigOption` call the controller made, in order. */
  readonly configCalls: Array<{ sessionId: string; configId: string; value: string }>
  readonly isDisposed: () => boolean
}

interface StubOptions {
  ready?: ReadyState
  sessionId?: string
  connectThrows?: unknown
  newSessionThrows?: unknown
  promptThrows?: unknown
  cancelThrows?: unknown
  /** The full option set `setSessionConfigOption` echoes back (the confirmed state). */
  configResponse?: ConfigOption[]
  /** Make `setSessionConfigOption` reject, to exercise the action's error path. */
  setConfigThrows?: unknown
  /** Options the agent advertises during `newSession`, emitted so the controller can seed them. */
  newSessionConfig?: ConfigOption[]
}

function createStubConnection(id: ProviderKind, options: StubOptions = {}): StubConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  const prompts: Array<{ sessionId: string; blocks: PromptBlock[] }> = []
  const cancels: string[] = []
  const newSessionCwds: string[] = []
  const configCalls: Array<{ sessionId: string; configId: string; value: string }> = []
  let permissionHandler: ((request: PermissionRequest) => Promise<PermissionOutcome>) | null = null
  let disposed = false

  const emit = (event: DomainSessionEvent): void => {
    for (const subscriber of subscribers) subscriber(event)
  }

  return {
    id,
    prompts,
    cancels,
    newSessionCwds,
    configCalls,
    isDisposed: () => disposed,
    async connect() {
      if (options.connectThrows !== undefined) throw options.connectThrows
      return options.ready ?? { ready: true, protocolVersion: 1 }
    },
    async newSession(cwd) {
      newSessionCwds.push(cwd)
      if (options.newSessionThrows !== undefined) throw options.newSessionThrows
      // Mirror the adapter: an agent that advertises config at session start emits it
      // as a `config_options` event during `newSession`, before the controller binds
      // its permanent subscription - the seed the controller must capture and replay.
      if (options.newSessionConfig !== undefined) emit({ kind: "config_options", options: options.newSessionConfig })
      return options.sessionId ?? `${id}-session`
    },
    async prompt(sessionId, blocks) {
      prompts.push({ sessionId, blocks })
      if (options.promptThrows !== undefined) throw options.promptThrows
      return { stopReason: "end_turn" }
    },
    async cancel(sessionId) {
      cancels.push(sessionId)
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
    async dispose() {
      disposed = true
    },
    emit,
    ask(request) {
      if (!permissionHandler) throw new Error("no permission handler registered")
      return permissionHandler(request)
    },
  }
}

/** Build a controller over one stub connection per configured agent. */
async function controllerWithStubs(
  stubs: Partial<Record<ProviderKind, StubOptions>> = {},
  overrides: { onError?: (sessionId: SessionId, error: unknown) => void; recorder?: ActionTelemetry } = {},
): Promise<{ controller: SessionController; connections: Record<ProviderKind, StubConnection> }> {
  const connections = {
    "claude-code": createStubConnection("claude-code", stubs["claude-code"]),
    codex: createStubConnection("codex", stubs.codex),
  } satisfies Record<ProviderKind, StubConnection>

  const controller = await createSessionController({
    config: APP_CONFIG,
    cwd: CWD,
    createConnection: (config) => connections[config.id],
    newMessageId: () => "msg-1",
    onError: overrides.onError,
    recorder: overrides.recorder,
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
  telemetryEnabled: false,
}

/**
 * Build a controller over a fresh stub per session, capturing every stub created in
 * plan order. Lets a test inspect the `newSession` directory and permission handler of
 * each individual session - including two sessions that share a provider kind.
 */
async function controllerOverFleet(
  config: AppConfig,
  optionsFor: (index: number) => StubOptions = () => ({}),
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
  })
  return { controller, created }
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
  it("Should connect every agent and open one session against the cwd", async () => {
    const { controller, connections } = await controllerWithStubs()

    expect(connections["claude-code"].newSessionCwds).toEqual([CWD])
    expect(connections.codex.newSessionCwds).toEqual([CWD])
    expect(controller.store.getState().sessions["claude-code"]!.acpSessionId).toBe("claude-code-session")
    expect(controller.store.getState().sessions.codex!.acpSessionId).toBe("codex-session")
    expect(controller.runtimes()).toEqual([
      {
        sessionId: "claude-code",
        providerKind: "claude-code",
        displayName: "Claude Code",
        title: "Claude Code",
        cwd: CWD,
        ready: true,
        acpSessionId: "claude-code-session",
      },
      {
        sessionId: "codex",
        providerKind: "codex",
        displayName: "Codex",
        title: "Codex",
        cwd: CWD,
        ready: true,
        acpSessionId: "codex-session",
      },
    ])
    expect(controller.isReady("claude-code")).toBe(true)

    await controller.dispose()
  })

  it("Should focus the first configured agent when it is ready", async () => {
    const { controller } = await controllerWithStubs()
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
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
})

describe("createSessionController - degraded startup", () => {
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
    })
    expect(controller.isReady("claude-code")).toBe(false)
    expect(controller.isReady("codex")).toBe(true)
    // The connection that never came up is released, not leaked.
    expect(connections["claude-code"].isDisposed()).toBe(true)
    expect(connections["claude-code"].newSessionCwds).toEqual([])

    // Focus falls through to the agent that did come up.
    expect(controller.store.getState().focusedSessionId).toBe("codex")
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
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")

    await controller.dispose()
  })

  it("Should leave focus alone when no agent is ready", async () => {
    const { controller } = await controllerWithStubs({
      "claude-code": { ready: { ready: false, error: "down" } },
      codex: { ready: { ready: false, error: "down" } },
    })

    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
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
      telemetryEnabled: false,
    }
    const { controller, created } = await controllerOverFleet(config)

    await waitFor(() => created[0]!.prompts.length === 1, "the opening task prompt to be sent")
    expect(created[0]!.prompts[0]!.blocks).toEqual([{ type: "text", text: "start the build" }])
    // The opening prompt is recorded as the session's first user turn.
    expect(controller.store.getState().sessions.codex!.turns).toEqual([
      { kind: "user", messageId: "msg-1", text: "start the build" },
    ])

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
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")

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
      config: { providers: PROVIDERS, sessions: [{ provider: "claude-code", cwd: process.cwd() }], telemetryEnabled: false },
      cwd: CWD,
      createConnection: () => connection,
    })

    expect(await controller.actions.sendPrompt("hi")).toBeNull()
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

    await controller.actions.setSessionConfigOption("model", "opus", "codex")

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

    await controller.actions.setSessionConfigOption("model", "opus", "codex")

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

    await controller.actions.setSessionConfigOption("model", "opus", "codex")

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
    await controller.actions.setSessionConfigOption("model", "opus", "claude-code")
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

    await controller.actions.setSessionConfigOption("model", "sonnet", "claude-code")

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
    expect(state.focusedSessionId).toBe("codex")
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
    expect(controller.store.getState().focusedSessionId).toBe("codex")
    controller.actions.switchFocus()
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")

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

describe("createSessionController - dispose", () => {
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
      config: { providers: PROVIDERS, sessions: [{ provider: "claude-code", cwd: process.cwd() }], telemetryEnabled: false },
      cwd: CWD,
      createConnection: () => connection,
    })

    await controller.dispose()
    expect(controller.runtime("claude-code")).toMatchObject({ ready: true })
  })
})

describe("createControllerActions", () => {
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

    expect(store.getState().focusedSessionId).toBe("c")
  })

  it("Should leave focus alone when no other session needs attention", () => {
    const store = createAppStore()
    const actions = createControllerActions({ store, getSession: () => undefined, resolvePermission: () => {} })

    actions.jumpToNextNeedy()

    expect(store.getState().focusedSessionId).toBe("claude-code")
  })

  it("Should count an overview switch through the numerator but a blind Ctrl+O only through the denominator", () => {
    const store = createAppStore()
    const switches: { sessionId: string; viaOverview: boolean }[] = []
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      recorder: { focusSwitch: (sessionId, viaOverview) => switches.push({ sessionId, viaOverview }) },
    })

    // A blind Ctrl+O cycle from "claude-code" to "codex": denominator only.
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
  it("Should stream a prompt into the addressed agent's slice while the other stays idle", async () => {
    const claude = connectionToMockAgent(CLAUDE, {
      sessionId: "claude-session",
      onPrompt: async (_request, ctx) => {
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "on " } })
        await ctx.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "it" } })
      },
    })
    const codex = connectionToMockAgent(CODEX, { sessionId: "codex-session" })
    const connections: Record<ProviderKind, AgentConnection> = {
      "claude-code": claude.connection,
      codex: codex.connection,
    }

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => connections[config.id],
    })

    const result = await controller.actions.sendPrompt("do the thing")
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
    const connections: Record<ProviderKind, AgentConnection> = {
      "claude-code": claude.connection,
      codex: codex.connection,
    }

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => connections[config.id],
    })

    const prompt = controller.actions.sendPrompt("edit the readme")
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
    })

    // Three live runtimes, two sharing a provider, each with a distinct SessionId.
    expect(controller.runtimes().map((runtime) => runtime.sessionId)).toEqual(["claude-code", "claude-code-2", "codex"])
    expect(controller.runtimes().every((runtime) => runtime.ready)).toBe(true)
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")

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
    const connections: Record<ProviderKind, AgentConnection> = {
      "claude-code": claude.connection,
      codex: codex.connection,
    }

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: CWD,
      createConnection: (config) => connections[config.id],
    })

    const claudeRuntime = controller.runtime("claude-code")!
    expect(claudeRuntime.ready).toBe(false)
    expect(claudeRuntime.ready === false && claudeRuntime.error).toContain("authenticate first")

    expect(controller.isReady("codex")).toBe(true)
    expect(controller.store.getState().focusedSessionId).toBe("codex")

    const result = await controller.actions.sendPrompt("carry on")
    expect(result).toEqual({ stopReason: "end_turn" })
    expect(codex.agent.prompts).toHaveLength(1)

    await controller.dispose()
  })
})
