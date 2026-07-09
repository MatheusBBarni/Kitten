import { describe, expect, it } from "bun:test"

import {
  createAgentConnection,
  type AgentConnection,
  type PermissionOutcome,
  type PermissionRequest,
  type PromptBlock,
  type ReadyState,
} from "../agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import type { AgentConfig, AgentId, AppConfig, DomainSessionEvent } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import { startMockAgent, type MockAgentHandle, type MockAgentOptions } from "../../test/mockAgent.ts"
import { composePromptBlocks, createControllerActions, nextAgentId } from "./actions.ts"
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
const APP_CONFIG: AppConfig = { agents: [CLAUDE, CODEX], telemetryEnabled: false }
const CWD = "/workspace/kitten"

const PERMISSION_REQUEST: PermissionRequest = {
  sessionId: "claude-code-session",
  toolCall: { toolCallId: "call-1", kind: "edit", title: "Edit src/index.ts" },
  options: [
    { optionId: "allow", name: "Allow once", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
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
  readonly isDisposed: () => boolean
}

interface StubOptions {
  ready?: ReadyState
  sessionId?: string
  connectThrows?: unknown
  newSessionThrows?: unknown
  promptThrows?: unknown
  cancelThrows?: unknown
}

function createStubConnection(id: AgentId, options: StubOptions = {}): StubConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  const prompts: Array<{ sessionId: string; blocks: PromptBlock[] }> = []
  const cancels: string[] = []
  const newSessionCwds: string[] = []
  let permissionHandler: ((request: PermissionRequest) => Promise<PermissionOutcome>) | null = null
  let disposed = false

  return {
    id,
    prompts,
    cancels,
    newSessionCwds,
    isDisposed: () => disposed,
    async connect() {
      if (options.connectThrows !== undefined) throw options.connectThrows
      return options.ready ?? { ready: true, protocolVersion: 1 }
    },
    async newSession(cwd) {
      newSessionCwds.push(cwd)
      if (options.newSessionThrows !== undefined) throw options.newSessionThrows
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
    emit(event) {
      for (const subscriber of subscribers) subscriber(event)
    },
    ask(request) {
      if (!permissionHandler) throw new Error("no permission handler registered")
      return permissionHandler(request)
    },
  }
}

/** Build a controller over one stub connection per configured agent. */
async function controllerWithStubs(
  stubs: Partial<Record<AgentId, StubOptions>> = {},
  overrides: { onError?: (agentId: AgentId, error: unknown) => void } = {},
): Promise<{ controller: SessionController; connections: Record<AgentId, StubConnection> }> {
  const connections = {
    "claude-code": createStubConnection("claude-code", stubs["claude-code"]),
    codex: createStubConnection("codex", stubs.codex),
  } satisfies Record<AgentId, StubConnection>

  const controller = await createSessionController({
    config: APP_CONFIG,
    cwd: CWD,
    createConnection: (config) => connections[config.id],
    newMessageId: () => "msg-1",
    onError: overrides.onError,
  })
  return { controller, connections }
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

describe("nextAgentId", () => {
  it("Should cycle through the agents in cockpit order", () => {
    expect(nextAgentId("claude-code")).toBe("codex")
    expect(nextAgentId("codex")).toBe("claude-code")
  })
})

describe("createSessionController - startup", () => {
  it("Should connect every agent and open one session against the cwd", async () => {
    const { controller, connections } = await controllerWithStubs()

    expect(connections["claude-code"].newSessionCwds).toEqual([CWD])
    expect(connections.codex.newSessionCwds).toEqual([CWD])
    expect(controller.store.getState().sessions["claude-code"].sessionId).toBe("claude-code-session")
    expect(controller.store.getState().sessions.codex.sessionId).toBe("codex-session")
    expect(controller.runtimes()).toEqual([
      { agentId: "claude-code", displayName: "Claude Code", ready: true, sessionId: "claude-code-session" },
      { agentId: "codex", displayName: "Codex", ready: true, sessionId: "codex-session" },
    ])
    expect(controller.isReady("claude-code")).toBe(true)

    await controller.dispose()
  })

  it("Should focus the first configured agent when it is ready", async () => {
    const { controller } = await controllerWithStubs()
    expect(controller.store.getState().focusedAgentId).toBe("claude-code")
    await controller.dispose()
  })

  it("Should dispatch each agent's updates into that agent's slice only", async () => {
    const { controller, connections } = await controllerWithStubs()

    connections["claude-code"].emit({ kind: "agent_message", messageId: "m1", textDelta: "hello" })

    const state = controller.store.getState()
    expect(state.sessions["claude-code"].turns).toEqual([{ kind: "agent", messageId: "m1", text: "hello" }])
    expect(state.sessions.codex.turns).toEqual([])

    await controller.dispose()
  })
})

describe("createSessionController - degraded startup", () => {
  it("Should report a rejected handshake as not-ready and keep the other agent usable", async () => {
    const { controller, connections } = await controllerWithStubs({
      "claude-code": { ready: { ready: false, error: "not logged in" } },
    })

    expect(controller.runtime("claude-code")).toEqual({
      agentId: "claude-code",
      displayName: "Claude Code",
      ready: false,
      error: "not logged in",
    })
    expect(controller.isReady("claude-code")).toBe(false)
    expect(controller.isReady("codex")).toBe(true)
    // The connection that never came up is released, not leaked.
    expect(connections["claude-code"].isDisposed()).toBe(true)
    expect(connections["claude-code"].newSessionCwds).toEqual([])

    // Focus falls through to the agent that did come up.
    expect(controller.store.getState().focusedAgentId).toBe("codex")
    await controller.actions.sendPrompt("still works")
    expect(connections.codex.prompts).toHaveLength(1)

    await controller.dispose()
  })

  it("Should report a thrown connect as not-ready without rejecting", async () => {
    const errors: Array<[AgentId, unknown]> = []
    const { controller } = await controllerWithStubs(
      { codex: { connectThrows: new Error("spawn ENOENT") } },
      { onError: (agentId, error) => errors.push([agentId, error]) },
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
    expect(controller.store.getState().focusedAgentId).toBe("claude-code")

    await controller.dispose()
  })

  it("Should leave focus alone when no agent is ready", async () => {
    const { controller } = await controllerWithStubs({
      "claude-code": { ready: { ready: false, error: "down" } },
      codex: { ready: { ready: false, error: "down" } },
    })

    expect(controller.store.getState().focusedAgentId).toBe("claude-code")
    expect(controller.runtimes().every((runtime) => !runtime.ready)).toBe(true)
    // A not-ready agent has no session, so the action surface is inert rather than fatal.
    expect(await controller.actions.sendPrompt("hello")).toBeNull()
    await controller.actions.cancel()

    await controller.dispose()
  })

  it("Should not know an agent the config never named", async () => {
    const { controller } = await controllerWithStubs()
    expect(controller.runtime("nope" as AgentId)).toBeUndefined()
    expect(controller.isReady("nope" as AgentId)).toBe(false)
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
    expect(controller.store.getState().sessions["claude-code"].turns).toEqual([
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
    expect(controller.store.getState().focusedAgentId).toBe("claude-code")

    await controller.dispose()
  })

  it("Should send nothing for a blank prompt", async () => {
    const { controller, connections } = await controllerWithStubs()

    expect(await controller.actions.sendPrompt("  \n  ")).toBeNull()
    expect(connections["claude-code"].prompts).toEqual([])
    expect(controller.store.getState().sessions["claude-code"].turns).toEqual([])

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
      config: { agents: [CLAUDE], telemetryEnabled: false },
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

describe("actions - switchFocus", () => {
  it("Should move focus and leave both sessions live and addressable", async () => {
    const { controller, connections } = await controllerWithStubs()
    const before = controller.store.getState().sessions

    controller.actions.switchFocus("codex")

    const state = controller.store.getState()
    expect(state.focusedAgentId).toBe("codex")
    expect(state.sessions["claude-code"]).toBe(before["claude-code"])
    expect(state.sessions["claude-code"].sessionId).toBe("claude-code-session")
    expect(state.sessions.codex.sessionId).toBe("codex-session")

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
    expect(controller.store.getState().focusedAgentId).toBe("codex")
    controller.actions.switchFocus()
    expect(controller.store.getState().focusedAgentId).toBe("claude-code")

    await controller.dispose()
  })
})

describe("actions - respondPermission", () => {
  it("Should open the approval overlay with the requesting agent's request", async () => {
    const { controller, connections } = await controllerWithStubs()

    const pending = connections["claude-code"].ask(PERMISSION_REQUEST)

    expect(controller.store.getState().overlays.approval).toEqual({
      agentId: "claude-code",
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

    expect(controller.store.getState().overlays.approval?.agentId).toBe("claude-code")

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    expect(await first).toEqual({ outcome: "selected", optionId: "allow" })
    expect(controller.store.getState().overlays.approval?.agentId).toBe("codex")

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
    expect(controller.store.getState().sessions.codex.turns).toEqual([])
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
      config: { agents: [CLAUDE], telemetryEnabled: false },
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
      getSession: () => ({ agentId: "claude-code", sessionId: "s1", connection }),
      resolvePermission: () => {},
    })

    await actions.sendPrompt("one")
    await actions.sendPrompt("two")

    const messageIds = store
      .getState()
      .sessions["claude-code"].turns.map((turn) => (turn.kind === "user" ? turn.messageId : null))
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
      getSession: () => ({ agentId: "codex", sessionId: "s1", connection }),
      resolvePermission: () => {},
    })

    expect(await actions.sendPrompt("x", "codex")).toBeNull()
    await actions.cancel("codex")
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
    const connections: Record<AgentId, AgentConnection> = {
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
    expect(state.sessions["claude-code"].turns.at(-1)).toEqual({ kind: "agent", messageId: "", text: "on it" })
    expect(state.sessions["claude-code"].status).toBe("idle")

    // B never saw the prompt, stayed idle, and is still addressable.
    expect(codex.agent.prompts).toHaveLength(0)
    expect(state.sessions.codex.turns).toEqual([])
    expect(state.sessions.codex.status).toBe("idle")
    expect(state.sessions.codex.sessionId).toBe("codex-session")

    controller.actions.switchFocus("codex")
    await controller.actions.sendPrompt("your turn")
    expect(codex.agent.prompts).toHaveLength(1)
    expect(controller.store.getState().sessions.codex.turns.at(0)).toMatchObject({ kind: "user", text: "your turn" })

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
    const connections: Record<AgentId, AgentConnection> = {
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
    expect(approval.agentId).toBe("claude-code")
    expect(approval.request.toolCall).toMatchObject({ toolCallId: "call-1", kind: "edit", title: "Edit README.md" })
    expect(approval.request.options.map((option) => option.optionId)).toEqual(["allow", "reject"])
    expect(controller.store.getState().sessions["claude-code"].status).toBe("awaiting_approval")

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    await prompt

    expect(claude.agent.permissionOutcomes).toEqual([{ outcome: "selected", optionId: "allow" }])
    expect(controller.store.getState().overlays.approval).toBeNull()
    expect(controller.store.getState().sessions["claude-code"].status).toBe("idle")

    await controller.dispose()
  })

  it("Should mark an agent whose handshake is rejected not-ready while the other stays usable", async () => {
    const claude = connectionToMockAgent(CLAUDE, {
      onInitialize: () => {
        throw new Error("authenticate first")
      },
    })
    const codex = connectionToMockAgent(CODEX, { sessionId: "codex-session" })
    const connections: Record<AgentId, AgentConnection> = {
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
    expect(controller.store.getState().focusedAgentId).toBe("codex")

    const result = await controller.actions.sendPrompt("carry on")
    expect(result).toEqual({ stopReason: "end_turn" })
    expect(codex.agent.prompts).toHaveLength(1)

    await controller.dispose()
  })
})
