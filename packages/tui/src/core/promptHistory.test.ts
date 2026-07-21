import { describe, expect, it } from "bun:test"

import {
  MAX_PROMPT_HISTORY,
  createPromptHistoryState,
  navigatePromptHistory,
  promptHistoryReducer,
  recordPromptHistory,
  selectPromptHistory,
  type PromptHistoryEvent,
  type PromptHistoryState,
} from "./promptHistory.ts"

// Suite: pure prompt-history policy
// Invariant: exact prompts remain bounded and immutable while navigation clamps and reports clear versus no replacement.
// Boundary IN: prompt-history factories, record transitions, navigation transitions, and selection results.
// Boundary OUT: session/store wiring, controller actions, telemetry, and composer rendering.

const fold = (
  events: readonly PromptHistoryEvent[],
  start: PromptHistoryState = createPromptHistoryState(),
): PromptHistoryState => events.reduce(promptHistoryReducer, start)

describe("createPromptHistoryState", () => {
  it("starts with no entries and no active recall cursor", () => {
    expect(createPromptHistoryState()).toEqual({ entries: [], cursor: null })
  })
})

describe("recordPromptHistory", () => {
  it("retains different prompts oldest-to-newest and leaves recall mode", () => {
    const recalling: PromptHistoryState = { entries: ["first"], cursor: 0 }

    const state = recordPromptHistory(recalling, "second")

    expect(state).toEqual({ entries: ["first", "second"], cursor: null })
  })

  it("collapses only adjacent exact duplicates", () => {
    const adjacent = fold([
      { kind: "prompt_history", action: "record", text: "same" },
      { kind: "prompt_history", action: "record", text: "same" },
    ])
    const separated = fold(
      [
        { kind: "prompt_history", action: "record", text: "different" },
        { kind: "prompt_history", action: "record", text: "same" },
      ],
      adjacent,
    )

    expect(adjacent.entries).toEqual(["same"])
    expect(separated.entries).toEqual(["same", "different", "same"])
  })

  it("resets an active recall cursor when recording an adjacent duplicate", () => {
    const entries = Object.freeze(["same"])
    const recalling: PromptHistoryState = { entries, cursor: 0 }

    const state = recordPromptHistory(recalling, "same")

    expect(state).toEqual({ entries: ["same"], cursor: null })
    expect(state.entries).toBe(entries)
  })

  it("evicts only the oldest prompt after the fixed capacity is exceeded", () => {
    const state = Array.from({ length: MAX_PROMPT_HISTORY + 1 }, (_, index) => `prompt ${index}`)
      .reduce(recordPromptHistory, createPromptHistoryState())

    expect(state.entries).toHaveLength(MAX_PROMPT_HISTORY)
    expect(state.entries[0]).toBe("prompt 1")
    expect(state.entries.at(-1)).toBe(`prompt ${MAX_PROMPT_HISTORY}`)
  })

  it("ignores blank submissions without changing state", () => {
    const before = recordPromptHistory(createPromptHistoryState(), "kept")

    expect(recordPromptHistory(before, " \n\t ")).toBe(before)
  })
})

describe("previous navigation", () => {
  it("starts at the newest prompt, reaches the oldest, and clamps there", () => {
    const recorded = fold([
      { kind: "prompt_history", action: "record", text: "oldest" },
      { kind: "prompt_history", action: "record", text: "middle" },
      { kind: "prompt_history", action: "record", text: "newest" },
    ])

    const newest = navigatePromptHistory(recorded, "previous")
    const middle = navigatePromptHistory(newest.state, "previous")
    const oldest = navigatePromptHistory(middle.state, "previous")
    const clamped = navigatePromptHistory(oldest.state, "previous")

    expect(newest.selection).toEqual({ text: "newest", historyIndex: 2, total: 3 })
    expect(middle.selection).toEqual({ text: "middle", historyIndex: 1, total: 3 })
    expect(oldest.selection).toEqual({ text: "oldest", historyIndex: 0, total: 3 })
    expect(clamped.selection).toEqual({ text: "oldest", historyIndex: 0, total: 3 })
    expect(clamped.state).toBe(oldest.state)
  })

  it("returns no replacement when history is empty", () => {
    const before = createPromptHistoryState()

    const result = navigatePromptHistory(before, "previous")

    expect(result.state).toBe(before)
    expect(result.selection).toEqual({ text: null, historyIndex: null, total: 0 })
  })
})

describe("next navigation", () => {
  it("walks toward the newest prompt, then clears and leaves recall mode", () => {
    const recorded = fold([
      { kind: "prompt_history", action: "record", text: "oldest" },
      { kind: "prompt_history", action: "record", text: "newest" },
    ])
    const atNewest = navigatePromptHistory(recorded, "previous")
    const atOldest = navigatePromptHistory(atNewest.state, "previous")

    const newest = navigatePromptHistory(atOldest.state, "next")
    const cleared = navigatePromptHistory(newest.state, "next")

    expect(newest.selection).toEqual({ text: "newest", historyIndex: 1, total: 2 })
    expect(cleared.selection).toEqual({ text: "", historyIndex: null, total: 2 })
    expect(cleared.state).toEqual({ entries: ["oldest", "newest"], cursor: null })
  })

  it("returns no replacement when already outside recall mode", () => {
    const before = recordPromptHistory(createPromptHistoryState(), "newest")

    const result = navigatePromptHistory(before, "next")

    expect(result.state).toBe(before)
    expect(result.selection).toEqual({ text: null, historyIndex: null, total: 1 })
  })
})

describe("selection and purity", () => {
  it("round-trips Unicode and multiline text without normalizing frozen input", () => {
    const exact = "  Olá, 世界 👋  \nsecond line\n"
    const entries = Object.freeze([exact])
    const before = Object.freeze({
      entries,
      cursor: null,
    }) satisfies PromptHistoryState

    const result = navigatePromptHistory(before, "previous")

    expect(result.state).not.toBe(before)
    expect(result.state.entries).toBe(entries)
    expect(result.selection.text).toBe(exact)
    expect(before).toEqual({ entries: [exact], cursor: null })
  })

  it("selects active recall without inventing a replacement outside recall mode", () => {
    const outside = recordPromptHistory(createPromptHistoryState(), "prompt")
    const recalling = navigatePromptHistory(outside, "previous").state

    expect(selectPromptHistory(outside)).toEqual({ text: null, historyIndex: null, total: 1 })
    expect(selectPromptHistory(recalling)).toEqual({ text: "prompt", historyIndex: 0, total: 1 })
  })
})

describe("promptHistoryReducer", () => {
  it("delegates previous and next events through the navigation policy", () => {
    const recorded = recordPromptHistory(createPromptHistoryState(), "prompt")

    const recalled = promptHistoryReducer(recorded, { kind: "prompt_history", action: "previous" })
    const cleared = promptHistoryReducer(recalled, { kind: "prompt_history", action: "next" })

    expect(recalled).toEqual({ entries: ["prompt"], cursor: 0 })
    expect(cleared).toEqual({ entries: ["prompt"], cursor: null })
  })

  it("rejects an unexpected runtime action", () => {
    const invalidEvent = {
      kind: "prompt_history",
      action: "unexpected",
    } as unknown as PromptHistoryEvent

    expect(() => promptHistoryReducer(createPromptHistoryState(), invalidEvent)).toThrow(
      "Unhandled prompt-history event",
    )
  })
})

describe("integration: record and navigate through the complete transition path", () => {
  it("returns each selected text followed by the explicit clear result", () => {
    const recorded = fold([
      { kind: "prompt_history", action: "record", text: "first" },
      { kind: "prompt_history", action: "record", text: "second" },
    ])

    const second = navigatePromptHistory(recorded, "previous")
    const first = navigatePromptHistory(second.state, "previous")
    const secondAgain = navigatePromptHistory(first.state, "next")
    const clear = navigatePromptHistory(secondAgain.state, "next")
    const noReplacement = navigatePromptHistory(clear.state, "next")

    expect([
      second.selection.text,
      first.selection.text,
      secondAgain.selection.text,
      clear.selection.text,
      noReplacement.selection.text,
    ]).toEqual(["second", "first", "second", "", null])
  })
})
