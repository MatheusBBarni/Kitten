import { describe, expect, it } from "bun:test"

import type { AvailableCommand, ConfigOption, DomainSessionEvent, HandoffBundle } from "../core/types.ts"
import { createAppStore, type AppStore } from "./appStore.ts"
import {
  needsAttention,
  selectAgentConfigOptions,
  selectAgentEffort,
  selectAgentModel,
  selectNextNeedy,
  selectSessionList,
  selectSessionBranch,
  selectSessionContext,
  selectSessionModel,
  selectRestoration,
  selectSessionPendingDiffs,
  selectSessionPlan,
  selectSessionPromptHistory,
  selectSessionCommands,
  selectSessionReferencedFiles,
  selectSessionState,
  selectSessionHeadroom,
  selectSessionStatus,
  selectSessionTurns,
  selectApprovalOverlay,
  selectFocusedPane,
  selectFocusedSessionId,
  selectFocusedSession,
  selectHandoffPreview,
  selectHasOpenOverlay,
  selectIsApprovalOpen,
  selectIsFocused,
  selectIsShellFocused,
  selectIsSessionsOpen,
  selectSessionPicker,
  selectModelSelectOverlay,
  selectSettingsOverlay,
  selectShell,
  selectThemePreference,
  selectActiveModal,
  selectAttentionQueue,
  selectBackgroundWork,
  selectDuplicateLabels,
  selectNextAttention,
  selectSharedWorkspaces,
  selectTabDialogOverlay,
  selectVisibleTabs,
} from "./selectors.ts"

/** A model + effort config-option pair, as an agent advertises them. */
const MODEL_OPTION: ConfigOption = {
  id: "model",
  category: "model",
  label: "Model",
  currentValue: "opus",
  options: [
    { value: "opus", name: "Opus" },
    { value: "sonnet", name: "Sonnet" },
  ],
}

const EFFORT_OPTION: ConfigOption = {
  id: "effort",
  category: "thought_level",
  label: "Reasoning effort",
  currentValue: "medium",
  options: [
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
  ],
}

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
    expect(selectFocusedSession(store.getState())?.providerKind).toBe("claude-code")

    store.setFocus("codex")
    expect(selectFocusedSession(store.getState())?.acpSessionId).toBe("session-codex")
  })

  it("projects pane focus and reports shell focus only for the shell pane", () => {
    const store = createAppStore()
    expect(selectFocusedPane(store.getState())).toBe(store.getState().focusedPane)
    expect(selectIsShellFocused(store.getState())).toBe(false)

    store.setFocusedPane({ kind: "shell" })
    expect(selectFocusedPane(store.getState())).toEqual({ kind: "shell" })
    expect(selectIsShellFocused(store.getState())).toBe(true)
    expect(selectIsFocused("claude-code")(store.getState())).toBe(false)

    store.setFocusedPane({ kind: "agent", sessionId: "codex" })
    expect(selectIsShellFocused(store.getState())).toBe(false)
  })
})

describe("shell selector", () => {
  it("returns the shell slice by reference across unrelated agent updates", () => {
    const store = createAppStore()
    const shell = selectShell(store.getState())

    store.applyEvent("claude-code", { kind: "status", status: "working" })

    expect(selectShell(store.getState())).toBe(shell)
  })
})

describe("preference selectors", () => {
  it("projects the default and configured theme preference", () => {
    const defaultStore = createAppStore()
    const configuredStore = createAppStore({ preferences: { theme: "dark" } })

    expect(selectThemePreference(defaultStore.getState())).toBe("auto")
    expect(selectThemePreference(configuredStore.getState())).toBe("dark")
  })
})

describe("per-agent session selectors", () => {
  it("project the slice each view renders", () => {
    const store = createAppStore()
    store.applyEvent("codex", { kind: "status", status: "working" })
    store.applyEvent("codex", { kind: "agent_message", messageId: "m1", textDelta: "hi" })
    store.applyEvent("codex", { kind: "plan", entries: [{ content: "Step one" }] })
    store.applyEvent("codex", { kind: "commands", commands: [{ name: "review", description: "Review changes" }] })
    store.applyEvent("codex", EDIT_CALL)
    const state = store.getState()

    expect(selectSessionState("codex")(state)).toBe(state.sessions.codex!)
    expect(selectSessionStatus("codex")(state)).toBe("working")
    expect(selectSessionTurns("codex")(state)).toHaveLength(2)
    expect(selectSessionPlan("codex")(state)).toEqual([{ content: "Step one" }])
    expect(selectSessionCommands("codex")(state)).toEqual([{ name: "review", description: "Review changes" }])
    expect(selectSessionPendingDiffs("codex")(state)).toEqual([
      { toolCallId: "c1", path: "src/parser.ts", unified: "@@ -1 +1 @@" },
    ])
    expect(selectSessionReferencedFiles("codex")(state)).toEqual(new Map([["src/parser.ts", "edited"]]))
  })

  it("returns a stored branch and hides it when unresolved", () => {
    const state = createAppStore().getState()
    expect(selectSessionBranch("claude-code")(state)).toBeNull()

    const withBranch = {
      ...state,
      sessions: {
        ...state.sessions,
        "claude-code": { ...state.sessions["claude-code"]!, branch: "feature/status-bar" },
      },
    }
    expect(selectSessionBranch("claude-code")(withBranch)).toBe("feature/status-bar")
  })

  it("derives rounded remaining-context headroom from reported usage", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    store.applyEvent("codex", { kind: "usage", used: 200_000, size: 200_000 })

    expect(selectSessionHeadroom("claude-code")(store.getState())).toBe(38)
    expect(selectSessionHeadroom("codex")(store.getState())).toBe(0)
  })

  it("returns null when usage is absent or its size is not positive", () => {
    const store = createAppStore()
    expect(selectSessionHeadroom("claude-code")(store.getState())).toBeNull()

    store.applyEvent("claude-code", { kind: "usage", used: 0, size: 0 })
    store.applyEvent("codex", { kind: "usage", used: 0, size: -1 })

    expect(selectSessionHeadroom("claude-code")(store.getState())).toBeNull()
    expect(selectSessionHeadroom("codex")(store.getState())).toBeNull()
  })

  it("preserves another agent's headroom value and session identity across a usage update", () => {
    const store = createAppStore()
    const before = store.getState()
    const codexHeadroom = selectSessionHeadroom("codex")
    const beforeHeadroom = codexHeadroom(before)

    store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })

    const after = store.getState()
    expect(codexHeadroom(after)).toBe(beforeHeadroom)
    expect(selectSessionState("codex")(after)).toBe(before.sessions.codex!)
  })

  it("keeps delegated model and context slots hidden", () => {
    const state = createAppStore().getState()
    expect(selectSessionModel("claude-code")(state)).toBeNull()
    expect(selectSessionContext("claude-code")(state)).toBeNull()
  })

  it("returns stable slot values from memoized per-session selectors", () => {
    const base = createAppStore().getState()
    const before = {
      ...base,
      sessions: {
        ...base.sessions,
        "claude-code": { ...base.sessions["claude-code"]!, branch: "feature/status-bar" },
      },
    }
    const after = {
      ...before,
      workspace: { ...before.workspace, selectedVisibleId: "codex" },
    }
    const branch = selectSessionBranch("claude-code")
    const model = selectSessionModel("claude-code")
    const context = selectSessionContext("claude-code")

    expect(branch(after)).toBe(branch(before))
    expect(model(after)).toBe(model(before))
    expect(context(after)).toBe(context(before))
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
    expect(selectSessionCommands("claude-code")(after)).toBe(selectSessionCommands("claude-code")(before))
    expect(selectSessionStatus("claude-code")(after)).toBe(selectSessionStatus("claude-code")(before))
    expect(selectSessionTurns("claude-code")(after)).not.toBe(selectSessionTurns("claude-code")(before))
  })
})

describe("selectSessionPromptHistory", () => {
  it("projects the addressed session history and stays stable across unrelated updates", () => {
    const store = createAppStore()
    const selectHistory = selectSessionPromptHistory("claude-code")
    const initialHistory = selectHistory(store.getState())

    expect(initialHistory).toEqual({ entries: [], cursor: null })

    store.applyEvent("claude-code", { kind: "status", status: "working" })
    expect(selectHistory(store.getState())).toBe(initialHistory)

    store.applyEvent("claude-code", {
      kind: "agent_message",
      messageId: "m1",
      textDelta: "streamed output",
    })
    expect(selectHistory(store.getState())).toBe(initialHistory)

    store.applyShellEvent({ kind: "cwd_changed", cwd: "/workspace/kitten" })
    expect(selectHistory(store.getState())).toBe(initialHistory)

    store.setThemePreference("dark")
    expect(selectHistory(store.getState())).toBe(initialHistory)
  })

  it("changes only for history events in the selected session", () => {
    const store = createAppStore()
    const selectClaudeHistory = selectSessionPromptHistory("claude-code")
    const before = selectClaudeHistory(store.getState())

    store.applyEvent("codex", { kind: "prompt_history", action: "record", text: "codex only" })
    expect(selectClaudeHistory(store.getState())).toBe(before)

    store.applyEvent("claude-code", {
      kind: "prompt_history",
      action: "record",
      text: "claude only",
    })
    expect(selectClaudeHistory(store.getState())).toEqual({
      entries: ["claude only"],
      cursor: null,
    })
    expect(selectClaudeHistory(store.getState())).not.toBe(before)
  })

  it("returns one stable empty fallback when no session is selected", () => {
    const selectHistory = selectSessionPromptHistory(null)
    const first = selectHistory(createAppStore().getState())
    const second = selectHistory(createAppStore({ seeds: [] }).getState())

    expect(first).toEqual({ entries: [], cursor: null })
    expect(second).toBe(first)
  })
})

describe("selectSessionCommands", () => {
  const commands: AvailableCommand[] = [
    { name: "review", description: "Review the current diff", hint: "[scope]" },
    { name: "test", description: "Run the test suite" },
  ]

  it("returns a session's advertised commands after a commands event", () => {
    const store = createAppStore()

    store.applyEvent("claude-code", { kind: "commands", commands })

    expect(selectSessionCommands("claude-code")(store.getState())).toBe(commands)
  })

  it("returns an empty list for a freshly created session", () => {
    const store = createAppStore()

    expect(selectSessionCommands("claude-code")(store.getState())).toEqual([])
  })

  it("preserves the list reference across an unrelated update to the same session", () => {
    const store = createAppStore()
    const selectCommands = selectSessionCommands("claude-code")
    store.applyEvent("claude-code", { kind: "commands", commands })
    const before = selectCommands(store.getState())

    store.applyEvent("claude-code", { kind: "status", status: "working" })

    expect(Object.is(selectCommands(store.getState()), before)).toBe(true)
  })

  it("preserves another session's list reference when commands change", () => {
    const store = createAppStore()
    const selectCodexCommands = selectSessionCommands("codex")
    const before = selectCodexCommands(store.getState())

    store.applyEvent("claude-code", { kind: "commands", commands })

    expect(Object.is(selectCodexCommands(store.getState()), before)).toBe(true)
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
    expect(needsAttention("awaiting_clarification")).toBe(true)
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
    expect(list[0]).toMatchObject({
      id: "a",
      title: "A",
      label: "A",
      providerKind: "claude-code",
      lifecycle: "visible",
      selected: true,
      attentionSeen: true,
    })
  })

  it("exposes background lifecycle and duplicate labels in workspace order", () => {
    const store = fleetStore()
    store.renameConversation("a", "Work")
    store.renameConversation("b", "Work")
    store.backgroundConversation("b")

    expect(selectSessionList(store.getState()).map(({ id, label, lifecycle }) => ({ id, label, lifecycle }))).toEqual([
      { id: "a", label: "Work (1)", lifecycle: "visible" },
      { id: "b", label: "Work (2)", lifecycle: "background" },
      { id: "c", label: "C", lifecycle: "visible" },
    ])
  })

  it("excludes a Closed conversation from the universal session list", () => {
    const store = fleetStore()
    store.removeSession("b")

    expect(selectSessionList(store.getState()).map((item) => item.id)).toEqual(["a", "c"])
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
  it("returns clarification ahead of simultaneous approval, error, and finished sessions", () => {
    const store = createAppStore({
      seeds: [
        { id: "pivot", providerKind: "claude-code", title: "Pivot", cwd: "/w" },
        { id: "done", providerKind: "codex", title: "Done", cwd: "/w" },
        { id: "failed", providerKind: "claude-code", title: "Failed", cwd: "/w" },
        { id: "approval", providerKind: "codex", title: "Approval", cwd: "/w" },
        { id: "clarification", providerKind: "claude-code", title: "Clarification", cwd: "/w" },
      ],
    })
    store.applyEvent("done", { kind: "status", status: "finished" })
    store.applyEvent("failed", { kind: "status", status: "error" })
    store.applyEvent("approval", { kind: "status", status: "awaiting_approval" })
    store.applyEvent("clarification", { kind: "status", status: "awaiting_clarification" })

    expect(selectNextNeedy("pivot")(store.getState())).toBe("clarification")
  })

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
    expect(selectSettingsOverlay(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(false)
    expect(selectIsApprovalOpen(state)).toBe(false)
    expect(selectIsSessionsOpen(state)).toBe(false)
    expect(selectSessionPicker(state)).toBe(false)
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

  it("reports an open session picker as an open, modal overlay", () => {
    const store = createAppStore()
    store.openSessionPicker()
    const state = store.getState()

    expect(selectSessionPicker(state)).toBe(true)
    expect(selectHasOpenOverlay(state)).toBe(true)
    expect(selectIsApprovalOpen(state)).toBe(false)
    expect(selectApprovalOverlay(state)).toBeNull()
    expect(selectHandoffPreview(state)).toBeNull()
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
    store.openHandoffPreview({ sourceSessionId: "claude-code", targetSessionId: "codex", bundle: HANDOFF_BUNDLE, targetConfigOptions: [] })

    expect(selectHasOpenOverlay(store.getState())).toBe(true)
    expect(selectIsApprovalOpen(store.getState())).toBe(false)
  })

  it("report an open hand-off preview", () => {
    const store = createAppStore()
    store.openHandoffPreview({ sourceSessionId: "claude-code", targetSessionId: "codex", bundle: HANDOFF_BUNDLE, targetConfigOptions: [] })
    const state = store.getState()

    expect(selectHandoffPreview(state)?.bundle).toBe(HANDOFF_BUNDLE)
    expect(selectApprovalOverlay(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(true)
  })

  it("report an open model selector as an open, modal overlay", () => {
    const store = createAppStore({ selectedVisibleId: "codex" })
    store.openModelSelect({ sessionId: "codex" })
    const state = store.getState()

    expect(selectModelSelectOverlay(state)?.sessionId).toBe("codex")
    expect(selectHasOpenOverlay(state)).toBe(true)
    expect(selectIsApprovalOpen(state)).toBe(false)
  })

  it("reports settings as an open overlay when it is the only open slot", () => {
    const store = createAppStore()
    store.openSettings()
    const state = store.getState()

    expect(selectSettingsOverlay(state)).toEqual({ tab: "theme" })
    expect(selectHasOpenOverlay(state)).toBe(true)
    expect(selectIsApprovalOpen(state)).toBe(false)
  })

  it("report the model selector closed as null and no open overlay", () => {
    const state = createAppStore().getState()
    expect(selectModelSelectOverlay(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(false)
  })
})

describe("config-option selectors", () => {
  it("return the current model, or undefined when no model category is advertised", () => {
    const store = createAppStore()
    expect(selectAgentModel("claude-code")(store.getState())).toBeUndefined()

    store.applyEvent("claude-code", { kind: "config_options", options: [MODEL_OPTION, EFFORT_OPTION] })
    expect(selectAgentModel("claude-code")(store.getState())).toBe("opus")
  })

  it("return the current effort, or undefined when no thought_level category is advertised", () => {
    const store = createAppStore()
    expect(selectAgentEffort("claude-code")(store.getState())).toBeUndefined()

    store.applyEvent("claude-code", { kind: "config_options", options: [MODEL_OPTION] })
    // Model advertised but no effort category yet.
    expect(selectAgentEffort("claude-code")(store.getState())).toBeUndefined()

    store.applyEvent("claude-code", { kind: "config_options", options: [MODEL_OPTION, EFFORT_OPTION] })
    expect(selectAgentEffort("claude-code")(store.getState())).toBe("medium")
  })

  it("return the raw option slice with a stable reference across unrelated updates", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", { kind: "config_options", options: [MODEL_OPTION, EFFORT_OPTION] })

    const first = selectAgentConfigOptions("claude-code")(store.getState())
    expect(first).toEqual([MODEL_OPTION, EFFORT_OPTION])

    // An update to a different session must not change this session's slice identity.
    store.applyEvent("codex", { kind: "status", status: "working" })
    expect(selectAgentConfigOptions("claude-code")(store.getState())).toBe(first)
  })

  it("observes a dispatched config_options event through subscribeSelector", () => {
    const store = createAppStore()
    const observed: (string | undefined)[] = []
    store.subscribeSelector(selectAgentModel("claude-code"), (value) => observed.push(value))

    store.applyEvent("claude-code", { kind: "config_options", options: [MODEL_OPTION, EFFORT_OPTION] })
    store.applyEvent("claude-code", {
      kind: "config_options",
      options: [{ ...MODEL_OPTION, currentValue: "sonnet" }, EFFORT_OPTION],
    })

    expect(observed).toEqual(["opus", "sonnet"])
  })

  it("does not notify a model subscriber when only the effort changes", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", { kind: "config_options", options: [MODEL_OPTION, EFFORT_OPTION] })

    let notifications = 0
    store.subscribeSelector(selectAgentModel("claude-code"), () => notifications++)

    store.applyEvent("claude-code", {
      kind: "config_options",
      options: [MODEL_OPTION, { ...EFFORT_OPTION, currentValue: "high" }],
    })

    expect(notifications).toBe(0)
  })
})

describe("workspace view selectors", () => {
  const workspaceStore = (): AppStore =>
    createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/shared" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/shared" },
        { id: "c", providerKind: "claude-code", title: "C", cwd: "/other" },
      ],
    })

  it("orders visible/background views and disambiguates duplicate labels deterministically", () => {
    const store = workspaceStore()
    for (const id of ["a", "b", "c"]) store.renameConversation(id, "Work")
    store.backgroundConversation("b")

    const state = store.getState()
    expect(selectVisibleTabs(state).map((tab) => tab.id)).toEqual(["a", "c"])
    expect(selectBackgroundWork(state).map((tab) => tab.id)).toEqual(["b"])
    expect(selectDuplicateLabels(state)).toEqual({
      a: "Work (1)",
      b: "Work (2)",
      c: "Work (3)",
    })
    expect(selectSharedWorkspaces(state)).toEqual([
      { cwd: "/shared", count: 2, sessionIds: ["a", "b"] },
    ])
    expect(selectVisibleTabs(state)[0]?.sharedWorkspaceCount).toBe(2)
  })

  it("routes unseen background attention by rank without losing execution status", () => {
    const store = workspaceStore()
    store.backgroundConversation("b")
    store.applyEvent("c", { kind: "status", status: "error" })
    store.applyEvent("b", { kind: "status", status: "awaiting_approval" })

    expect(selectAttentionQueue(store.getState()).map((item) => item.id)).toEqual(["b", "c"])
    expect(selectNextAttention(store.getState())).toBe("b")

    store.reopenConversation("b")
    expect(store.getState().sessions.b?.status).toBe("awaiting_approval")
    expect(selectAttentionQueue(store.getState()).map((item) => item.id)).toEqual(["c"])
  })

  it("preserves unrelated tab identities through concurrent streaming", () => {
    const store = workspaceStore()
    const before = selectVisibleTabs(store.getState())

    store.applyEvent("b", { kind: "agent_message", messageId: "m1", textDelta: "token" })
    const streamed = selectVisibleTabs(store.getState())
    expect(streamed).toBe(before)
    expect(streamed[0]).toBe(before[0])
    expect(streamed[1]).toBe(before[1])
    expect(streamed[2]).toBe(before[2])

    store.applyEvent("b", { kind: "status", status: "finished" })
    const finished = selectVisibleTabs(store.getState())
    expect(finished).not.toBe(streamed)
    expect(finished[0]).toBe(streamed[0])
    expect(finished[1]).not.toBe(streamed[1])
    expect(finished[2]).toBe(streamed[2])
  })

  it("reports approval above a captured tab dialog", () => {
    const store = workspaceStore()
    store.openTabDialog({ kind: "close", sessionId: "b" })
    expect(selectTabDialogOverlay(store.getState())).toEqual({ kind: "close", sessionId: "b" })
    expect(selectActiveModal(store.getState())).toEqual({ kind: "tab-dialog", sessionId: "b" })

    store.openApproval({
      sessionId: "c",
      title: "C",
      cwd: "/other",
      request: { sessionId: "acp-c", toolCall: { toolCallId: "call-c" }, options: [] },
    })
    expect(selectActiveModal(store.getState())).toEqual({ kind: "approval", sessionId: "c" })
    expect(selectTabDialogOverlay(store.getState())?.sessionId).toBe("b")
  })
})
