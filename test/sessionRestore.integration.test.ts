import { describe, expect, it } from "bun:test"
import { createElement } from "react"

import { testRender } from "@opentui/react/test-utils"

import type {
  AgentConnection,
  AgentPromptInput,
  PermissionOutcome,
  PermissionRequest,
  PromptBlock,
} from "../src/agent/agentConnection.ts"
import { createSessionController } from "../src/app/controller.ts"
import {
  composeHandoffBlocks,
  createHandoffEdits,
} from "../src/app/handoff.ts"
import type { ManagedWorktreeProvisioner } from "../src/app/managedWorktree.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import {
  evaluateExplorePolicy,
  EXPLORE_RESTRICTIONS,
} from "../src/core/explorePolicy.ts"
import type {
  ClarificationOutcome,
  ClarificationPayload,
  DomainSessionEvent,
  HandoffBundle,
  ManagedWorktreeBinding,
  ProviderKind,
  SessionId,
} from "../src/core/types.ts"
import {
  selectDelegationAggregateStatus,
  selectOrderedDelegatedChildren,
} from "../src/core/orchestration.ts"
import type { PersistedRunRecord } from "../src/persistence/runRecord.ts"
import { createRunWriter } from "../src/persistence/runWriter.ts"
import type { RunStore } from "../src/persistence/runStore.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { CockpitApp } from "../src/ui/CockpitApp.tsx"
import {
  RESTORATION_UNAVAILABLE_LABEL,
  START_FRESH_LABEL,
} from "../src/ui/ConversationView.tsx"
import { actAsync, destroyMounted } from "./reactTui.ts"

// Suite: autosave-to-controller restore integration
// Invariant: a writer-produced pointer record replaces populated panes through fake live replay.
// Boundary IN: RunWriter snapshot plus SessionController.restore and real AppStore reduction
// Boundary OUT: real ACP transports and filesystem persistence

function recordingRunStore(): RunStore & { record: PersistedRunRecord | null } {
  return {
    record: null,
    save(record) {
      this.record = record
    },
    list: () => [],
    load: () => null,
    delete() {},
    deleteAll() {},
    flush() {},
  }
}

function fakeConnection(
  id: ProviderKind,
  prompts: Array<{ id: ProviderKind; input: AgentPromptInput }> = [],
): AgentConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  return {
    id,
    connect: async () => ({ ready: true, protocolVersion: 1, canLoadSession: true }),
    newSession: async () => `${id}-startup`,
    async loadSession(sessionId) {
      const event: DomainSessionEvent = {
        kind: "agent_message",
        messageId: `${id}-replay`,
        textDelta: `history from ${sessionId}`,
      }
      for (const subscriber of subscribers) subscriber(event)
    },
    prompt: async (_sessionId, input) => {
      prompts.push({ id, input })
      return { stopReason: "end_turn" }
    },
    cancel: async () => {},
    setSessionConfigOption: async () => [],
    onUpdate(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    onPermission(_handler: (request: PermissionRequest) => Promise<PermissionOutcome>) {},
    onClarification: () => () => {},
    dispose: async () => {},
  }
}

interface LifecycleRestoreConnection extends AgentConnection {
  emit(event: DomainSessionEvent): void
  clarify(payload: ClarificationPayload): Promise<ClarificationOutcome>
  disposeCalls(): number
}

function lifecycleRestoreConnection(id: ProviderKind, ordinal: number): LifecycleRestoreConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  let clarification: ((payload: ClarificationPayload) => Promise<ClarificationOutcome>) | null = null
  let disposals = 0
  return {
    id,
    connect: async () => ({ ready: true, protocolVersion: 1, canLoadSession: true }),
    newSession: async () => `${id}-lifecycle-${ordinal}`,
    loadSession: async () => {},
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => {},
    setSessionConfigOption: async () => [],
    onUpdate(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    onPermission() {},
    onClarification(handler) {
      clarification = handler
      return () => {
        if (clarification === handler) clarification = null
      }
    },
    async dispose() {
      disposals += 1
    },
    emit(event) {
      for (const subscriber of subscribers) subscriber(event)
    },
    clarify(payload) {
      if (!clarification) throw new Error("clarification handler unavailable")
      return clarification(payload)
    },
    disposeCalls: () => disposals,
  }
}

/** Keep controller restore coverage independent of the CI checkout's Git state. */
function inMemoryManagedWorktrees(): ManagedWorktreeProvisioner {
  return {
    async provision({ parentCwd, ownerSessionId }) {
      const binding: ManagedWorktreeBinding = {
        kind: "managed",
        id: `kw-${ownerSessionId}`,
        repoRoot: parentCwd,
        worktreePath: `${parentCwd}/.kitten-test/${ownerSessionId}`,
        branch: `kitten/${ownerSessionId}`,
        baseBranch: "main",
        baseSha: "a".repeat(40),
        ownerSessionId,
        availability: "available",
      }
      return { kind: "provisioned", binding }
    },
    async reconcile(binding) {
      return { kind: "available", binding }
    },
    async cleanup() {
      return { kind: "removed" }
    },
  }
}

describe("writer-produced run restore", () => {
  it("restores focus, live status, ACP ids, and replayed panes into a populated store", async () => {
    const cwd = process.cwd()
    const source = createAppStore()
    source.startSession("claude-code", "claude-persisted")
    source.startSession("codex", "codex-persisted")
    source.applyEvent("claude-code", { kind: "user_message", messageId: "u1", text: "persist this run" })
    source.applyEvent("codex", { kind: "agent_message", messageId: "a1", textDelta: "ready to resume" })
    source.setFocus("codex")

    const runStore = recordingRunStore()
    const times = [1_000, 2_000]
    const writer = createRunWriter({
      enabled: true,
      runStore,
      projectCwd: cwd,
      runId: "writer-run",
      now: () => times.shift() ?? 3_000,
    })
    writer.watch(source)
    writer.dispose()
    const record = runStore.record
    expect(record).not.toBeNull()

    const target = createAppStore()
    const controller = await createSessionController({
      config: { ...defaultAppConfig(), shell: { ...defaultAppConfig().shell, enabled: false } },
      cwd,
      store: target,
      createConnection: (config) => fakeConnection(config.id),
      readBranch: async () => null,
    })
    target.applyEvent("claude-code", { kind: "agent_message", messageId: "stale", textDelta: "replace me" })
    target.applyEvent("codex", { kind: "agent_message", messageId: "stale", textDelta: "replace me too" })

    await controller.restore(record!)

    const state = target.getState()
    expect(state.workspace.selectedVisibleId).toBe("codex")
    expect(state.restoration).toMatchObject({ "claude-code": "live", codex: "live" })
    expect(state.sessions["claude-code"]!.acpSessionId).toBe("claude-persisted")
    expect(state.sessions.codex!.acpSessionId).toBe("codex-persisted")
    expect(state.sessions["claude-code"]!.turns).toEqual([
      { kind: "agent", messageId: "claude-code-replay", text: "history from claude-persisted" },
    ])
    expect(state.sessions.codex!.turns).toEqual([
      { kind: "agent", messageId: "codex-replay", text: "history from codex-persisted" },
    ])

    await controller.dispose()
  })

  it("restores an unresolved V3 checkpoint from V4 without replay and leaves its loaded sibling promptable", async () => {
    const cwd = process.cwd()
    const source = createAppStore()
    source.startSession("claude-code", "claude-persisted")
    source.startSession("codex", "codex-persisted")
    source.applyEvent("claude-code", { kind: "user_message", messageId: "u1", text: "ambiguous first task" })
    source.applyEvent("codex", { kind: "user_message", messageId: "u2", text: "completed first task" })
    source.setHarnessDelivery("claude-code", { version: "v1", generation: 5, state: "in_flight" })
    source.setHarnessDelivery("codex", { version: "v1", generation: 3, state: "delivered" })

    const runStore = recordingRunStore()
    const writer = createRunWriter({
      enabled: true,
      runStore,
      projectCwd: cwd,
      runId: "checkpoint-run",
      now: () => 1_000,
    })
    writer.watch(source)
    writer.dispose()
    expect(runStore.record?.version).toBe(4)

    const prompts: Array<{ id: ProviderKind; input: AgentPromptInput }> = []
    const controller = await createSessionController({
      config: { ...defaultAppConfig(), shell: { ...defaultAppConfig().shell, enabled: false } },
      cwd,
      createConnection: (config) => fakeConnection(config.id, prompts),
      readBranch: async () => null,
      sendInitialTasks: false,
    })
    await controller.restore(runStore.record!)

    expect(controller.store.getState().harnessDeliveries["claude-code"]).toMatchObject({
      state: "failed",
      failureCategory: "dispatch_indeterminate",
    })
    expect(await controller.actions.sendPrompt("must not replay", "claude-code")).toBeNull()
    expect(await controller.actions.sendPrompt("continue safely", "codex")).toEqual({ stopReason: "end_turn" })
    expect(prompts).toEqual([{ id: "codex", input: [{ type: "text", text: "continue safely" }] }])
    expect(controller.store.getState().harnessDeliveries.codex?.state).toBe("not_required")

    await controller.dispose()
  })

  it("restores over delegated ownership, settles its pending interaction once, and ignores old callbacks", async () => {
    const cwd = process.cwd()
    const source = createAppStore()
    source.startSession("claude-code", "claude-persisted")
    source.startSession("codex", "codex-persisted")
    source.setFocus("claude-code")
    const persistedPolicy = evaluateExplorePolicy({
      role: "explore",
      restrictions: EXPLORE_RESTRICTIONS,
      limits: { perParent: 1, global: 1 },
      attestationVersion: "RESTORE_ATTESTATION_SENTINEL",
      confirmed: {
        provider: "claude-code",
        model: "RESTORE_MODEL_SENTINEL",
        effort: "RESTORE_EFFORT_SENTINEL",
      },
    })
    if (persistedPolicy.kind !== "eligible") throw new Error("test policy must be eligible")
    source.addDelegatedSession({
      seed: {
        id: "persisted-ordinary-child",
        providerKind: "claude-code",
        title: "Persisted ordinary child",
        cwd,
      },
      parentId: "claude-code",
      parentGeneration: 10,
      childGeneration: 11,
      task: "Ephemeral delegated task",
      desiredOutcome: "Ephemeral delegated outcome",
      policy: persistedPolicy.policy,
      displayName: "Persisted ordinary child",
    })
    source.startSession("persisted-ordinary-child", "persisted-child-acp")
    source.publishDelegatedChildState({
      parentId: "claude-code",
      childId: "persisted-ordinary-child",
      parentGeneration: 10,
      childGeneration: 11,
      status: "finished",
      sessionStatus: "finished",
      at: 123,
    })
    const runStore = recordingRunStore()
    const writer = createRunWriter({
      enabled: true,
      runStore,
      projectCwd: cwd,
      runId: "delegated-restore",
      now: () => 1_000,
    })
    writer.watch(source)
    writer.dispose()
    const serializedRun = JSON.stringify(runStore.record)
    for (const forbidden of [
      '"delegation"',
      '"policy"',
      '"restrictions"',
      '"limits"',
      '"attestationVersion"',
      '"confirmed"',
      "RESTORE_ATTESTATION_SENTINEL",
      "RESTORE_MODEL_SENTINEL",
      "RESTORE_EFFORT_SENTINEL",
      "Ephemeral delegated task",
      "Ephemeral delegated outcome",
    ]) expect(serializedRun).not.toContain(forbidden)

    const created: LifecycleRestoreConnection[] = []
    const controller = await createSessionController({
      config: { ...defaultAppConfig(), shell: { ...defaultAppConfig().shell, enabled: false } },
      cwd,
      createConnection(config) {
        const connection = lifecycleRestoreConnection(config.id, created.length)
        created.push(connection)
        return connection
      },
      newSessionId: () => "restore-owned-child",
      readBranch: async () => null,
      sendInitialTasks: false,
      managedWorktreeProvisioner: inMemoryManagedWorktrees(),
      resolveHarnessCapability: () => ({
        status: "supported",
        profileId: "restore-lifecycle-test",
        encoder: "codex-prompt-meta-v1",
      }),
      resolveExploreCapability: (provider) => {
        const decision = evaluateExplorePolicy({
          role: "explore",
          restrictions: EXPLORE_RESTRICTIONS,
          limits: { perParent: 1, global: 1 },
          attestationVersion: "restore-lifecycle-test-v1",
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
      task: "Wait for restore",
      desiredOutcome: "No stale ownership",
    })
    const oldChild = created[2]!
    let settlements = 0
    const clarification = oldChild.clarify({
      prompt: "Choose restore behavior",
      fields: [{
        id: "restore",
        label: "Restore",
        mode: "single",
        required: true,
        allowsCustom: false,
        options: [{ id: "continue", label: "Continue" }],
      }],
    })
    void clarification.then(() => settlements += 1)

    await controller.restore(runStore.record!)
    expect(await clarification).toEqual({ kind: "cancelled" })
    await Bun.sleep(0)
    expect(settlements).toBe(1)
    expect(oldChild.disposeCalls()).toBe(1)
    expect(controller.store.getState().delegation).toEqual({ parents: {}, children: {} })
    expect(controller.store.getState().sessions[childId!]).toBeUndefined()
    expect(controller.store.getState().sessions["persisted-ordinary-child"]).toBeDefined()
    expect(controller.store.getState().workspace.conversations["persisted-ordinary-child"]).toBeDefined()
    expect(selectOrderedDelegatedChildren(controller.store.getState().delegation, "claude-code")).toEqual([])
    expect(selectDelegationAggregateStatus(controller.store.getState().delegation, "claude-code")).toBeNull()
    expect(controller.store.getState().delegation.parents["claude-code"]?.closeState).toBeUndefined()

    const restoredBeforeLate = controller.store.getState()
    oldChild.emit({ kind: "status", status: "finished" })
    oldChild.emit({ kind: "agent_message", messageId: "late", textDelta: "ignored" })
    expect(controller.store.getState()).toBe(restoredBeforeLate)
    expect(settlements).toBe(1)
    await controller.dispose()
  })
})

const DEGRADED_BUNDLE: HandoffBundle = {
  intent: "continue",
  summary: "Continue the saved restoration task from the verified context.",
  files: [{ path: "src/ui/ConversationView.tsx", reason: "edited" }],
  pendingDiffs: [],
  redactionCount: 0,
}

describe("unavailable-pane fresh-start integration", () => {
  it("creates and seeds only the unavailable agent from the persisted bundle", async () => {
    const created: Record<ProviderKind, number> = { "claude-code": 0, codex: 0, cursor: 0 }
    const newSessions: Array<{ id: ProviderKind; sessionId: string }> = []
    const prompts: Array<{ id: ProviderKind; sessionId: string; blocks: PromptBlock[] }> = []

    const controller = await createSessionController({
      config: { ...defaultAppConfig(), shell: { ...defaultAppConfig().shell, enabled: false } },
      cwd: process.cwd(),
      readBranch: async () => null,
      resolveHarnessCapability: () => ({
        status: "supported",
        profileId: "session-restore-test",
        encoder: "codex-prompt-meta-v1",
      }),
      createConnection(idConfig) {
        const id = idConfig.id
        const instance = created[id]++
        const subscribers = new Set<(event: DomainSessionEvent) => void>()
        return {
          id,
          connect: async () => ({ ready: true, protocolVersion: 1, canLoadSession: true }),
          async newSession() {
            const sessionId = `${id}-fresh-${instance}`
            newSessions.push({ id, sessionId })
            return sessionId
          },
          async loadSession(sessionId) {
            if (id === "codex") throw new Error("saved transcript was purged")
            for (const subscriber of subscribers) {
              subscriber({
                kind: "agent_message",
                messageId: `${id}-restored`,
                textDelta: `history from ${sessionId}`,
              })
            }
          },
          async prompt(sessionId, input) {
            prompts.push({ id, sessionId, blocks: Array.isArray(input) ? input : [...input.userBlocks] })
            return { stopReason: "end_turn" }
          },
          cancel: async () => {},
          setSessionConfigOption: async () => [],
          onUpdate(callback) {
            subscribers.add(callback)
            return () => subscribers.delete(callback)
          },
          onPermission(_handler: (request: PermissionRequest) => Promise<PermissionOutcome>) {},
          onClarification: () => () => {},
          dispose: async () => {},
        }
      },
    })

    const record: PersistedRunRecord = {
      version: 1,
      runId: "degraded-run",
      cwd: process.cwd(),
      gitBranch: "feat/resume",
      focusedAgentId: "codex",
      createdAt: 1,
      updatedAt: 2,
      agents: {
        "claude-code": {
          sessionId: "claude-saved",
          lastPrompt: "continue",
          messageCount: 1,
          status: "idle",
        },
        codex: {
          sessionId: "codex-saved",
          lastPrompt: "continue",
          messageCount: 1,
          status: "idle",
        },
      },
      handoffBundle: DEGRADED_BUNDLE,
    }
    await controller.restore(record)

    const setup = await testRender(createElement(CockpitApp, { controller }), {
      width: 80,
      height: 22,
    })
    const degraded = await setup.waitForFrame((frame) =>
      frame.includes(RESTORATION_UNAVAILABLE_LABEL),
    )
    expect(degraded).toContain(START_FRESH_LABEL)

    await actAsync(async () => {
      await setup.mockInput.typeText("/new")
    })
    await setup.waitForFrame((frame) => frame.includes("Commands") && frame.includes("/new"))
    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitFor(() => prompts.length === 1)

    expect(newSessions.filter((entry) => entry.id === "claude-code")).toHaveLength(1)
    expect(newSessions.filter((entry) => entry.id === "codex")).toHaveLength(2)
    expect(prompts).toEqual([
      {
        id: "codex",
        sessionId: "codex-fresh-2",
        blocks: composeHandoffBlocks(DEGRADED_BUNDLE, createHandoffEdits(DEGRADED_BUNDLE)),
      },
    ])
    expect(controller.store.getState().restoration.codex).toBeNull()

    await destroyMounted(setup.renderer)
    await controller.dispose()
  })
})
