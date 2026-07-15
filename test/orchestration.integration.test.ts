import { describe, expect, it } from "bun:test"

import type {
  AgentConnection,
  AgentPromptInput,
  PermissionOutcome,
  PermissionRequest,
} from "../src/agent/agentConnection.ts"
import { createSessionController } from "../src/app/controller.ts"

import {
  countOccupiedDelegatedChildren,
  createDelegationState,
  delegationReducer,
  selectDelegationTerminalOutcomes,
  selectOrderedDelegatedChildren,
} from "../src/core/orchestration.ts"
import {
  evaluateExplorePolicy,
  EXPLORE_RESTRICTIONS,
} from "../src/core/explorePolicy.ts"
import type {
  AppConfig,
  ClarificationOutcome,
  ClarificationPayload,
  ConfigOption,
  DelegationEvent,
  DomainSessionEvent,
  ProviderKind,
  SessionSeed,
} from "../src/core/types.ts"
import { createAppStore, type AppState } from "../src/store/appStore.ts"

interface InjectedConnection extends AgentConnection {
  readonly prompts: Array<{ sessionId: string; input: AgentPromptInput }>
  emit(event: DomainSessionEvent): void
  ask(request: PermissionRequest): Promise<PermissionOutcome>
}

function injectedConnection(id: ProviderKind, ordinal: number): InjectedConnection {
  const updates = new Set<(event: DomainSessionEvent) => void>()
  let permission: ((request: PermissionRequest) => Promise<PermissionOutcome>) | null = null
  let clarification: ((payload: ClarificationPayload) => Promise<ClarificationOutcome>) | null = null
  const prompts: Array<{ sessionId: string; input: AgentPromptInput }> = []
  return {
    id,
    prompts,
    async connect() {
      return { ready: true, protocolVersion: 1, canLoadSession: false }
    },
    async newSession() {
      return `injected-${ordinal}`
    },
    async loadSession() {},
    async prompt(sessionId, input) {
      prompts.push({ sessionId, input })
      return { stopReason: "end_turn" }
    },
    async cancel() {},
    async setSessionConfigOption(): Promise<ConfigOption[]> {
      return []
    },
    onUpdate(callback) {
      updates.add(callback)
      return () => updates.delete(callback)
    },
    onPermission(handler) {
      permission = handler
    },
    onClarification(handler) {
      clarification = handler
      return () => {
        if (clarification === handler) clarification = null
      }
    },
    async dispose() {},
    emit(event) {
      for (const update of updates) update(event)
    },
    ask(request) {
      if (!permission) throw new Error("permission handler unavailable")
      return permission(request)
    },
  }
}

describe("delegation pure consumer integration", () => {
  it("atomically admits, denies, terminally releases, and removes policy-bearing children", () => {
    const decision = evaluateExplorePolicy({
      role: "explore",
      restrictions: EXPLORE_RESTRICTIONS,
      limits: { perParent: 1, global: 1 },
      attestationVersion: "integration-capacity-v1",
      confirmed: { provider: "codex", model: "test-model", effort: "high" },
    })
    if (decision.kind !== "eligible") throw new Error("expected eligible policy fixture")
    const policy = decision.policy
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const seed = (id: string): SessionSeed => ({
      id,
      providerKind: "codex",
      title: id,
      cwd: "/work/child",
    })
    const registration = (id: string, generation: number) => ({
      seed: seed(id),
      parentId: "claude-code",
      parentGeneration: 1,
      childGeneration: generation,
      task: "Inspect orchestration",
      desiredOutcome: "Return verified findings",
      policy,
    })
    const commits: AppState[] = []
    store.subscribe((state) => commits.push(state))

    expect(store.addDelegatedSession(registration("capacity-child", 1))).toEqual({
      kind: "accepted",
    })
    expect(commits).toHaveLength(1)
    expect(commits[0]?.sessions["capacity-child"]).toBeDefined()
    expect(commits[0]?.workspace.conversations["capacity-child"]?.lifecycle).toBe("background")
    expect(commits[0]?.workspace.selectedVisibleId).toBe("claude-code")
    expect(commits[0]?.delegation.children["capacity-child"]?.policy).toBe(policy)

    const beforeDenial = store.getState()
    expect(store.addDelegatedSession(registration("denied-child", 2))).toEqual({
      kind: "denied",
      reason: "capacity-exhausted",
      scope: "per-parent",
    })
    expect(store.getState()).toBe(beforeDenial)
    expect(commits).toHaveLength(1)

    const identity = {
      parentId: "claude-code",
      childId: "capacity-child",
      parentGeneration: 1,
      childGeneration: 1,
    } as const
    store.publishDelegatedChildState({
      ...identity,
      status: "failed",
      sessionStatus: "error",
      at: 50,
    })
    expect(countOccupiedDelegatedChildren(store.getState().delegation)).toBe(0)
    expect(store.addDelegatedSession(registration("replacement-child", 3))).toEqual({
      kind: "accepted",
    })
    expect(countOccupiedDelegatedChildren(store.getState().delegation)).toBe(1)

    store.removeDelegationChild(identity)
    expect(countOccupiedDelegatedChildren(store.getState().delegation)).toBe(1)
  })

  it("reads two ordered terminal outcomes without importing runtime or ACP types", () => {
    const events: DelegationEvent[] = [
      {
        kind: "register_child",
        parentId: "parent",
        childId: "research",
        parentGeneration: 1,
        childGeneration: 2,
        task: "Research the API",
        desiredOutcome: "A concise recommendation",
      },
      {
        kind: "register_child",
        parentId: "parent",
        childId: "verify",
        parentGeneration: 1,
        childGeneration: 3,
        task: "Verify the implementation",
        desiredOutcome: "A passing test report",
      },
      {
        kind: "publish_child_status",
        parentId: "parent",
        childId: "research",
        parentGeneration: 1,
        childGeneration: 2,
        status: "running",
      },
      {
        kind: "publish_child_status",
        parentId: "parent",
        childId: "verify",
        parentGeneration: 1,
        childGeneration: 3,
        status: "running",
      },
      {
        kind: "publish_child_status",
        parentId: "parent",
        childId: "verify",
        parentGeneration: 1,
        childGeneration: 3,
        status: "failed",
        at: 20,
      },
      {
        kind: "publish_child_status",
        parentId: "parent",
        childId: "research",
        parentGeneration: 1,
        childGeneration: 2,
        status: "finished",
        at: 10,
      },
    ]
    const state = events.reduce(delegationReducer, createDelegationState())

    expect(selectOrderedDelegatedChildren(state, "parent").map((child) => child.desiredOutcome)).toEqual([
      "A concise recommendation",
      "A passing test report",
    ])
    expect(selectDelegationTerminalOutcomes(state, "parent")).toEqual([
      { status: "finished", at: 10 },
      { status: "failed", at: 20 },
    ])
  })

  it("drives delegated launch, prompt, Running, and one child interaction through injected connections", async () => {
    const config: AppConfig = {
      providers: {
        codex: { displayName: "Codex", command: "unused", args: [], env: {} },
      } as unknown as AppConfig["providers"],
      providerDefaults: {},
      sessions: [],
      mcpServers: [],
      shell: { enabled: false, command: "/bin/sh", scrollback: 100 },
      clarificationTimeoutSeconds: 300,
      persistenceEnabled: false,
      telemetryEnabled: false,
      theme: "auto",
      welcomeBanner: "auto",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    }
    const connections: InjectedConnection[] = []
    const controller = await createSessionController({
      config,
      cwd: process.cwd(),
      createConnection(provider) {
        const connection = injectedConnection(provider.id, connections.length)
        connections.push(connection)
        return connection
      },
      newSessionId: () => "integration-child",
      readBranch: async () => null,
      sendInitialTasks: false,
      resolveHarnessCapability: () => ({
        status: "supported",
        profileId: "integration-profile",
        encoder: "codex-prompt-meta-v1",
      }),
      resolveExploreCapability: (provider) => {
        const decision = evaluateExplorePolicy({
          role: "explore",
          restrictions: EXPLORE_RESTRICTIONS,
          limits: { perParent: 1, global: 1 },
          attestationVersion: "integration-launch-v1",
          confirmed: { provider: provider.id, model: "test-model", effort: "low" },
        })
        if (decision.kind !== "eligible") return { status: "unsupported", reason: decision.reason }
        return {
          status: "supported",
          policy: decision.policy,
          recipe: { ...provider, args: [...provider.args], env: { ...provider.env } },
        }
      },
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const childId = await controller.actions.startDelegatedChild({
      parentId,
      task: "Inspect injected orchestration",
      desiredOutcome: "Return one verified interaction",
    })

    expect(childId).toBe("integration-child")
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("running")
    expect(connections[1]?.prompts).toHaveLength(1)

    const permission = connections[1]!.ask({
      sessionId: "injected-1",
      toolCall: { toolCallId: "delegated-call", kind: "edit", title: "Edit controller" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    })
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("needs_input")
    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    expect(await permission).toEqual({ outcome: "selected", optionId: "allow" })
    connections[1]!.emit({ kind: "status", status: "working" })
    expect(controller.store.getState().delegation.children[childId!]?.status).toBe("running")

    await controller.dispose()
  })
})
