// Suite: session-tab workspace reducer
// Invariant: workspace transitions preserve lifecycle, order, selection, attention epochs, and structural sharing.
// Boundary IN: pure workspace factory, reducer, and ordering helpers
// Boundary OUT: execution reduction and store composition, covered by sessionReducer.test.ts and appStore.test.ts

import { describe, expect, it } from "bun:test"

import {
  attentionConversationIds,
  attentionRank,
  createWorkspaceState,
  visibleConversationIds,
  workspaceReducer,
} from "./workspace.ts"
import type {
  SessionId,
  WorkspaceConversationSeed,
  WorkspaceEvent,
  WorkspaceState,
} from "./types.ts"

const seed = (
  sessionId: SessionId,
  overrides: Partial<WorkspaceConversationSeed> = {},
): WorkspaceConversationSeed => ({
  sessionId,
  displayName: sessionId,
  availability: { kind: "ready" },
  ...overrides,
})

const workspace = (
  conversations: WorkspaceConversationSeed[] = [seed("a"), seed("b"), seed("c")],
  selectedVisibleId: SessionId | null = "a",
): WorkspaceState => createWorkspaceState({ conversations, selectedVisibleId })

const reduce = (state: WorkspaceState, ...events: WorkspaceEvent[]): WorkspaceState =>
  events.reduce(workspaceReducer, state)

describe("createWorkspaceState", () => {
  it("creates a valid empty workspace with nullable selection", () => {
    expect(createWorkspaceState()).toEqual({
      conversations: {},
      order: [],
      selectedVisibleId: null,
    })
  })

  it("preserves a background-only workspace without fabricating visible selection", () => {
    const state = workspace([seed("background", { lifecycle: "background" })], null)

    expect(state.order).toEqual(["background"])
    expect(state.conversations.background?.lifecycle).toBe("background")
    expect(state.selectedVisibleId).toBeNull()
    expect(visibleConversationIds(state)).toEqual([])
  })

  it("chooses the first visible conversation when a requested selection is invalid", () => {
    const state = workspace(
      [seed("background", { lifecycle: "background" }), seed("visible")],
      "missing",
    )

    expect(state.selectedVisibleId).toBe("visible")
  })

  it("ignores duplicate IDs and blank names while preserving input order", () => {
    const state = workspace(
      [seed("a", { displayName: "First" }), seed("a", { displayName: "Duplicate" }), seed("blank", { displayName: "  " }), seed("b")],
      "a",
    )

    expect(state.order).toEqual(["a", "b"])
    expect(state.conversations.a?.displayName).toBe("First")
  })
})

describe("creation and naming", () => {
  it("creates and selects a normalized visible conversation at the end of order", () => {
    const before = workspace([seed("a", { createdOrdinal: 4 })], "a")
    const after = workspaceReducer(before, {
      kind: "create",
      sessionId: "b",
      displayName: "  Review tests  ",
      availability: { kind: "starting" },
    })

    expect(after.order).toEqual(["a", "b"])
    expect(after.selectedVisibleId).toBe("b")
    expect(after.conversations.b).toMatchObject({
      sessionId: "b",
      displayName: "Review tests",
      lifecycle: "visible",
      createdOrdinal: 5,
      availability: { kind: "starting" },
      teardownState: "open",
      attention: { status: "idle", seen: true, sequence: 0 },
    })
    expect(after.conversations.a).toBe(before.conversations.a)
  })

  it("allows duplicate labels across identities and preserves unaffected entries", () => {
    const before = workspace([seed("a", { displayName: "Same" }), seed("b")], "a")
    const after = workspaceReducer(before, { kind: "rename", sessionId: "b", displayName: " Same " })

    expect(after.conversations.b?.displayName).toBe("Same")
    expect(after.conversations.a).toBe(before.conversations.a)
  })

  it("returns the same state for duplicate IDs, blank names, unknown IDs, and repeated names", () => {
    const before = workspace([seed("a", { displayName: "Alpha" })], "a")
    const events: WorkspaceEvent[] = [
      { kind: "create", sessionId: "a", displayName: "Other" },
      { kind: "create", sessionId: "b", displayName: "  " },
      { kind: "rename", sessionId: "missing", displayName: "Other" },
      { kind: "rename", sessionId: "a", displayName: " Alpha " },
      { kind: "rename", sessionId: "a", displayName: " " },
    ]

    for (const event of events) expect(workspaceReducer(before, event)).toBe(before)
  })
})

describe("selection and adjacent navigation", () => {
  it("cycles previous and next through visible conversations while skipping background work", () => {
    const initial = workspace(
      [seed("a"), seed("background", { lifecycle: "background" }), seed("c")],
      "a",
    )

    const previous = workspaceReducer(initial, { kind: "select_adjacent", direction: "previous" })
    const wrappedNext = workspaceReducer(previous, { kind: "select_adjacent", direction: "next" })
    const next = workspaceReducer(wrappedNext, { kind: "select_adjacent", direction: "next" })

    expect(previous.selectedVisibleId).toBe("c")
    expect(wrappedNext.selectedVisibleId).toBe("a")
    expect(next.selectedVisibleId).toBe("c")
  })

  it("selects the first or last visible conversation when selection is null", () => {
    const invalidlyUnselected: WorkspaceState = { ...workspace(), selectedVisibleId: null }

    expect(
      workspaceReducer(invalidlyUnselected, { kind: "select_adjacent", direction: "next" })
        .selectedVisibleId,
    ).toBe("a")
    expect(
      workspaceReducer(invalidlyUnselected, { kind: "select_adjacent", direction: "previous" })
        .selectedVisibleId,
    ).toBe("c")
  })

  it("returns the same state for unknown, background, and already-selected IDs", () => {
    const before = workspace([seed("a"), seed("b", { lifecycle: "background" })], "a")

    expect(workspaceReducer(before, { kind: "select", sessionId: "missing" })).toBe(before)
    expect(workspaceReducer(before, { kind: "select", sessionId: "b" })).toBe(before)
    expect(workspaceReducer(before, { kind: "select", sessionId: "a" })).toBe(before)
  })

  it("does nothing when adjacent navigation has no visible conversation", () => {
    const before = workspace([seed("background", { lifecycle: "background" })], null)
    expect(workspaceReducer(before, { kind: "select_adjacent", direction: "next" })).toBe(before)
  })
})

describe("background, reopen, and successful close", () => {
  it("backgrounds the selected conversation and focuses the next visible entry", () => {
    const before = workspace()
    const after = workspaceReducer(before, { kind: "background", sessionId: "a" })

    expect(after.conversations.a?.lifecycle).toBe("background")
    expect(after.selectedVisibleId).toBe("b")
    expect(after.order).toBe(before.order)
    expect(after.conversations.b).toBe(before.conversations.b)
    expect(after.conversations.c).toBe(before.conversations.c)
  })

  it("keeps background work and null selection after the final visible removal", () => {
    const before = workspace(
      [seed("visible"), seed("already-background", { lifecycle: "background" })],
      "visible",
    )
    const after = workspaceReducer(before, { kind: "background", sessionId: "visible" })

    expect(after.selectedVisibleId).toBeNull()
    expect(after.order).toEqual(["visible", "already-background"])
    expect(visibleConversationIds(after)).toEqual([])
  })

  it("reopens and selects a background conversation while acknowledging its current epoch", () => {
    const before = reduce(
      workspace([seed("a"), seed("b", { lifecycle: "background" })], "a"),
      { kind: "execution_status", sessionId: "b", status: "error" },
    )
    const after = workspaceReducer(before, { kind: "reopen", sessionId: "b" })

    expect(after.conversations.b?.lifecycle).toBe("visible")
    expect(after.conversations.b?.attention).toEqual({ status: "error", seen: true, sequence: 1 })
    expect(after.selectedVisibleId).toBe("b")
  })

  it("removes a successfully closed conversation and focuses the next visible entry", () => {
    const before = workspace()
    const after = workspaceReducer(before, { kind: "close_succeeded", sessionId: "a" })

    expect(after.conversations.a).toBeUndefined()
    expect(after.order).toEqual(["b", "c"])
    expect(after.selectedVisibleId).toBe("b")
    expect(after.conversations.b).toBe(before.conversations.b)
    expect(after.conversations.c).toBe(before.conversations.c)
  })

  it("keeps the selection when closing background work", () => {
    const before = workspace([seed("a"), seed("background", { lifecycle: "background" })], "a")
    const after = workspaceReducer(before, { kind: "close_succeeded", sessionId: "background" })

    expect(after.selectedVisibleId).toBe("a")
    expect(after.conversations.a).toBe(before.conversations.a)
  })

  it("returns the same state for invalid or repeated lifecycle events", () => {
    const before = workspace([seed("a"), seed("background", { lifecycle: "background" })], "a")
    const events: WorkspaceEvent[] = [
      { kind: "background", sessionId: "background" },
      { kind: "background", sessionId: "missing" },
      { kind: "reopen", sessionId: "a" },
      { kind: "reopen", sessionId: "missing" },
      { kind: "close_succeeded", sessionId: "missing" },
    ]

    for (const event of events) expect(workspaceReducer(before, event)).toBe(before)
  })

  it("keeps lifecycle unchanged while teardown is closing", () => {
    const visibleClosing = reduce(workspace([seed("a")], "a"), {
      kind: "set_teardown_state",
      sessionId: "a",
      teardownState: "closing",
    })
    const backgroundClosing = reduce(
      workspace([seed("a", { lifecycle: "background" })], null),
      { kind: "set_teardown_state", sessionId: "a", teardownState: "closing" },
    )

    expect(workspaceReducer(visibleClosing, { kind: "background", sessionId: "a" })).toBe(
      visibleClosing,
    )
    expect(workspaceReducer(backgroundClosing, { kind: "reopen", sessionId: "a" })).toBe(
      backgroundClosing,
    )
  })
})

describe("availability, teardown, and structural sharing", () => {
  it("updates only the targeted conversation for availability and teardown", () => {
    const before = workspace()
    const unavailable = workspaceReducer(before, {
      kind: "set_availability",
      sessionId: "b",
      availability: { kind: "unavailable", reasonCode: "connection-failed", retryable: true },
    })
    const closing = workspaceReducer(unavailable, {
      kind: "set_teardown_state",
      sessionId: "b",
      teardownState: "closing",
    })

    expect(closing.conversations.b).toMatchObject({
      availability: { kind: "unavailable", reasonCode: "connection-failed", retryable: true },
      teardownState: "closing",
    })
    expect(closing.conversations.a).toBe(before.conversations.a)
    expect(closing.conversations.c).toBe(before.conversations.c)
    expect(closing.order).toBe(before.order)
  })

  it("returns the same state for unknown targets and repeated values", () => {
    const before = workspace()
    const unavailable = workspaceReducer(before, {
      kind: "set_availability",
      sessionId: "b",
      availability: { kind: "unavailable", reasonCode: "connection-failed", retryable: true },
    })

    expect(
      workspaceReducer(unavailable, {
        kind: "set_availability",
        sessionId: "b",
        availability: { kind: "unavailable", reasonCode: "connection-failed", retryable: true },
      }),
    ).toBe(unavailable)
    expect(
      workspaceReducer(before, {
        kind: "set_availability",
        sessionId: "missing",
        availability: { kind: "ready" },
      }),
    ).toBe(before)
    expect(
      workspaceReducer(before, { kind: "set_teardown_state", sessionId: "a", teardownState: "open" }),
    ).toBe(before)
  })
})

describe("attention epochs and ordering", () => {
  it("ranks approval, error, and finished ahead of non-attention statuses", () => {
    expect(attentionRank("awaiting_approval")).toBe(0)
    expect(attentionRank("error")).toBe(1)
    expect(attentionRank("finished")).toBe(2)
    expect(attentionRank("working")).toBeNull()
    expect(attentionRank("idle")).toBeNull()
  })

  it("creates a new unseen epoch only when entering an attention status", () => {
    const initial = workspace([seed("a")], "a")
    const approval = workspaceReducer(initial, {
      kind: "execution_status",
      sessionId: "a",
      status: "awaiting_approval",
    })
    const repeated = workspaceReducer(approval, {
      kind: "execution_status",
      sessionId: "a",
      status: "awaiting_approval",
    })
    const selected = workspaceReducer(approval, { kind: "select", sessionId: "a" })
    const working = workspaceReducer(selected, { kind: "execution_status", sessionId: "a", status: "working" })
    const laterApproval = workspaceReducer(working, {
      kind: "execution_status",
      sessionId: "a",
      status: "awaiting_approval",
    })

    expect(approval.conversations.a?.attention).toEqual({
      status: "awaiting_approval",
      seen: false,
      sequence: 1,
    })
    expect(repeated).toBe(approval)
    expect(selected.conversations.a?.attention).toEqual({
      status: "awaiting_approval",
      seen: true,
      sequence: 1,
    })
    expect(working.conversations.a?.attention).toEqual({ status: "working", seen: true, sequence: 1 })
    expect(laterApproval.conversations.a?.attention).toEqual({
      status: "awaiting_approval",
      seen: false,
      sequence: 2,
    })
  })

  it("orders unseen visible and background attention by rank then forward position", () => {
    const initial = workspace(
      [seed("selected"), seed("finished"), seed("approval", { lifecycle: "background" }), seed("error")],
      "selected",
    )
    const state = reduce(
      initial,
      { kind: "execution_status", sessionId: "finished", status: "finished" },
      { kind: "execution_status", sessionId: "approval", status: "awaiting_approval" },
      { kind: "execution_status", sessionId: "error", status: "error" },
    )

    expect(attentionConversationIds(state)).toEqual(["approval", "error", "finished"])
  })

  it("excludes acknowledged and successfully closed attention epochs", () => {
    const initial = reduce(
      workspace([seed("a"), seed("b", { lifecycle: "background" })], "a"),
      { kind: "execution_status", sessionId: "a", status: "error" },
      { kind: "execution_status", sessionId: "b", status: "finished" },
    )
    const acknowledged = workspaceReducer(initial, { kind: "select", sessionId: "a" })
    const closed = workspaceReducer(acknowledged, { kind: "close_succeeded", sessionId: "b" })

    expect(attentionConversationIds(acknowledged)).toEqual(["b"])
    expect(attentionConversationIds(closed)).toEqual([])
  })

  it("excludes the selected conversation from next-attention routing", () => {
    const state = reduce(workspace([seed("a"), seed("b")], "a"), {
      kind: "execution_status",
      sessionId: "a",
      status: "awaiting_approval",
    })

    expect(attentionConversationIds(state)).toEqual([])
  })

  it("returns the same state for an unknown status target", () => {
    const before = workspace()
    expect(
      workspaceReducer(before, { kind: "execution_status", sessionId: "missing", status: "error" }),
    ).toBe(before)
  })
})
