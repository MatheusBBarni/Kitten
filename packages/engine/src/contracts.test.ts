import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"

import {
  classifyActivityOrder,
  classifyScopedQuestionOutcome,
  isDirectAcpTerminalState,
  isTerminalQuestionOutcome,
  profileReadinessClass,
  toActivitySequence,
  toAttemptGeneration,
  toOpaqueId,
  validateNormalizedAttemptEvent,
  NormalizedActivityValidationError,
  type ActivityEventId,
  type ActivitySequence,
  type AttemptGeneration,
  type AttemptId,
  type DirectAcpAttemptState,
  type NormalizedAttemptEvent,
  type ProfileId,
  type ProfileReadiness,
  type QuestionId,
  type QuestionOutcome,
  type ScopedQuestionOutcome,
  type TerminalQuestionOutcome,
} from "./index.ts"

const ATTEMPT = toOpaqueId<AttemptId>("attempt-1")!
const OTHER_ATTEMPT = toOpaqueId<AttemptId>("attempt-2")!
const EVENT = toOpaqueId<ActivityEventId>("event-1")!
const QUESTION = toOpaqueId<QuestionId>("question-1")!
const GENERATION = toAttemptGeneration(3)!
const SEQUENCE = toActivitySequence(7)!

function activity(
  overrides: Partial<NormalizedAttemptEvent> = {},
): NormalizedAttemptEvent {
  return {
    eventId: EVENT,
    attemptId: ATTEMPT,
    generation: GENERATION,
    sequence: SEQUENCE,
    occurredAt: 1_721_234_567_890,
    activity: { kind: "agent_message", messageId: "message-1", textDelta: "hello" },
    ...overrides,
  }
}

describe("opaque identifiers and numeric fences", () => {
  it("brands non-empty application IDs without changing their values", () => {
    expect(String(toOpaqueId<ProfileId>("profile-1"))).toBe("profile-1")
    expect(toOpaqueId<AttemptId>("")).toBeNull()
  })

  it("accepts only non-negative safe integer generations and sequences", () => {
    expect(Number(toAttemptGeneration(0))).toBe(0)
    expect(Number(toActivitySequence(42))).toBe(42)

    for (const invalid of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(toAttemptGeneration(invalid)).toBeNull()
      expect(toActivitySequence(invalid)).toBeNull()
    }
  })
})

describe("certified profile readiness", () => {
  it("classifies ready and every not-ready verdict without inspecting protocol state", () => {
    const ready: ProfileReadiness = { ready: true, protocolVersion: 1 }
    const notReady: ProfileReadiness = {
      ready: false,
      reason: "authentication_required",
      message: "Sign in, then retry.",
    }

    expect(profileReadinessClass(ready)).toBe("ready")
    expect(profileReadinessClass(notReady)).toBe("not_ready")
  })
})

describe("Direct ACP attempt lifecycle", () => {
  it("recognizes only closed terminal states", () => {
    const terminal: DirectAcpAttemptState[] = ["succeeded", "failed", "cancelled", "interrupted"]
    const active: DirectAcpAttemptState[] = ["created", "starting", "running", "needs_attention"]
    expect(terminal.every(isDirectAcpTerminalState)).toBe(true)
    expect(active.some(isDirectAcpTerminalState)).toBe(false)
  })
})

describe("normalized activity ordering", () => {
  const cursor = { attemptId: ATTEMPT, generation: GENERATION, nextSequence: SEQUENCE }

  it("preserves identity, generation, sequence, timestamp, and normalized payload metadata", () => {
    const event = activity()

    expect(classifyActivityOrder(cursor, event)).toEqual({ accepted: true })
    expect(String(event.eventId)).toBe("event-1")
    expect(String(event.attemptId)).toBe("attempt-1")
    expect(Number(event.generation)).toBe(3)
    expect(Number(event.sequence)).toBe(7)
    expect(event.occurredAt).toBe(1_721_234_567_890)
    expect(event.activity).toEqual({ kind: "agent_message", messageId: "message-1", textDelta: "hello" })
  })

  it("rejects unknown attempts, stale generations, regressions, and gaps", () => {
    expect(classifyActivityOrder(cursor, activity({ attemptId: OTHER_ATTEMPT }))).toEqual({
      accepted: false,
      reason: "unknown_attempt",
    })
    expect(classifyActivityOrder(cursor, activity({ generation: toAttemptGeneration(2)! }))).toEqual({
      accepted: false,
      reason: "stale_generation",
    })
    expect(classifyActivityOrder(cursor, activity({ sequence: toActivitySequence(6)! }))).toEqual({
      accepted: false,
      reason: "non_monotonic",
    })
    expect(classifyActivityOrder(cursor, activity({ sequence: toActivitySequence(8)! }))).toEqual({
      accepted: false,
      reason: "sequence_gap",
    })
  })

  it("runtime-validates every normalized activity shape and rejects wire-shaped or unknown data", () => {
    expect(validateNormalizedAttemptEvent(activity())).toEqual(activity())
    expect(validateNormalizedAttemptEvent(activity({
      activity: {
        kind: "tool_call",
        call: {
          toolCallId: "tool-1",
          kind: "execute",
          status: "completed",
          locations: ["src/index.ts"],
          failureKind: null,
          diff: { path: "src/index.ts", unified: "@@ fixture" },
        },
      },
    })).activity).toMatchObject({ kind: "tool_call" })
    expect(validateNormalizedAttemptEvent(activity({
      activity: { kind: "plan", entries: [{ content: "Verify", priority: "high", status: "pending" }] },
    })).activity).toMatchObject({ kind: "plan" })
    expect(validateNormalizedAttemptEvent(activity({
      activity: { kind: "usage", used: 5, size: 10 },
    })).activity).toEqual({ kind: "usage", used: 5, size: 10 })

    for (const invalid of [
      { ...activity(), eventId: "" },
      { ...activity(), wireType: "session/update" },
      { ...activity(), activity: { kind: "agent_message", messageId: "m", textDelta: "", acp: {} } },
      { ...activity(), activity: { kind: "usage", used: 11, size: 10 } },
      { ...activity(), activity: { kind: "tool_call", call: { toolCallId: "t", status: "wire_pending" } } },
    ]) {
      expect(() => validateNormalizedAttemptEvent(invalid)).toThrow(NormalizedActivityValidationError)
    }
  })
})

describe("generation-fenced question outcomes", () => {
  function scoped(
    outcome: QuestionOutcome<Record<string, string>>,
    generation: AttemptGeneration = GENERATION,
  ): ScopedQuestionOutcome<Record<string, string>> {
    return { attemptId: ATTEMPT, questionId: QUESTION, generation, outcome }
  }

  it("accepts submitted, skipped, timed-out, and cancelled as terminal outcomes", () => {
    const outcomes: TerminalQuestionOutcome<Record<string, string>>[] = [
      { kind: "submitted", answers: { choice: "yes" } },
      { kind: "skipped" },
      { kind: "timed_out" },
      { kind: "cancelled" },
    ]

    for (const outcome of outcomes) {
      expect(isTerminalQuestionOutcome(outcome)).toBe(true)
      expect(classifyScopedQuestionOutcome(GENERATION, scoped(outcome))).toEqual({ accepted: true, outcome })
    }
  })

  it("rejects stale generations and non-terminal outcomes", () => {
    expect(classifyScopedQuestionOutcome(GENERATION, scoped({ kind: "cancelled" }, toAttemptGeneration(2)!))).toEqual({
      accepted: false,
      reason: "stale_generation",
    })
    expect(isTerminalQuestionOutcome({ kind: "pending" })).toBe(false)
    expect(classifyScopedQuestionOutcome(GENERATION, scoped({ kind: "pending" }))).toEqual({
      accepted: false,
      reason: "non_terminal",
    })
  })
})

describe("engine package boundary", () => {
  it("imports only its own protocol-free modules and declares no runtime dependency", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>
    const productionFiles = ["contracts.ts", "index.ts"]
    const importSpecifiers: string[] = []

    for (const file of productionFiles) {
      const source = await readFile(new URL(file, import.meta.url), "utf8")
      importSpecifiers.push(
        ...Array.from(source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu), (match) => match[1]!),
      )
    }

    expect(packageJson).not.toHaveProperty("dependencies")
    expect(importSpecifiers).toEqual(["./contracts.ts"])
    expect(importSpecifiers.some((specifier) => /(?:tui|desktop|react|electrobun|sqlite|acp|bun)/iu.test(specifier))).toBe(false)
  })
})
