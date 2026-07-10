import { describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentConnection } from "../src/agent/agentConnection.ts"
import { createControllerActions } from "../src/app/actions.ts"
import type { AgentRuntimeState, SessionController } from "../src/app/controller.ts"
import { createHandoffEdits, createHandoffFlow } from "../src/app/handoff.ts"
import { REEXPLANATION_CHAR_THRESHOLD } from "../src/core/telemetryHeuristics.ts"
import type { SessionId } from "../src/core/types.ts"
import { createAppStore, type AppStore } from "../src/store/appStore.ts"
import { createJsonlFileSink, createTelemetryRecorder, recordReadiness, type TelemetryRecord } from "../src/telemetry/recorder.ts"
import { readyRuntimes } from "./fakeController.ts"

/** A connection stub whose prompt/cancel resolve; the flow only needs those two. */
const CONNECTION_STUB = {
  prompt: async () => ({ stopReason: "end_turn" as const }),
  cancel: async () => {},
} as unknown as AgentConnection

/**
 * A controller backed by a real store and the real action surface, so `sendPrompt`
 * records the user turn into the store exactly as it would in production - which is
 * what makes the hand-off's re-explanation arming order faithful.
 */
function realController(store: AppStore, runtimes: AgentRuntimeState[]): SessionController {
  const actions = createControllerActions({
    store,
    getSession: (sessionId) => ({ sessionId, acpSessionId: `s-${sessionId}`, connection: CONNECTION_STUB }),
    resolvePermission: () => {},
    newMessageId: () => "fixed-id",
  })
  return {
    store,
    actions,
    runtimes: () => runtimes,
    runtime: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId),
    isReady: (sessionId) => runtimes.find((runtime) => runtime.sessionId === sessionId)?.ready === true,
    dispose: async () => {},
  }
}

const SECRET = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789"

describe("telemetry over a scripted hand-off session", () => {
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
      expect(flow.begin()).toBe(true)
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
