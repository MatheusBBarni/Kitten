// Suite: content-free local telemetry recorder
// Invariant: enabled telemetry records only allowlisted metadata; disabled telemetry records nothing.
// Boundary IN: recorder API, store-derived heuristics, injected clock/sink, and local JSONL sink.
// Boundary OUT: controller/picker orchestration and rendered UI, owned by their canonical suites.

import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { bucketChars, CHAR_BUCKETS, REEXPLANATION_CHAR_THRESHOLD } from "../core/telemetryHeuristics.ts"
import { createAppStore } from "../store/appStore.ts"
import {
  createUsageSeenRecord,
  createJsonlFileSink,
  createTelemetryRecorder,
  createUsageSeenJsonlFileSink,
  logUsageSeen,
  recordReadiness,
  resolveTelemetryPath,
  TELEMETRY_PATH_ENV_VAR,
  type TelemetryRecord,
  type TelemetrySink,
} from "./recorder.ts"

/** A sink that keeps every record in memory so a test can read them back. */
function memorySink(): TelemetrySink & { records: TelemetryRecord[] } {
  const records: TelemetryRecord[] = []
  return { records, write: (record) => records.push(record) }
}

/** A clock a test can advance by hand, for deterministic durations. */
function fakeClock(start = 1000): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

const types = (records: TelemetryRecord[]): string[] => records.map((record) => record.type)

describe("opt-in gating", () => {
  it("produces one exact content-free usage record when enabled", () => {
    const record = createUsageSeenRecord(
      { provider: "claude-code", used: 124_000, size: 200_000 },
      true,
    )

    expect(record).toEqual({
      evt: "usage_seen",
      provider: "claude-code",
      used: 124_000,
      size: 200_000,
    })
    expect(Object.keys(record!)).toEqual(["evt", "provider", "used", "size"])
  })

  it("suppresses usage records by default", () => {
    const records: unknown[] = []
    const input = { provider: "codex", used: 10, size: 20 } as const

    expect(createUsageSeenRecord(input)).toBeNull()
    logUsageSeen(input, false, { write: (record) => records.push(record) })

    expect(records).toHaveLength(0)
  })

  it("writes nothing across a full sequence when telemetry is disabled", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: false, sink })
    expect(recorder.enabled).toBe(false)

    const unsubscribe = recorder.watch(store)
    recordReadiness(recorder, [
      { sessionId: "claude-code", ready: true },
      { sessionId: "codex", ready: false },
    ])
    recorder.handoffInvoked()
    recorder.handoffSent({ targetSessionId: "codex", editChars: 400 })
    recorder.effortLinkedHandoff("codex")
    recorder.settingsOpened()
    recorder.shellActivated()
    recorder.shellSnapshotAttached()
    recorder.externalRun()
    recorder.themeSet("catppuccin-mocha")
    recorder.configWrite("modal")
    recorder.configWriteError("modal")
    recorder.recordSwitch("codex", "model", true, false)
    recorder.recordSwitch("codex", "effort", false, false)
    recorder.promptHistorySubmitted("codex")
    recorder.promptHistorySubmitted("codex")
    recorder.promptHistoryRecalled("codex")
    recorder.promptHistoryCleared("codex")
    recorder.promptHistoryEditedResend("codex")
    recorder.fileSelectorOpened("codex")
    recorder.fileSelectorDiscovery("codex", "unavailable", 20)
    recorder.fileSelectorQueryRendered("codex", "empty", 3)
    recorder.fileSelectorSelected("codex", 150)
    recorder.fileSelectorCorrected("codex")
    recorder.clarificationCapabilityClassified("codex", "unsupported", "unknown_recipe")
    recorder.clarificationPresented({
      requestId: "request-secret",
      sessionId: "codex",
      capability: "unsupported",
      focused: false,
      hasSingle: true,
      hasMulti: true,
      hasText: true,
      fieldCount: 3,
    })
    recorder.clarificationPreempted("codex", "permission")
    recorder.clarificationResumed("codex", "permission")
    recorder.clarificationCancelledOnSessionLoss("codex", "connection_error")
    recorder.clarificationSettled("request-secret", "cancelled")
    recorder.resumePickerOpened()
    recorder.resumePickerInteractive()
    recorder.resumeLoadStarted()
    recorder.resumePaneUnavailable("codex")
    recorder.sessionResumed({ mode: "picker", liveCount: 1 })
    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: "x".repeat(400) })
    store.applyEvent("codex", { kind: "agent_message", messageId: "m2", textDelta: "working" })
    unsubscribe()

    expect(sink.records).toHaveLength(0)
  })

  it("does not access or construct a sink for disabled file-selector telemetry", () => {
    const recorder = createTelemetryRecorder({
      enabled: false,
      get sink(): TelemetrySink {
        throw new Error("disabled telemetry must not access a sink")
      },
    })

    recorder.fileSelectorOpened("codex")
    recorder.fileSelectorDiscovery("codex", "ready", 10)
    recorder.fileSelectorQueryRendered("codex", "results", 2)
    recorder.fileSelectorSelected("codex", 25)
    recorder.fileSelectorCorrected("codex")
  })
})

describe("clarification lifecycle events", () => {
  it("records one ordered mixed-form lifecycle with anonymous refs and coarse duration", () => {
    const sink = memorySink()
    const clock = fakeClock()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: clock.now,
      sessionRef: "run-1",
    })

    recorder.clarificationCapabilityClassified("codex", "supported", "verified_recipe")
    recorder.clarificationPresented({
      requestId: "request-private",
      sessionId: "developer-named-session",
      capability: "supported",
      focused: false,
      hasSingle: true,
      hasMulti: true,
      hasText: true,
      fieldCount: 3,
    })
    recorder.clarificationPreempted("developer-named-session", "permission")
    clock.advance(7_000)
    recorder.clarificationResumed("developer-named-session", "permission")
    recorder.clarificationSettled("request-private", "answered")
    recorder.clarificationSettled("request-private", "cancelled")

    expect(types(sink.records)).toEqual([
      "clarification_capability_classified",
      "clarification_presented",
      "clarification_preempted",
      "clarification_resumed",
      "clarification_settled",
    ])
    expect(sink.records).toEqual([
      {
        type: "clarification_capability_classified",
        provider: "codex",
        capability: "supported",
        diagnostic: "verified_recipe",
        at: 1_000,
        sessionRef: "run-1",
      },
      {
        type: "clarification_presented",
        agentRef: 1,
        capability: "supported",
        focused: false,
        at: 1_000,
        sessionRef: "run-1",
      },
      {
        type: "clarification_preempted",
        agentRef: 1,
        interactionKind: "permission",
        at: 1_000,
        sessionRef: "run-1",
      },
      {
        type: "clarification_resumed",
        agentRef: 1,
        interactionKind: "permission",
        at: 8_000,
        sessionRef: "run-1",
      },
      {
        type: "clarification_settled",
        agentRef: 1,
        terminalKind: "answered",
        hasSingle: true,
        hasMulti: true,
        hasText: true,
        fieldCountBucket: "two_to_three",
        durationBucket: "5_to_30s",
        at: 8_000,
        sessionRef: "run-1",
      },
    ])
  })

  it("serializes no request, answer, session identity, or adapter recipe content", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: () => 42,
      sessionRef: "anonymous-run",
    })

    recorder.clarificationCapabilityClassified("claude-code", "unsupported", "recipe_overridden")
    recorder.clarificationPresented({
      requestId: "request-containing-prompt",
      sessionId: "/private/workspace/customer-project",
      capability: "unsupported",
      focused: true,
      hasSingle: false,
      hasMulti: false,
      hasText: true,
      fieldCount: 1,
    })
    recorder.clarificationCancelledOnSessionLoss(
      "/private/workspace/customer-project",
      "session_replaced",
    )
    recorder.clarificationSettled("request-containing-prompt", "cancelled")

    const serialized = JSON.stringify(sink.records)
    expect(serialized).not.toContain("customer-project")
    expect(serialized).not.toContain("request-containing-prompt")
    expect(serialized).not.toContain("adapterPackage")
    expect(serialized).not.toContain("adapterVersion")
    expect(serialized).not.toContain("prompt")
    expect(serialized).not.toContain("answer")
    expect(serialized).not.toContain("selected")
    expect(serialized).not.toContain("command")
    expect(serialized).not.toContain("cwd")
    expect(sink.records.map((record) => Object.keys(record).sort())).toEqual([
      ["at", "capability", "diagnostic", "provider", "sessionRef", "type"],
      ["agentRef", "at", "capability", "focused", "sessionRef", "type"],
      ["agentRef", "at", "lossReason", "sessionRef", "type"],
      [
        "agentRef",
        "at",
        "durationBucket",
        "fieldCountBucket",
        "hasMulti",
        "hasSingle",
        "hasText",
        "sessionRef",
        "terminalKind",
        "type",
      ],
    ])
  })
})

describe("file-selector events", () => {
  it("records every fixed interaction fact with only allowlisted metadata", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.fileSelectorOpened("codex")
    recorder.fileSelectorDiscovery("codex", "ready", 18)
    recorder.fileSelectorQueryRendered("codex", "empty", 4)
    recorder.fileSelectorSelected("codex", 240)
    recorder.fileSelectorCorrected("codex")

    expect(sink.records).toEqual([
      { type: "file_selector_opened", agent: "codex", at: 42, sessionRef: "run-1" },
      {
        type: "file_selector_discovery",
        agent: "codex",
        outcome: "ready",
        durationMs: 18,
        at: 42,
        sessionRef: "run-1",
      },
      {
        type: "file_selector_query_rendered",
        agent: "codex",
        state: "empty",
        durationMs: 4,
        at: 42,
        sessionRef: "run-1",
      },
      {
        type: "file_selector_selected",
        agent: "codex",
        durationMs: 240,
        at: 42,
        sessionRef: "run-1",
      },
      { type: "file_selector_corrected", agent: "codex", at: 42, sessionRef: "run-1" },
    ])
  })

  it("serializes no query, path, prompt, count, reference, or byte fields", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.fileSelectorOpened("claude-code")
    recorder.fileSelectorDiscovery("claude-code", "unavailable", 30)
    recorder.fileSelectorQueryRendered("claude-code", "unavailable", 5)
    recorder.fileSelectorSelected("claude-code", 350)
    recorder.fileSelectorCorrected("claude-code")

    const prohibited = [
      "query",
      "path",
      "prompt",
      "count",
      "candidateCount",
      "candidate_count",
      "referenceText",
      "reference_text",
      "sourceBytes",
      "source_bytes",
      "bytes",
    ]
    for (const record of sink.records) {
      for (const field of prohibited) expect(Object.keys(record)).not.toContain(field)
    }
    const serialized = JSON.stringify(sink.records)
    for (const field of prohibited) expect(serialized).not.toContain(`"${field}"`)
  })

  it("keeps outcome and render state closed at the typed recorder API", () => {
    if (false) {
      const recorder = createTelemetryRecorder({ enabled: false })
      // @ts-expect-error Discovery outcomes are intentionally fixed.
      recorder.fileSelectorDiscovery("codex", "failed", 1)
      // @ts-expect-error Render states are intentionally fixed.
      recorder.fileSelectorQueryRendered("codex", "loading", 1)
    }
    expect(true).toBe(true)
  })
})

describe("prompt-history events", () => {
  it("emits eligibility once on a session's second composer submission", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.promptHistorySubmitted("codex")
    expect(sink.records).toEqual([])
    recorder.promptHistorySubmitted("codex")
    recorder.promptHistorySubmitted("codex")

    expect(sink.records).toEqual([
      { type: "prompt_history_eligible", agent: "codex", at: 42, sessionRef: "run-1" },
    ])
  })

  it("starts a fresh eligibility count when the session run is replaced", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    recorder.promptHistorySubmitted("codex")
    recorder.promptHistorySubmitted("codex")
    store.startSession("codex", "replacement-acp-session")
    recorder.promptHistorySubmitted("codex")
    recorder.promptHistorySubmitted("codex")

    expect(types(sink.records)).toEqual(["prompt_history_eligible", "prompt_history_eligible"])
  })

  it("emits only exact content-free recall, clear, and edited-resend records", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.promptHistoryRecalled("claude-code")
    recorder.promptHistoryCleared("claude-code")
    recorder.promptHistoryEditedResend("claude-code")

    expect(sink.records).toEqual([
      { type: "prompt_history_recalled", agent: "claude-code", at: 42, sessionRef: "run-1" },
      { type: "prompt_history_cleared", agent: "claude-code", at: 42, sessionRef: "run-1" },
      { type: "prompt_history_edited_resend", agent: "claude-code", at: 42, sessionRef: "run-1" },
    ])
    const forbidden = ["text", "hash", "promptHash", "length", "capacity", "historyIndex", "entries", "charBucket"]
    for (const record of sink.records) {
      for (const key of forbidden) expect(Object.keys(record)).not.toContain(key)
    }
  })
})

describe("settings events", () => {
  it("records settings_opened with only the common event fields", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.settingsOpened()

    expect(sink.records).toEqual([{ type: "settings_opened", at: 42, sessionRef: "run-1" }])
  })

  it("records theme_set with a fixed ThemePreference and no text field", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.themeSet("catppuccin-mocha")

    expect(sink.records).toEqual([
      { type: "theme_set", themeId: "catppuccin-mocha", at: 42, sessionRef: "run-1" },
    ])
    expect(Object.keys(sink.records[0]!)).not.toContain("text")
  })

  it("records config write outcomes with the fixed modal source", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.configWrite("modal")
    recorder.configWriteError("modal")

    expect(sink.records).toEqual([
      { type: "config_write", source: "modal", at: 42, sessionRef: "run-1" },
      { type: "config_write_error", source: "modal", at: 42, sessionRef: "run-1" },
    ])
  })

})

describe("shell events", () => {
  it("records shell_activated with only the common content-free fields", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.shellActivated()

    expect(sink.records).toEqual([{ type: "shell_activated", at: 42, sessionRef: "run-1" }])
    expect(Object.keys(sink.records[0]!)).not.toContain("text")
  })

  it("records shell_snapshot_attached with only the common content-free fields", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.shellSnapshotAttached()

    expect(sink.records).toEqual([{ type: "shell_snapshot_attached", at: 42, sessionRef: "run-1" }])
    expect(Object.keys(sink.records[0]!)).not.toContain("text")
  })

  it("records external_run with only the common content-free fields", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.externalRun()

    expect(sink.records).toEqual([{ type: "external_run", at: 42, sessionRef: "run-1" }])
    expect(Object.keys(sink.records[0]!)).not.toContain("text")
  })
})

describe("hand-off events", () => {
  it("records handoff_invoked then handoff_sent with an edit-chars bucket", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.handoffInvoked()
    recorder.handoffSent({ targetSessionId: "codex", editChars: 137 })

    expect(types(sink.records)).toEqual(["handoff_invoked", "handoff_sent", "bundle_edit_chars"])
    const edit = sink.records.find((record) => record.type === "bundle_edit_chars")!
    // Coarse bucket, never the exact 137 the developer typed.
    expect(edit.charBucket).toBe(bucketChars(137))
    expect(edit.charBucket).not.toBe(137)
    expect(edit.charBucket).toBe(100)
    expect(sink.records[0]).toMatchObject({ type: "handoff_invoked", at: 42, sessionRef: "run-1" })
  })

  it("adds handoff_repeat only from the second hand-off in a run", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })

    recorder.handoffSent({ targetSessionId: "codex", editChars: 0 })
    expect(types(sink.records)).not.toContain("handoff_repeat")

    recorder.handoffSent({ targetSessionId: "claude-code", editChars: 0 })
    expect(types(sink.records)).toContain("handoff_repeat")
  })
})

describe("switch events", () => {
  it("records a confirmed model switch with its agent id and no text-bearing field", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run-1" })

    recorder.recordSwitch("codex", "model", true, false)

    expect(types(sink.records)).toEqual(["model_switched", "switch_confirmed"])
    for (const record of sink.records) {
      expect(record).toMatchObject({ agent: "codex", at: 42, sessionRef: "run-1" })
      expect(Object.keys(record)).not.toContain("text")
    }
  })

  it("records an unverified switch without recording it as confirmed", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })

    recorder.recordSwitch("claude-code", "effort", false, false)

    expect(types(sink.records)).toEqual(["effort_switched", "switch_unverified"])
    expect(types(sink.records)).not.toContain("switch_confirmed")
  })
})

describe("kept effort changes (store-derived over the heuristic)", () => {
  const effortOption = (currentValue: string) => ({
    id: "effort",
    category: "thought_level",
    label: "Effort",
    currentValue,
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  })

  it("records a confirmed effort change when it survives to the next turn", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    store.applyEvent("codex", { kind: "config_options", options: [effortOption("low")] })
    recorder.watch(store)

    // The action applies the adapter-reported value before it arms the retention watch.
    store.applyEvent("codex", { kind: "config_options", options: [effortOption("high")] })
    recorder.recordSwitch("codex", "effort", true, true)
    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: "continue" })

    expect(types(sink.records)).toContain("effort_change_kept")
  })

  it("does not record a kept change when the effort is reverted before the next turn", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    store.applyEvent("codex", { kind: "config_options", options: [effortOption("low")] })
    recorder.watch(store)

    store.applyEvent("codex", { kind: "config_options", options: [effortOption("high")] })
    recorder.recordSwitch("codex", "effort", true, true)
    store.applyEvent("codex", { kind: "config_options", options: [effortOption("low")] })
    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: "continue" })

    expect(types(sink.records)).not.toContain("effort_change_kept")
  })
})

describe("readiness events", () => {
  it("records agent_ready and agent_unready from a runtimes snapshot", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })

    recordReadiness(recorder, [
      { sessionId: "claude-code", ready: true },
      { sessionId: "codex", ready: false },
    ])

    expect(sink.records.slice(0, 2)).toEqual([
      expect.objectContaining({ type: "agent_ready", agent: "claude-code" }),
      expect.objectContaining({ type: "agent_unready", agent: "codex" }),
    ])
  })
})

describe("max concurrent sessions (task_09)", () => {
  it("records the count of live sessions in the run", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })

    recordReadiness(recorder, [
      { sessionId: "claude-code", ready: true },
      { sessionId: "codex", ready: true },
    ])

    const maxConcurrent = sink.records.filter((record) => record.type === "max_concurrent_sessions")
    expect(maxConcurrent).toHaveLength(1)
    expect(maxConcurrent[0]!.count).toBe(2)
  })

  it("counts only the sessions that actually came up", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })

    recordReadiness(recorder, [
      { sessionId: "claude-code", ready: true },
      { sessionId: "codex", ready: false },
    ])

    const maxConcurrent = sink.records.find((record) => record.type === "max_concurrent_sessions")!
    expect(maxConcurrent.count).toBe(1)
  })
})

describe("resume events", () => {
  it("records picker and load timings plus content-free restore outcomes", () => {
    const sink = memorySink()
    const clock = fakeClock(1000)
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: clock.now,
      sessionRef: "run-1",
    })

    recorder.resumePickerOpened()
    clock.advance(40)
    recorder.resumePickerInteractive()
    recorder.resumeLoadStarted()
    clock.advance(300)
    recorder.resumePaneUnavailable("codex")
    recorder.sessionResumed({ mode: "picker", liveCount: 1 })

    expect(sink.records).toEqual([
      { type: "resume_picker_interactive_ms", durationMs: 40, at: 1040, sessionRef: "run-1" },
      { type: "resume_pane_unavailable", agent: "codex", at: 1340, sessionRef: "run-1" },
      { type: "session_resumed", mode: "picker", liveCount: 1, at: 1340, sessionRef: "run-1" },
      { type: "resume_load_usable_ms", durationMs: 300, at: 1340, sessionRef: "run-1" },
    ])
  })

  it("classifies only the first short post-resume message as continued", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)
    recorder.sessionResumed({ mode: "last-run", liveCount: 2 })

    store.applyEvent("claude-code", { kind: "user_message", messageId: "m1", text: "keep going" })
    store.applyEvent("codex", {
      kind: "user_message",
      messageId: "m2",
      text: "x".repeat(REEXPLANATION_CHAR_THRESHOLD + 10),
    })

    const actions = sink.records.filter((record) => record.type === "resume_first_action")
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ continued: true })
  })

  it("classifies a long first post-resume message as re-explanation", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)
    recorder.sessionResumed({ mode: "picker", liveCount: 2 })

    store.applyEvent("codex", {
      kind: "user_message",
      messageId: "m1",
      text: "x".repeat(REEXPLANATION_CHAR_THRESHOLD + 10),
    })

    expect(sink.records.find((record) => record.type === "resume_first_action")).toMatchObject({ continued: false })
  })
})

describe("content-free guarantee", () => {
  it("never serializes prompt or code text, even from a long re-explanation", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    const secret = "sk-ant-0123456789 THE-USER-TYPED-THIS-SENTENCE and this code: const x = 1"
    const promptText = `${secret} ${"and more context ".repeat(40)}`
    recorder.handoffSent({ targetSessionId: "codex", editChars: promptText.length })
    recorder.sessionResumed({ mode: "picker", liveCount: 2 })
    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: promptText })

    const serialized = JSON.stringify(sink.records)
    expect(serialized).not.toContain("sk-ant")
    expect(serialized).not.toContain("THE-USER-TYPED-THIS-SENTENCE")
    expect(serialized).not.toContain("const x = 1")
    // Structural guarantee: no record carries a text-bearing field at all.
    for (const record of sink.records) {
      const keys = Object.keys(record)
      expect(keys).not.toContain("text")
      expect(keys).not.toContain("summary")
      expect(
        keys.every((key) =>
          ["type", "at", "sessionRef", "agent", "charBucket", "durationMs", "count", "themeId", "source", "mode", "liveCount", "continued", "outcome", "state"].includes(
            key,
          ),
        ),
      ).toBe(true)
    }
  })
})

describe("first_response_ms (store-derived)", () => {
  it("records the gap from a prompt to the agent's first response", () => {
    const sink = memorySink()
    const store = createAppStore()
    const clock = fakeClock(1000)
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: clock.now })
    recorder.watch(store)

    store.applyEvent("claude-code", { kind: "user_message", messageId: "m1", text: "hi" })
    clock.advance(250)
    store.applyEvent("claude-code", { kind: "agent_message", messageId: "m2", textDelta: "hello" })

    const response = sink.records.find((record) => record.type === "first_response_ms")!
    expect(response).toMatchObject({ agent: "claude-code", durationMs: 250 })
  })

  it("does not double-count: only the first response after a prompt is timed", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 5 })
    recorder.watch(store)

    store.applyEvent("claude-code", { kind: "user_message", messageId: "m1", text: "hi" })
    store.applyEvent("claude-code", { kind: "agent_message", messageId: "m2", textDelta: "a" })
    store.applyEvent("claude-code", { kind: "agent_message", messageId: "m3", textDelta: "b" })

    expect(types(sink.records).filter((type) => type === "first_response_ms")).toHaveLength(1)
  })
})

describe("reexplanation (store-derived over the heuristic)", () => {
  it("flags a long developer message before the target's first action", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    // Arm the watch on the target, as a completed hand-off does.
    recorder.handoffSent({ targetSessionId: "codex", editChars: 0 })
    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: "x".repeat(REEXPLANATION_CHAR_THRESHOLD + 10) })

    const flagged = sink.records.find((record) => record.type === "reexplanation_detected")
    expect(flagged).toBeDefined()
    expect(flagged!.agent).toBe("codex")
    expect(CHAR_BUCKETS).toContain(flagged!.charBucket!)
  })

  it("does not flag when the target acts before the developer speaks", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    recorder.handoffSent({ targetSessionId: "codex", editChars: 0 })
    store.applyEvent("codex", {
      kind: "tool_call",
      call: { toolCallId: "c1", kind: "edit", title: "edit", status: "in_progress", locations: ["a.ts"] },
    })
    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: "x".repeat(REEXPLANATION_CHAR_THRESHOLD + 10) })

    expect(types(sink.records)).not.toContain("reexplanation_detected")
  })

  it("does not flag a short first message to the target", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    recorder.handoffSent({ targetSessionId: "codex", editChars: 0 })
    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: "keep going" })

    expect(types(sink.records)).not.toContain("reexplanation_detected")
  })

  it("resets its per-agent state when a session restarts", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: "hi" })
    store.startSession("codex", "fresh")
    // A response after the reset must not be timed against the pre-reset prompt.
    store.applyEvent("codex", { kind: "agent_message", messageId: "m2", textDelta: "hello" })

    expect(types(sink.records)).not.toContain("first_response_ms")
  })
})

describe("attention latency (task_09, store-derived)", () => {
  it("records the gap from a session entering a needs-you state to its resolution", () => {
    const sink = memorySink()
    const store = createAppStore()
    const clock = fakeClock(1000)
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: clock.now })
    recorder.watch(store)

    store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    clock.advance(500)
    // The developer answers the approval; the agent resumes and leaves the needy state.
    store.applyEvent("codex", { kind: "status", status: "working" })

    const latency = sink.records.find((record) => record.type === "attention_latency_ms")
    expect(latency).toMatchObject({ agent: "codex", durationMs: 500 })
  })

  it("does not record until the needs-you state is resolved", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 7 })
    recorder.watch(store)

    store.applyEvent("codex", { kind: "status", status: "finished" })

    expect(types(sink.records)).not.toContain("attention_latency_ms")
  })

  it("does not fire on a session restart", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    store.applyEvent("codex", { kind: "status", status: "finished" })
    // A restart resets the slice to idle; that is not the developer answering.
    store.startSession("codex", "fresh")

    expect(types(sink.records)).not.toContain("attention_latency_ms")
  })
})

describe("idle-fleet time (task_09, store-derived)", () => {
  it("accumulates the waiting time a needy session spends unfocused", () => {
    const sink = memorySink()
    // The default store focuses "claude-code", so "codex" starts unfocused.
    const store = createAppStore()
    const clock = fakeClock(1000)
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: clock.now })
    recorder.watch(store)

    store.applyEvent("codex", { kind: "status", status: "finished" })
    clock.advance(300)
    // The developer arrives at the waiting session; the idle-fleet window closes.
    store.setFocus("codex")

    const idle = sink.records.find((record) => record.type === "idle_fleet_ms")
    expect(idle).toMatchObject({ agent: "codex", durationMs: 300 })
  })

  it("does not accrue idle-fleet time for a needy session that is focused", () => {
    const sink = memorySink()
    const store = createAppStore() // "claude-code" is focused
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    store.applyEvent("claude-code", { kind: "status", status: "finished" })
    store.applyEvent("claude-code", { kind: "status", status: "working" })

    expect(types(sink.records)).not.toContain("idle_fleet_ms")
  })
})

describe("attention counters are opt-in (task_09)", () => {
  it("emits no attention, idle-fleet, focus, or max-concurrent event when disabled", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: false, sink })

    recorder.watch(store)
    recordReadiness(recorder, [{ sessionId: "codex", ready: true }])
    store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    store.setFocus("codex")
    store.applyEvent("codex", { kind: "status", status: "working" })
    recorder.focusSwitch("codex", true)
    recorder.maxConcurrentSessions(2)

    expect(sink.records).toHaveLength(0)
  })
})

describe("local JSONL sink", () => {
  it("appends one JSON object per line and creates the parent directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitten-telemetry-"))
    try {
      const path = join(dir, "nested", "telemetry.jsonl")
      const sink = createJsonlFileSink(path)
      sink.write({ type: "handoff_invoked", at: 1, sessionRef: "r" })
      sink.write({ type: "agent_ready", at: 2, sessionRef: "r", agent: "codex" })
      createUsageSeenJsonlFileSink(path).write({
        evt: "usage_seen",
        provider: "claude-code",
        used: 124_000,
        size: 200_000,
      })

      const lines = readFileSync(path, "utf8").trimEnd().split("\n")
      expect(lines).toHaveLength(3)
      expect(JSON.parse(lines[0]!)).toEqual({ type: "handoff_invoked", at: 1, sessionRef: "r" })
      expect(JSON.parse(lines[1]!).agent).toBe("codex")
      expect(JSON.parse(lines[2]!)).toEqual({
        evt: "usage_seen",
        provider: "claude-code",
        used: 124_000,
        size: 200_000,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("resolveTelemetryPath", () => {
  it("prefers an explicit path override", () => {
    expect(resolveTelemetryPath({ [TELEMETRY_PATH_ENV_VAR]: "/tmp/t.jsonl" })).toBe("/tmp/t.jsonl")
  })

  it("falls back to the XDG state directory", () => {
    expect(resolveTelemetryPath({ XDG_STATE_HOME: "/state" })).toBe("/state/kitten/telemetry.jsonl")
  })

  it("defaults under the home directory when nothing is set", () => {
    const path = resolveTelemetryPath({})
    expect(path.endsWith(join(".local", "state", "kitten", "telemetry.jsonl"))).toBe(true)
  })
})
