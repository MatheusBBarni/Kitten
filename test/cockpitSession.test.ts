import { describe, expect, it } from "bun:test"

import { createCockpitSession } from "../src/index.ts"
import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { createControllerActions } from "../src/app/actions.ts"
import type { SessionController } from "../src/app/controller.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import type { AppConfig } from "../src/core/types.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { createTelemetryRecorder, type TelemetryRecord, type TelemetrySink } from "../src/telemetry/recorder.ts"
import { readyRuntimes } from "./fakeController.ts"

const CONNECTION_STUB = { prompt: async () => ({ stopReason: "end_turn" as const }), cancel: async () => {} } as unknown as AgentConnection

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
    })

    expect(enabledSeen).toBe(true)
    // The controller now seeds its own store from the resolved sessions, so the
    // session no longer injects one - the recorder watches `controller.store`.
    expect(builtWithStore).toBe(false)
    expect(recorder.enabled).toBe(true)

    // Readiness was recorded from the controller's runtimes at boot.
    expect(records.map((record) => record.type)).toEqual(["agent_ready", "agent_ready"])

    // The store is watched: a prompt/response pair now produces a first-response event.
    controller.store.applyEvent("claude-code", { kind: "user_message", messageId: "m1", text: "hi" })
    controller.store.applyEvent("claude-code", { kind: "agent_message", messageId: "m2", textDelta: "hey" })
    expect(records.some((record) => record.type === "first_response_ms")).toBe(true)
  })

  it("produces a disabled recorder when telemetry is off, writing nothing", async () => {
    const records: TelemetryRecord[] = []
    const sink: TelemetrySink = { write: (record) => records.push(record) }
    const store = createAppStore()

    const { recorder } = await createCockpitSession({
      loadConfig: async () => defaultAppConfig(),
      createRecorder: (enabled) => createTelemetryRecorder({ enabled, sink }),
      buildController: async (options) => controllerOver(options.store ?? store),
    })

    expect(recorder.enabled).toBe(false)
    expect(records).toHaveLength(0)
  })
})
