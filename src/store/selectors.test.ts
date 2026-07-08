import { describe, expect, it } from "bun:test"

import type { DomainSessionEvent, HandoffBundle } from "../core/types.ts"
import { createAppStore } from "./appStore.ts"
import {
  selectAgentPendingDiffs,
  selectAgentPlan,
  selectAgentReferencedFiles,
  selectAgentSession,
  selectAgentStatus,
  selectAgentTurns,
  selectApprovalOverlay,
  selectFocusedAgentId,
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
    expect(selectFocusedAgentId(store.getState())).toBe("claude-code")
    expect(selectIsFocused("claude-code")(store.getState())).toBe(true)
    expect(selectIsFocused("codex")(store.getState())).toBe(false)

    store.setFocus("codex")
    expect(selectFocusedAgentId(store.getState())).toBe("codex")
    expect(selectIsFocused("codex")(store.getState())).toBe(true)
  })

  it("follows the focused agent's session", () => {
    const store = createAppStore({ sessionIds: { codex: "session-codex" } })
    expect(selectFocusedSession(store.getState()).agentId).toBe("claude-code")

    store.setFocus("codex")
    expect(selectFocusedSession(store.getState()).sessionId).toBe("session-codex")
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

    expect(selectAgentSession("codex")(state)).toBe(state.sessions.codex)
    expect(selectAgentStatus("codex")(state)).toBe("working")
    expect(selectAgentTurns("codex")(state)).toHaveLength(2)
    expect(selectAgentPlan("codex")(state)).toEqual([{ content: "Step one" }])
    expect(selectAgentPendingDiffs("codex")(state)).toEqual([
      { toolCallId: "c1", path: "src/parser.ts", unified: "@@ -1 +1 @@" },
    ])
    expect(selectAgentReferencedFiles("codex")(state)).toEqual(new Map([["src/parser.ts", "edited"]]))
  })

  it("keeps an untouched agent's slices referentially stable", () => {
    const store = createAppStore()
    const before = store.getState()
    const claudeTurns = selectAgentTurns("claude-code")(before)

    store.applyEvent("codex", { kind: "agent_message", messageId: "m1", textDelta: "hi" })
    store.setFocus("codex")

    const after = store.getState()
    expect(selectAgentSession("claude-code")(after)).toBe(before.sessions["claude-code"])
    expect(selectAgentTurns("claude-code")(after)).toBe(claudeTurns)
    expect(selectAgentStatus("claude-code")(after)).toBe("idle")
  })

  it("keeps a streaming agent's status and plan stable while its transcript grows", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", { kind: "plan", entries: [{ content: "Step one" }] })
    const before = store.getState()

    store.applyEvent("claude-code", { kind: "agent_message", messageId: "m1", textDelta: "tok" })

    const after = store.getState()
    expect(selectAgentPlan("claude-code")(after)).toBe(selectAgentPlan("claude-code")(before))
    expect(selectAgentStatus("claude-code")(after)).toBe(selectAgentStatus("claude-code")(before))
    expect(selectAgentTurns("claude-code")(after)).not.toBe(selectAgentTurns("claude-code")(before))
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
      agentId: "claude-code",
      request: { sessionId: "s1", toolCall: { toolCallId: "c1" }, options: [] },
    })
    const state = store.getState()

    expect(selectApprovalOverlay(state)?.agentId).toBe("claude-code")
    expect(selectHandoffPreview(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(true)
    expect(selectIsApprovalOpen(state)).toBe(true)
  })

  it("keep the approval flag false for a hand-off preview, which is not modal", () => {
    const store = createAppStore()
    store.openHandoffPreview({ sourceAgentId: "claude-code", targetAgentId: "codex", bundle: HANDOFF_BUNDLE })

    expect(selectHasOpenOverlay(store.getState())).toBe(true)
    expect(selectIsApprovalOpen(store.getState())).toBe(false)
  })

  it("report an open hand-off preview", () => {
    const store = createAppStore()
    store.openHandoffPreview({ sourceAgentId: "claude-code", targetAgentId: "codex", bundle: HANDOFF_BUNDLE })
    const state = store.getState()

    expect(selectHandoffPreview(state)?.bundle).toBe(HANDOFF_BUNDLE)
    expect(selectApprovalOverlay(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(true)
  })
})
