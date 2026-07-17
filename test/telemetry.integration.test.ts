import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { createControllerActions } from "../src/app/actions.ts"
import {
  createSessionController,
  type AgentRuntimeState,
  type SessionController,
} from "../src/app/controller.ts"
import type { ManagedWorktreeProvisioner } from "../src/app/managedWorktree.ts"
import type {
  AgentRunControl,
  AgentRunRoute,
  KittenMcpBridgeOptions,
} from "../src/app/kittenMcpBridge.ts"
import { createHandoffEdits, createHandoffFlow } from "../src/app/handoff.ts"
import {
  evaluateExplorePolicy,
  EXPLORE_RESTRICTIONS,
} from "../src/core/explorePolicy.ts"
import { REEXPLANATION_CHAR_THRESHOLD } from "../src/core/telemetryHeuristics.ts"
import type {
  AppConfig,
  ClarificationOutcome,
  ClarificationPayload,
  ConfigOption,
  DomainSessionEvent,
  ProviderKind,
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
    transcriptWindowingEnabled: false,
    actions,
    shell: { ready: false, error: "shell outside telemetry test boundary" },
    runtimes: () => runtimes,
    runtime: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId),
    isReady: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId)?.ready === true,
    updateProviderDefaults: () => {},
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

function clarificationAppConfig(dir: string, telemetryEnabled: boolean): AppConfig {
  return {
    providers: {
      "claude-code": { displayName: "Claude Code", command: "claude-acp", args: [], env: {} },
      codex: { displayName: "Codex", command: "codex-acp", args: [], env: {} },
    } as unknown as AppConfig["providers"],
    providerDefaults: {},
    sessions: [{ provider: "claude-code", cwd: dir, title: "Private" }],
    mcpServers: [],
    shell: { enabled: false, command: "/bin/sh", scrollback: 100 },
    clarificationTimeoutSeconds: 300,
    persistenceEnabled: false,
    telemetryEnabled,
    transcriptWindowingEnabled: false,
    theme: "auto",
    editor: { kind: "system-default" },
    welcomeBanner: "auto",
    statusline: { llmDisclosureAcknowledged: false, layout: null },
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

describe("provider-default outcome JSONL privacy", () => {
  it("writes only bounded terminal categories and excludes every sentinel content class", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-default-telemetry-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => 77,
        sessionRef: "run-defaults",
      })
      const sentinels = {
        model: "MODEL_SENTINEL_private",
        effort: "EFFORT_SENTINEL_private",
        prompt: "PROMPT_SENTINEL_private",
        code: "CODE_SENTINEL_private",
        error: "ERROR_SENTINEL_private",
        adapter: "ADAPTER_SENTINEL_private",
      }
      const store = createAppStore()
      let configured: { model?: string; effort?: string } | undefined
      let failModel = false
      let effortAvailable = true
      const option = (id: string, category: string, currentValue: string, values: string[]): ConfigOption => ({
        id,
        category,
        label: id,
        currentValue,
        options: values.map((value) => ({ value, name: value })),
      })
      const confirmed = (): ConfigOption[] => [
        option("model", "model", sentinels.model, [sentinels.model]),
        option("effort", "thought_level", effortAvailable ? sentinels.effort : "low", effortAvailable
          ? ["low", sentinels.effort]
          : ["low"]),
      ]
      const connection = {
        setSessionConfigOption: async (_sessionId: string, configId: string): Promise<ConfigOption[]> => {
          if (configId === "model" && failModel) throw new Error(sentinels.error)
          return confirmed()
        },
      } as unknown as AgentConnection
      const observedErrors: unknown[] = []
      const actions = createControllerActions({
        store,
        getSession: (sessionId) => ({ sessionId, acpSessionId: sentinels.adapter, connection }),
        getProviderDefault: () => configured,
        resolvePermission: () => {},
        recorder,
        onError: (_sessionId, error) => observedErrors.push(error),
      })
      store.applyEvent("codex", { kind: "config_options", options: confirmed() })
      store.applyEvent("codex", { kind: "user_message", messageId: "private-prompt", text: sentinels.prompt })
      store.applyEvent("codex", { kind: "agent_message", messageId: "private-code", textDelta: sentinels.code })

      expect(await actions.applyProviderDefaults("codex")).toEqual({ kind: "none" })
      configured = { model: sentinels.model }
      failModel = true
      expect(await actions.applyProviderDefaults("codex")).toEqual({ kind: "unavailable", unavailable: "model" })
      failModel = false
      configured = { model: sentinels.model, effort: sentinels.effort }
      expect(await actions.applyProviderDefaults("codex")).toEqual({
        kind: "applied",
        model: sentinels.model,
        effort: sentinels.effort,
      })
      effortAvailable = false
      expect(await actions.applyProviderDefaults("codex")).toEqual({
        kind: "partial",
        model: sentinels.model,
        unavailable: "effort",
      })
      expect(observedErrors).toEqual([new Error(sentinels.error)])

      const raw = readFileSync(path, "utf8")
      const records = raw.trimEnd().split("\n").map((line) => JSON.parse(line) as TelemetryRecord)
      const outcomes = records.filter((record) => record.type === "provider_default_outcome")
      expect(outcomes.map((record) => record.defaultOutcome)).toEqual([
        "none",
        "unavailable",
        "applied",
        "partial",
      ])
      expect(outcomes.every((record) => Object.keys(record).every((key) =>
        ["type", "defaultOutcome", "at", "sessionRef"].includes(key),
      ))).toBe(true)
      for (const sentinel of Object.values(sentinels)) expect(raw).not.toContain(sentinel)
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
      const controller = await createSessionController({
        config: clarificationAppConfig(dir, true),
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
            allowsCustom: false,
            required: true,
            options: [{ id: "selected-private", label: "private option" }],
          },
          {
            id: "multi-private",
            label: "private multi",
            mode: "multi",
            allowsCustom: false,
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
        kind: "submitted",
        answers: {
          "single-private": { selectedOptionIds: ["selected-private"] },
          "multi-private": { selectedOptionIds: ["multi-value-private"] },
          "text-private": { selectedOptionIds: [], customText: "private answer" },
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
      expect(records.at(-1)).toEqual({
        type: "clarification_settled",
        terminalKind: "submitted",
        durationBucket: "30_to_120s",
        at: 32_000,
        sessionRef: "run-fixed",
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

  it("writes one content-free timed-out terminal record in an opt-in run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-clarification-timeout-int-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      let clock = 1_000
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => clock,
        sessionRef: "run-timeout",
      })
      const stub = clarificationConnection()
      const controller = await createSessionController({
        config: clarificationAppConfig(dir, true),
        createConnection: () => stub.connection,
        readBranch: async () => null,
        recorder,
        newInteractionId: () => "request-id-private",
        sendInitialTasks: false,
      })
      const clarification = stub.clarify({
        title: "private title",
        context: "private context",
        prompt: "private prompt",
        fields: [{
          id: "field-id-private",
          label: "private field",
          mode: "single",
          allowsCustom: false,
          required: true,
          options: [{ id: "option-id-private", label: "private option label" }],
        }],
      })
      const overlay = controller.store.getState().overlays.clarification!
      clock += 300_000
      controller.actions.respondClarification(overlay.requestId, overlay.generation, { kind: "timed_out" })
      await clarification

      const raw = readFileSync(path, "utf8")
      const terminalRecords = raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as TelemetryRecord)
        .filter((record) => record.type === "clarification_settled")
      expect(terminalRecords).toEqual([{
        type: "clarification_settled",
        terminalKind: "timed_out",
        durationBucket: "over_120s",
        at: 301_000,
        sessionRef: "run-timeout",
      }])
      for (const forbidden of [
        "private title",
        "private context",
        "private prompt",
        "field-id-private",
        "private field",
        "option-id-private",
        "private option label",
        "request-id-private",
        dir,
        "claude-acp",
      ]) expect(raw).not.toContain(forbidden)

      await controller.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("creates no clarification output when telemetry is disabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-clarification-disabled-int-"))
    try {
      const records: TelemetryRecord[] = []
      const recorder = createTelemetryRecorder({
        enabled: false,
        sink: { write: (record) => records.push(record) },
      })
      const stub = clarificationConnection()
      const controller = await createSessionController({
        config: clarificationAppConfig(dir, false),
        createConnection: () => stub.connection,
        readBranch: async () => null,
        recorder,
        sendInitialTasks: false,
      })
      const clarification = stub.clarify({
        prompt: "private disabled prompt",
        fields: [{ id: "private-field", label: "Private", mode: "text", required: true }],
      })
      const overlay = controller.store.getState().overlays.clarification!
      controller.actions.respondClarification(overlay.requestId, overlay.generation, { kind: "timed_out" })
      await clarification

      expect(records).toEqual([])
      await controller.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("delegated lifecycle telemetry over the local JSONL sink", () => {
  it("never serializes delegated content, identities, paths, titles, or provider failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-delegation-telemetry-int-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      const privateCwd = join(dir, "PRIVATE_CWD_SENTINEL")
      mkdirSync(privateCwd)
      const events: Array<(event: DomainSessionEvent) => void> = []
      let connectionIndex = 0
      let agentRunControl: AgentRunControl | undefined
      let parentRoute: AgentRunRoute | undefined
      const providerError = "PROVIDER_ERROR_SENTINEL"
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => 500,
        sessionRef: "anonymous-delegation-run",
      })
      const config = clarificationAppConfig(privateCwd, true)
      config.sessions = [{
        provider: "claude-code",
        cwd: privateCwd,
        title: "PRIVATE_TITLE_SENTINEL",
      }]
      const managedWorktreeProvisioner: ManagedWorktreeProvisioner = {
        async provision({ ownerSessionId }) {
          return {
            kind: "provisioned",
            binding: {
              kind: "managed",
              id: "kw-telemetry-integration",
              repoRoot: privateCwd,
              worktreePath: join(dir, "managed-child-worktree"),
              branch: "kitten/kw-telemetry-integration",
              baseBranch: "main",
              baseSha: "a".repeat(40),
              ownerSessionId,
              availability: "available",
            },
          }
        },
        async reconcile(binding) {
          return { kind: "available", binding }
        },
        async cleanup() {
          return { kind: "removed" }
        },
      }
      const controller = await createSessionController({
        config,
        cwd: privateCwd,
        createConnection(provider) {
          const index = connectionIndex++
          let emit: (event: DomainSessionEvent) => void = () => {}
          events[index] = (event) => emit(event)
          return {
            id: provider.id as ProviderKind,
            connect: async () => ({ ready: true as const, protocolVersion: 1, canLoadSession: false }),
            newSession: async () => `ACP_SESSION_SENTINEL_${index}`,
            loadSession: async () => {},
            prompt: async () => ({ stopReason: "end_turn" as const }),
            cancel: async () => {},
            setSessionConfigOption: async () => [],
            onUpdate(next) {
              emit = next
              return () => { emit = () => {} }
            },
            onPermission: () => () => {},
            onClarification: () => () => {},
            async dispose() {
              if (index === 1) throw new Error(providerError)
            },
          } as AgentConnection
        },
        createKittenMcpBridge(options: KittenMcpBridgeOptions) {
          agentRunControl = options.agentRunControl
          return {
            register(input) {
              parentRoute ??= { parentId: input.sessionId, parentGeneration: input.generation }
              return {
                name: "kitten-telemetry-test",
                command: "kitten-test",
                args: [],
                env: {},
              }
            },
            async ask() {
              return { kind: "cancelled" }
            },
            cancelSession() {},
            async dispose() {},
          }
        },
        newSessionId: () => "SESSION_ID_SENTINEL",
        readBranch: async () => null,
        sendInitialTasks: false,
        recorder,
        managedWorktreeProvisioner,
        resolveHarnessCapability: () => ({
          status: "supported",
          profileId: "telemetry-integration-profile",
          encoder: "codex-prompt-meta-v1",
        }),
        resolveExploreCapability: (provider) => {
          const decision = evaluateExplorePolicy({
            role: "explore",
            restrictions: EXPLORE_RESTRICTIONS,
            limits: { perParent: 1, global: 1 },
            attestationVersion: "ATTESTATION_PAYLOAD_SENTINEL",
            confirmed: {
              provider: provider.id,
              model: "MODEL_SENTINEL",
              effort: "EFFORT_SENTINEL",
            },
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
      if (!agentRunControl || !parentRoute) throw new Error("agent-run integration route missing")
      const accepted = await agentRunControl.start(parentRoute, [{
        task: "TASK_TEXT_SENTINEL",
        desiredOutcome: "OUTCOME_TEXT_SENTINEL",
      }])
      await expect(agentRunControl.start(parentRoute, [{
        task: "REJECTED_TASK_TEXT_SENTINEL",
        desiredOutcome: "REJECTED_OUTCOME_TEXT_SENTINEL",
      }])).rejects.toThrow()
      expect(agentRunControl.poll(parentRoute, accepted.map((snapshot) => snapshot.childId))).toHaveLength(1)

      expect(await controller.closeConversation(parentId, "cancel")).toEqual({ outcome: "teardown-failed" })
      events[1]?.({ kind: "status", status: "finished" })

      const records = readFileSync(path, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as TelemetryRecord)
      const delegatedRecords = records.filter((record) => record.type.startsWith("delegated_"))
      expect(delegatedRecords.map((record) => record.type)).toEqual([
        "delegated_launch_requested",
        "delegated_launch_succeeded",
        "delegated_visible_running_ms",
        "delegated_cascade_requested",
        "delegated_child_terminal",
        "delegated_teardown_failed",
      ])
      expect(delegatedRecords.every((record) => record.agent === undefined)).toBe(true)
      const managedWorktreeRecords = records.filter((record) => record.type.startsWith("managed_worktree_"))
      expect(managedWorktreeRecords).toEqual([
        expect.objectContaining({ type: "managed_worktree_requested" }),
        expect.objectContaining({ type: "managed_worktree_provisioned" }),
      ])
      expect(managedWorktreeRecords.every((record) => Object.keys(record).every((key) =>
        ["type", "at", "sessionRef", "managedWorktreeReason"].includes(key)
      ))).toBe(true)
      expect(managedWorktreeRecords.every((record) =>
        record.agent === undefined && record.provider === undefined
      )).toBe(true)
      const exploreRecords = records.filter((record) => record.type.startsWith("explore_"))
      expect(exploreRecords).toEqual([
        expect.objectContaining({
          type: "explore_launch_eligible",
          policyVersion: "explore-v1",
          provider: "claude-code",
          count: 1,
        }),
        expect.objectContaining({ type: "explore_terminal", terminalStatus: "failed", count: 1 }),
      ])
      const allowedExploreKeys = new Set([
        "type",
        "at",
        "sessionRef",
        "policyVersion",
        "provider",
        "denialReason",
        "capacityScope",
        "failureCategory",
        "terminalStatus",
        "count",
      ])
      expect(exploreRecords.every((record) =>
        Object.keys(record).every((key) => allowedExploreKeys.has(key))
      )).toBe(true)
      const agentRunRecords = records.filter((record) => record.type === "agent_run_control")
      expect(agentRunRecords).toEqual([
        expect.objectContaining({
          operation: "start",
          outcome: "accepted",
          batchSizeBucket: "one",
        }),
        expect.objectContaining({
          operation: "start",
          outcome: "rejected",
          batchSizeBucket: "one",
        }),
        expect.objectContaining({
          operation: "poll",
          outcome: "accepted",
          batchSizeBucket: "one",
        }),
      ])
      expect(agentRunRecords.every((record) => Object.keys(record).every((key) => [
        "type", "at", "sessionRef", "operation", "outcome", "batchSizeBucket", "durationBucket",
      ].includes(key)))).toBe(true)
      const serialized = JSON.stringify(records)
      for (const forbidden of [
        "TASK_TEXT_SENTINEL",
        "OUTCOME_TEXT_SENTINEL",
        "REJECTED_TASK_TEXT_SENTINEL",
        "REJECTED_OUTCOME_TEXT_SENTINEL",
        "SESSION_ID_SENTINEL",
        "ACP_SESSION_SENTINEL",
        "PRIVATE_CWD_SENTINEL",
        "PRIVATE_TITLE_SENTINEL",
        "MODEL_SENTINEL",
        "EFFORT_SENTINEL",
        "ATTESTATION_PAYLOAD_SENTINEL",
        "kw-telemetry-integration",
        "kitten/kw-telemetry-integration",
        "a".repeat(40),
        providerError,
      ]) {
        expect(serialized).not.toContain(forbidden)
      }
      await controller.dispose()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("serializes only fixed denial, capacity, startup, and terminal categories", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-explore-policy-telemetry-int-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => 700,
        sessionRef: "anonymous-explore-run",
      })
      const privateKey = [
        "TASK_SENTINEL",
        "OUTCOME_SENTINEL",
        "PROMPT_SENTINEL",
        "TRANSCRIPT_SENTINEL",
        "SESSION_SENTINEL",
        "CHILD_SENTINEL",
        "ACP_SENTINEL",
        "TITLE_SENTINEL",
        "CWD_SENTINEL",
        "PATH_SENTINEL",
        "RECIPE_SENTINEL",
        "CONFIG_SENTINEL",
        "MODEL_SENTINEL",
        "EFFORT_SENTINEL",
        "ATTESTATION_SENTINEL",
        "MCP_SENTINEL",
        "RAW_ERROR_SENTINEL",
      ].join(":")

      recorder.exploreLaunchDenied({ denialReason: "missing-attestation", count: 1 })
      recorder.exploreLaunchDenied({ denialReason: "stale-attestation", count: 1 })
      recorder.exploreCapacityDenied({ capacityScope: "per-parent", count: 1 })
      recorder.exploreLaunchEligible(privateKey, {
        policyVersion: "explore-v1",
        provider: "codex",
        count: 1,
      })
      recorder.exploreStartFailed(privateKey, {
        failureCategory: "session-start-failed",
        count: 1,
      })
      recorder.exploreTerminal(`${privateKey}:replacement`, {
        terminalStatus: "cancelled",
        count: 1,
      })

      const raw = readFileSync(path, "utf8")
      const records = raw.trimEnd().split("\n").map((line) => JSON.parse(line) as TelemetryRecord)
      expect(records.map((record) => record.type)).toEqual([
        "explore_launch_denied",
        "explore_launch_denied",
        "explore_capacity_denied",
        "explore_launch_eligible",
        "explore_start_failed",
        "explore_terminal",
      ])
      expect(records.map(({ type, denialReason, capacityScope, failureCategory, terminalStatus }) => ({
        type,
        denialReason,
        capacityScope,
        failureCategory,
        terminalStatus,
      }))).toEqual([
        expect.objectContaining({ type: "explore_launch_denied", denialReason: "missing-attestation" }),
        expect.objectContaining({ type: "explore_launch_denied", denialReason: "stale-attestation" }),
        expect.objectContaining({ type: "explore_capacity_denied", capacityScope: "per-parent" }),
        expect.objectContaining({ type: "explore_launch_eligible" }),
        expect.objectContaining({ type: "explore_start_failed", failureCategory: "session-start-failed" }),
        expect.objectContaining({ type: "explore_terminal", terminalStatus: "cancelled" }),
      ])
      for (const sentinel of privateKey.split(":")) expect(raw).not.toContain(sentinel)
      for (const record of records) {
        expect(record.count).toBe(1)
        expect(record.agent).toBeUndefined()
      }
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

describe("Context Pack telemetry over the local JSONL sink", () => {
  const allowedKeys = new Set([
    "type",
    "at",
    "sessionRef",
    "contextPackReason",
    "contextPackOutcome",
    "selectionCountBucket",
    "redactionCountBucket",
    "byteBucket",
    "contextPackDurationBucket",
  ])

  it("writes the permitted lifecycle in settled order without content or identities", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-context-pack-telemetry-int-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      let currentTime = 1_000
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => currentTime,
        sessionRef: "anonymous-run",
      })

      recorder.contextPackDraftCreated({ selectionCountBucket: "zero" })
      recorder.contextPackBuildStarted("PRIVATE-BUILDER-IDENTITY", { selectionCountBucket: "two_to_four" })
      currentTime += 6_000
      recorder.contextPackBuildSettled("PRIVATE-BUILDER-IDENTITY", { outcome: "ready_for_review" })
      recorder.contextPackReviewReady({
        selectionCountBucket: "two_to_four",
        redactionCountBucket: "one",
        byteBucket: "8_to_31kb",
      })
      recorder.contextPackSealed({
        selectionCountBucket: "two_to_four",
        redactionCountBucket: "one",
        byteBucket: "8_to_31kb",
      })
      recorder.contextPackFitAvailable({ byteBucket: "8_to_31kb" })
      recorder.contextPackDeliveryConfirmed({ byteBucket: "8_to_31kb" })

      const raw = readFileSync(path, "utf8")
      const records = raw.trimEnd().split("\n").map((line) => JSON.parse(line) as TelemetryRecord)
      expect(records.map(({ type }) => type)).toEqual([
        "context_pack_draft_created",
        "build_started",
        "build_settled",
        "review_ready",
        "sealed",
        "fit_available",
        "delivery_confirmed",
      ])
      expect(records.every((record) => Object.keys(record).every((key) => allowedKeys.has(key)))).toBeTrue()
      expect(raw).not.toContain("PRIVATE-BUILDER-IDENTITY")
      expect(raw).not.toContain("src/private.ts")
      expect(raw).not.toContain(SECRET)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("writes denied and stale flows with only fixed reason categories", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-context-pack-denied-int-"))
    try {
      const path = join(dir, "telemetry.jsonl")
      const recorder = createTelemetryRecorder({
        enabled: true,
        sink: createJsonlFileSink(path),
        now: () => 1_000,
        sessionRef: "anonymous-run",
      })

      recorder.contextPackBuildDenied({ reason: "capability_unavailable" })
      recorder.contextPackReviewBlocked({ reason: "source_stale" })
      recorder.contextPackSealDenied({ reason: "candidate_stale" })
      recorder.contextPackFitUnavailable({ reason: "stale_evidence" })
      recorder.contextPackFitInsufficient({ byteBucket: "128kb_or_more" })
      recorder.contextPackDeliveryDenied({ reason: "fit_insufficient" })

      const raw = readFileSync(path, "utf8")
      const records = raw.trimEnd().split("\n").map((line) => JSON.parse(line) as TelemetryRecord)
      expect(records.map(({ type, contextPackReason }) => ({ type, contextPackReason }))).toEqual([
        { type: "build_denied", contextPackReason: "capability_unavailable" },
        { type: "review_blocked", contextPackReason: "source_stale" },
        { type: "seal_denied", contextPackReason: "candidate_stale" },
        { type: "fit_unavailable", contextPackReason: "stale_evidence" },
        { type: "fit_insufficient", contextPackReason: undefined },
        { type: "delivery_denied", contextPackReason: "fit_insufficient" },
      ])
      expect(records.every((record) => Object.keys(record).every((key) => allowedKeys.has(key)))).toBeTrue()
      for (const sentinel of [
        "operator instructions",
        "src/private.ts",
        "source-digest",
        "selection rationale",
        "sealed payload",
        "recipient-id",
        "export destination",
        "provider recipe",
        "raw stack trace",
      ]) expect(raw).not.toContain(sentinel)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
