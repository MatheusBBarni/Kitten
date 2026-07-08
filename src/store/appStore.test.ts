import { describe, expect, it } from "bun:test"

import type { PermissionRequest } from "../agent/agentConnection.ts"
import { createSessionState, sessionReducer } from "../core/sessionReducer.ts"
import type { AgentId, DomainSessionEvent, HandoffBundle, SessionState } from "../core/types.ts"
import { createAppStore, type AppStore, type AppState } from "./appStore.ts"
import { selectAgentStatus, selectAgentTurns, selectApprovalOverlay, selectHandoffPreview } from "./selectors.ts"

/**
 * The store is verified two ways.
 *
 * Unit tests pin the store's own contract: events reach the right agent slice through
 * the core reducer, prior state is never mutated, focus and overlay actions touch only
 * their own field, and a narrow subscription stays silent when an unrelated slice moves
 * (the ADR-004 property that keeps a streamed token from re-rendering the cockpit).
 *
 * The integration test drives a scripted, interleaved two-agent event stream through the
 * store and asserts each final `SessionState` equals an independent fold of that agent's
 * events over the same reducer - so routing, ordering, and reduction are checked end to end.
 */

const APPROVAL_REQUEST: PermissionRequest = {
  sessionId: "session-claude",
  toolCall: { toolCallId: "call-1", kind: "edit", title: "Edit src/index.ts" },
  options: [
    { optionId: "allow", name: "Allow once", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
}

const HANDOFF_BUNDLE: HandoffBundle = {
  intent: "continue",
  summary: "Refactor the parser",
  files: [{ path: "src/parser.ts", reason: "edited" }],
  pendingDiffs: [{ toolCallId: "call-1", path: "src/parser.ts", unified: "@@ -1 +1 @@" }],
  redactionCount: 0,
}

const message = (messageId: string, textDelta: string): DomainSessionEvent => ({
  kind: "agent_message",
  messageId,
  textDelta,
})

/** Record every value a narrow subscription is notified with. */
function trackSelector<T>(store: AppStore, selector: (state: AppState) => T): T[] {
  const seen: T[] = []
  store.subscribeSelector(selector, (value) => seen.push(value))
  return seen
}

describe("createAppStore", () => {
  it("starts both agents empty and idle, unfocused overlays, focus on the first agent", () => {
    const state = createAppStore().getState()
    expect(state.sessions["claude-code"]).toEqual(createSessionState("claude-code", ""))
    expect(state.sessions.codex).toEqual(createSessionState("codex", ""))
    expect(state.focusedAgentId).toBe("claude-code")
    expect(state.overlays).toEqual({ approval: null, handoffPreview: null })
  })

  it("honors pre-bound session ids and an initial focused agent", () => {
    const store = createAppStore({ sessionIds: { codex: "session-codex" }, focusedAgentId: "codex" })
    const state = store.getState()
    expect(state.sessions.codex.sessionId).toBe("session-codex")
    expect(state.sessions["claude-code"].sessionId).toBe("")
    expect(state.focusedAgentId).toBe("codex")
  })
})

describe("applyEvent", () => {
  it("updates only the target agent's slice and leaves the other untouched", () => {
    const store = createAppStore()
    const before = store.getState()

    store.applyEvent("claude-code", message("m1", "hello"))

    const after = store.getState()
    expect(after.sessions["claude-code"].turns).toEqual([{ kind: "agent", messageId: "m1", text: "hello" }])
    expect(after.sessions.codex).toBe(before.sessions.codex)
    expect(after.sessions.codex.turns).toEqual([])
  })

  it("never mutates the prior state", () => {
    const store = createAppStore()
    const before = store.getState()
    const beforeSession = before.sessions["claude-code"]

    store.applyEvent("claude-code", message("m1", "hello"))
    store.applyEvent("claude-code", { kind: "status", status: "working" })

    expect(store.getState()).not.toBe(before)
    expect(before.sessions["claude-code"]).toBe(beforeSession)
    expect(beforeSession.turns).toEqual([])
    expect(beforeSession.status).toBe("idle")
  })

  it("reduces through the core reducer, so derived fields are recomputed", () => {
    const store = createAppStore()

    store.applyEvent("codex", {
      kind: "tool_call",
      call: {
        toolCallId: "call-1",
        kind: "edit",
        title: "Patch parser",
        status: "pending",
        locations: ["src/parser.ts"],
        diff: { path: "src/parser.ts", unified: "@@ -1 +1 @@" },
      },
    })

    const session = store.getState().sessions.codex
    expect(session.pendingDiffs).toEqual([{ toolCallId: "call-1", path: "src/parser.ts", unified: "@@ -1 +1 @@" }])
    expect(session.referencedFiles.get("src/parser.ts")).toBe("edited")
  })

  it("applies each already-coalesced event immediately, without re-batching content", () => {
    const store = createAppStore()
    const turns = trackSelector(store, selectAgentTurns("claude-code"))

    store.applyEvent("claude-code", message("m1", "hel"))
    store.applyEvent("claude-code", message("m1", "lo"))

    expect(turns).toHaveLength(2)
    expect(turns[0]).toEqual([{ kind: "agent", messageId: "m1", text: "hel" }])
    expect(turns[1]).toEqual([{ kind: "agent", messageId: "m1", text: "hello" }])
  })
})

describe("startSession", () => {
  it("binds a new session id and clears that agent's transcript and status", () => {
    const store = createAppStore()
    store.applyEvent("codex", message("m1", "stale"))
    store.applyEvent("codex", { kind: "status", status: "working" })
    const claudeBefore = store.getState().sessions["claude-code"]

    store.startSession("codex", "session-2")

    const state = store.getState()
    expect(state.sessions.codex).toEqual(createSessionState("codex", "session-2"))
    expect(state.sessions["claude-code"]).toBe(claudeBefore)
  })
})

describe("setFocus", () => {
  it("changes the focused agent and nothing else", () => {
    const store = createAppStore()
    const before = store.getState()

    store.setFocus("codex")

    const after = store.getState()
    expect(after.focusedAgentId).toBe("codex")
    expect(after.sessions).toBe(before.sessions)
    expect(after.overlays).toBe(before.overlays)
  })

  it("is a no-op when the agent is already focused", () => {
    const store = createAppStore({ focusedAgentId: "codex" })
    const before = store.getState()
    let notifications = 0
    store.subscribe(() => notifications++)

    store.setFocus("codex")

    expect(store.getState()).toBe(before)
    expect(notifications).toBe(0)
  })
})

describe("overlay slots", () => {
  it("exposes an opened approval request and clears it on close", () => {
    const store = createAppStore()
    const overlay = { agentId: "claude-code" as AgentId, request: APPROVAL_REQUEST }

    store.openApproval(overlay)
    expect(selectApprovalOverlay(store.getState())).toEqual(overlay)

    store.closeApproval()
    expect(selectApprovalOverlay(store.getState())).toBeNull()
  })

  it("exposes an opened hand-off preview and clears it on close", () => {
    const store = createAppStore()
    const overlay = { sourceAgentId: "claude-code" as AgentId, targetAgentId: "codex" as AgentId, bundle: HANDOFF_BUNDLE }

    store.openHandoffPreview(overlay)
    expect(selectHandoffPreview(store.getState())).toEqual(overlay)

    store.closeHandoffPreview()
    expect(selectHandoffPreview(store.getState())).toBeNull()
  })

  it("keeps the two slots independent", () => {
    const store = createAppStore()
    store.openApproval({ agentId: "codex", request: APPROVAL_REQUEST })
    store.openHandoffPreview({ sourceAgentId: "codex", targetAgentId: "claude-code", bundle: HANDOFF_BUNDLE })

    store.closeApproval()

    const overlays = store.getState().overlays
    expect(overlays.approval).toBeNull()
    expect(overlays.handoffPreview?.bundle).toBe(HANDOFF_BUNDLE)
  })

  it("does not notify when closing an already-closed slot", () => {
    const store = createAppStore()
    let notifications = 0
    store.subscribe(() => notifications++)

    store.closeApproval()
    store.closeHandoffPreview()

    expect(notifications).toBe(0)
  })
})

describe("subscriptions", () => {
  it("notifies whole-state subscribers with the new and previous state, until unsubscribed", () => {
    const store = createAppStore()
    const seen: { focused: AgentId; previous: AgentId }[] = []
    const unsubscribe = store.subscribe((state, previous) =>
      seen.push({ focused: state.focusedAgentId, previous: previous.focusedAgentId }),
    )

    store.setFocus("codex")
    unsubscribe()
    store.setFocus("claude-code")

    expect(seen).toEqual([{ focused: "codex", previous: "claude-code" }])
  })

  it("tolerates a listener unsubscribing during notification", () => {
    const store = createAppStore()
    const seen: string[] = []
    const unsubscribeFirst = store.subscribe(() => {
      seen.push("first")
      unsubscribeFirst()
    })
    store.subscribe(() => seen.push("second"))

    store.setFocus("codex")
    store.setFocus("claude-code")

    expect(seen).toEqual(["first", "second", "second"])
  })

  it("does not notify agent A's status subscriber when agent B's status changes", () => {
    const store = createAppStore()
    const claudeStatuses = trackSelector(store, selectAgentStatus("claude-code"))
    const codexStatuses = trackSelector(store, selectAgentStatus("codex"))

    store.applyEvent("codex", { kind: "status", status: "working" })

    expect(claudeStatuses).toEqual([])
    expect(codexStatuses).toEqual(["working"])
  })

  it("does not notify a transcript subscriber when focus or an overlay changes", () => {
    const store = createAppStore()
    const turns = trackSelector(store, selectAgentTurns("claude-code"))

    store.setFocus("codex")
    store.openApproval({ agentId: "codex", request: APPROVAL_REQUEST })

    expect(turns).toEqual([])
  })

  it("does not notify a status subscriber when the same agent only streams tokens", () => {
    const store = createAppStore()
    const statuses = trackSelector(store, selectAgentStatus("claude-code"))

    store.applyEvent("claude-code", message("m1", "tok"))
    store.applyEvent("claude-code", message("m1", "en"))

    expect(statuses).toEqual([])
  })

  it("honors a custom equality function", () => {
    const store = createAppStore()
    const lengths: number[] = []
    store.subscribeSelector(
      selectAgentTurns("claude-code"),
      (turns) => lengths.push(turns.length),
      (a, b) => a.length === b.length,
    )

    store.applyEvent("claude-code", message("m1", "one"))
    store.applyEvent("claude-code", message("m1", " more")) // same turn: length unchanged
    store.applyEvent("claude-code", message("m2", "two")) // new turn

    expect(lengths).toEqual([1, 2])
  })

  it("stops notifying a narrow subscriber after unsubscribe", () => {
    const store = createAppStore()
    const seen: string[] = []
    const unsubscribe = store.subscribeSelector(selectAgentStatus("codex"), (status) => seen.push(status))

    store.applyEvent("codex", { kind: "status", status: "working" })
    unsubscribe()
    store.applyEvent("codex", { kind: "status", status: "idle" })

    expect(seen).toEqual(["working"])
  })
})

describe("integration: a scripted interleaved event stream", () => {
  const script: { agentId: AgentId; event: DomainSessionEvent }[] = [
    { agentId: "claude-code", event: { kind: "user_message", messageId: "u1", text: "Fix the parser" } },
    { agentId: "claude-code", event: { kind: "status", status: "working" } },
    { agentId: "claude-code", event: message("a1", "Looking at ") },
    { agentId: "codex", event: { kind: "user_message", messageId: "u2", text: "Write the tests" } },
    { agentId: "claude-code", event: message("a1", "the parser.") },
    { agentId: "codex", event: { kind: "status", status: "working" } },
    {
      agentId: "claude-code",
      event: {
        kind: "tool_call",
        call: {
          toolCallId: "c1",
          kind: "edit",
          title: "Patch parser",
          status: "pending",
          locations: ["src/parser.ts"],
          diff: { path: "src/parser.ts", unified: "@@ -1 +1 @@" },
        },
      },
    },
    { agentId: "codex", event: { kind: "plan", entries: [{ content: "Add a failing test", status: "in_progress" }] } },
    { agentId: "claude-code", event: { kind: "tool_call", call: { toolCallId: "c1", status: "completed" } } },
    { agentId: "claude-code", event: { kind: "status", status: "idle" } },
    { agentId: "codex", event: message("a2", "Tests written.") },
    { agentId: "codex", event: { kind: "status", status: "awaiting_approval" } },
  ]

  /** Fold one agent's events over a fresh session, independently of the store. */
  const expected = (agentId: AgentId): SessionState =>
    script
      .filter((step) => step.agentId === agentId)
      .map((step) => step.event)
      .reduce(sessionReducer, createSessionState(agentId, `session-${agentId}`))

  it("routes every event to its agent and reduces both sessions correctly", () => {
    const store = createAppStore({
      sessionIds: { "claude-code": "session-claude-code", codex: "session-codex" },
    })

    for (const { agentId, event } of script) {
      store.applyEvent(agentId, event)
    }

    const state = store.getState()
    expect(state.sessions["claude-code"]).toEqual(expected("claude-code"))
    expect(state.sessions.codex).toEqual(expected("codex"))
  })

  it("produces the expected transcript, status, plan, and derived fields per agent", () => {
    const store = createAppStore({
      sessionIds: { "claude-code": "session-claude-code", codex: "session-codex" },
    })
    for (const { agentId, event } of script) {
      store.applyEvent(agentId, event)
    }
    const { sessions } = store.getState()

    const claude = sessions["claude-code"]
    expect(claude.status).toBe("idle")
    expect(claude.turns).toEqual([
      { kind: "user", messageId: "u1", text: "Fix the parser" },
      { kind: "agent", messageId: "a1", text: "Looking at the parser." },
      {
        kind: "tool_call",
        record: {
          toolCallId: "c1",
          kind: "edit",
          title: "Patch parser",
          status: "completed",
          locations: ["src/parser.ts"],
          diff: { path: "src/parser.ts", unified: "@@ -1 +1 @@" },
        },
      },
    ])
    expect(claude.pendingDiffs).toEqual([]) // the edit completed, so nothing is pending
    expect(claude.referencedFiles.get("src/parser.ts")).toBe("edited")
    expect(claude.plan).toEqual([])

    const codex = sessions.codex
    expect(codex.status).toBe("awaiting_approval")
    expect(codex.turns).toEqual([
      { kind: "user", messageId: "u2", text: "Write the tests" },
      { kind: "agent", messageId: "a2", text: "Tests written." },
    ])
    expect(codex.plan).toEqual([{ content: "Add a failing test", status: "in_progress" }])
    expect(codex.referencedFiles.size).toBe(0)
  })

  it("keeps focus and overlays independent of the event stream", () => {
    const store = createAppStore()
    store.setFocus("codex")
    store.openApproval({ agentId: "codex", request: APPROVAL_REQUEST })

    for (const { agentId, event } of script) {
      store.applyEvent(agentId, event)
    }

    const state = store.getState()
    expect(state.focusedAgentId).toBe("codex")
    expect(state.overlays.approval?.request).toBe(APPROVAL_REQUEST)
  })
})
