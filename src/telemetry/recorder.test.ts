import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { bucketChars, CHAR_BUCKETS, REEXPLANATION_CHAR_THRESHOLD } from "../core/telemetryHeuristics.ts"
import { createAppStore } from "../store/appStore.ts"
import {
  createJsonlFileSink,
  createTelemetryRecorder,
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
    recorder.recordSwitch("codex", "model", true, false)
    recorder.recordSwitch("codex", "effort", false, false)
    store.applyEvent("codex", { kind: "user_message", messageId: "m1", text: "x".repeat(400) })
    store.applyEvent("codex", { kind: "agent_message", messageId: "m2", textDelta: "working" })
    unsubscribe()

    expect(sink.records).toHaveLength(0)
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

describe("content-free guarantee", () => {
  it("never serializes prompt or code text, even from a long re-explanation", () => {
    const sink = memorySink()
    const store = createAppStore()
    const recorder = createTelemetryRecorder({ enabled: true, sink })
    recorder.watch(store)

    const secret = "sk-ant-0123456789 THE-USER-TYPED-THIS-SENTENCE and this code: const x = 1"
    const promptText = `${secret} ${"and more context ".repeat(40)}`
    recorder.handoffSent({ targetSessionId: "codex", editChars: promptText.length })
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
        keys.every((key) => ["type", "at", "sessionRef", "agent", "charBucket", "durationMs", "count"].includes(key)),
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

      const lines = readFileSync(path, "utf8").trimEnd().split("\n")
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]!)).toEqual({ type: "handoff_invoked", at: 1, sessionRef: "r" })
      expect(JSON.parse(lines[1]!).agent).toBe("codex")
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
