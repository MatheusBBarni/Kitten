import { describe, expect, it } from "bun:test"

import type { DomainSessionEvent, HandoffBundle } from "../core/types.ts"
import { createAppStore } from "./appStore.ts"
import {
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

describe("overlay selectors", () => {
  it("report closed slots as null and no open overlay", () => {
    const state = createAppStore().getState()
    expect(selectApprovalOverlay(state)).toBeNull()
    expect(selectHandoffPreview(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(false)
    expect(selectIsApprovalOpen(state)).toBe(false)
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
