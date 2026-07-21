// Suite: slash-command saved-run picker integration
// Invariant: the mounted cockpit restores only an explicit choice and deletes only after picker confirmation.
// Boundary IN: OpenTUI input/tree, real AppStore/SessionController, fake agents, and real or injected RunStore.
// Boundary OUT: real adapter subprocesses.

import { describe, expect, it } from "bun:test"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  AgentConnection,
  PermissionOutcome,
  PermissionRequest,
  PromptBlock,
} from "../src/agent/agentConnection.ts"
import { createSessionController } from "../src/app/controller.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { DomainSessionEvent, ProviderKind } from "../src/core/types.ts"
import type {
  PersistedRunRecord,
  PersistedRunRecordV1,
  PersistedRunRecordV2,
  PersistedRunSummary,
} from "../src/persistence/runRecord.ts"
import { createRunStore, encodeProjectDirectory, type RunStore } from "../src/persistence/runStore.ts"
import { CockpitApp } from "../src/ui/CockpitApp.tsx"
import { createTelemetryRecorder, type TelemetryRecord } from "../src/telemetry/recorder.ts"
import {
  DELETE_RUN_CONFIRMATION,
  NO_SAVED_RUNS,
  SESSION_PICKER_TITLE,
} from "../src/ui/SessionPicker.tsx"
import { actAsync, destroyMounted } from "./reactTui.ts"

const CWD = process.cwd()

function fakeConnection(id: ProviderKind, loadUnavailable = false): AgentConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  return {
    id,
    connect: async () => ({ ready: true, protocolVersion: 1, canLoadSession: true }),
    newSession: async () => `${id}-startup`,
    async loadSession(sessionId) {
      if (loadUnavailable) throw new Error(`${id} transcript unavailable`)
      for (const subscriber of subscribers) {
        subscriber({ kind: "agent_message", messageId: `${id}-restored`, textDelta: `history from ${sessionId}` })
      }
    },
    prompt: async (_sessionId: string, _blocks: PromptBlock[]) => ({ stopReason: "end_turn" }),
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

function run(runId: string, updatedAt: number): PersistedRunRecordV1 {
  return {
    version: 1,
    runId,
    cwd: CWD,
    gitBranch: `feat/${runId}`,
    focusedAgentId: "codex",
    createdAt: updatedAt - 1_000,
    updatedAt,
    agents: {
      "claude-code": { sessionId: `${runId}-claude`, lastPrompt: `Claude ${runId}`, messageCount: 3, status: "idle" },
      codex: { sessionId: `${runId}-codex`, lastPrompt: `Codex ${runId}`, messageCount: 5, status: "finished" },
    },
    handoffBundle: null,
  }
}

function summary(record: PersistedRunRecord): PersistedRunSummary {
  const focusedId = record.version === 1 ? record.focusedAgentId : record.workspace.selectedVisibleId
  const focused = focusedId === null
    ? undefined
    : record.version === 1
      ? record.agents[focusedId]
      : record.conversations[focusedId]
  return {
    runId: record.runId,
    updatedAt: record.updatedAt,
    gitBranch: record.gitBranch,
    focusedAgentId: focusedId,
    lastPrompt: focused?.lastPrompt ?? "",
    messageCount: focused?.messageCount ?? 0,
  }
}

function runStore(records: PersistedRunRecord[]): RunStore {
  return {
    save() {},
    list: (cwd) => records.filter((record) => record.cwd === cwd).map(summary).sort((a, b) => b.updatedAt - a.updatedAt),
    load: (cwd, runId) => records.find((record) => record.cwd === cwd && record.runId === runId) ?? null,
    delete() {},
    deleteAll() {},
    flush() {},
  }
}

function dynamicRun(): PersistedRunRecordV2 {
  return {
    version: 2,
    runId: "dynamic-tabs",
    cwd: CWD,
    gitBranch: "feat/dynamic-tabs",
    createdAt: 7_000,
    updatedAt: 8_000,
    conversations: {
      "review-tab": {
        sessionId: "review-tab",
        providerKind: "codex",
        cwd: CWD,
        initialTitle: "Review",
        acpSessionId: "review-acp",
        lastPrompt: "Review the API",
        messageCount: 2,
        status: "finished",
      },
      "build-tab": {
        sessionId: "build-tab",
        providerKind: "codex",
        cwd: join(CWD, "packages", "tui", "src"),
        initialTitle: "Build",
        acpSessionId: "build-acp",
        lastPrompt: "Build the CLI",
        messageCount: 3,
        status: "idle",
      },
    },
    workspace: {
      conversations: {
        "review-tab": {
          sessionId: "review-tab",
          displayName: "Review API",
          lifecycle: "background",
          createdOrdinal: 2,
          attention: { seen: false, sequence: 1 },
        },
        "build-tab": {
          sessionId: "build-tab",
          displayName: "Build CLI",
          lifecycle: "visible",
          createdOrdinal: 3,
          attention: { seen: true, sequence: 0 },
        },
      },
      order: ["review-tab", "build-tab"],
      selectedVisibleId: "build-tab",
    },
    handoffBundle: null,
  }
}

/** Drive `/resume` through the prompt menu, matching the user-visible command flow. */
async function openResumePicker(setup: TestRendererSetup): Promise<void> {
  await actAsync(async () => {
    await setup.mockInput.typeText("/resume")
  })
  await setup.waitForFrame((frame) => frame.includes("Commands") && frame.includes("/resume"))
  await actAsync(() => setup.mockInput.pressEnter())
  await setup.waitForFrame((frame) => frame.includes(SESSION_PICKER_TITLE))
}

describe("slash-command saved-run restore", () => {
  it("restores dynamic visible and background conversations through the picker when startup seeds differ", async () => {
    const saved = dynamicRun()
    const controller = await createSessionController({
      config: {
        ...defaultAppConfig(),
        sessions: [{ provider: "claude-code", cwd: CWD, title: "Startup only" }],
        shell: { ...defaultAppConfig().shell, enabled: false },
      },
      cwd: CWD,
      createConnection: (config) => fakeConnection(config.id),
      readBranch: async () => null,
    })
    const setup = await testRender(
      <CockpitApp
        controller={controller}
        sessionPicker={{ runStore: runStore([saved]), cwd: CWD, now: () => 10_000 }}
      />,
      { width: 80, height: 24, kittyKeyboard: true, exitOnCtrlC: false },
    )

    try {
      await setup.waitForFrame((frame) => frame.includes("Kitten"))
      await openResumePicker(setup)
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitFor(() => controller.store.getState().sessions["build-tab"]?.turns.length === 1)

      const state = controller.store.getState()
      expect(controller.runtimes().map((runtime) => runtime.sessionId)).toEqual(["review-tab", "build-tab"])
      expect(state.workspace.order).toEqual(["review-tab", "build-tab"])
      expect(state.workspace.selectedVisibleId).toBe("build-tab")
      expect(state.workspace.conversations["review-tab"]).toMatchObject({
        displayName: "Review API",
        lifecycle: "background",
        availability: { kind: "ready" },
      })
      expect(state.sessions["review-tab"]?.turns).toEqual([
        { kind: "agent", messageId: "codex-restored", text: "history from review-acp" },
      ])
      expect(state.sessions["build-tab"]?.turns).toEqual([
        { kind: "agent", messageId: "codex-restored", text: "history from build-acp" },
      ])
    } finally {
      await destroyMounted(setup.renderer)
      await controller.dispose()
    }
  })

  it("emits content-free picker resume telemetry when one pane degrades", async () => {
    const saved = run("degraded", 8_000)
    const records: TelemetryRecord[] = []
    let now = 1000
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => now,
      sessionRef: "resume-run",
    })
    const controller = await createSessionController({
      config: { ...defaultAppConfig(), shell: { ...defaultAppConfig().shell, enabled: false } },
      cwd: CWD,
      createConnection: (config) => fakeConnection(config.id, config.id === "codex"),
      readBranch: async () => null,
      recorder,
    })
    const stopRecorder = recorder.watch(controller.store)
    const setup = await testRender(
      <CockpitApp
        controller={controller}
        recorder={recorder}
        sessionPicker={{ runStore: runStore([saved]), cwd: CWD, now: () => 10_000 }}
      />,
      { width: 80, height: 24, kittyKeyboard: true, exitOnCtrlC: false },
    )

    try {
      await setup.waitForFrame((frame) => frame.includes("Kitten"))
      await openResumePicker(setup)
      await setup.waitFor(() => records.some((record) => record.type === "resume_picker_interactive_ms"))
      now = 1300
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitFor(() => records.some((record) => record.type === "session_resumed"))

      expect(records.find((record) => record.type === "session_resumed")).toMatchObject({
        mode: "picker",
        liveCount: 1,
      })
      expect(records.find((record) => record.type === "resume_pane_unavailable")).toMatchObject({ agent: "codex" })
      expect(records.some((record) => record.type === "resume_picker_interactive_ms")).toBe(true)
      expect(records.some((record) => record.type === "resume_load_usable_ms")).toBe(true)
      const resumeRecords = records.filter((record) =>
        record.type === "session_resumed"
        || record.type === "resume_pane_unavailable"
        || record.type === "resume_picker_interactive_ms"
        || record.type === "resume_load_usable_ms"
      )
      for (const record of resumeRecords) {
        expect(
          Object.keys(record).every((key) =>
            ["type", "at", "sessionRef", "agent", "durationMs", "mode", "liveCount"].includes(key),
          ),
        ).toBe(true)
      }
      expect(JSON.stringify(records)).not.toContain("Codex degraded")
    } finally {
      stopRecorder()
      await destroyMounted(setup.renderer)
      await controller.dispose()
    }
  })

  it("opens the picker and restores the arrow-selected run through fake agents", async () => {
    const records = [run("newest", 9_000), run("selected", 8_000)]
    const store = runStore(records)
    const controller = await createSessionController({
      config: { ...defaultAppConfig(), shell: { ...defaultAppConfig().shell, enabled: false } },
      cwd: CWD,
      createConnection: (config) => fakeConnection(config.id),
      readBranch: async () => null,
    })
    const setup = await testRender(
      <CockpitApp controller={controller} sessionPicker={{ runStore: store, cwd: CWD, now: () => 10_000 }} />,
      { width: 80, height: 24, kittyKeyboard: true, exitOnCtrlC: false },
    )

    try {
      await setup.waitForFrame((frame) => frame.includes("Kitten"))
      await openResumePicker(setup)
      await actAsync(() => {
        setup.mockInput.pressArrow("down")
      })
      await actAsync(() => {
        setup.mockInput.pressEnter()
      })
      await setup.waitFor(
        () => controller.store.getState().sessions.codex?.turns[0]?.kind === "agent",
      )

      const state = controller.store.getState()
      expect(state.overlays.sessionPicker).toBe(false)
      expect(state.workspace.selectedVisibleId).toBe("codex")
      expect(state.restoration).toMatchObject({ "claude-code": "live", codex: "live" })
      expect(state.sessions.codex?.turns).toEqual([
        { kind: "agent", messageId: "codex-restored", text: "history from selected-codex" },
      ])
      expect(state.sessions["claude-code"]?.turns).toEqual([
        { kind: "agent", messageId: "claude-code-restored", text: "history from selected-claude" },
      ])
    } finally {
      await destroyMounted(setup.renderer)
      await controller.dispose()
    }
  })

  it("deletes a run through the picker and removes its persisted file from later listings", async () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-session-picker-delete-"))
    const record = run("delete-me", 8_000)
    const store = createRunStore({ enabled: true, path: base })
    const persistedPath = join(
      base,
      "sessions",
      encodeProjectDirectory(CWD),
      `${record.runId}.json`,
    )
    store.save(record)
    const controller = await createSessionController({
      config: { ...defaultAppConfig(), shell: { ...defaultAppConfig().shell, enabled: false } },
      cwd: CWD,
      createConnection: (config) => fakeConnection(config.id),
      readBranch: async () => null,
    })
    const setup = await testRender(
      <CockpitApp controller={controller} sessionPicker={{ runStore: store, cwd: CWD, now: () => 10_000 }} />,
      { width: 80, height: 24, kittyKeyboard: true, exitOnCtrlC: false },
    )

    try {
      expect(existsSync(persistedPath)).toBe(true)
      await setup.waitForFrame((frame) => frame.includes("Kitten"))
      await openResumePicker(setup)
      await setup.waitForFrame((frame) => frame.includes("Codex delete-me"))

      await actAsync(() => {
        setup.mockInput.pressKey("d", { ctrl: true })
      })
      await setup.waitForFrame((frame) => frame.includes(DELETE_RUN_CONFIRMATION))
      expect(store.list(CWD).map((item) => item.runId)).toEqual(["delete-me"])

      await actAsync(() => {
        setup.mockInput.pressKey("d", { ctrl: true })
      })
      await setup.waitForFrame((frame) => frame.includes(NO_SAVED_RUNS))

      expect(existsSync(persistedPath)).toBe(false)
      expect(store.load(CWD, record.runId)).toBeNull()
      expect(store.list(CWD)).toEqual([])
    } finally {
      await destroyMounted(setup.renderer)
      await controller.dispose()
      rmSync(base, { recursive: true, force: true })
    }
  })
})
