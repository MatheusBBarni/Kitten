import { describe, expect, it } from "bun:test"

import { projectTranscript, type TranscriptProjectionInput } from "./transcriptProjection.ts"
import type { AgentTurn, ToolCallStatus, ToolCallTurn, Turn, UserTurn } from "./types.ts"

const userTurn = (index: number): UserTurn => ({
  kind: "user",
  messageId: `user-${index}`,
  text: `user ${index}`,
})

const agentTurn = (index: number): AgentTurn => ({
  kind: "agent",
  messageId: `agent-${index}`,
  text: `agent ${index}`,
})

const toolTurn = (index: number, status: ToolCallStatus): ToolCallTurn => ({
  kind: "tool_call",
  record: {
    toolCallId: `tool-${index}`,
    kind: "other",
    title: `tool ${index}`,
    status,
    locations: [],
  },
})

const completedTurns = (count: number): readonly Turn[] =>
  Array.from({ length: count }, (_, index) => (index % 2 === 0 ? userTurn(index) : agentTurn(index)))

const input = (
  turns: readonly Turn[],
  overrides: Partial<TranscriptProjectionInput> = {},
): TranscriptProjectionInput => ({
  turns,
  enabled: true,
  revealedTurnCount: 0,
  protection: {
    tailTurnCount: 3,
    activeStreamingMessageId: null,
    activeToolCallIds: [],
    approvalToolCallId: null,
  },
  ...overrides,
})

const turnRows = (projection: ReturnType<typeof projectTranscript>) =>
  projection.rows.filter((row) => row.kind === "turn")

describe("projectTranscript", () => {
  it("retains empty and below-tail inputs without a marker", () => {
    const empty = projectTranscript(input([]))
    expect(empty).toEqual({ rows: [], hiddenTurnCount: 0 })

    const turns = completedTurns(3)
    const belowTail = projectTranscript(input(turns, {
      protection: { ...input(turns).protection, tailTurnCount: 5 },
    }))

    expect(belowTail.hiddenTurnCount).toBe(0)
    expect(belowTail.rows.map((row) => row.key)).toEqual(["turn:0", "turn:1", "turn:2"])
    expect(turnRows(belowTail).map((row) => row.turn)).toEqual([...turns])
  })

  it("returns every authoritative turn in order when disabled", () => {
    const turns = completedTurns(10)
    const projection = projectTranscript(input(turns, {
      enabled: false,
      protection: { ...input(turns).protection, tailTurnCount: 1 },
    }))

    expect(projection.hiddenTurnCount).toBe(0)
    expect(projection.rows).toHaveLength(10)
    expect(projection.rows.every((row) => row.kind === "turn")).toBe(true)
    expect(turnRows(projection).map((row) => row.turn)).toEqual([...turns])
  })

  it("collapses a completed ten-turn fixture to a counted marker and absolute-index tail keys", () => {
    const projection = projectTranscript(input(completedTurns(10)))

    expect(projection.hiddenTurnCount).toBe(7)
    expect(projection.rows.map((row) => row.key)).toEqual([
      "history:0-6",
      "turn:7",
      "turn:8",
      "turn:9",
    ])
    expect(projection.rows[0]).toEqual({
      kind: "history_marker",
      key: "history:0-6",
      hiddenTurnCount: 7,
    })
  })

  it("reveals immediately preceding history and removes the marker only at full reveal", () => {
    const turns = completedTurns(10)

    const partial = projectTranscript(input(turns, { revealedTurnCount: 2 }))
    expect(partial.hiddenTurnCount).toBe(5)
    expect(partial.rows.map((row) => row.key)).toEqual([
      "history:0-4",
      "turn:5",
      "turn:6",
      "turn:7",
      "turn:8",
      "turn:9",
    ])

    const full = projectTranscript(input(turns, { revealedTurnCount: 7 }))
    expect(full.hiddenTurnCount).toBe(0)
    expect(full.rows.map((row) => row.key)).toEqual(turns.map((_, index) => `turn:${index}`))

    const oversized = projectTranscript(input(turns, { revealedTurnCount: Number.POSITIVE_INFINITY }))
    expect(oversized.rows.map((row) => row.key)).toEqual(full.rows.map((row) => row.key))
  })

  it("independently retains every historical protection source and its intervening suffix", () => {
    const base: readonly Turn[] = [
      userTurn(0),
      agentTurn(1),
      toolTurn(2, "completed"),
      toolTurn(3, "completed"),
      toolTurn(4, "completed"),
      toolTurn(5, "completed"),
      userTurn(6),
      agentTurn(7),
      userTurn(8),
      agentTurn(9),
    ]
    const cases = [
      {
        name: "active stream",
        turns: base,
        earliestIndex: 1,
        protection: { ...input(base).protection, activeStreamingMessageId: "agent-1" },
      },
      {
        name: "explicit active tool",
        turns: base,
        earliestIndex: 2,
        protection: { ...input(base).protection, activeToolCallIds: ["tool-2"] },
      },
      {
        name: "pending tool status",
        turns: base.map((turn, index) => (index === 3 ? toolTurn(3, "pending") : turn)),
        earliestIndex: 3,
        protection: input(base).protection,
      },
      {
        name: "in-progress tool status",
        turns: base.map((turn, index) => (index === 4 ? toolTurn(4, "in_progress") : turn)),
        earliestIndex: 4,
        protection: input(base).protection,
      },
      {
        name: "approval-owned tool",
        turns: base,
        earliestIndex: 5,
        protection: { ...input(base).protection, approvalToolCallId: "tool-5" },
      },
    ] as const

    for (const fixture of cases) {
      const projection = projectTranscript(input(fixture.turns, { protection: fixture.protection }))
      expect(projection.hiddenTurnCount, fixture.name).toBe(fixture.earliestIndex)
      expect(projection.rows.map((row) => row.key), fixture.name).toEqual([
        `history:0-${fixture.earliestIndex - 1}`,
        ...fixture.turns.slice(fixture.earliestIndex).map((_, index) =>
          `turn:${index + fixture.earliestIndex}`),
      ])
    }
  })

  it("re-projects a same-index historical tool update without mutating either input", () => {
    const originalTool = toolTurn(2, "completed")
    const original: readonly Turn[] = Object.freeze([
      Object.freeze(userTurn(0)),
      Object.freeze(agentTurn(1)),
      Object.freeze(originalTool),
      ...completedTurns(5).map((turn) => Object.freeze(turn)),
    ])
    const originalInput = Object.freeze(input(original, {
      protection: { ...input(original).protection, tailTurnCount: 2 },
    }))
    const originalProjection = projectTranscript(originalInput)
    expect(originalProjection.hiddenTurnCount).toBe(6)

    const updatedTool = toolTurn(2, "in_progress")
    const updated = Object.freeze(original.map((turn, index) => (index === 2 ? updatedTool : turn)))
    const updatedProjection = projectTranscript(input(updated, {
      protection: { ...input(updated).protection, tailTurnCount: 2 },
    }))

    expect(updatedProjection.hiddenTurnCount).toBe(2)
    expect(updatedProjection.rows.map((row) => row.key)).toEqual([
      "history:0-1",
      "turn:2",
      "turn:3",
      "turn:4",
      "turn:5",
      "turn:6",
      "turn:7",
    ])
    expect(turnRows(updatedProjection)[0]?.turn).toBe(updatedTool)
    expect(original[2]).toBe(originalTool)
    expect(originalTool.record.status).toBe("completed")
    expect(originalInput.turns).toBe(original)
    expect(originalInput.revealedTurnCount).toBe(0)
  })

  it("preserves frozen references and stable keys through tail streaming", () => {
    const initial: readonly Turn[] = Object.freeze(
      completedTurns(10).map((turn) => Object.freeze(turn)),
    )
    const before = projectTranscript(input(initial))
    const last = initial[9] as AgentTurn
    const streaming = Object.freeze({ ...last, text: `${last.text} delta` })
    const updated = Object.freeze([...initial.slice(0, 9), streaming])
    const after = projectTranscript(input(updated))

    expect(after.rows.map((row) => row.key)).toEqual(before.rows.map((row) => row.key))
    expect(turnRows(after)[0]?.turn).toBe(initial[7])
    expect(turnRows(after)[1]?.turn).toBe(initial[8])
    expect(turnRows(after)[2]?.turn).toBe(streaming)
    expect(turnRows(before)[2]?.turn).toBe(initial[9])
  })
})
