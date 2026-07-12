import { describe, expect, it } from "bun:test"
import { createElement } from "react"

import { testRender } from "@opentui/react/test-utils"

import type {
  AgentConnection,
  PermissionOutcome,
  PermissionRequest,
  PromptBlock,
} from "../src/agent/agentConnection.ts"
import { createSessionController } from "../src/app/controller.ts"
import {
  composeHandoffBlocks,
  createHandoffEdits,
} from "../src/app/handoff.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { DomainSessionEvent, HandoffBundle, ProviderKind } from "../src/core/types.ts"
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

function fakeConnection(id: ProviderKind): AgentConnection {
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
    prompt: async (_sessionId: string, _blocks: PromptBlock[]) => ({ stopReason: "end_turn" }),
    cancel: async () => {},
    setSessionConfigOption: async () => [],
    onUpdate(callback) {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    },
    onPermission(_handler: (request: PermissionRequest) => Promise<PermissionOutcome>) {},
    dispose: async () => {},
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
    expect(state.focusedSessionId).toBe("codex")
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
    const created = { "claude-code": 0, codex: 0 }
    const newSessions: Array<{ id: ProviderKind; sessionId: string }> = []
    const prompts: Array<{ id: ProviderKind; sessionId: string; blocks: PromptBlock[] }> = []

    const controller = await createSessionController({
      config: { ...defaultAppConfig(), shell: { ...defaultAppConfig().shell, enabled: false } },
      cwd: process.cwd(),
      readBranch: async () => null,
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
          async prompt(sessionId, blocks) {
            prompts.push({ id, sessionId, blocks })
            return { stopReason: "end_turn" }
          },
          cancel: async () => {},
          setSessionConfigOption: async () => [],
          onUpdate(callback) {
            subscribers.add(callback)
            return () => subscribers.delete(callback)
          },
          onPermission(_handler: (request: PermissionRequest) => Promise<PermissionOutcome>) {},
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

    await actAsync(() => setup.mockInput.pressKey("n", { ctrl: true }))
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
