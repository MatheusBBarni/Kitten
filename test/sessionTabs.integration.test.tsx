// Integration: Session Tabs lifecycle, persistence, restore, and per-conversation degradation.

import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { createSessionController } from "../src/app/controller.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { AppConfig, ProviderKind } from "../src/core/types.ts"
import type { PersistedRunRecordV2 } from "../src/persistence/runRecord.ts"
import { createRunStore } from "../src/persistence/runStore.ts"
import { createRunWriter } from "../src/persistence/runWriter.ts"

function tabConfig(cwd: string): AppConfig {
  return {
    ...defaultAppConfig(),
    sessions: [{ provider: "codex", cwd, title: "Primary" }],
    shell: { ...defaultAppConfig().shell, enabled: false },
    persistenceEnabled: true,
    telemetryEnabled: false,
  }
}

function connectionFactory(disposed: string[]): (config: { id: ProviderKind }) => AgentConnection {
  let nextAcpId = 0
  return (config) => ({
    id: config.id,
    connect: async () => ({ ready: true, protocolVersion: 1, canLoadSession: true }),
    newSession: async () => `acp-${config.id}-${++nextAcpId}`,
    async loadSession(sessionId) {
      if (sessionId === "unavailable-history") throw new Error("private raw restore failure")
    },
    prompt: async () => ({ stopReason: "end_turn" }),
    cancel: async () => {},
    setSessionConfigOption: async () => [],
    onUpdate: () => () => {},
    onPermission() {},
    onClarification: () => () => {},
    async dispose() {
      disposed.push(config.id)
    },
  })
}

describe("Session Tabs integrated lifecycle", () => {
  it("creates, navigates, backgrounds, reopens, closes, saves, disposes, and restores", async () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-session-tabs-flow-"))
    const cwd = process.cwd()
    const runStore = createRunStore({ enabled: true, path: base })
    const disposed: string[] = []
    let controller: Awaited<ReturnType<typeof createSessionController>> | undefined
    let restored: Awaited<ReturnType<typeof createSessionController>> | undefined

    try {
      let createdOrdinal = 0
      controller = await createSessionController({
        config: tabConfig(cwd),
        cwd,
        createConnection: connectionFactory(disposed),
        newSessionId: () => `created-${++createdOrdinal}`,
        readBranch: async () => null,
        sendInitialTasks: false,
      })
      const primary = controller.store.getState().workspace.order[0]!

      const closed = await controller.actions.createConversation()
      expect(closed).toBe("created-1")
      if (!closed) throw new Error("expected the first dynamic conversation")
      controller.actions.selectConversation(primary, { source: "mouse" })
      controller.store.applyEvent(closed, { kind: "status", status: "working" })
      expect(await controller.actions.closeConversation(closed, "background")).toEqual({
        outcome: "backgrounded",
      })
      controller.actions.reopenConversation(closed, { source: "sessions_fallback" })
      controller.store.applyEvent(closed, { kind: "status", status: "idle" })
      expect(await controller.actions.closeConversation(closed, "close")).toEqual({ outcome: "closed" })

      const background = await controller.actions.createConversation()
      expect(background).toBe("created-2")
      if (!background) throw new Error("expected the second dynamic conversation")
      controller.actions.backgroundConversation(background)
      controller.actions.selectConversation(primary, { source: "mouse" })

      const writer = createRunWriter({
        enabled: true,
        runStore,
        projectCwd: cwd,
        runId: "integrated-flow",
        debounceMs: 0,
      })
      writer.watch(controller.store)
      writer.dispose()

      const record = runStore.load(cwd, "integrated-flow")
      expect(record?.version).toBe(2)
      if (!record || record.version !== 2) throw new Error("expected a V2 run record")
      expect(record.workspace.order).toEqual([primary, background!])
      expect(record.workspace.conversations[background]!.lifecycle).toBe("background")
      expect(record.workspace.conversations[closed]).toBeUndefined()

      await controller.dispose()
      controller = undefined

      restored = await createSessionController({
        config: tabConfig(cwd),
        cwd,
        createConnection: connectionFactory(disposed),
        readBranch: async () => null,
        sendInitialTasks: false,
      })
      await restored.restore(record)

      const workspace = restored.store.getState().workspace
      expect(workspace.order).toEqual([primary, background!])
      expect(workspace.selectedVisibleId).toBe(primary)
      expect(workspace.conversations[background]!.lifecycle).toBe("background")
      expect(restored.runtimes().every((runtime) => runtime.ready)).toBe(true)
    } finally {
      await restored?.dispose()
      await controller?.dispose()
      rmSync(base, { recursive: true, force: true })
    }

    expect(disposed.length).toBeGreaterThanOrEqual(4)
  })

  it("isolates one unavailable restored tab and preserves empty-workspace creation", async () => {
    const cwd = process.cwd()
    const disposed: string[] = []
    const record: PersistedRunRecordV2 = {
      version: 2,
      runId: "partial-restore",
      cwd,
      gitBranch: null,
      createdAt: 1,
      updatedAt: 2,
      conversations: {
        usable: {
          sessionId: "usable",
          providerKind: "codex",
          cwd,
          initialTitle: "Usable",
          acpSessionId: "usable-history",
          lastPrompt: "continue",
          messageCount: 1,
          status: "idle",
        },
        unavailable: {
          sessionId: "unavailable",
          providerKind: "codex",
          cwd,
          initialTitle: "Unavailable",
          acpSessionId: "unavailable-history",
          lastPrompt: "continue",
          messageCount: 1,
          status: "idle",
        },
      },
      workspace: {
        order: ["usable", "unavailable"],
        selectedVisibleId: "usable",
        conversations: {
          usable: {
            sessionId: "usable",
            displayName: "Usable",
            lifecycle: "visible",
            createdOrdinal: 0,
            attention: { seen: true, sequence: 0 },
          },
          unavailable: {
            sessionId: "unavailable",
            displayName: "Unavailable",
            lifecycle: "background",
            createdOrdinal: 1,
            attention: { seen: true, sequence: 0 },
          },
        },
      },
      handoffBundle: null,
    }
    let nextId = 0
    const controller = await createSessionController({
      config: tabConfig(cwd),
      cwd,
      createConnection: connectionFactory(disposed),
      newSessionId: () => `recovery-${++nextId}`,
      readBranch: async () => null,
      sendInitialTasks: false,
    })

    try {
      await controller.restore(record)

      expect(controller.runtime("usable")?.ready).toBe(true)
      expect(controller.runtime("unavailable")?.ready).toBe(false)
      expect(controller.store.getState().workspace.conversations.unavailable!.availability).toEqual({
        kind: "unavailable",
        reasonCode: "restore-unavailable",
        retryable: true,
      })

      controller.actions.backgroundConversation("usable")
      expect(controller.store.getState().workspace.selectedVisibleId).toBeNull()
      const recovery = await controller.actions.createConversation()
      expect(recovery).toBe("recovery-1")
      expect(controller.store.getState().workspace.selectedVisibleId).toBe(recovery)
      expect(controller.isReady(recovery!)).toBe(true)
    } finally {
      await controller.dispose()
    }
  })
})
