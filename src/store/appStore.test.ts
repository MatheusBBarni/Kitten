import { describe, expect, it } from "bun:test"

import type { PermissionRequest } from "../agent/agentConnection.ts"
import { createSessionState, sessionReducer } from "../core/sessionReducer.ts"
import { createShellState } from "../core/shellReducer.ts"
import type { DomainSessionEvent, HandoffBundle, SessionId, SessionSeed, SessionState } from "../core/types.ts"
import { createAppStore, defaultSessionSeeds, type AppStore, type AppState } from "./appStore.ts"
import {
  selectApprovalOverlay,
  selectHandoffPreview,
  selectFocusedPane,
  selectHasOpenOverlay,
  selectIsFocused,
  selectRestoration,
  selectRestorationBundle,
  selectSessionPicker,
  selectShell,
  selectSessionStatus,
  selectSessionTurns,
  selectSettingsOverlay,
  selectThemePreference,
} from "./selectors.ts"

/** A default-fleet seed for `id`, optionally bound to an ACP session id. */
const seed = (id: SessionId, acpSessionId = ""): SessionSeed => ({
  ...defaultSessionSeeds().find((s) => s.id === id)!,
  acpSessionId,
})

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
    expect(state.sessions["claude-code"]).toEqual(createSessionState(seed("claude-code")))
    expect(state.sessions.codex).toEqual(createSessionState(seed("codex")))
    expect(state.workspace.order).toEqual(["claude-code", "codex"])
    expect(state.workspace.selectedVisibleId).toBe("claude-code")
    expect(state.focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })
    expect(state.shell).toEqual(createShellState())
    expect(state.overlays).toEqual({
      approval: null,
      handoffPreview: null,
      handoffTarget: null,
      modelSelect: null,
      settings: null,
      tabDialog: null,
      sessions: false,
      sessionPicker: false,
    })
    expect(state.restoration).toEqual({ "claude-code": null, codex: null })
    expect(state.restorationBundle).toBeNull()
    expect(state.preferences).toEqual({ theme: "auto" })
  })

  it("seeds one session per provider with distinct ids, the default cwd, and the provider title", () => {
    const state = createAppStore().getState()

    const claude = state.sessions["claude-code"]!
    const codex = state.sessions.codex!
    expect(claude.id).toBe("claude-code")
    expect(codex.id).toBe("codex")
    expect(claude.id).not.toBe(codex.id)
    expect(claude.providerKind).toBe("claude-code")
    expect(codex.providerKind).toBe("codex")
    expect(claude.title).toBe("Claude Code")
    expect(codex.title).toBe("Codex")
    // The launch directory is the working directory of every default session.
    expect(claude.cwd).toBe(process.cwd())
    expect(codex.cwd).toBe(process.cwd())
    expect(claude.acpSessionId).toBe("")
  })

  it("honors pre-bound session ids and an initial focused session", () => {
    const store = createAppStore({
      seeds: [seed("claude-code"), seed("codex", "session-codex")],
      selectedVisibleId: "codex",
    })
    const state = store.getState()
    expect(state.sessions.codex!.acpSessionId).toBe("session-codex")
    expect(state.sessions["claude-code"]!.acpSessionId).toBe("")
    expect(state.workspace.selectedVisibleId).toBe("codex")
  })

  it("seeds the theme preference from options", () => {
    const store = createAppStore({ preferences: { theme: "dark" } })

    expect(selectThemePreference(store.getState())).toBe("dark")
  })
})

describe("applyEvent", () => {
  it("updates only the target agent's slice and leaves the other untouched", () => {
    const store = createAppStore()
    const before = store.getState()

    store.applyEvent("claude-code", message("m1", "hello"))

    const after = store.getState()
    expect(after.sessions["claude-code"]!.turns).toEqual([{ kind: "agent", messageId: "m1", text: "hello" }])
    expect(after.sessions.codex).toBe(before.sessions.codex)
    expect(after.sessions.codex!.turns).toEqual([])
  })

  it("never mutates the prior state", () => {
    const store = createAppStore()
    const before = store.getState()
    const beforeSession = before.sessions["claude-code"]!

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

    const session = store.getState().sessions.codex!
    expect(session.pendingDiffs).toEqual([{ toolCallId: "call-1", path: "src/parser.ts", unified: "@@ -1 +1 @@" }])
    expect(session.referencedFiles.get("src/parser.ts")).toBe("edited")
  })

  it("applies each already-coalesced event immediately, without re-batching content", () => {
    const store = createAppStore()
    const turns = trackSelector(store, selectSessionTurns("claude-code"))

    store.applyEvent("claude-code", message("m1", "hel"))
    store.applyEvent("claude-code", message("m1", "lo"))

    expect(turns).toHaveLength(2)
    expect(turns[0]).toEqual([{ kind: "agent", messageId: "m1", text: "hel" }])
    expect(turns[1]).toEqual([{ kind: "agent", messageId: "m1", text: "hello" }])
  })
})

describe("applyShellEvent", () => {
  it("updates only the shell slice for a cwd change", () => {
    const store = createAppStore()
    const before = store.getState()

    store.applyShellEvent({ kind: "cwd_changed", cwd: "/workspace/kitten" })

    const after = store.getState()
    expect(after.shell).toEqual({ ...before.shell, cwd: "/workspace/kitten" })
    expect(after.sessions).toBe(before.sessions)
    expect(after.focusedPane).toBe(before.focusedPane)
  })

  it("leaves the shell reference and subscribers untouched for agent events", () => {
    const store = createAppStore()
    const beforeShell = selectShell(store.getState())
    const shells = trackSelector(store, selectShell)

    store.applyEvent("claude-code", message("m1", "hello"))

    expect(selectShell(store.getState())).toBe(beforeShell)
    expect(shells).toEqual([])
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
    expect(state.sessions.codex).toEqual(createSessionState(seed("codex", "session-2")))
    expect(state.sessions["claude-code"]).toBe(claudeBefore)
  })
})

describe("setFocus", () => {
  it("changes the focused agent and nothing else", () => {
    const store = createAppStore()
    const before = store.getState()

    store.setFocus("codex")

    const after = store.getState()
    expect(after.workspace.selectedVisibleId).toBe("codex")
    expect(after.focusedPane).toEqual({ kind: "agent", sessionId: "codex" })
    expect(after.sessions).toBe(before.sessions)
    expect(after.overlays).toBe(before.overlays)
  })

  it("is a no-op when the agent is already focused", () => {
    const store = createAppStore({ selectedVisibleId: "codex" })
    const before = store.getState()
    let notifications = 0
    store.subscribe(() => notifications++)

    store.setFocus("codex")

    expect(store.getState()).toBe(before)
    expect(notifications).toBe(0)
  })

  it("notifies only the focus subscribers whose flag changed, leaving session slices identical", () => {
    const store = createAppStore()
    const before = store.getState()
    const claudeFocus = trackSelector(store, selectIsFocused("claude-code"))
    const codexFocus = trackSelector(store, selectIsFocused("codex"))
    const claudeTurns = trackSelector(store, selectSessionTurns("claude-code"))

    store.setFocus("codex")

    // Both focus flags flipped, so both are notified once - but nothing else moved.
    expect(claudeFocus).toEqual([false])
    expect(codexFocus).toEqual([true])
    expect(claudeTurns).toEqual([])
    const after = store.getState()
    expect(after.sessions["claude-code"]).toBe(before.sessions["claude-code"])
    expect(after.sessions.codex).toBe(before.sessions.codex)
  })

  it("ignores a focus request for a session that does not exist", () => {
    const store = createAppStore()
    const before = store.getState()

    store.setFocus("ghost")

    expect(store.getState()).toBe(before)
    expect(store.getState().workspace.selectedVisibleId).toBe("claude-code")
  })
})

describe("setFocusedPane", () => {
  it("is a no-op when the semantic pane is unchanged", () => {
    const store = createAppStore()
    const before = store.getState()
    let notifications = 0
    store.subscribe(() => notifications++)

    store.setFocusedPane({ kind: "agent", sessionId: "claude-code" })

    expect(store.getState()).toBe(before)
    expect(notifications).toBe(0)
  })

  it("notifies a focused-pane subscriber exactly once when switching to the shell", () => {
    const store = createAppStore()
    const panes = trackSelector(store, selectFocusedPane)

    store.setFocusedPane({ kind: "shell" })
    store.setFocusedPane({ kind: "shell" })

    expect(panes).toEqual([{ kind: "shell" }])
    expect(store.getState().workspace.selectedVisibleId).toBe("claude-code")
  })

  it("ignores an agent pane whose session does not exist", () => {
    const store = createAppStore()
    const before = store.getState()

    store.setFocusedPane({ kind: "agent", sessionId: "ghost" })

    expect(store.getState()).toBe(before)
  })
})

describe("overlay slots", () => {
  it("exposes an opened approval request and clears it on close", () => {
    const store = createAppStore()
    const overlay = { sessionId: "claude-code" as SessionId, title: "Claude Code", cwd: "/workspace/kitten", request: APPROVAL_REQUEST }

    store.openApproval(overlay)
    expect(selectApprovalOverlay(store.getState())).toEqual(overlay)

    store.closeApproval()
    expect(selectApprovalOverlay(store.getState())).toBeNull()
  })

  it("exposes an opened hand-off preview and clears it on close", () => {
    const store = createAppStore()
    const overlay = {
      sourceSessionId: "claude-code" as SessionId,
      targetSessionId: "codex" as SessionId,
      bundle: HANDOFF_BUNDLE,
      targetConfigOptions: [],
    }

    store.openHandoffPreview(overlay)
    expect(selectHandoffPreview(store.getState())).toEqual(overlay)

    store.closeHandoffPreview()
    expect(selectHandoffPreview(store.getState())).toBeNull()
  })

  it("keeps the two slots independent", () => {
    const store = createAppStore()
    store.openApproval({ sessionId: "codex", title: "Codex", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })
    store.openHandoffPreview({ sourceSessionId: "codex", targetSessionId: "claude-code", bundle: HANDOFF_BUNDLE, targetConfigOptions: [] })

    store.closeApproval()

    const overlays = store.getState().overlays
    expect(overlays.approval).toBeNull()
    expect(overlays.handoffPreview?.bundle).toBe(HANDOFF_BUNDLE)
  })

  it("exposes an opened model selector and clears it on close", () => {
    const store = createAppStore()
    const overlay = { sessionId: "codex" as SessionId }

    store.openModelSelect(overlay)
    expect(store.getState().overlays.modelSelect).toEqual(overlay)

    store.closeModelSelect()
    expect(store.getState().overlays.modelSelect).toBeNull()
  })

  it("keeps the model selector independent of the approval slot", () => {
    const store = createAppStore()
    store.openApproval({ sessionId: "codex", title: "Codex", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })
    store.openModelSelect({ sessionId: "claude-code" })

    store.closeModelSelect()

    const overlays = store.getState().overlays
    expect(overlays.modelSelect).toBeNull()
    expect(overlays.approval?.sessionId).toBe("codex")
  })

  it("opens settings without changing the other overlay-slot identities", () => {
    const store = createAppStore()
    store.openApproval({ sessionId: "codex", title: "Codex", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })
    store.openHandoffPreview({ sourceSessionId: "codex", targetSessionId: "claude-code", bundle: HANDOFF_BUNDLE, targetConfigOptions: [] })
    const before = store.getState()

    store.openSettings()

    const after = store.getState()
    expect(selectSettingsOverlay(after)).toEqual({ tab: "theme" })
    expect(after.overlays.approval).toBe(before.overlays.approval)
    expect(after.overlays.handoffPreview).toBe(before.overlays.handoffPreview)
    expect(after.sessions).toBe(before.sessions)
    expect(after.preferences).toBe(before.preferences)
  })

  it("opens and closes the sessions overview", () => {
    const store = createAppStore()
    expect(store.getState().overlays.sessions).toBe(false)

    store.openSessions()
    expect(store.getState().overlays.sessions).toBe(true)

    store.closeSessions()
    expect(store.getState().overlays.sessions).toBe(false)
  })

  it("leaves the payload slots untouched when the overview opens", () => {
    const store = createAppStore()
    store.openApproval({ sessionId: "claude-code", title: "Claude Code", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })

    store.openSessions()

    const overlays = store.getState().overlays
    expect(overlays.sessions).toBe(true)
    expect(overlays.approval?.sessionId).toBe("claude-code")
  })

  it("opens and closes the session picker without clobbering payload slots", () => {
    const store = createAppStore()
    store.openApproval({ sessionId: "codex", title: "Codex", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })
    store.openHandoffPreview({ sourceSessionId: "codex", targetSessionId: "claude-code", bundle: HANDOFF_BUNDLE, targetConfigOptions: [] })
    const before = store.getState()

    store.openSessionPicker()

    const opened = store.getState()
    expect(selectSessionPicker(opened)).toBe(true)
    expect(selectHasOpenOverlay(opened)).toBe(true)
    expect(opened.overlays.approval).toBe(before.overlays.approval)
    expect(opened.overlays.handoffPreview).toBe(before.overlays.handoffPreview)
    expect(opened.sessions).toBe(before.sessions)
    expect(opened.restoration).toBe(before.restoration)

    store.closeSessionPicker()
    const closed = store.getState()
    expect(selectSessionPicker(closed)).toBe(false)
    expect(closed.overlays.approval).toBe(before.overlays.approval)
    expect(closed.overlays.handoffPreview).toBe(before.overlays.handoffPreview)
  })

  it("clears the overlay gate when the session picker was the only open slot", () => {
    const store = createAppStore()
    store.openSessionPicker()

    store.closeSessionPicker()

    expect(selectSessionPicker(store.getState())).toBe(false)
    expect(selectHasOpenOverlay(store.getState())).toBe(false)
  })

  it("does not notify when closing an already-closed slot", () => {
    const store = createAppStore()
    const before = store.getState()
    let notifications = 0
    store.subscribe(() => notifications++)

    store.closeApproval()
    store.closeHandoffPreview()
    store.closeModelSelect()
    store.closeSettings()
    store.closeSessions()
    store.closeSessionPicker()

    expect(store.getState()).toBe(before)
    expect(notifications).toBe(0)
  })

  it("does not notify when opening an already-open overview", () => {
    const store = createAppStore()
    store.openSessions()
    let notifications = 0
    store.subscribe(() => notifications++)

    store.openSessions()

    expect(notifications).toBe(0)
  })
})

describe("restoration state", () => {
  it("defaults every seeded session to no restoration status", () => {
    const store = createAppStore()

    expect(selectRestoration("claude-code")(store.getState())).toBeNull()
    expect(selectRestoration("codex")(store.getState())).toBeNull()
  })

  it("sets one session's restoration status without changing sibling state", () => {
    const store = createAppStore()
    const before = store.getState()

    store.setRestoration("codex", "unavailable")

    const after = store.getState()
    expect(selectRestoration("codex")(after)).toBe("unavailable")
    expect(selectRestoration("claude-code")(after)).toBeNull()
    expect(after.sessions).toBe(before.sessions)
    expect(after.overlays).toBe(before.overlays)
  })

  it("stores the persisted hand-off bundle without changing session state", () => {
    const store = createAppStore()
    const before = store.getState()

    store.setRestorationBundle(HANDOFF_BUNDLE)

    const after = store.getState()
    expect(selectRestorationBundle(after)).toBe(HANDOFF_BUNDLE)
    expect(after.sessions).toBe(before.sessions)
    expect(after.restoration).toBe(before.restoration)

    store.setRestorationBundle(HANDOFF_BUNDLE)
    expect(store.getState()).toBe(after)
  })

  it("ignores unknown sessions and unchanged restoration values", () => {
    const store = createAppStore()
    const initial = store.getState()

    store.setRestoration("ghost", "live")
    expect(store.getState()).toBe(initial)

    store.setRestoration("codex", "live")
    const live = store.getState()
    store.setRestoration("codex", "live")
    expect(store.getState()).toBe(live)
  })
})

describe("preferences", () => {
  it("changes only preferences and preserves state identity for an unchanged theme", () => {
    const store = createAppStore()
    const before = store.getState()

    store.setThemePreference("dark")

    const afterChange = store.getState()
    expect(afterChange.preferences).toEqual({ theme: "dark" })
    expect(afterChange.preferences).not.toBe(before.preferences)
    expect(afterChange.sessions).toBe(before.sessions)
    expect(afterChange.overlays).toBe(before.overlays)
    expect(afterChange.workspace.selectedVisibleId).toBe(before.workspace.selectedVisibleId)

    store.setThemePreference("dark")

    expect(store.getState()).toBe(afterChange)
  })

  it("does not notify an unrelated session-turns subscriber when settings or theme changes", () => {
    const store = createAppStore()
    const turns = trackSelector(store, selectSessionTurns("claude-code"))

    store.openSettings()
    store.setThemePreference("dark")
    store.closeSettings()

    expect(turns).toEqual([])
  })
})

describe("integration: settings preference flow", () => {
  it("opens settings, changes the theme, and closes settings without cross-slice changes", () => {
    const store = createAppStore()
    const initial = store.getState()

    store.openSettings()
    const opened = store.getState()
    expect(opened.overlays.settings).toEqual({ tab: "theme" })
    expect(opened.preferences).toBe(initial.preferences)
    expect(opened.sessions).toBe(initial.sessions)
    expect(opened.workspace.selectedVisibleId).toBe(initial.workspace.selectedVisibleId)

    store.setThemePreference("dark")
    const themed = store.getState()
    expect(themed.preferences).toEqual({ theme: "dark" })
    expect(themed.overlays).toBe(opened.overlays)
    expect(themed.sessions).toBe(opened.sessions)
    expect(themed.workspace.selectedVisibleId).toBe(opened.workspace.selectedVisibleId)

    store.closeSettings()
    const closed = store.getState()
    expect(closed.overlays.settings).toBeNull()
    expect(closed.preferences).toBe(themed.preferences)
    expect(closed.sessions).toBe(themed.sessions)
    expect(closed.workspace.selectedVisibleId).toBe(themed.workspace.selectedVisibleId)
  })
})

describe("subscriptions", () => {
  it("notifies whole-state subscribers with the new and previous state, until unsubscribed", () => {
    const store = createAppStore()
    const seen: { focused: SessionId; previous: SessionId }[] = []
    const unsubscribe = store.subscribe((state, previous) =>
      seen.push({ focused: state.workspace.selectedVisibleId!, previous: previous.workspace.selectedVisibleId! }),
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
    const claudeStatuses = trackSelector(store, selectSessionStatus("claude-code"))
    const codexStatuses = trackSelector(store, selectSessionStatus("codex"))

    store.applyEvent("codex", { kind: "status", status: "working" })

    expect(claudeStatuses).toEqual([])
    expect(codexStatuses).toEqual(["working"])
  })

  it("does not notify a transcript subscriber when focus or an overlay changes", () => {
    const store = createAppStore()
    const turns = trackSelector(store, selectSessionTurns("claude-code"))

    store.setFocus("codex")
    store.openApproval({ sessionId: "codex", title: "Codex", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })

    expect(turns).toEqual([])
  })

  it("does not notify a status subscriber when the same agent only streams tokens", () => {
    const store = createAppStore()
    const statuses = trackSelector(store, selectSessionStatus("claude-code"))

    store.applyEvent("claude-code", message("m1", "tok"))
    store.applyEvent("claude-code", message("m1", "en"))

    expect(statuses).toEqual([])
  })

  it("honors a custom equality function", () => {
    const store = createAppStore()
    const lengths: number[] = []
    store.subscribeSelector(
      selectSessionTurns("claude-code"),
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
    const unsubscribe = store.subscribeSelector(selectSessionStatus("codex"), (status) => seen.push(status))

    store.applyEvent("codex", { kind: "status", status: "working" })
    unsubscribe()
    store.applyEvent("codex", { kind: "status", status: "idle" })

    expect(seen).toEqual(["working"])
  })
})

describe("integration: a scripted interleaved event stream", () => {
  const script: { sessionId: SessionId; event: DomainSessionEvent }[] = [
    { sessionId: "claude-code", event: { kind: "user_message", messageId: "u1", text: "Fix the parser" } },
    { sessionId: "claude-code", event: { kind: "status", status: "working" } },
    { sessionId: "claude-code", event: message("a1", "Looking at ") },
    { sessionId: "codex", event: { kind: "user_message", messageId: "u2", text: "Write the tests" } },
    { sessionId: "claude-code", event: message("a1", "the parser.") },
    { sessionId: "codex", event: { kind: "status", status: "working" } },
    {
      sessionId: "claude-code",
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
    { sessionId: "codex", event: { kind: "plan", entries: [{ content: "Add a failing test", status: "in_progress" }] } },
    { sessionId: "claude-code", event: { kind: "tool_call", call: { toolCallId: "c1", status: "completed" } } },
    { sessionId: "claude-code", event: { kind: "status", status: "idle" } },
    { sessionId: "codex", event: message("a2", "Tests written.") },
    { sessionId: "codex", event: { kind: "status", status: "awaiting_approval" } },
  ]

  /** Fold one session's events over a fresh session, independently of the store. */
  const expected = (sessionId: SessionId): SessionState =>
    script
      .filter((step) => step.sessionId === sessionId)
      .map((step) => step.event)
      .reduce(sessionReducer, createSessionState(seed(sessionId, `session-${sessionId}`)))

  it("routes every event to its session and reduces both sessions correctly", () => {
    const store = createAppStore({
      seeds: [seed("claude-code", "session-claude-code"), seed("codex", "session-codex")],
    })

    for (const { sessionId, event } of script) {
      store.applyEvent(sessionId, event)
    }

    const state = store.getState()
    expect(state.sessions["claude-code"]).toEqual(expected("claude-code"))
    expect(state.sessions.codex).toEqual(expected("codex"))
  })

  it("produces the expected transcript, status, plan, and derived fields per session", () => {
    const store = createAppStore({
      seeds: [seed("claude-code", "session-claude-code"), seed("codex", "session-codex")],
    })
    for (const { sessionId, event } of script) {
      store.applyEvent(sessionId, event)
    }
    const { sessions } = store.getState()

    const claude = sessions["claude-code"]!
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

    const codex = sessions.codex!
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
    store.openApproval({ sessionId: "codex", title: "Codex", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })

    for (const { sessionId, event } of script) {
      store.applyEvent(sessionId, event)
    }

    const state = store.getState()
    expect(state.workspace.selectedVisibleId).toBe("codex")
    expect(state.overlays.approval?.request).toBe(APPROVAL_REQUEST)
  })
})

describe("integration: shell and agent selector isolation", () => {
  it("notifies only the selector matching each interleaved event", () => {
    const store = createAppStore()
    const shellCwds: string[] = []
    const agentStatuses: string[] = []
    store.subscribeSelector(selectShell, (shell) => shellCwds.push(shell.cwd))
    store.subscribeSelector(selectSessionStatus("claude-code"), (status) => agentStatuses.push(status))

    store.applyShellEvent({ kind: "cwd_changed", cwd: "/one" })
    store.applyEvent("claude-code", { kind: "status", status: "working" })
    store.applyShellEvent({ kind: "cwd_changed", cwd: "/two" })
    store.applyEvent("claude-code", message("m1", "streamed output"))

    expect(shellCwds).toEqual(["/one", "/two"])
    expect(agentStatuses).toEqual(["working"])
  })
})

describe("workspace lifecycle integration", () => {
  it("represents an empty workspace without an invalid agent pane", () => {
    const store = createAppStore({ seeds: [] })

    expect(store.getState().sessions).toEqual({})
    expect(store.getState().workspace).toEqual({
      conversations: {},
      order: [],
      selectedVisibleId: null,
    })
    expect(store.getState().focusedPane).toEqual({ kind: "workspace" })
  })

  it("atomically inserts and removes a dynamic execution slice and workspace entry", () => {
    const store = createAppStore({ seeds: [] })
    const dynamic: SessionSeed = {
      id: "dynamic",
      providerKind: "codex",
      title: "Dynamic",
      cwd: "/work/dynamic",
    }

    store.addSession(dynamic, { displayName: "Parser", availability: { kind: "ready" } })
    const inserted = store.getState()
    expect(inserted.sessions.dynamic).toEqual(createSessionState(dynamic))
    expect(inserted.workspace.conversations.dynamic).toMatchObject({
      displayName: "Parser",
      lifecycle: "visible",
      availability: { kind: "ready" },
    })
    expect(inserted.workspace.selectedVisibleId).toBe("dynamic")
    expect(inserted.focusedPane).toEqual({ kind: "agent", sessionId: "dynamic" })

    store.removeSession("dynamic")
    const removed = store.getState()
    expect(removed.sessions.dynamic).toBeUndefined()
    expect(removed.workspace.conversations.dynamic).toBeUndefined()
    expect(removed.workspace.selectedVisibleId).toBeNull()
    expect(removed.focusedPane).toEqual({ kind: "workspace" })
  })

  it("preserves SessionState through rename, background, reopen, teardown, and availability", () => {
    const store = createAppStore()
    const session = store.getState().sessions["claude-code"]!

    store.renameConversation("claude-code", "Compiler")
    store.backgroundConversation("claude-code")
    store.reopenConversation("claude-code")
    store.setConversationTeardown("claude-code", "closing")
    store.setConversationAvailability("claude-code", {
      kind: "unavailable",
      reasonCode: "teardown-failed",
      retryable: true,
    })

    expect(store.getState().sessions["claude-code"]).toBe(session)
    expect(store.getState().workspace.conversations["claude-code"]).toMatchObject({
      displayName: "Compiler",
      lifecycle: "visible",
      teardownState: "closing",
      availability: {
        kind: "unavailable",
        reasonCode: "teardown-failed",
        retryable: true,
      },
    })
  })

  it("creates attention epochs and acknowledges only the selected current epoch", () => {
    const store = createAppStore()

    store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    expect(store.getState().sessions.codex?.status).toBe("awaiting_approval")
    expect(store.getState().workspace.conversations.codex?.attention).toEqual({
      status: "awaiting_approval",
      seen: false,
      sequence: 1,
    })

    store.setFocus("codex")
    expect(store.getState().sessions.codex?.status).toBe("awaiting_approval")
    expect(store.getState().workspace.conversations.codex?.attention.seen).toBe(true)

    store.applyEvent("codex", { kind: "status", status: "working" })
    store.applyEvent("codex", { kind: "status", status: "error" })
    expect(store.getState().workspace.conversations.codex?.attention).toEqual({
      status: "error",
      seen: false,
      sequence: 2,
    })
  })

  it("keeps a background approval attributed while another conversation is selected", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", { kind: "status", status: "awaiting_approval" })
    store.backgroundConversation("claude-code")
    store.openApproval({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      request: APPROVAL_REQUEST,
    })

    expect(store.getState().workspace.selectedVisibleId).toBe("codex")
    expect(store.getState().workspace.conversations["claude-code"]?.lifecycle).toBe("background")
    expect(store.getState().workspace.conversations["claude-code"]?.attention.seen).toBe(false)
    expect(store.getState().overlays.approval?.sessionId).toBe("claude-code")
  })

  it("suppresses focus changes under overlays and retains captured target identity", () => {
    const store = createAppStore()
    store.openTabDialog({ kind: "rename", sessionId: "claude-code" })
    store.setFocus("codex")
    expect(store.getState().workspace.selectedVisibleId).toBe("claude-code")
    expect(store.getState().overlays.tabDialog).toEqual({
      kind: "rename",
      sessionId: "claude-code",
    })

    store.openApproval({
      sessionId: "codex",
      title: "Codex",
      cwd: "/workspace/kitten",
      request: APPROVAL_REQUEST,
    })
    store.openTabDialog({ kind: "close", sessionId: "codex" })
    expect(store.getState().overlays.tabDialog).toEqual({
      kind: "rename",
      sessionId: "claude-code",
    })
    expect(store.getState().overlays.approval?.sessionId).toBe("codex")
  })
})
