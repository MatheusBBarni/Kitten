import { describe, expect, it } from "bun:test"

import type {
  AgentConnection,
  AgentPromptInput,
  PermissionOutcome,
  PermissionRequest,
} from "../src/agent/agentConnection.ts"
import { createSessionController } from "../src/app/controller.ts"

import {
  createDelegationState,
  delegationReducer,
  selectDelegationTerminalOutcomes,
  selectOrderedDelegatedChildren,
} from "../src/core/orchestration.ts"
import type {
  AppConfig,
  ClarificationOutcome,
  ClarificationPayload,
  ConfigOption,
  DelegationEvent,
  DomainSessionEvent,
  ProviderKind,
} from "../src/core/types.ts"

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
