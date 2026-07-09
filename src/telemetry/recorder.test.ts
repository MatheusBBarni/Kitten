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
      { agentId: "claude-code", ready: true },
      { agentId: "codex", ready: false },
    ])
    recorder.handoffInvoked()
    recorder.handoffSent({ targetAgentId: "codex", editChars: 400 })
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
    recorder.handoffSent({ targetAgentId: "codex", editChars: 137 })

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

    recorder.handoffSent({ targetAgentId: "codex", editChars: 0 })
    expect(types(sink.records)).not.toContain("handoff_repeat")

    recorder.handoffSent({ targetAgentId: "claude-code", editChars: 0 })
    expect(types(sink.records)).toContain("handoff_repeat")
  })
})

describe("readiness events", () => {
  it("records agent_ready and agent_unready from a runtimes snapshot", () => {
    const sink = memorySink()
    const recorder = createTelemetryRecorder({ enabled: true, sink })

    recordReadiness(recorder, [
      { agentId: "claude-code", ready: true },
      { agentId: "codex", ready: false },
    ])

    expect(sink.records).toEqual([
      expect.objectContaining({ type: "agent_ready", agent: "claude-code" }),
      expect.objectContaining({ type: "agent_unready", agent: "codex" }),
    ])
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
    recorder.handoffSent({ targetAgentId: "codex", editChars: promptText.length })
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
      expect(keys.every((key) => ["type", "at", "sessionRef", "agent", "charBucket", "durationMs"].includes(key))).toBe(true)
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
    recorder.handoffSent({ targetAgentId: "codex", editChars: 0 })
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

    recorder.handoffSent({ targetAgentId: "codex", editChars: 0 })
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

    recorder.handoffSent({ targetAgentId: "codex", editChars: 0 })
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
