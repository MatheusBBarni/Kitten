import { describe, expect, it } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createCockpitSession as createRealCockpitSession,
  type CockpitSessionDeps,
} from "../src/index.ts"
import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { createControllerActions } from "../src/app/actions.ts"
import type { SessionController } from "../src/app/controller.ts"
import type { ConfigWatcher } from "../src/config/configWatcher.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { AppConfig, ThemePreference } from "../src/core/types.ts"
import type { PersistedRunRecord, PersistedRunRecordV1 } from "../src/persistence/runRecord.ts"
import { createRunStore } from "../src/persistence/runStore.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { selectThemePreference } from "../src/store/selectors.ts"
import { createTelemetryRecorder, type TelemetryRecord, type TelemetrySink } from "../src/telemetry/recorder.ts"
import { readyRuntimes } from "./fakeController.ts"

const CONNECTION_STUB = { prompt: async () => ({ stopReason: "end_turn" as const }), cancel: async () => {} } as unknown as AgentConnection
const NOOP_WATCHER: ConfigWatcher = { close() {} }

/** Keep existing session tests off the real user state directory unless a case opts in. */
function createCockpitSession(deps: CockpitSessionDeps = {}) {
  return createRealCockpitSession({
    ...deps,
    createRunStore: deps.createRunStore ?? (() => createRunStore({ enabled: false })),
  })
}

function controlledTimer(): {
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
  flush: () => void
  pending: () => boolean
  clearCalls: () => number
} {
  let callback: (() => void) | undefined
  let clears = 0
  const handle = 1 as unknown as ReturnType<typeof setTimeout>
  return {
    setTimer(next) {
      callback = next
      return handle
    },
    clearTimer(timer) {
      expect(timer).toBe(handle)
      callback = undefined
      clears += 1
    },
    flush() {
      const next = callback
      callback = undefined
      next?.()
    },
    pending: () => callback !== undefined,
    clearCalls: () => clears,
  }
}

/** A controller built over the given store, so the session's `watch` and it agree. */
function controllerOver(
  store: ReturnType<typeof createAppStore>,
  onRestore: (record: PersistedRunRecord) => void = () => {},
): SessionController {
  const runtimes = readyRuntimes()
  const actions = createControllerActions({
    store,
    getSession: (sessionId) => ({ sessionId, acpSessionId: `s-${sessionId}`, connection: CONNECTION_STUB }),
    resolvePermission: () => {},
  })
  return {
    store,
    actions,
    shell: { ready: false, error: "shell outside cockpit-session test boundary" },
    runtimes: () => runtimes,
    runtime: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId),
    isReady: () => true,
    closeConversation: async () => ({ outcome: "ignored" }),
    restore: async (record) => onRestore(record),
    dispose: async () => {},
  }
}

function persistedRun(runId: string, updatedAt: number, cwd = process.cwd()): PersistedRunRecordV1 {
  return {
    version: 1,
    runId,
    cwd,
    gitBranch: "feat/session-resume",
    focusedAgentId: "codex",
    createdAt: 1_000,
    updatedAt,
    agents: {
      "claude-code": {
        sessionId: `${runId}-claude`,
        lastPrompt: "continue claude",
        messageCount: 2,
        status: "finished",
      },
      codex: {
        sessionId: `${runId}-codex`,
        lastPrompt: "continue codex",
        messageCount: 3,
        status: "idle",
      },
    },
    handoffBundle: null,
  }
}

describe("createCockpitSession", () => {
  it("starts a fresh run even when the project has persisted runs", async () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-cockpit-resume-newest-"))
    try {
      const runStore = createRunStore({ enabled: true, path: base })
      runStore.save(persistedRun("older", 2_000))
      runStore.save(persistedRun("newest", 9_000))
      runStore.save(persistedRun("middle", 5_000))
      const restored: PersistedRunRecord[] = []
      let sendInitialTasks: boolean | undefined

      const session = await createCockpitSession({
        loadConfig: async () => ({ ...defaultAppConfig(), persistenceEnabled: true }),
        createRunStore: () => runStore,
        buildController: async (options) => {
          sendInitialTasks = options.sendInitialTasks
          return controllerOver(options.store!, (record) => {
            restored.push(record)
          })
        },
        persistConfig: async () => {},
        watchConfig: () => NOOP_WATCHER,
      })

      expect(restored).toEqual([])
      expect(sendInitialTasks).toBe(true)
      await session.controller.dispose()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("keeps the fresh controller untouched when the project has no persisted runs", async () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-cockpit-resume-empty-"))
    try {
      let restoreCalls = 0
      let buildCalls = 0
      const session = await createCockpitSession({
        loadConfig: async () => ({ ...defaultAppConfig(), persistenceEnabled: true }),
        createRunStore: () => createRunStore({ enabled: true, path: base }),
        buildController: async (options) => {
          buildCalls += 1
          return controllerOver(options.store!, () => {
            restoreCalls += 1
          })
        },
        persistConfig: async () => {},
        watchConfig: () => NOOP_WATCHER,
      })

      expect(buildCalls).toBe(1)
      expect(restoreCalls).toBe(0)
      await session.controller.dispose()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("keeps the fresh controller untouched when persistence is disabled even if run files exist", async () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-cockpit-resume-disabled-"))
    try {
      const enabledStore = createRunStore({ enabled: true, path: base })
      enabledStore.save(persistedRun("existing", 9_000))
      let restoreCalls = 0
      const session = await createCockpitSession({
        loadConfig: async () => ({ ...defaultAppConfig(), persistenceEnabled: false }),
        createRunStore: () => createRunStore({ enabled: false, path: base }),
        buildController: async (options) => controllerOver(options.store!, () => {
          restoreCalls += 1
        }),
        persistConfig: async () => {},
        watchConfig: () => NOOP_WATCHER,
      })

      expect(restoreCalls).toBe(0)
      await session.controller.dispose()
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("writes one booted run only when persistence is enabled", async () => {
    const enabledBase = mkdtempSync(join(tmpdir(), "kitten-cockpit-persistence-on-"))
    const disabledBase = mkdtempSync(join(tmpdir(), "kitten-cockpit-persistence-off-"))
    try {
      const enabledStore = createRunStore({ enabled: true, path: enabledBase })
      const enabled = await createCockpitSession({
        loadConfig: async () => ({ ...defaultAppConfig(), persistenceEnabled: true }),
        createRunStore: (flag) => {
          expect(flag).toBe(true)
          return enabledStore
        },
        buildController: async (options) => controllerOver(options.store!),
        persistConfig: async () => {},
        watchConfig: () => NOOP_WATCHER,
      })
      await enabled.controller.dispose()

      const disabledStore = createRunStore({ enabled: false, path: disabledBase })
      const disabled = await createCockpitSession({
        loadConfig: async () => ({ ...defaultAppConfig(), persistenceEnabled: false }),
        createRunStore: (flag) => {
          expect(flag).toBe(false)
          return disabledStore
        },
        buildController: async (options) => controllerOver(options.store!),
        persistConfig: async () => {},
        watchConfig: () => NOOP_WATCHER,
      })
      await disabled.controller.dispose()

      expect(enabledStore.list(process.cwd())).toHaveLength(1)
      expect(createRunStore({ enabled: true, path: disabledBase }).list(process.cwd())).toEqual([])
      expect(readdirSync(disabledBase)).toEqual([])
    } finally {
      rmSync(enabledBase, { recursive: true, force: true })
      rmSync(disabledBase, { recursive: true, force: true })
    }
  })

  it("keeps a multi-directory fleet in the launch project's run namespace", async () => {
    const stateBase = mkdtempSync(join(tmpdir(), "kitten-cockpit-project-scope-state-"))
    const launchCwd = mkdtempSync(join(tmpdir(), "kitten-cockpit-project-scope-launch-"))
    const alphaCwd = mkdtempSync(join(tmpdir(), "kitten-cockpit-project-scope-alpha-"))
    const betaCwd = mkdtempSync(join(tmpdir(), "kitten-cockpit-project-scope-beta-"))
    const runStore = createRunStore({ enabled: true, path: stateBase })
    const config: AppConfig = {
      ...defaultAppConfig(),
      persistenceEnabled: true,
      sessions: [
        { provider: "claude-code", cwd: alphaCwd },
        { provider: "codex", cwd: betaCwd },
      ],
    }
    const restored: PersistedRunRecord[] = []

    try {
      const first = await createCockpitSession({
        cwd: launchCwd,
        config,
        createRunStore: () => runStore,
        buildController: async (options) => {
          options.store!.setFocus("codex")
          return controllerOver(options.store!)
        },
        persistConfig: async () => {},
        watchConfig: () => NOOP_WATCHER,
      })
      await first.controller.dispose()

      expect(runStore.list(launchCwd)).toHaveLength(1)
      expect(runStore.list(alphaCwd)).toEqual([])
      expect(runStore.list(betaCwd)).toEqual([])

      const second = await createCockpitSession({
        cwd: launchCwd,
        config,
        createRunStore: () => runStore,
        buildController: async (options) => controllerOver(options.store!, (record) => {
          restored.push(record)
        }),
        persistConfig: async () => {},
        watchConfig: () => NOOP_WATCHER,
      })

      expect(restored).toEqual([])
      await second.controller.dispose()
    } finally {
      rmSync(stateBase, { recursive: true, force: true })
      rmSync(launchCwd, { recursive: true, force: true })
      rmSync(alphaCwd, { recursive: true, force: true })
      rmSync(betaCwd, { recursive: true, force: true })
    }
  })

  it("wires the recorder from config, records boot readiness, and watches the store", async () => {
    const records: TelemetryRecord[] = []
    const sink: TelemetrySink = { write: (record) => records.push(record) }
    const config: AppConfig = { ...defaultAppConfig(), telemetryEnabled: true }

    let enabledSeen: boolean | undefined
    let builtWithStore = false
    const store = createAppStore()

    const { controller, recorder } = await createCockpitSession({
      loadConfig: async () => config,
      createRecorder: (enabled) => {
        enabledSeen = enabled
        return createTelemetryRecorder({ enabled, sink, now: () => 7 })
      },
      buildController: async (options) => {
        builtWithStore = options.store !== undefined
        return controllerOver(options.store ?? store)
      },
      persistConfig: async () => {},
      watchConfig: () => NOOP_WATCHER,
    })

    expect(enabledSeen).toBe(true)
    expect(builtWithStore).toBe(true)
    expect(recorder.enabled).toBe(true)

    // Readiness was recorded from the controller's runtimes at boot, followed by the
    // run's peak concurrency (both agents came up, so two).
    expect(records.map((record) => record.type)).toEqual(["agent_ready", "agent_ready", "max_concurrent_sessions"])
    expect(records.find((record) => record.type === "max_concurrent_sessions")).toMatchObject({ count: 2 })

    // The store is watched: a prompt/response pair now produces a first-response event.
    controller.store.applyEvent("claude-code", { kind: "user_message", messageId: "m1", text: "hi" })
    controller.store.applyEvent("claude-code", { kind: "agent_message", messageId: "m2", textDelta: "hey" })
    expect(records.some((record) => record.type === "first_response_ms")).toBe(true)
    await controller.dispose()
  })

  it("produces a disabled recorder when telemetry is off, writing nothing", async () => {
    const records: TelemetryRecord[] = []
    const sink: TelemetrySink = { write: (record) => records.push(record) }
    const store = createAppStore()

    const { controller, recorder } = await createCockpitSession({
      loadConfig: async () => defaultAppConfig(),
      createRecorder: (enabled) => createTelemetryRecorder({ enabled, sink }),
      buildController: async (options) => controllerOver(options.store ?? store),
      persistConfig: async () => {},
      watchConfig: () => NOOP_WATCHER,
    })

    expect(recorder.enabled).toBe(false)
    expect(records).toHaveLength(0)
    await controller.dispose()
  })

  it("seeds the store theme from the loaded config", async () => {
    const config: AppConfig = { ...defaultAppConfig(), theme: "catppuccin-mocha" }
    const session = await createCockpitSession({
      loadConfig: async () => config,
      buildController: async (options) => controllerOver(options.store!),
      persistConfig: async () => {},
      watchConfig: () => NOOP_WATCHER,
    })

    expect(selectThemePreference(session.controller.store.getState())).toBe("catppuccin-mocha")
    await session.controller.dispose()
  })

  it("coalesces theme changes into one debounced persist and records success", async () => {
    const timer = controlledTimer()
    const writes: ThemePreference[] = []
    const records: TelemetryRecord[] = []
    const session = await createCockpitSession({
      loadConfig: async () => ({ ...defaultAppConfig(), telemetryEnabled: true }),
      createRecorder: (enabled) => createTelemetryRecorder({
        enabled,
        sink: { write: (record) => records.push(record) },
      }),
      buildController: async (options) => controllerOver(options.store!),
      persistConfig: async ({ theme }) => {
        writes.push(theme)
      },
      watchConfig: () => NOOP_WATCHER,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })

    session.controller.store.setThemePreference("light")
    session.controller.store.setThemePreference("dark")
    expect(writes).toEqual([])
    expect(timer.pending()).toBe(true)

    timer.flush()
    await session.controller.dispose()

    expect(writes).toEqual(["dark"])
    expect(records.filter((record) => record.type === "theme_set").map((record) => record.themeId)).toEqual(["light", "dark"])
    expect(records.filter((record) => record.type === "config_write")).toHaveLength(1)
  })

  it("records a write error without rejecting controller disposal", async () => {
    const timer = controlledTimer()
    const records: TelemetryRecord[] = []
    const session = await createCockpitSession({
      loadConfig: async () => ({ ...defaultAppConfig(), telemetryEnabled: true }),
      createRecorder: (enabled) => createTelemetryRecorder({
        enabled,
        sink: { write: (record) => records.push(record) },
      }),
      buildController: async (options) => controllerOver(options.store!),
      persistConfig: async () => {
        throw new Error("disk full")
      },
      watchConfig: () => NOOP_WATCHER,
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })

    session.controller.store.setThemePreference("dark")
    timer.flush()

    await expect(session.controller.dispose()).resolves.toBeUndefined()
    expect(records.filter((record) => record.type === "config_write_error")).toHaveLength(1)
    expect(records.filter((record) => record.type === "config_write")).toHaveLength(0)
  })

  it("applies external watcher themes and ignores an unchanged self-write reload", async () => {
    const timer = controlledTimer()
    let onConfig: ((config: AppConfig) => void) | undefined
    const writes: ThemePreference[] = []
    const session = await createCockpitSession({
      loadConfig: async () => ({ ...defaultAppConfig(), theme: "light" }),
      buildController: async (options) => controllerOver(options.store!),
      persistConfig: async ({ theme }) => {
        writes.push(theme)
      },
      watchConfig: (callback) => {
        onConfig = callback
        return NOOP_WATCHER
      },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })

    onConfig!({ ...defaultAppConfig(), theme: "dark" })
    expect(selectThemePreference(session.controller.store.getState())).toBe("dark")
    expect(timer.pending()).toBe(true)
    timer.flush()
    await Promise.resolve()

    onConfig!({ ...defaultAppConfig(), theme: "dark" })
    expect(timer.pending()).toBe(false)
    await session.controller.dispose()
    expect(writes).toEqual(["dark"])
  })

  it("closes the watcher and cancels a pending persist on dispose", async () => {
    const timer = controlledTimer()
    let watcherCloseCalls = 0
    const writes: ThemePreference[] = []
    const session = await createCockpitSession({
      loadConfig: async () => defaultAppConfig(),
      buildController: async (options) => controllerOver(options.store!),
      persistConfig: async ({ theme }) => {
        writes.push(theme)
      },
      watchConfig: () => ({ close: () => watcherCloseCalls++ }),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    })

    session.controller.store.setThemePreference("dark")
    expect(timer.pending()).toBe(true)
    await session.controller.dispose()
    timer.flush()

    expect(watcherCloseCalls).toBe(1)
    expect(timer.clearCalls()).toBe(1)
    expect(writes).toEqual([])
  })
})
