import { describe, expect, it } from "bun:test"

import type {
  AgentConnection,
  AgentPromptInput,
  PermissionOutcome,
  PermissionRequest,
} from "../src/agent/agentConnection.ts"
import { createAgentConnection } from "../src/agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../src/agent/transport.ts"
import { createSessionController } from "../src/app/controller.ts"
import type {
  AgentRunControl,
  KittenMcpBridge,
  KittenMcpBridgeOptions,
} from "../src/app/kittenMcpBridge.ts"
import type { ManagedWorktreeProvisioner } from "../src/app/managedWorktree.ts"
import { HARNESS_CONTRACT_SDK_VERSION, type CertifiedHarnessProfile } from "../src/config/harnessCapability.ts"

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
  ManagedWorktreeBinding,
  ProviderKind,
  ResolvedAgentConfig,
  SessionId,
  SessionSeed,
} from "../src/core/types.ts"
import { createInMemoryShellRuntimeFactory } from "../src/shell/shellRuntime.ts"
import { createAppStore, type AppState } from "../src/store/appStore.ts"
import { startMockAgent } from "./mockAgent.ts"

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

function captureAgentRunControl(): {
  readonly factory: (options: KittenMcpBridgeOptions) => KittenMcpBridge
  control(): AgentRunControl
} {
  let control: AgentRunControl | null = null
  return {
    factory(options) {
      if (!options.agentRunControl) throw new Error("agent-run control missing")
      control = options.agentRunControl
      return {
        register(input) {
          return {
            name: "kitten-ask-user",
            command: "kitten-test-mcp",
            args: [],
            env: { KITTEN_TEST_ROUTE: `${input.sessionId}:${input.generation}` },
          }
        },
        async ask() {
          return { kind: "cancelled" }
        },
        cancelSession() {},
        async dispose() {},
      }
    },
    control() {
      if (!control) throw new Error("agent-run control unavailable")
      return control
    },
  }
}

function managedBinding(ownerSessionId: SessionId): ManagedWorktreeBinding {
  return {
    kind: "managed",
    id: `kw-${ownerSessionId}`,
    repoRoot: process.cwd(),
    worktreePath: `${process.cwd()}/.kitten-test/${ownerSessionId}`,
    branch: `kitten/${ownerSessionId}`,
    baseBranch: "main",
    baseSha: "a".repeat(40),
    ownerSessionId,
    availability: "available",
  }
}

function inMemoryManagedWorktrees(): ManagedWorktreeProvisioner {
  return {
    async provision({ ownerSessionId }) {
      return { kind: "provisioned", binding: managedBinding(ownerSessionId) }
    },
    async reconcile(binding) {
      return { kind: "available", binding }
    },
    async cleanup() {
      return { kind: "removed" }
    },
  }
}

function exploreCapability(config: ResolvedAgentConfig) {
  const decision = evaluateExplorePolicy({
    role: "explore",
    restrictions: EXPLORE_RESTRICTIONS,
    limits: { perParent: 4, global: 4 },
    attestationVersion: "integration-agent-run-v1",
    confirmed: { provider: config.id, model: "test-model", effort: "low" },
  })
  if (decision.kind !== "eligible") return { status: "unsupported" as const, reason: decision.reason }
  return {
    status: "supported" as const,
    policy: decision.policy,
    recipe: { ...config, args: [...config.args], env: { ...config.env } },
  }
}

function certifiedHarnessProfile(config: ResolvedAgentConfig): CertifiedHarnessProfile {
  return {
    profileId: "orchestration-integration",
    encoder: "codex-prompt-meta-v1",
    sdkVersion: HARNESS_CONTRACT_SDK_VERSION,
    recipe: {
      providerKind: config.id,
      command: config.command,
      args: [...config.args],
      env: { ...config.env },
      adapterPackage: "@agentclientprotocol/codex-acp",
      adapterVersion: "0.13.0",
    },
  }
}

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  return { promise: new Promise<void>((done) => { resolve = done }), resolve: () => resolve() }
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${label}`)
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

  it("drives four fake-ACP children through visible mixed lifecycle polling and rejects a replaced route", async () => {
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
    const runningGate = deferred()
    const pairs = Array.from({ length: 6 }, () => createInMemoryTransportPair())
    const agents = [
      startMockAgent(pairs[0]!.agent, { sessionId: "parent-acp" }),
      startMockAgent(pairs[1]!.agent, {
        sessionId: "running-acp",
        onPrompt: async () => { await runningGate.promise },
      }),
      startMockAgent(pairs[2]!.agent, {
        sessionId: "attention-acp",
        onPrompt: async (_prompt, context) => {
          await context.requestPermission(
            { toolCallId: "attention-call", kind: "edit", title: "Review child change" },
            [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
          )
        },
      }),
      startMockAgent(pairs[3]!.agent, { sessionId: "finished-acp" }),
      startMockAgent(pairs[4]!.agent, {
        sessionId: "failed-acp",
        onPrompt: () => { throw new Error("scripted child failure") },
      }),
      startMockAgent(pairs[5]!.agent, { sessionId: "replacement-parent-acp" }),
    ]
    const bridge = captureAgentRunControl()
    const childIds = ["running-child", "attention-child", "finished-child", "failed-child"]
    let childIndex = 0
    let connectionIndex = 0
    const controller = await createSessionController({
      config,
      cwd: process.cwd(),
      createConnection(resolved) {
        const index = connectionIndex++
        return createAgentConnection({
          config: resolved,
          transport: () => ({
            stream: pairs[index]!.client,
            onClose: () => {},
            dispose: async () => {},
          }),
          scheduler: { schedule: (flush) => flush(), dispose: () => {} },
          harnessProfiles: [certifiedHarnessProfile(resolved)],
        })
      },
      createKittenMcpBridge: bridge.factory,
      createShellRuntime: createInMemoryShellRuntimeFactory().factory,
      managedWorktreeProvisioner: inMemoryManagedWorktrees(),
      newSessionId: () => childIds[childIndex++]!,
      now: () => 4242,
      readBranch: async () => null,
      resolveExploreCapability: exploreCapability,
      resolveHarnessCapability: () => ({
        status: "supported",
        profileId: "orchestration-integration",
        encoder: "codex-prompt-meta-v1",
      }),
      sendInitialTasks: false,
    })
    const parentId = controller.store.getState().workspace.selectedVisibleId!
    const route = { parentId, parentGeneration: 1 }
    const control = bridge.control()
    const launch = control.start(route, childIds.map((childId) => ({
      task: `Run ${childId}`,
      desiredOutcome: `Report ${childId}`,
    })))

    await waitUntil(() => {
      const children = controller.store.getState().delegation.children
      return children["running-child"]?.status === "running" &&
        children["attention-child"]?.status === "needs_input" &&
        children["finished-child"]?.status === "finished" &&
        children["failed-child"]?.status === "failed"
    }, "four mixed child lifecycle states")

    expect(control.poll(route, childIds)).toEqual([
      { childId: "running-child", status: "running" },
      { childId: "attention-child", status: "needs_input" },
      { childId: "finished-child", status: "finished", terminalAt: 4242 },
      { childId: "failed-child", status: "failed", terminalAt: 4242 },
    ])
    expect(() => control.poll(route, ["not-owned"])).toThrow("unavailable")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe(parentId)
    for (const childId of childIds) {
      expect(controller.store.getState().workspace.conversations[childId]).toBeDefined()
      expect(controller.store.getState().sessions[childId]).toBeDefined()
    }

    controller.actions.respondPermission({ outcome: "selected", optionId: "allow" })
    runningGate.resolve()
    expect(await launch).toEqual([
      { childId: "running-child", status: "finished", terminalAt: 4242 },
      { childId: "attention-child", status: "finished", terminalAt: 4242 },
      { childId: "finished-child", status: "finished", terminalAt: 4242 },
      { childId: "failed-child", status: "failed", terminalAt: 4242 },
    ])
    expect(agents.slice(1, 5).every((agent) => agent.prompts.length === 1)).toBe(true)

    await controller.actions.startFreshFromContext("replace the parent generation", parentId)
    await expect(control.start(route, [{ task: "stale", desiredOutcome: "rejected" }])).rejects.toThrow()
    expect(() => control.poll(route, ["finished-child"])).toThrow("unavailable")

    await controller.dispose()
  }, 15_000)
})
