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
  bucketTabRestoreCount,
  bucketTabSwitchLatency,
  bucketAgentRunBatchSize,
  bucketAgentRunDuration,
  bucketSteeringDuration,
  logUsageSeen,
  recordReadiness,
  resolveTelemetryPath,
  TELEMETRY_PATH_ENV_VAR,
  type TelemetryRecord,
  type TelemetrySink,
  type ProviderReadinessOutcome,
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
    recorder.recordProviderDefaultOutcome("partial")
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
    recorder.providerReadiness("cursor", "authentication_required")
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
    recorder.tabCreated("codex", "inherited")
    recorder.tabSelectionStarted("mouse")
    recorder.tabSelectionSettled()
    recorder.tabBackgrounded()
    recorder.tabCloseConfirmed("cancel")
    recorder.tabCloseKeptOpen()
    recorder.tabRestore({ visibleCount: 2, backgroundCount: 1, unavailableCount: 0 })
    recorder.tabAttentionSeen("finished", "background")
    recorder.delegatedLaunchRequested("private-child")
    recorder.delegatedLaunchSucceeded("private-child")
    recorder.delegatedLaunchFailed("private-child")
    recorder.delegatedChildTerminal("private-child", "finished")
    recorder.delegatedCascadeRequested("private-parent")
    recorder.delegatedCascadeCompleted("private-parent")
    recorder.delegatedTeardownFailed("private-child")
    recorder.exploreLaunchEligible("private-explore", {
      policyVersion: "explore-v1",
      provider: "codex",
      count: 1,
    })
    recorder.exploreLaunchDenied({ denialReason: "missing-attestation", count: 1 })
    recorder.exploreCapacityDenied({ capacityScope: "global", count: 1 })
    recorder.exploreStartFailed("private-explore", {
      failureCategory: "session-start-failed",
      count: 1,
    })
    recorder.exploreTerminal("private-explore", { terminalStatus: "finished", count: 1 })
    recorder.agentRunControl({
      operation: "start",
      outcome: "accepted",
      batchSizeBucket: "one",
      durationBucket: "under_100ms",
    })
    recorder.mcpBridgeFailure("capacity_limited")
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
    recorder.tabCreated("codex", "default")
    recorder.tabSelectionStarted("kitty_chord")
    recorder.tabSelectionSettled()
    recorder.tabRestore({ visibleCount: 0, backgroundCount: 0, unavailableCount: 0 })
    recorder.delegatedLaunchRequested("private-child")
    recorder.delegatedLaunchSucceeded("private-child")
    recorder.delegatedChildTerminal("private-child", "cancelled")
    recorder.delegatedCascadeRequested("private-parent")
    recorder.delegatedCascadeCompleted("private-parent")
    recorder.delegatedTeardownFailed("private-child")
    recorder.exploreLaunchEligible("private-explore", {
      policyVersion: "explore-v1",
      provider: "claude-code",
      count: 1,
    })
    recorder.exploreLaunchDenied({ denialReason: "stale-attestation", count: 1 })
    recorder.exploreCapacityDenied({ capacityScope: "per-parent", count: 1 })
    recorder.exploreStartFailed("private-explore", {
      failureCategory: "bridge-unavailable",
      count: 1,
    })
    recorder.exploreTerminal("private-explore", { terminalStatus: "cancelled", count: 1 })
    recorder.agentRunControl({
      operation: "poll",
      outcome: "unavailable",
      batchSizeBucket: "five_or_more",
      durationBucket: "2s_or_more",
    })
    recorder.mcpBridgeFailure("unavailable")
  })
})

describe("steering outcome telemetry", () => {
  it("does not access or construct a sink when disabled", () => {
    const recorder = createTelemetryRecorder({
      enabled: false,
      get sink(): TelemetrySink {
        throw new Error("disabled steering telemetry must not access a sink")
      },
    })

    recorder.steeringOutcome("private-request", "queued", "fallback")
    recorder.steeringOutcome("private-request", "delivered", "fallback")
    recorder.steeringOutcome("private-request", "recovered", "native")
    recorder.steeringOutcome("private-request", "timeout", "fallback")
    recorder.steeringOutcome("private-request", "unavailable", "unavailable")
  })

  it("emits every allowlisted outcome with only closed content-free dimensions", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: () => 1_000,
      sessionRef: "safe-run",
    })
    const cases = [
      ["queued", "fallback"],
      ["delivered", "native"],
      ["recovered", "fallback"],
      ["timeout", "fallback"],
      ["unavailable", "unavailable"],
    ] as const

    for (const [index, [outcome, capabilityClass]] of cases.entries()) {
      recorder.steeringOutcome(`private-${index}`, outcome, capabilityClass)
    }

    expect(sink.records.map((record) => record.outcome)).toEqual(cases.map(([outcome]) => outcome))
    for (const [index, record] of sink.records.entries()) {
      expect(record).toEqual({
        type: "steering_outcome",
        at: 1_000,
        sessionRef: "safe-run",
        outcome: cases[index]![0],
        capabilityClass: cases[index]![1],
        durationBucket: "under_5s",
      })
      expect(Object.keys(record)).toEqual([
        "type",
        "outcome",
        "capabilityClass",
        "durationBucket",
        "at",
        "sessionRef",
      ])
    }
  })

  it("reduces exact lifecycle timing to stable named buckets", () => {
    expect([
      0,
      4_999,
      5_000,
      29_999,
      30_000,
      119_999,
      120_000,
      Number.POSITIVE_INFINITY,
      -1,
    ].map(bucketSteeringDuration)).toEqual([
      "under_5s",
      "under_5s",
      "5_to_30s",
      "5_to_30s",
      "30_to_120s",
      "30_to_120s",
      "over_120s",
      "under_5s",
      "under_5s",
    ])

    const sink = memorySink()
    const clock = fakeClock()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: clock.now })
    recorder.steeringOutcome("private-lifecycle", "queued", "fallback")
    clock.advance(30_000)
    recorder.steeringOutcome("private-lifecycle", "delivered", "fallback")

    expect(sink.records.map((record) => record.durationBucket)).toEqual([
      "under_5s",
      "30_to_120s",
    ])
    expect(JSON.stringify(sink.records)).not.toContain("30000")
  })

  it("deduplicates repeated callbacks by private lifecycle key without exposing it", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, sessionRef: "safe-run" })

    recorder.steeringOutcome("REQUEST_ID_SENTINEL", "queued", "fallback")
    recorder.steeringOutcome("REQUEST_ID_SENTINEL", "queued", "fallback")
    recorder.steeringOutcome("REQUEST_ID_SENTINEL", "delivered", "fallback")
    recorder.steeringOutcome("REQUEST_ID_SENTINEL", "delivered", "fallback")

    expect(sink.records).toHaveLength(2)
    expect(sink.records.map((record) => record.outcome)).toEqual(["queued", "delivered"])
    expect(JSON.stringify(sink.records)).not.toContain("REQUEST_ID_SENTINEL")
  })

  it("rejects unknown dimensions and never serializes private sentinels", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, sessionRef: "safe-run" })
    const lifecycleKey = [
      "PROMPT_BLOCK_SENTINEL",
      "RECOVERY_TEXT_SENTINEL",
      "REQUEST_ID_SENTINEL",
      "ACP_ID_SENTINEL",
      "/PRIVATE/PATH/SENTINEL",
      "RAW_ERROR_SENTINEL",
      "ADAPTER_CONFIG_SENTINEL",
    ].join(":")

    recorder.steeringOutcome(lifecycleKey, "queued", "fallback")
    recorder.steeringOutcome(lifecycleKey, "not-allowlisted" as never, "fallback")
    recorder.steeringOutcome(lifecycleKey, "delivered", "private-adapter" as never)

    const serialized = JSON.stringify(sink.records)
    expect(sink.records).toHaveLength(1)
    for (const sentinel of lifecycleKey.split(":")) expect(serialized).not.toContain(sentinel)
  })
})

describe("Kitten MCP bridge failure telemetry", () => {
  it("serializes only the exact closed category and ignores invalid runtime input", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: () => 42,
      sessionRef: "anonymous-run",
    })

    recorder.mcpBridgeFailure("capacity_limited")
    recorder.mcpBridgeFailure("unavailable")
    recorder.mcpBridgeFailure("invalid_request")
    recorder.mcpBridgeFailure("RAW_ERROR_SENTINEL" as never)

    expect(sink.records).toEqual([
      {
        type: "kitten_mcp_bridge_failure",
        at: 42,
        sessionRef: "anonymous-run",
        mcpBridgeFailureCategory: "capacity_limited",
      },
      {
        type: "kitten_mcp_bridge_failure",
        at: 42,
        sessionRef: "anonymous-run",
        mcpBridgeFailureCategory: "unavailable",
      },
      {
        type: "kitten_mcp_bridge_failure",
        at: 42,
        sessionRef: "anonymous-run",
        mcpBridgeFailureCategory: "invalid_request",
      },
    ])
    expect(sink.records.every((record) => Object.keys(record).every((key) =>
      ["type", "at", "sessionRef", "mcpBridgeFailureCategory"].includes(key)
    ))).toBe(true)

    if (false) {
      // @ts-expect-error bridge telemetry accepts no prompt, task, route, capability, endpoint, id, or error fields
      recorder.mcpBridgeFailure({ category: "unavailable", prompt: "private" })
    }
  })

  it("cannot serialize prompts, tasks, transport identity, call identity, or raw errors", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, sessionRef: "anonymous-run" })
    const sentinels = [
      "PROMPT_SENTINEL",
      "TASK_SENTINEL",
      "ROUTE_SENTINEL",
      "CAPABILITY_SENTINEL",
      "ENDPOINT_SENTINEL",
      "CALL_ID_SENTINEL",
      "SESSION_ID_SENTINEL",
      "RAW_ERROR_SENTINEL",
    ]

    recorder.mcpBridgeFailure("invalid_request")

    const serialized = JSON.stringify(sink.records)
    for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel)
    for (const forbiddenKey of [
      "prompt", "task", "route", "capability", "endpoint", "callId", "sessionId", "error",
    ]) expect(sink.records[0]).not.toHaveProperty(forbiddenKey)
  })
})

describe("agent_run control telemetry", () => {
  it("serializes only the exact closed control dimensions", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: () => 42,
      sessionRef: "anonymous-run",
    })

    recorder.agentRunControl({
      operation: "start",
      outcome: "accepted",
      batchSizeBucket: "three_to_four",
      durationBucket: "500_to_1999ms",
    })
    recorder.agentRunControl({
      operation: "poll",
      outcome: "rejected",
      batchSizeBucket: "one",
      durationBucket: "under_100ms",
    })
    recorder.agentRunControl({
      operation: "poll",
      outcome: "unavailable",
      batchSizeBucket: "five_or_more",
      durationBucket: "2s_or_more",
    })

    expect(sink.records).toEqual([
      {
        type: "agent_run_control",
        at: 42,
        sessionRef: "anonymous-run",
        operation: "start",
        outcome: "accepted",
        batchSizeBucket: "three_to_four",
        durationBucket: "500_to_1999ms",
      },
      {
        type: "agent_run_control",
        at: 42,
        sessionRef: "anonymous-run",
        operation: "poll",
        outcome: "rejected",
        batchSizeBucket: "one",
        durationBucket: "under_100ms",
      },
      {
        type: "agent_run_control",
        at: 42,
        sessionRef: "anonymous-run",
        operation: "poll",
        outcome: "unavailable",
        batchSizeBucket: "five_or_more",
        durationBucket: "2s_or_more",
      },
    ])
    const allowed = new Set([
      "type",
      "at",
      "sessionRef",
      "operation",
      "outcome",
      "batchSizeBucket",
      "durationBucket",
    ])
    expect(sink.records.every((record) => Object.keys(record).every((key) => allowed.has(key)))).toBe(true)

    if (false) {
      // @ts-expect-error operation vocabulary is closed
      recorder.agentRunControl({ operation: "wait", outcome: "accepted", batchSizeBucket: "one", durationBucket: "under_100ms" })
      // @ts-expect-error raw errors cannot cross the recorder API
      recorder.agentRunControl({ operation: "start", outcome: "rejected", batchSizeBucket: "one", durationBucket: "under_100ms", error: "private" })
    }
  })

  it("maps every batch-size and operation-duration boundary to bounded buckets", () => {
    expect([0, 1, 2, 3, 4, 5, 99].map(bucketAgentRunBatchSize)).toEqual([
      "zero",
      "one",
      "two",
      "three_to_four",
      "three_to_four",
      "five_or_more",
      "five_or_more",
    ])
    expect([-1, 0, 99, 100, 499, 500, 1_999, 2_000].map(bucketAgentRunDuration)).toEqual([
      "under_100ms",
      "under_100ms",
      "under_100ms",
      "100_to_499ms",
      "100_to_499ms",
      "500_to_1999ms",
      "500_to_1999ms",
      "2s_or_more",
    ])
  })

  it("cannot serialize content, identities, routes, lifecycle, or raw errors", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, sessionRef: "anonymous-run" })
    const sentinels = [
      "TASK_SENTINEL",
      "DESIRED_OUTCOME_SENTINEL",
      "CHILD_ID_SENTINEL",
      "PARENT_ID_SENTINEL",
      "GENERATION_SENTINEL",
      "PROVIDER_SENTINEL",
      "CAPABILITY_SENTINEL",
      "ROUTE_SENTINEL",
      "ENDPOINT_SENTINEL",
      "/private/path/SENTINEL",
      "PROMPT_SENTINEL",
      "TRANSCRIPT_SENTINEL",
      "RAW_ERROR_SENTINEL",
      "LIFECYCLE_STATUS_SENTINEL",
    ]

    recorder.agentRunControl({
      operation: "start",
      outcome: "rejected",
      batchSizeBucket: "two",
      durationBucket: "100_to_499ms",
    })

    const serialized = JSON.stringify(sink.records)
    for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel)
    for (const forbiddenKey of [
      "task", "desiredOutcome", "childId", "parentId", "generation", "provider",
      "capability", "route", "endpoint", "path", "prompt", "transcript", "error", "status",
    ]) {
      expect(sink.records[0]).not.toHaveProperty(forbiddenKey)
    }
  })
})

describe("explore policy telemetry", () => {
  it("records only exact closed payloads and keeps lifecycle identities private", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: () => 42,
      sessionRef: "anonymous-run",
    })
    const privateKey = "TASK:OUTCOME:SESSION:ACP:/private/cwd:recipe:model:ATTESTATION_SENTINEL:MCP:raw-error"

    recorder.exploreLaunchEligible(privateKey, {
      policyVersion: "explore-v1",
      provider: "codex",
      count: 1,
    })
    recorder.exploreLaunchEligible(privateKey, {
      policyVersion: "explore-v1",
      provider: "codex",
      count: 1,
    })
    recorder.exploreLaunchDenied({ denialReason: "missing-attestation", count: 1 })
    recorder.exploreCapacityDenied({ capacityScope: "global", count: 1 })
    recorder.exploreStartFailed(privateKey, {
      failureCategory: "prompt-dispatch-failed",
      count: 1,
    })
    recorder.exploreStartFailed(privateKey, {
      failureCategory: "session-start-failed",
      count: 1,
    })
    recorder.exploreTerminal(privateKey, { terminalStatus: "finished", count: 1 })
    recorder.exploreTerminal(privateKey, { terminalStatus: "failed", count: 1 })

    expect(sink.records).toEqual([
      {
        type: "explore_launch_eligible",
        policyVersion: "explore-v1",
        provider: "codex",
        count: 1,
        at: 42,
        sessionRef: "anonymous-run",
      },
      {
        type: "explore_launch_denied",
        denialReason: "missing-attestation",
        count: 1,
        at: 42,
        sessionRef: "anonymous-run",
      },
      {
        type: "explore_capacity_denied",
        capacityScope: "global",
        count: 1,
        at: 42,
        sessionRef: "anonymous-run",
      },
      {
        type: "explore_start_failed",
        failureCategory: "prompt-dispatch-failed",
        count: 1,
        at: 42,
        sessionRef: "anonymous-run",
      },
      {
        type: "explore_terminal",
        terminalStatus: "finished",
        count: 1,
        at: 42,
        sessionRef: "anonymous-run",
      },
    ])
    const serialized = JSON.stringify(sink.records)
    for (const sentinel of privateKey.split(":")) expect(serialized).not.toContain(sentinel)
    expect(sink.records.every((record) => Object.keys(record).every((key) => [
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
    ].includes(key)))).toBe(true)
  })

  it("rejects unknown enum values, counters, and extra runtime fields", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })

    recorder.exploreLaunchEligible("eligible", {
      policyVersion: "explore-v2",
      provider: "codex",
      count: 1,
    } as never)
    recorder.exploreLaunchDenied({ denialReason: "raw-provider-error", count: 1 } as never)
    recorder.exploreCapacityDenied({ capacityScope: "active-child-ids", count: 1 } as never)
    recorder.exploreStartFailed("failed", {
      failureCategory: "adapter said SECRET",
      count: 1,
    } as never)
    recorder.exploreTerminal("terminal", { terminalStatus: "unknown", count: 1 } as never)
    recorder.exploreLaunchDenied({
      denialReason: "missing-attestation",
      count: 1,
      task: "forbidden",
    } as never)
    recorder.exploreTerminal("counter", { terminalStatus: "finished", count: 2 } as never)

    expect(sink.records).toEqual([])

    if (false) {
      // @ts-expect-error closed denial vocabulary rejects unknown values
      recorder.exploreLaunchDenied({ denialReason: "unknown", count: 1 })
      // @ts-expect-error exact input type rejects content-bearing additions
      recorder.exploreCapacityDenied({ capacityScope: "global", count: 1, childId: "private" })
      // @ts-expect-error counters are fixed to one outcome per call
      recorder.exploreTerminal("private", { terminalStatus: "finished", count: 2 })
    }
  })
})

describe("delegated lifecycle telemetry", () => {
  it("records only the allowlisted lifecycle vocabulary and deduplicates terminal callbacks", () => {
    const sink = memorySink()
    const clock = fakeClock(100)
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: clock.now,
      sessionRef: "anonymous-run",
    })
    const sensitiveKey = [
      "TASK_SENTINEL",
      "OUTCOME_SENTINEL",
      "SESSION_SENTINEL",
      "/private/cwd/path",
      "provider raw error",
    ].join(":")

    recorder.delegatedLaunchRequested(sensitiveKey)
    clock.advance(125)
    recorder.delegatedLaunchSucceeded(sensitiveKey)
    recorder.delegatedLaunchSucceeded(sensitiveKey)
    recorder.delegatedChildTerminal(sensitiveKey, "finished")
    recorder.delegatedChildTerminal(sensitiveKey, "failed")
    recorder.delegatedCascadeRequested(sensitiveKey)
    recorder.delegatedCascadeRequested(sensitiveKey)
    recorder.delegatedCascadeCompleted(sensitiveKey)
    recorder.delegatedCascadeCompleted(sensitiveKey)
    recorder.delegatedTeardownFailed(sensitiveKey)
    recorder.delegatedTeardownFailed(sensitiveKey)

    expect(sink.records).toEqual([
      { type: "delegated_launch_requested", at: 100, sessionRef: "anonymous-run" },
      { type: "delegated_launch_succeeded", at: 225, sessionRef: "anonymous-run" },
      { type: "delegated_visible_running_ms", durationMs: 125, at: 225, sessionRef: "anonymous-run" },
      {
        type: "delegated_child_terminal",
        delegatedStatus: "finished",
        at: 225,
        sessionRef: "anonymous-run",
      },
      { type: "delegated_cascade_requested", at: 225, sessionRef: "anonymous-run" },
      { type: "delegated_cascade_completed", at: 225, sessionRef: "anonymous-run" },
      { type: "delegated_teardown_failed", at: 225, sessionRef: "anonymous-run" },
    ])
    const serialized = JSON.stringify(sink.records)
    for (const forbidden of [
      "TASK_SENTINEL",
      "OUTCOME_SENTINEL",
      "SESSION_SENTINEL",
      "/private/cwd/path",
      "provider raw error",
      '"agent"',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(sink.records.every((record) => Object.keys(record).every((key) =>
      ["type", "at", "sessionRef", "durationMs", "delegatedStatus"].includes(key),
    ))).toBe(true)
  })

  it("records one failed launch only when a private launch clock exists", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42, sessionRef: "run" })

    recorder.delegatedLaunchFailed("not-requested")
    recorder.delegatedLaunchRequested("failed-child")
    recorder.delegatedLaunchFailed("failed-child")
    recorder.delegatedLaunchFailed("failed-child")
    recorder.delegatedLaunchSucceeded("failed-child")

    expect(sink.records).toEqual([
      { type: "delegated_launch_requested", at: 42, sessionRef: "run" },
      { type: "delegated_launch_failed", at: 42, sessionRef: "run" },
    ])
  })
})

describe("managed worktree lifecycle telemetry", () => {
  it("serializes exactly the six allowlisted categories with only bounded reasons", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: () => 42,
      sessionRef: "anonymous-run",
    })
    const privateSuccessKey = [
      "BINDING_ID_SENTINEL",
      "CHILD_ID_SENTINEL",
      "/repo/root/PATH_SENTINEL",
      "BRANCH_SENTINEL",
      "SHA_SENTINEL",
      "TASK_SENTINEL",
      "PROMPT_SENTINEL",
      "RAW_ERROR_SENTINEL",
      "PROVIDER_SENTINEL",
      "AGENT_SENTINEL",
    ].join(":")

    recorder.managedWorktreeRequested(privateSuccessKey)
    recorder.managedWorktreeProvisioned(privateSuccessKey)
    recorder.managedWorktreeRequested("PRIVATE_FAILED_ATTEMPT")
    recorder.managedWorktreeProvisionFailed("PRIVATE_FAILED_ATTEMPT", "verification_failed")
    recorder.managedWorktreeReconciled("missing")
    recorder.managedWorktreeCleanupRefused("dirty")
    recorder.managedWorktreeCleaned()

    expect(sink.records).toEqual([
      { type: "managed_worktree_requested", at: 42, sessionRef: "anonymous-run" },
      { type: "managed_worktree_provisioned", at: 42, sessionRef: "anonymous-run" },
      { type: "managed_worktree_requested", at: 42, sessionRef: "anonymous-run" },
      {
        type: "managed_worktree_provision_failed",
        managedWorktreeReason: "verification_failed",
        at: 42,
        sessionRef: "anonymous-run",
      },
      {
        type: "managed_worktree_reconciled",
        managedWorktreeReason: "missing",
        at: 42,
        sessionRef: "anonymous-run",
      },
      {
        type: "managed_worktree_cleanup_refused",
        managedWorktreeReason: "dirty",
        at: 42,
        sessionRef: "anonymous-run",
      },
      { type: "managed_worktree_cleaned", at: 42, sessionRef: "anonymous-run" },
    ])
    expect(new Set(sink.records.map((record) => record.type))).toEqual(new Set([
      "managed_worktree_requested",
      "managed_worktree_provisioned",
      "managed_worktree_provision_failed",
      "managed_worktree_reconciled",
      "managed_worktree_cleanup_refused",
      "managed_worktree_cleaned",
    ]))
    expect(sink.records.every((record) => Object.keys(record).every((key) =>
      ["type", "at", "sessionRef", "managedWorktreeReason"].includes(key),
    ))).toBe(true)
    const serialized = JSON.stringify(sink.records)
    for (const forbidden of privateSuccessKey.split(":")) expect(serialized).not.toContain(forbidden)
    expect(serialized).not.toContain("PRIVATE_FAILED_ATTEMPT")
    expect(serialized).not.toContain('"provider"')
    expect(serialized).not.toContain('"agent"')
  })

  it("settles each private provision attempt with exactly one result", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 7, sessionRef: "run" })

    recorder.managedWorktreeProvisioned("missing-request")
    recorder.managedWorktreeProvisionFailed("missing-request", "git_failed")
    recorder.managedWorktreeRequested("one-attempt")
    recorder.managedWorktreeRequested("one-attempt")
    recorder.managedWorktreeProvisioned("one-attempt")
    recorder.managedWorktreeProvisionFailed("one-attempt", "git_failed")
    recorder.managedWorktreeProvisioned("one-attempt")

    expect(sink.records.map((record) => record.type)).toEqual([
      "managed_worktree_requested",
      "managed_worktree_provisioned",
    ])
  })

  it("rejects unbounded reasons and never accesses a disabled sink", () => {
    const sink = memorySink()
    const active = createTelemetryRecorder({ enabled: true, sink })
    active.managedWorktreeRequested("invalid-reason-attempt")
    active.managedWorktreeProvisionFailed("invalid-reason-attempt", "RAW_ERROR_SENTINEL" as never)
    active.managedWorktreeReconciled("PATH_SENTINEL" as never)
    active.managedWorktreeCleanupRefused("BRANCH_SENTINEL" as never)
    expect(sink.records.map((record) => record.type)).toEqual(["managed_worktree_requested"])

    const disabled = createTelemetryRecorder({
      enabled: false,
      get sink(): TelemetrySink {
        throw new Error("disabled managed-worktree telemetry must not access a sink")
      },
    })
    disabled.managedWorktreeRequested("private")
    disabled.managedWorktreeProvisioned("private")
    disabled.managedWorktreeProvisionFailed("private", "git_failed")
    disabled.managedWorktreeReconciled("missing")
    disabled.managedWorktreeCleanupRefused("dirty")
    disabled.managedWorktreeCleaned()
    expect(disabled.enabled).toBe(false)
  })
})

describe("Session Tabs telemetry", () => {
  it("records only fixed enums and coarse buckets in the approved order", () => {
    const sink = memorySink()
    const clock = fakeClock(10)
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: clock.now,
      sessionRef: "run-tabs",
    })

    recorder.tabCreated("codex", "inherited")
    recorder.tabSelectionStarted("sessions_fallback")
    clock.advance(275)
    recorder.tabSelectionSettled()
    recorder.tabBackgrounded()
    recorder.tabCloseConfirmed("idle_close")
    recorder.tabCloseKeptOpen()
    recorder.tabRestore({ visibleCount: 4, backgroundCount: 1, unavailableCount: 8 })
    recorder.tabAttentionSeen("awaiting_approval", "background")

    expect(sink.records).toEqual([
      { type: "tab_created", provider: "codex", creationSource: "inherited", at: 10, sessionRef: "run-tabs" },
      { type: "tab_selected", selectionSource: "sessions_fallback", at: 10, sessionRef: "run-tabs" },
      {
        type: "tab_switch_latency_ms",
        selectionSource: "sessions_fallback",
        switchLatencyBucket: "200_to_499ms",
        at: 285,
        sessionRef: "run-tabs",
      },
      { type: "tab_backgrounded", at: 285, sessionRef: "run-tabs" },
      { type: "tab_close_confirmed", tabCloseOutcome: "idle_close", at: 285, sessionRef: "run-tabs" },
      { type: "tab_close_kept_open", at: 285, sessionRef: "run-tabs" },
      {
        type: "tab_restore",
        visibleCountBucket: "two_to_four",
        backgroundCountBucket: "one",
        unavailableCountBucket: "five_or_more",
        at: 285,
        sessionRef: "run-tabs",
      },
      {
        type: "tab_attention_seen",
        attentionStatus: "awaiting_approval",
        lifecycle: "background",
        at: 285,
        sessionRef: "run-tabs",
      },
    ])

    const allowlist = new Set([
      "type",
      "at",
      "sessionRef",
      "provider",
      "creationSource",
      "selectionSource",
      "switchLatencyBucket",
      "tabCloseOutcome",
      "visibleCountBucket",
      "backgroundCountBucket",
      "unavailableCountBucket",
      "attentionStatus",
      "lifecycle",
    ])
    for (const record of sink.records) {
      expect(Object.keys(record).every((key) => allowlist.has(key))).toBe(true)
      expect(record.agent).toBeUndefined()
    }
  })

  it("uses stable count and latency boundaries", () => {
    expect([0, 1, 2, 4, 5].map(bucketTabRestoreCount)).toEqual([
      "zero",
      "one",
      "two_to_four",
      "two_to_four",
      "five_or_more",
    ])
    expect([0, 199, 200, 499, 500, 999, 1_000].map(bucketTabSwitchLatency)).toEqual([
      "under_200ms",
      "under_200ms",
      "200_to_499ms",
      "200_to_499ms",
      "500_to_999ms",
      "500_to_999ms",
      "1s_or_more",
    ])
  })

  it("derives an attention visit without recording the conversation identity", () => {
    const sink = memorySink()
    const store = createAppStore()
    store.backgroundConversation("codex")
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 42 })
    recorder.watch(store)

    store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    store.reopenConversation("codex")

    const attention = sink.records.filter((record) => record.type === "tab_attention_seen")
    expect(attention).toEqual([
      expect.objectContaining({
        attentionStatus: "awaiting_approval",
        lifecycle: "background",
      }),
    ])
    expect(attention[0]!.agent).toBeUndefined()
  })
})

describe("provider-default outcome telemetry", () => {
  it("records only the four bounded terminal categories", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: () => 42,
      sessionRef: "run-defaults",
    })

    for (const outcome of ["none", "applied", "partial", "unavailable"] as const) {
      recorder.recordProviderDefaultOutcome(outcome)
    }

    expect(sink.records).toEqual([
      { type: "provider_default_outcome", defaultOutcome: "none", at: 42, sessionRef: "run-defaults" },
      { type: "provider_default_outcome", defaultOutcome: "applied", at: 42, sessionRef: "run-defaults" },
      { type: "provider_default_outcome", defaultOutcome: "partial", at: 42, sessionRef: "run-defaults" },
      { type: "provider_default_outcome", defaultOutcome: "unavailable", at: 42, sessionRef: "run-defaults" },
    ])
    expect(sink.records.every((record) => Object.keys(record).every((key) =>
      ["type", "defaultOutcome", "at", "sessionRef"].includes(key),
    ))).toBe(true)
  })

  it("does not access a sink when provider-default telemetry is disabled", () => {
    const recorder = createTelemetryRecorder({
      enabled: false,
      get sink(): TelemetrySink {
        throw new Error("disabled provider-default telemetry must not access a sink")
      },
    })

    recorder.recordProviderDefaultOutcome("applied")
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
    recorder.clarificationSettled("request-private", "submitted")
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
        terminalKind: "submitted",
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
        "at",
        "durationBucket",
        "sessionRef",
        "terminalKind",
        "type",
      ],
    ])
  })

  it.each([
    ["submitted", 1_000, "under_5s"],
    ["skipped", 5_000, "5_to_30s"],
    ["timed_out", 30_000, "30_to_120s"],
    ["cancelled", 121_000, "over_120s"],
  ] as const)("records %s with only its closed outcome and a coarse duration bucket", (terminalKind, elapsed, durationBucket) => {
    const sink = memorySink()
    const clock = fakeClock()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: clock.now, sessionRef: "run-1" })
    recorder.clarificationPresented({
      requestId: `private-${terminalKind}`,
      sessionId: "/private/customer/session",
      capability: "supported",
      focused: true,
      hasSingle: true,
      hasMulti: true,
      hasText: true,
      fieldCount: 10,
    })

    clock.advance(elapsed)
    recorder.clarificationSettled(`private-${terminalKind}`, terminalKind)

    expect(sink.records.at(-1)).toEqual({
      type: "clarification_settled",
      terminalKind,
      durationBucket,
      at: 1_000 + elapsed,
      sessionRef: "run-1",
    })
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
  it("records only provider and a fixed readiness outcome", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: () => 42,
      sessionRef: "readiness-run",
    })

    recorder.providerReadiness("cursor", "ready")
    recorder.providerReadiness("cursor", "binary_missing")
    recorder.providerReadiness("cursor", "version_mismatch")
    recorder.providerReadiness("cursor", "uncertified_recipe")
    recorder.providerReadiness("cursor", "authentication_required")
    recorder.providerReadiness("cursor", "handshake_failed")

    const outcomes = [
      "ready",
      "binary_missing",
      "version_mismatch",
      "uncertified_recipe",
      "authentication_required",
      "handshake_failed",
    ] as const
    expect(sink.records).toEqual(outcomes.map((readinessOutcome) => ({
      type: "provider_readiness",
      provider: "cursor",
      readinessOutcome,
      at: 42,
      sessionRef: "readiness-run",
    })))
    for (const record of sink.records) {
      expect(Object.keys(record).sort()).toEqual([
        "at",
        "provider",
        "readinessOutcome",
        "sessionRef",
        "type",
      ])
    }
  })

  it("discards casted raw provider and outcome sentinels at the recorder boundary", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    const sentinels = [
      "agent acp --profile private-profile",
      "/private/repository/path",
      "raw provider error with credential",
      "private prompt and code",
      "model-option-id=secret-option-value",
      "first-task-completed=1",
    ]

    for (const sentinel of sentinels) {
      recorder.providerReadiness("cursor", sentinel as ProviderReadinessOutcome)
      recorder.providerReadiness(sentinel as "cursor", "ready")
    }

    expect(sink.records).toHaveLength(0)
    for (const sentinel of sentinels) {
      expect(JSON.stringify(sink.records)).not.toContain(sentinel)
    }
  })

  it("does not access the sink when disabled readiness is reported", () => {
    let sinkAccesses = 0
    const recorder = createTelemetryRecorder({
      enabled: false,
      get sink() {
        sinkAccesses += 1
        return { write: () => { sinkAccesses += 1 } }
      },
    })

    recorder.providerReadiness("cursor", "authentication_required")

    expect(recorder.enabled).toBe(false)
    expect(sinkAccesses).toBe(0)
  })

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

describe("Context Pack lifecycle telemetry", () => {
  it("emits every fixed lifecycle event with only its allowlisted keys", () => {
    const sink = memorySink()
    const clock = fakeClock(1_000)
    const recorder = createTelemetryRecorder({
      enabled: true,
      sink,
      now: clock.now,
      sessionRef: "run",
    })

    recorder.contextPackDraftCreated({ selectionCountBucket: "zero" })
    recorder.contextPackBuildStarted("private-child", { selectionCountBucket: "two_to_four" })
    recorder.contextPackBuildDenied({ reason: "capability_unavailable" })
    clock.advance(5_000)
    recorder.contextPackBuildSettled("private-child", { outcome: "ready_for_review" })
    recorder.contextPackReviewReady({
      selectionCountBucket: "two_to_four",
      redactionCountBucket: "one",
      byteBucket: "8_to_31kb",
    })
    recorder.contextPackReviewBlocked({ reason: "source_stale" })
    recorder.contextPackSealed({
      selectionCountBucket: "two_to_four",
      redactionCountBucket: "one",
      byteBucket: "8_to_31kb",
    })
    recorder.contextPackSealDenied({ reason: "candidate_stale" })
    recorder.contextPackFitAvailable({ byteBucket: "8_to_31kb" })
    recorder.contextPackFitUnavailable({ reason: "stale_evidence" })
    recorder.contextPackFitInsufficient({ byteBucket: "128kb_or_more" })
    recorder.contextPackDeliveryConfirmed({ byteBucket: "8_to_31kb" })
    recorder.contextPackDeliveryDenied({ reason: "fit_insufficient" })

    expect(types(sink.records)).toEqual([
      "context_pack_draft_created",
      "build_started",
      "build_denied",
      "build_settled",
      "review_ready",
      "review_blocked",
      "sealed",
      "seal_denied",
      "fit_available",
      "fit_unavailable",
      "fit_insufficient",
      "delivery_confirmed",
      "delivery_denied",
    ])
    expect(sink.records.map((record) => Object.keys(record).sort())).toEqual([
      ["at", "selectionCountBucket", "sessionRef", "type"],
      ["at", "selectionCountBucket", "sessionRef", "type"],
      ["at", "contextPackReason", "sessionRef", "type"],
      ["at", "contextPackDurationBucket", "contextPackOutcome", "sessionRef", "type"],
      ["at", "byteBucket", "redactionCountBucket", "selectionCountBucket", "sessionRef", "type"],
      ["at", "contextPackReason", "sessionRef", "type"],
      ["at", "byteBucket", "redactionCountBucket", "selectionCountBucket", "sessionRef", "type"],
      ["at", "contextPackReason", "sessionRef", "type"],
      ["at", "byteBucket", "sessionRef", "type"],
      ["at", "contextPackReason", "sessionRef", "type"],
      ["at", "byteBucket", "sessionRef", "type"],
      ["at", "byteBucket", "sessionRef", "type"],
      ["at", "contextPackReason", "sessionRef", "type"],
    ].map((keys) => [...keys].sort()))
    expect(sink.records[3]).toMatchObject({
      contextPackOutcome: "ready_for_review",
      contextPackDurationBucket: "5_to_29s",
    })
  })

  it("rejects forged enums, extra fields, exact counters, and content-bearing sentinels", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    const prohibited = [
      "instructions", "path", "sourceIdentity", "sourceDigest", "rationale",
      "materializedBytes", "payload", "recipe", "model", "recipient",
      "exportDestination", "providerIdentity", "childIdentity", "error",
    ]

    recorder.contextPackDraftCreated({ selectionCountBucket: "exactly_3" } as never)
    recorder.contextPackBuildDenied({ reason: "raw provider failure" } as never)
    recorder.contextPackFitAvailable({ byteBucket: "12345" } as never)
    recorder.contextPackReviewReady({
      selectionCountBucket: "one",
      redactionCountBucket: "zero",
      byteBucket: "under_8kb",
      selectionCount: 1,
      redactionCount: 0,
      bytes: 12,
      durationMs: 7,
    } as never)
    for (const field of prohibited) {
      recorder.contextPackReviewReady({
        selectionCountBucket: "one",
        redactionCountBucket: "zero",
        byteBucket: "under_8kb",
        [field]: `SENTINEL-${field}`,
      } as never)
    }

    expect(sink.records).toHaveLength(0)
    expect(JSON.stringify(sink.records)).not.toContain("SENTINEL")
  })

  it("deduplicates private build callbacks without suppressing distinct public outcomes", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink, now: () => 1 })

    recorder.contextPackBuildStarted("build-1", { selectionCountBucket: "one" })
    recorder.contextPackBuildStarted("build-1", { selectionCountBucket: "one" })
    recorder.contextPackBuildSettled("build-1", { outcome: "failed" })
    recorder.contextPackBuildSettled("build-1", { outcome: "ready_for_review" })
    recorder.contextPackBuildSettled("unknown", { outcome: "failed" })
    recorder.contextPackBuildDenied({ reason: "startup_failed" })
    recorder.contextPackBuildDenied({ reason: "startup_failed" })

    expect(types(sink.records)).toEqual([
      "build_started",
      "build_settled",
      "build_denied",
      "build_denied",
    ])
  })

  it("never constructs or accesses a sink and performs no lifecycle bookkeeping when disabled", () => {
    const options = {
      enabled: false,
      get sink(): TelemetrySink {
        throw new Error("disabled telemetry accessed its sink")
      },
    }
    const recorder = createTelemetryRecorder(options)

    recorder.contextPackDraftCreated({ selectionCountBucket: "zero" })
    recorder.contextPackBuildStarted("private", { selectionCountBucket: "zero" })
    recorder.contextPackBuildDenied({ reason: "startup_failed" })
    recorder.contextPackBuildSettled("private", { outcome: "failed" })
    recorder.contextPackReviewReady({ selectionCountBucket: "zero", redactionCountBucket: "zero", byteBucket: "under_8kb" })
    recorder.contextPackReviewBlocked({ reason: "draft_unavailable" })
    recorder.contextPackSealed({ selectionCountBucket: "zero", redactionCountBucket: "zero", byteBucket: "under_8kb" })
    recorder.contextPackSealDenied({ reason: "review_unavailable" })
    recorder.contextPackFitAvailable({ byteBucket: "under_8kb" })
    recorder.contextPackFitUnavailable({ reason: "missing_evidence" })
    recorder.contextPackFitInsufficient({ byteBucket: "under_8kb" })
    recorder.contextPackDeliveryConfirmed({ byteBucket: "under_8kb" })
    recorder.contextPackDeliveryDenied({ reason: "sealed_unavailable" })

    expect(recorder.enabled).toBeFalse()
    expect(recorder).toBe(createTelemetryRecorder({ enabled: false }))
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
