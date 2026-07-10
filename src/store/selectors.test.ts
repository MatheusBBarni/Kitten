import { describe, expect, it } from "bun:test"

import type { DomainSessionEvent, HandoffBundle } from "../core/types.ts"
import { createAppStore, type AppStore } from "./appStore.ts"
import {
  needsAttention,
  selectNextNeedy,
  selectSessionList,
  selectSessionPendingDiffs,
  selectSessionPlan,
  selectSessionReferencedFiles,
  selectSessionState,
  selectSessionStatus,
  selectSessionTurns,
  selectApprovalOverlay,
  selectFocusedSessionId,
  selectFocusedSession,
  selectHandoffPreview,
  selectHasOpenOverlay,
  selectIsApprovalOpen,
  selectIsFocused,
  selectIsSessionsOpen,
} from "./selectors.ts"

/**
 * Selectors are asserted on two axes: the value they project, and the identity of
 * that value across unrelated updates. Identity is the load-bearing property - it is
 * what lets `Object.is` short-circuit a re-render (ADR-004), so an unchanged slice
 * must return the *same reference*, not merely an equal one.
 */

const HANDOFF_BUNDLE: HandoffBundle = {
  intent: "continue",
  summary: "Refactor the parser",
  files: [],
  pendingDiffs: [],
  redactionCount: 2,
}

const EDIT_CALL: DomainSessionEvent = {
  kind: "tool_call",
  call: {
    toolCallId: "c1",
    kind: "edit",
    title: "Patch parser",
    status: "in_progress",
    locations: ["src/parser.ts"],
    diff: { path: "src/parser.ts", unified: "@@ -1 +1 @@" },
  },
}

describe("focus selectors", () => {
  it("project the focused agent and per-agent focus flags", () => {
    const store = createAppStore()
    expect(selectFocusedSessionId(store.getState())).toBe("claude-code")
    expect(selectIsFocused("claude-code")(store.getState())).toBe(true)
    expect(selectIsFocused("codex")(store.getState())).toBe(false)

    store.setFocus("codex")
    expect(selectFocusedSessionId(store.getState())).toBe("codex")
    expect(selectIsFocused("codex")(store.getState())).toBe(true)
  })

  it("follows the focused session", () => {
    const store = createAppStore({
      seeds: [
        { id: "claude-code", providerKind: "claude-code", title: "Claude Code", cwd: "/w" },
        { id: "codex", providerKind: "codex", title: "Codex", cwd: "/w", acpSessionId: "session-codex" },
      ],
    })
    expect(selectFocusedSession(store.getState()).providerKind).toBe("claude-code")

    store.setFocus("codex")
    expect(selectFocusedSession(store.getState()).acpSessionId).toBe("session-codex")
  })
})

describe("per-agent session selectors", () => {
  it("project the slice each view renders", () => {
    const store = createAppStore()
    store.applyEvent("codex", { kind: "status", status: "working" })
    store.applyEvent("codex", { kind: "agent_message", messageId: "m1", textDelta: "hi" })
    store.applyEvent("codex", { kind: "plan", entries: [{ content: "Step one" }] })
    store.applyEvent("codex", EDIT_CALL)
    const state = store.getState()

    expect(selectSessionState("codex")(state)).toBe(state.sessions.codex!)
    expect(selectSessionStatus("codex")(state)).toBe("working")
    expect(selectSessionTurns("codex")(state)).toHaveLength(2)
    expect(selectSessionPlan("codex")(state)).toEqual([{ content: "Step one" }])
    expect(selectSessionPendingDiffs("codex")(state)).toEqual([
      { toolCallId: "c1", path: "src/parser.ts", unified: "@@ -1 +1 @@" },
    ])
    expect(selectSessionReferencedFiles("codex")(state)).toEqual(new Map([["src/parser.ts", "edited"]]))
  })

  it("keeps an untouched agent's slices referentially stable", () => {
    const store = createAppStore()
    const before = store.getState()
    const claudeTurns = selectSessionTurns("claude-code")(before)

    store.applyEvent("codex", { kind: "agent_message", messageId: "m1", textDelta: "hi" })
    store.setFocus("codex")

    const after = store.getState()
    expect(selectSessionState("claude-code")(after)).toBe(before.sessions["claude-code"]!)
    expect(selectSessionTurns("claude-code")(after)).toBe(claudeTurns)
    expect(selectSessionStatus("claude-code")(after)).toBe("idle")
  })

  it("keeps a streaming agent's status and plan stable while its transcript grows", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", { kind: "plan", entries: [{ content: "Step one" }] })
    const before = store.getState()

    store.applyEvent("claude-code", { kind: "agent_message", messageId: "m1", textDelta: "tok" })

    const after = store.getState()
    expect(selectSessionPlan("claude-code")(after)).toBe(selectSessionPlan("claude-code")(before))
    expect(selectSessionStatus("claude-code")(after)).toBe(selectSessionStatus("claude-code")(before))
    expect(selectSessionTurns("claude-code")(after)).not.toBe(selectSessionTurns("claude-code")(before))
  })
})

/** A three-session fleet (two sharing a provider) focused on "a" by default. */
function fleetStore(): AppStore {
  return createAppStore({
    seeds: [
      { id: "a", providerKind: "claude-code", title: "A", cwd: "/w" },
      { id: "b", providerKind: "codex", title: "B", cwd: "/w" },
      { id: "c", providerKind: "claude-code", title: "C", cwd: "/w" },
    ],
  })
}

describe("needsAttention (ADR-006)", () => {
  it("is true for the states the developer must act on", () => {
    expect(needsAttention("awaiting_approval")).toBe(true)
    expect(needsAttention("error")).toBe(true)
    expect(needsAttention("finished")).toBe(true)
  })

  it("is false while a session is idle or working", () => {
    expect(needsAttention("idle")).toBe(false)
    expect(needsAttention("working")).toBe(false)
  })
})

describe("selectSessionList", () => {
  it("lists every session with its status and attention flag, in order", () => {
    const store = fleetStore()
    store.applyEvent("b", { kind: "status", status: "finished" })
    const list = selectSessionList(store.getState())

    expect(list.map((item) => item.id)).toEqual(["a", "b", "c"])
    expect(list.map((item) => item.status)).toEqual(["idle", "finished", "idle"])
    expect(list.map((item) => item.needsAttention)).toEqual([false, true, false])
    expect(list[0]).toMatchObject({ id: "a", title: "A", providerKind: "claude-code" })
  })

  it("carries each session's working directory, so the overview can label its card", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/frontend" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/work/backend" },
      ],
    })
    expect(selectSessionList(store.getState()).map((item) => item.cwd)).toEqual(["/work/frontend", "/work/backend"])
  })
})

describe("selectNextNeedy (ADR-006)", () => {
  it("returns an awaiting_approval session ahead of a finished one", () => {
    const store = fleetStore()
    store.applyEvent("b", { kind: "status", status: "finished" })
    store.applyEvent("c", { kind: "status", status: "awaiting_approval" })
    // From "a" both need attention; the approval outranks the finished turn.
    expect(selectNextNeedy("a")(store.getState())).toBe("c")
  })

  it("wraps past the pivot to an earlier needy session", () => {
    const store = fleetStore()
    store.applyEvent("a", { kind: "status", status: "finished" })
    // Pivot is the last session; the only needy one sits before it in order.
    expect(selectNextNeedy("c")(store.getState())).toBe("a")
  })

  it("breaks a rank tie by nearest after the pivot, walking forward", () => {
    const store = fleetStore()
    store.applyEvent("a", { kind: "status", status: "finished" })
    store.applyEvent("c", { kind: "status", status: "finished" })
    // From pivot "b", walking forward reaches "c" before wrapping to "a".
    expect(selectNextNeedy("b")(store.getState())).toBe("c")
  })

  it("skips the pivot session even when it needs attention", () => {
    const store = fleetStore()
    store.applyEvent("a", { kind: "status", status: "finished" })
    store.applyEvent("b", { kind: "status", status: "error" })
    // Pivot "a" is finished but excluded; the next needy session is "b".
    expect(selectNextNeedy("a")(store.getState())).toBe("b")
  })

  it("returns null when no session needs attention", () => {
    const store = fleetStore()
    store.applyEvent("b", { kind: "status", status: "working" })
    expect(selectNextNeedy("a")(store.getState())).toBeNull()
  })
})

describe("overlay selectors", () => {
  it("report closed slots as null and no open overlay", () => {
    const state = createAppStore().getState()
    expect(selectApprovalOverlay(state)).toBeNull()
    expect(selectHandoffPreview(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(false)
    expect(selectIsApprovalOpen(state)).toBe(false)
    expect(selectIsSessionsOpen(state)).toBe(false)
  })

  it("report an open sessions overview as an open, modal overlay", () => {
    const store = createAppStore()
    store.openSessions()
    const state = store.getState()

    expect(selectIsSessionsOpen(state)).toBe(true)
    expect(selectHasOpenOverlay(state)).toBe(true)
    // The overview carries no payload, so the approval flag stays independent of it.
    expect(selectIsApprovalOpen(state)).toBe(false)
    expect(selectApprovalOverlay(state)).toBeNull()
  })

  it("report an open approval overlay", () => {
    const store = createAppStore()
    store.openApproval({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      request: { sessionId: "s1", toolCall: { toolCallId: "c1" }, options: [] },
    })
    const state = store.getState()

    expect(selectApprovalOverlay(state)?.sessionId).toBe("claude-code")
    expect(selectHandoffPreview(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(true)
    expect(selectIsApprovalOpen(state)).toBe(true)
  })

  it("keep the approval flag false for a hand-off preview, which is not modal", () => {
    const store = createAppStore()
    store.openHandoffPreview({ sourceSessionId: "claude-code", targetSessionId: "codex", bundle: HANDOFF_BUNDLE })

    expect(selectHasOpenOverlay(store.getState())).toBe(true)
    expect(selectIsApprovalOpen(store.getState())).toBe(false)
  })

  it("report an open hand-off preview", () => {
    const store = createAppStore()
    store.openHandoffPreview({ sourceSessionId: "claude-code", targetSessionId: "codex", bundle: HANDOFF_BUNDLE })
    const state = store.getState()

    expect(selectHandoffPreview(state)?.bundle).toBe(HANDOFF_BUNDLE)
    expect(selectApprovalOverlay(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(true)
  })
})
