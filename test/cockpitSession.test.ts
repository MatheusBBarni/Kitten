import { describe, expect, it } from "bun:test"

import { createCockpitSession } from "../src/index.ts"
import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { createControllerActions } from "../src/app/actions.ts"
import type { SessionController } from "../src/app/controller.ts"
import type { ConfigWatcher } from "../src/config/configWatcher.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { AppConfig, ThemePreference } from "../src/core/types.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { selectThemePreference } from "../src/store/selectors.ts"
import { createTelemetryRecorder, type TelemetryRecord, type TelemetrySink } from "../src/telemetry/recorder.ts"
import { readyRuntimes } from "./fakeController.ts"

const CONNECTION_STUB = { prompt: async () => ({ stopReason: "end_turn" as const }), cancel: async () => {} } as unknown as AgentConnection
const NOOP_WATCHER: ConfigWatcher = { close() {} }

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
function controllerOver(store: ReturnType<typeof createAppStore>): SessionController {
  const runtimes = readyRuntimes()
  const actions = createControllerActions({
    store,
    getSession: (sessionId) => ({ sessionId, acpSessionId: `s-${sessionId}`, connection: CONNECTION_STUB }),
    resolvePermission: () => {},
  })
  return {
    store,
    actions,
    runtimes: () => runtimes,
    runtime: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId),
    isReady: () => true,
    dispose: async () => {},
  }
}

describe("createCockpitSession", () => {
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
