import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { createControllerActions } from "../src/app/actions.ts"
import {
  createSessionController,
  type AgentRuntimeState,
  type SessionController,
} from "../src/app/controller.ts"
import { createHandoffEdits, createHandoffFlow } from "../src/app/handoff.ts"
import { REEXPLANATION_CHAR_THRESHOLD } from "../src/core/telemetryHeuristics.ts"
import type {
  AppConfig,
  ClarificationOutcome,
  ClarificationPayload,
  ConfigOption,
  SessionId,
} from "../src/core/types.ts"
import { createAppStore, type AppStore } from "../src/store/appStore.ts"
import {
  createJsonlFileSink,
  createTelemetryRecorder,
  recordReadiness,
  type TelemetryRecord,
  type TelemetryRecorder,
} from "../src/telemetry/recorder.ts"
import { readyRuntimes } from "./fakeController.ts"

/** A connection stub whose prompt/cancel resolve; the flow only needs those two. */
const CONNECTION_STUB = {
  prompt: async () => ({ stopReason: "end_turn" as const }),
  cancel: async () => {},
} as unknown as AgentConnection

/** A configurable ACP seam that confirms the requested model or effort value. */
const SWITCHABLE_CONNECTION = {
  prompt: async () => ({ stopReason: "end_turn" as const }),
  cancel: async () => {},
  setSessionConfigOption: async (_sessionId: string, configId: string, value: string): Promise<ConfigOption[]> => [
    configId === "model"
      ? configOption("model", "model", value)
      : configOption("effort", "thought_level", value),
  ],
} as unknown as AgentConnection

function configOption(id: string, category: string, currentValue: string): ConfigOption {
  return {
    id,
    category,
    label: category,
    currentValue,
    options: [{ value: currentValue, name: currentValue }],
  }
}

/**
 * A controller backed by a real store and the real action surface, so `sendPrompt`
 * records the user turn into the store exactly as it would in production - which is
 * what makes the hand-off's re-explanation arming order faithful.
 */
function realController(
  store: AppStore,
  runtimes: AgentRuntimeState[],
  options: { recorder?: TelemetryRecorder; connection?: AgentConnection } = {},
): SessionController {
  const actions = createControllerActions({
    store,
    getSession: (sessionId) => ({ sessionId, acpSessionId: `s-${sessionId}`, connection: options.connection ?? CONNECTION_STUB }),
    resolvePermission: () => {},
    newMessageId: () => "fixed-id",
    recorder: options.recorder,
  })
  return {
    store,
    actions,
    shell: { ready: false, error: "shell outside telemetry test boundary" },
    runtimes: () => runtimes,
    runtime: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId),
    isReady: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId)?.ready === true,
    closeConversation: async () => ({ outcome: "ignored" }),
    restore: async () => {},
    dispose: async () => {},
  }
}

const SECRET = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789"

function clarificationConnection(): {
  connection: AgentConnection
  clarify(payload: ClarificationPayload): Promise<ClarificationOutcome>
} {
  let handler: ((payload: ClarificationPayload) => Promise<ClarificationOutcome>) | null = null
  const connection = {
    id: "claude-code",
    connect: async () => ({ ready: true as const, protocolVersion: 1, canLoadSession: false }),
    newSession: async () => "acp-session-private",
    loadSession: async () => {},
    prompt: async () => ({ stopReason: "end_turn" as const }),
    cancel: async () => {},
    setSessionConfigOption: async () => [],
    onUpdate: () => () => {},
    onPermission: () => {},
    onClarification: (next: (payload: ClarificationPayload) => Promise<ClarificationOutcome>) => {
      handler = next
      return () => {
        if (handler === next) handler = null
      }
    },
    dispose: async () => {},
  } as AgentConnection
  return {
    connection,
    clarify(payload) {
      if (!handler) throw new Error("clarification handler not registered")
      return handler(payload)
    },
  }
}

describe("telemetry over a scripted hand-off session", () => {
  it("writes the content-free switch and effort-linked hand-off sequence to an injected memory sink", async () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 1000,
      sessionRef: "run-fixed",
    })
    const store = createAppStore()
    const runtimes = readyRuntimes()
    const controller = realController(store, runtimes, { recorder, connection: SWITCHABLE_CONNECTION })

    // Seed confirmed state and enough source work to open the redacted hand-off preview.
    store.applyEvent("claude-code", { kind: "config_options", options: [configOption("model", "model", "sonnet")] })
    store.applyEvent("codex", { kind: "config_options", options: [configOption("effort", "thought_level", "low")] })
    store.applyEvent("claude-code", { kind: "user_message", messageId: "u1", text: `carry ${SECRET}` })
    store.applyEvent("claude-code", { kind: "agent_message", messageId: "a1", textDelta: "working" })
    recorder.watch(store)

    // A confirmed model switch, then an effort-tagged hand-off to the other pane.
    await controller.actions.setSessionConfigOption("model", "opus", "claude-code")
    const flow = createHandoffFlow({ controller, recorder })
    expect(flow.begin()).toEqual({ ok: true })
    await flow.confirm({
      ...createHandoffEdits(store.getState().overlays.handoffPreview!.bundle),
      targetConfig: [{ configId: "effort", value: "high" }],
    })

    expect(records.map((record) => record.type)).toEqual([
      "model_switched",
      "switch_confirmed",
      "handoff_invoked",
      "effort_switched",
      "switch_confirmed",
      "effort_change_kept",
      "handoff_sent",
      "bundle_edit_chars",
      "effort_linked_handoff",
      "focus_switch",
    ])
    expect(records.filter((record) => record.type === "switch_confirmed")).toHaveLength(2)
    expect(records.every((record) => Object.keys(record).every((key) => ["type", "at", "sessionRef", "agent", "charBucket", "durationMs", "count"].includes(key)))).toBe(true)
    expect(JSON.stringify(records)).not.toContain(SECRET)
  })

  it("writes the ordered, content-free event stream to a local JSONL file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-telemetry-int-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      const store = createAppStore()
      const runtimes = readyRuntimes()
      const controller = realController(store, runtimes)

      let clock = 1000
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => clock,
        sessionRef: "run-fixed",
      })

      // The source agent did some work worth handing over (one of the turns holds a
      // secret). Applied before `watch` primes, so this pre-existing transcript is not
      // replayed as fresh activity - the scripted stream begins at boot.
      store.setFocus("claude-code")
      store.applyEvent("claude-code", { kind: "user_message", messageId: "u1", text: `bump b, key is ${SECRET}` })
      store.applyEvent("claude-code", { kind: "agent_message", messageId: "a1", textDelta: "On it, editing app.ts." })

      // Boot: both agents came up.
      recordReadiness(recorder, runtimes.map((runtime): { sessionId: SessionId; ready: boolean } => ({ sessionId: runtime.sessionId, ready: runtime.ready })))
      recorder.watch(store)

      // Hand off to Codex, editing the summary in the preview before sending.
      const flow = createHandoffFlow({ controller, recorder })
      expect(flow.begin()).toEqual({ ok: true })
      const overlay = store.getState().overlays.handoffPreview!
      await flow.confirm({ ...createHandoffEdits(overlay.bundle), summary: "Finish the app.ts edit." })

      // Codex responds, then the developer re-explains at length before Codex's first tool call.
      clock += 320
      store.applyEvent("codex", { kind: "agent_message", messageId: "a2", textDelta: "Sure." })
      store.applyEvent("codex", { kind: "user_message", messageId: "u2", text: "y".repeat(REEXPLANATION_CHAR_THRESHOLD + 40) })

      const raw = readFileSync(path, "utf8")
      const records = raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as TelemetryRecord)

      expect(records.map((record) => record.type)).toEqual([
        "agent_ready",
        "agent_ready",
        "max_concurrent_sessions",
        "handoff_invoked",
        "handoff_sent",
        "bundle_edit_chars",
        "first_response_ms",
        "reexplanation_detected",
      ])

      // Both agents came up, so the run's peak concurrency is two.
      expect(records.find((record) => record.type === "max_concurrent_sessions")).toMatchObject({ count: 2 })

      // The first response was timed against the bundle prompt.
      expect(records.find((record) => record.type === "first_response_ms")).toMatchObject({ agent: "codex", durationMs: 320 })

      // Content-free: neither the secret, the transcript, nor the re-explanation is on disk.
      expect(raw).not.toContain(SECRET)
      expect(raw).not.toContain("bump b")
      expect(raw).not.toContain("Finish the app.ts edit.")
      expect(raw).not.toContain("yyyy")
      for (const record of records) {
        expect(
          Object.keys(record).every((key) =>
            ["type", "at", "sessionRef", "agent", "charBucket", "durationMs", "count"].includes(key),
          ),
        ).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("writes a content-free attention-latency event across a needs-you to action sequence", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-telemetry-attn-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      const store = createAppStore()
      const runtimes = readyRuntimes()
      const controller = realController(store, runtimes)

      let clock = 1000
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => clock,
        sessionRef: "run-fixed",
      })
      recorder.watch(store)

      // The focused session finishes its turn (needs the developer), then - after the
      // developer sends their next prompt, secret and all - it leaves the needy state.
      store.applyEvent("claude-code", { kind: "status", status: "finished" })
      clock += 900
      void controller.actions.sendPrompt(`carry on, key is ${SECRET}`, "claude-code")
      store.applyEvent("claude-code", { kind: "status", status: "working" })

      const raw = readFileSync(path, "utf8")
      const records = raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as TelemetryRecord)

      const attention = records.filter((record) => record.type === "attention_latency_ms")
      expect(attention).toHaveLength(1)
      expect(attention[0]).toMatchObject({ type: "attention_latency_ms", agent: "claude-code", durationMs: 900 })
      // The event carries its run reference and timestamp, and nothing that is content.
      expect(attention[0]!.sessionRef).toBe("run-fixed")
      expect(attention[0]!.at).toBeNumber()

      // No prompt content reaches the log, and no record carries a text-bearing field.
      expect(raw).not.toContain(SECRET)
      expect(raw).not.toContain("carry on")
      for (const record of records) {
        expect(
          Object.keys(record).every((key) =>
            ["type", "at", "sessionRef", "agent", "charBucket", "durationMs", "count"].includes(key),
          ),
        ).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("Session Tabs telemetry over the action and store seams", () => {
  it("records model-selector tab changes as user-directed selection and latency events", () => {
    const records: TelemetryRecord[] = []
    let tabClock = 1_000
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => tabClock,
      sessionRef: "tabs-model-select",
    })
    const store = createAppStore()
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      recorder,
    })

    actions.selectConversation("codex", { source: "model_select" })
    tabClock += 125
    recorder.tabSelectionSettled()

    const tabs = records.filter((record) => record.type.startsWith("tab_"))
    expect(tabs).toEqual([
      { type: "tab_selected", selectionSource: "model_select", at: 1_000, sessionRef: "tabs-model-select" },
      {
        type: "tab_switch_latency_ms",
        selectionSource: "model_select",
        switchLatencyBucket: "under_200ms",
        at: 1_125,
        sessionRef: "tabs-model-select",
      },
    ])
  })

  it("keeps lifecycle ordering and a strict content-free payload allowlist", async () => {
    const records: TelemetryRecord[] = []
    let tabClock = 1_000
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => tabClock,
      sessionRef: "tabs-run",
    })
    const store = createAppStore()
    recorder.watch(store)
    const actions = createControllerActions({
      store,
      getSession: () => undefined,
      resolvePermission: () => {},
      recorder,
      async createConversation() {
        store.addSession({
          id: "private-session-id",
          providerKind: "claude-code",
          title: "Private display name",
          cwd: "/private/customer/path",
        }, { availability: { kind: "ready" } })
        return "private-session-id"
      },
      async closeConversation(sessionId, choice) {
        if (choice === "keep-open") return { outcome: "kept-open" }
        store.removeSession(sessionId)
        return { outcome: "closed" }
      },
    })

    const created = await actions.createConversation()
    actions.selectConversation("claude-code", { source: "mouse" })
    tabClock += 250
    recorder.tabSelectionSettled()
    actions.backgroundConversation(created!)
    store.applyEvent(created!, { kind: "status", status: "finished" })
    actions.jumpToNextAttention()
    tabClock += 50
    recorder.tabSelectionSettled()
    await actions.closeConversation(created!, "keep-open")
    store.applyEvent(created!, { kind: "status", status: "idle" })
    await actions.closeConversation(created!, "close")

    const tabs = records.filter((record) => record.type.startsWith("tab_"))
    expect(tabs.map((record) => record.type)).toEqual([
      "tab_created",
      "tab_selected",
      "tab_switch_latency_ms",
      "tab_backgrounded",
      "tab_attention_seen",
      "tab_selected",
      "tab_switch_latency_ms",
      "tab_close_kept_open",
      "tab_close_confirmed",
    ])
    expect(tabs[2]).toMatchObject({ switchLatencyBucket: "200_to_499ms", selectionSource: "mouse" })
    expect(tabs[4]).toMatchObject({ attentionStatus: "finished", lifecycle: "background" })
    expect(tabs[5]).toMatchObject({ selectionSource: "attention_jump" })
    expect(tabs.at(-1)).toMatchObject({ tabCloseOutcome: "idle_close" })

    const allowed = new Set([
      "type",
      "at",
      "sessionRef",
      "provider",
      "creationSource",
      "selectionSource",
      "switchLatencyBucket",
      "attentionStatus",
      "lifecycle",
      "tabCloseOutcome",
    ])
    for (const record of tabs) {
      expect(Object.keys(record).every((key) => allowed.has(key))).toBe(true)
      expect(record.agent).toBeUndefined()
    }
    const serialized = JSON.stringify(tabs)
    expect(serialized).not.toContain("private-session-id")
    expect(serialized).not.toContain("Private display name")
    expect(serialized).not.toContain("/private/customer/path")
  })
})

describe("clarification lifecycle over controller and local JSONL", () => {
  it("writes an ordered mixed-form lifecycle without request or answer content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-clarification-telemetry-int-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      let clock = 1_000
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => clock,
        sessionRef: "run-fixed",
      })
      const stub = clarificationConnection()
      const config: AppConfig = {
        providers: {
          "claude-code": {
            displayName: "Claude Code",
            command: "claude-acp",
            args: [],
            env: {},
          },
          codex: {
            displayName: "Codex",
            command: "codex-acp",
            args: [],
            env: {},
          },
        } as unknown as AppConfig["providers"],
        sessions: [{ provider: "claude-code", cwd: dir, title: "Private" }],
        mcpServers: [],
        shell: { enabled: false, command: "/bin/sh", scrollback: 100 },
        persistenceEnabled: false,
        telemetryEnabled: true,
        theme: "auto",
        welcomeBanner: "auto",
      }
      const controller = await createSessionController({
        config,
        createConnection: () => stub.connection,
        readBranch: async () => null,
        recorder,
        newInteractionId: () => "request-private",
        sendInitialTasks: false,
      })
      const payload: ClarificationPayload = {
        prompt: "private prompt",
        fields: [
          {
            id: "single-private",
            label: "private single",
            mode: "single",
            required: true,
            options: [{ id: "selected-private", label: "private option" }],
          },
          {
            id: "multi-private",
            label: "private multi",
            mode: "multi",
            required: false,
            options: [{ id: "multi-value-private", label: "private multi option" }],
          },
          {
            id: "text-private",
            label: "private text",
            mode: "text",
            required: false,
          },
        ],
      }

      const clarification = stub.clarify(payload)
      const overlay = controller.store.getState().overlays.clarification!
      clock += 31_000
      controller.actions.respondClarification(overlay.requestId, overlay.generation, {
        kind: "answered",
        values: {
          "single-private": "selected-private",
          "multi-private": ["multi-value-private"],
          "text-private": "private answer",
        },
      })
      await clarification

      const raw = readFileSync(path, "utf8")
      const records = raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as TelemetryRecord)
      expect(records.map((record) => record.type)).toEqual([
        "clarification_capability_classified",
        "provider_readiness",
        "clarification_presented",
        "clarification_settled",
      ])
      expect(records.at(-1)).toMatchObject({
        terminalKind: "answered",
        hasSingle: true,
        hasMulti: true,
        hasText: true,
        fieldCountBucket: "two_to_three",
        durationBucket: "30_to_120s",
      })
      expect(raw).not.toContain("private prompt")
      expect(raw).not.toContain("private option")
      expect(raw).not.toContain("private answer")
      expect(raw).not.toContain(dir)
      expect(raw).not.toContain("claude-acp")
      expect(raw).not.toContain("request-private")

      await controller.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("settings telemetry over an injected sink", () => {
  it("emits the four settings events as content-free records", () => {
    const records: TelemetryRecord[] = []
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink: { write: (record) => records.push(record) },
      now: () => 1000,
      sessionRef: "run-fixed",
    })

    recorder.settingsOpened()
    recorder.themeSet("catppuccin-mocha")
    recorder.configWrite("modal")
    recorder.configWriteError("modal")

    expect(records).toEqual([
      { type: "settings_opened", at: 1000, sessionRef: "run-fixed" },
      { type: "theme_set", themeId: "catppuccin-mocha", at: 1000, sessionRef: "run-fixed" },
      { type: "config_write", source: "modal", at: 1000, sessionRef: "run-fixed" },
      { type: "config_write_error", source: "modal", at: 1000, sessionRef: "run-fixed" },
    ])
    expect(
      records.every((record) =>
        Object.keys(record).every((key) => ["type", "at", "sessionRef", "themeId", "source"].includes(key)),
      ),
    ).toBe(true)
  })
})

describe("shell telemetry over the local JSONL sink", () => {
  it("appends the three shell events as well-formed content-free records", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-shell-telemetry-int-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => 1000,
        sessionRef: "run-fixed",
      })

      recorder.shellActivated()
      recorder.shellSnapshotAttached()
      recorder.externalRun()

      const raw = readFileSync(path, "utf8")
      const records = raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as TelemetryRecord)

      expect(records).toEqual([
        { type: "shell_activated", at: 1000, sessionRef: "run-fixed" },
        { type: "shell_snapshot_attached", at: 1000, sessionRef: "run-fixed" },
        { type: "external_run", at: 1000, sessionRef: "run-fixed" },
      ])
      expect(
        records.every((record) => Object.keys(record).every((key) => ["type", "at", "sessionRef"].includes(key))),
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
