import { describe, expect, it } from "bun:test"

import type {
  AvailableCommand,
  ClarificationPayload,
  ConfigOption,
  DefaultApplyResult,
  DomainSessionEvent,
  HandoffBundle,
  ManagedWorktreeAvailability,
  ManagedWorktreeBinding,
} from "../core/types.ts"
import type { StatuslineLayout } from "../core/statusline.ts"
import {
  EXPLORE_DENIAL_REASONS,
  evaluateExplorePolicy,
  type ExplorePolicySnapshot,
} from "../core/explorePolicy.ts"
import { createAppStore, type AppStore } from "./appStore.ts"
import {
  needsAttention,
  selectAgentConfigOptions,
  selectSessionDefaultApplyResult,
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
  selectSessionTranscriptProjection,
  selectSessionTranscriptWindow,
  selectApprovalOverlay,
  selectClarificationCapability,
  selectClarificationOverlay,
  selectDelegationOverlay,
  selectExploreAvailabilityPresentation,
  selectDelegatedParentCloseSummary,
  selectFocusedPane,
  selectExplorerVisible,
  selectFocusedExplorerPosition,
  selectFocusedSessionId,
  selectFocusedSession,
  selectFocusedTranscriptProjection,
  selectFocusedTranscriptWindow,
  selectHandoffPreview,
  selectHasOpenOverlay,
  selectIsApprovalOpen,
  selectIsClarificationOpen,
  selectIsFocused,
  selectIsExplorerFocused,
  selectIsShellFocused,
  selectIsSessionsOpen,
  selectSessionPicker,
  selectModelSelectOverlay,
  selectSettingsOverlay,
  selectShell,
  selectStatuslineOverlay,
  selectStatuslinePreference,
  selectThemePreference,
  selectActiveModal,
  selectAttentionQueue,
  selectBackgroundWork,
  selectDuplicateLabels,
  selectNextAttention,
  selectSharedWorkspaces,
  selectTabDialogOverlay,
  selectVisibleTabs,
  EXPLORE_DENIAL_LABELS,
  EXPLORE_RESTRICTION_SUMMARY,
  MANAGED_WORKTREE_AVAILABILITY_LABELS,
  MANAGED_WORKTREE_REASON_LABELS,
  selectManagedWorktreeReview,
  selectSessionSteeringPhase,
  selectSessionSteeringQueueCount,
  selectSessionSteeringRecovery,
  selectSessionSteeringRecoveryAvailable,
  selectSessionSteeringStatus,
  selectSessionExplorerPosition,
  selectVisibleExplorerPosition,
  selectCursorRecovery,
  selectContextPack,
  selectContextPackAttention,
  selectContextPackBuild,
  selectContextPackDraft,
  selectContextPackReview,
  selectContextPackSealed,
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

const CLARIFICATION_PAYLOAD: ClarificationPayload = {
  prompt: "Choose a boundary",
  fields: [{
    id: "boundary",
    label: "Boundary",
    mode: "single",
    allowsCustom: false,
    required: true,
    options: [{ id: "controller", label: "Controller" }],
  }],
}

describe("Context Pack selectors", () => {
  it("returns stable null fallbacks for missing and uninitialized values", () => {
    const store = createAppStore({
      seeds: [{ id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" }],
    })
    const state = store.getState()

    expect(selectContextPack("missing")(state)).toBeNull()
    expect(selectContextPack(null)(state)).toBeNull()
    expect(selectContextPackDraft("a")(state)).toBeNull()
    expect(selectContextPackSealed("a")(state)).toBeNull()
    expect(selectContextPackReview("a")(state)).toBeNull()
    expect(selectContextPackBuild("a")(state)).toBeNull()

    store.applyEvent("a", { kind: "status", status: "working" })
    const updated = store.getState()
    expect(selectContextPackDraft("a")(updated)).toBeNull()
    expect(selectContextPackSealed("a")(updated)).toBeNull()
    expect(selectContextPackReview("a")(updated)).toBeNull()
    expect(selectContextPackBuild("a")(updated)).toBeNull()
  })

  it("preserves every addressed selector identity across unrelated session updates", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/work/b" },
      ],
    })
    const created = store.createContextPackDraft("a", "Implement A")
    if (created?.kind !== "created") throw new Error("expected draft")
    const binding = {
      parentId: "a",
      childId: "builder",
      parentGeneration: 1,
      childGeneration: 1,
      draftRevision: created.draft.revision,
      state: "building",
    } as const
    expect(store.bindContextBuild("a", binding)).toBe(true)

    const selectPack = selectContextPack("a")
    const selectDraft = selectContextPackDraft("a")
    const selectBuild = selectContextPackBuild("a")
    const pack = selectPack(store.getState())
    const draft = selectDraft(store.getState())
    const build = selectBuild(store.getState())
    const notifications: unknown[] = []
    store.subscribeSelector(selectPack, (value) => notifications.push(value))

    store.createContextPackDraft("b", "Implement B")
    store.applyEvent("b", { kind: "status", status: "working" })
    store.applyEvent("a", { kind: "agent_message", messageId: "token", textDelta: "x" })

    expect(selectPack(store.getState())).toBe(pack)
    expect(selectDraft(store.getState())).toBe(draft)
    expect(selectBuild(store.getState())).toBe(build)
    expect(selectContextPackReview("a")(store.getState())).toBeNull()
    expect(selectContextPackSealed("a")(store.getState())).toBeNull()
    expect(notifications).toEqual([])

    store.applyContextPackOperatorMutation("a", {
      kind: "set_brief_section",
      section: "architecture",
      text: "Changed",
    })
    expect(notifications).toHaveLength(1)
    expect(selectDraft(store.getState())).not.toBe(draft)
    expect(selectBuild(store.getState())).toBe(build)
  })

  it("returns one stable absent attention projection without Context Pack attention", () => {
    const store = createAppStore({
      seeds: [{ id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" }],
    })
    const selectAttention = selectContextPackAttention("a")
    const absent = selectAttention(store.getState())

    expect(absent).toBeNull()
    expect(selectContextPackAttention("missing")(store.getState())).toBeNull()
    expect(selectContextPackAttention(null)(store.getState())).toBeNull()
    store.createContextPackDraft("a", "Prepare context")
    store.applyEvent("a", { kind: "status", status: "working" })
    expect(selectAttention(store.getState())).toBe(absent)
  })

  it("projects review-ready Context Pack attention without forging SessionStatus", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/work/b" },
      ],
      selectedVisibleId: "a",
    })
    store.applyEvent("b", { kind: "status", status: "working" })
    const prepared = store.prepareContextBuild("b", {
      kind: "start_fresh",
      original: "Prepare B",
    }, {
      parentId: "b",
      childId: "builder-b",
      parentGeneration: 1,
      childGeneration: 1,
    })
    if (prepared.kind !== "prepared") throw new Error("expected prepared Context Build")
    const sessionStatus = store.getState().sessions.b?.status
    const agentAttention = store.getState().workspace.conversations.b?.attention

    expect(store.settleContextBuild("b", prepared.binding, "ready_for_review")).toBeTrue()
    const projection = selectContextPackAttention("b")(store.getState())
    expect(projection).toEqual({ kind: "ready_for_review", label: "Context ready" })
    expect(selectContextPackAttention("b")(store.getState())).toBe(projection)
    expect(store.getState().sessions.b?.status).toBe(sessionStatus)
    expect(store.getState().workspace.conversations.b?.attention).toBe(agentAttention)
  })

  it("clears only Context Pack attention on explicit session selection", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/work/b" },
      ],
      selectedVisibleId: "a",
    })
    const prepared = store.prepareContextBuild("b", {
      kind: "start_fresh",
      original: "Prepare B",
    }, {
      parentId: "b",
      childId: "builder-b",
      parentGeneration: 1,
      childGeneration: 1,
    })
    if (prepared.kind !== "prepared") throw new Error("expected prepared Context Build")
    expect(store.settleContextBuild("b", prepared.binding, "ready_for_review")).toBeTrue()
    const draft = store.getState().contextPacks.b?.draft
    const sessionStatus = store.getState().sessions.b?.status
    const agentAttention = store.getState().workspace.conversations.b?.attention

    store.selectConversation("b")

    expect(selectContextPackAttention("b")(store.getState())).toBeNull()
    expect(store.getState().contextPacks.b?.draft).toBe(draft)
    expect(store.getState().contextPacks.b?.review).toBeNull()
    expect(store.getState().sessions.b?.status).toBe(sessionStatus)
    expect(store.getState().workspace.conversations.b?.attention).toBe(agentAttention)
  })
})

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

const STATUSLINE_LAYOUT: StatuslineLayout = {
  separator: " · ",
  line: ["FOLDER", "MODEL"],
}

const enqueueSteering = (
  store: AppStore,
  sessionId: "claude-code" | "codex",
  requestId: string,
  text: string,
): void => {
  store.applyEvent(sessionId, {
    kind: "steering_enqueue",
    activeTurnId: "turn-active",
    requestId,
    generation: 4,
    blocks: [{ type: "text", text }],
  })
}

describe("Cursor recovery selector", () => {
  it("returns only the bounded projection for an unavailable Cursor session", () => {
    const store = createAppStore({
      seeds: [
        { id: "cursor", providerKind: "cursor", title: "Cursor", cwd: "/w" },
        { id: "codex", providerKind: "codex", title: "Codex", cwd: "/w" },
      ],
    })
    const recovery = {
      reason: "authentication_required",
      action: "authenticate_natively",
      recheckable: true,
    } as const

    store.setConversationAvailability("cursor", {
      kind: "unavailable",
      reasonCode: "connection-failed",
      retryable: true,
      cursorRecovery: recovery,
    })
    store.setConversationAvailability("codex", {
      kind: "unavailable",
      reasonCode: "connection-failed",
      retryable: true,
      cursorRecovery: recovery,
    })

    expect(selectCursorRecovery("cursor")(store.getState())).toBe(recovery)
    expect(selectCursorRecovery("codex")(store.getState())).toBeNull()
    expect(selectCursorRecovery("missing")(store.getState())).toBeNull()
    expect(selectCursorRecovery(null)(store.getState())).toBeNull()
  })

  it("returns null for starting, ready, and unavailable Cursor sessions without a projection", () => {
    const store = createAppStore({
      seeds: [{ id: "cursor", providerKind: "cursor", title: "Cursor", cwd: "/w" }],
    })
    const selectRecovery = selectCursorRecovery("cursor")

    expect(selectRecovery(store.getState())).toBeNull()
    store.setConversationAvailability("cursor", { kind: "ready" })
    expect(selectRecovery(store.getState())).toBeNull()
    store.setConversationAvailability("cursor", {
      kind: "unavailable",
      reasonCode: "teardown-failed",
      retryable: true,
    })
    expect(selectRecovery(store.getState())).toBeNull()
  })

  it("publishes changed recovery values and stays silent for equal or sibling updates", () => {
    const store = createAppStore({
      seeds: [
        { id: "cursor", providerKind: "cursor", title: "Cursor", cwd: "/w" },
        { id: "codex", providerKind: "codex", title: "Codex", cwd: "/w" },
      ],
    })
    const seen: unknown[] = []
    store.subscribeSelector(selectCursorRecovery("cursor"), (recovery) => seen.push(recovery))

    const unavailable = {
      kind: "unavailable",
      reasonCode: "connection-failed",
      retryable: true,
      cursorRecovery: {
        reason: "uncertified_recipe",
        action: "await_maintainer_review",
        recheckable: false,
      },
    } as const
    store.setConversationAvailability("cursor", unavailable)
    store.setConversationAvailability("cursor", { ...unavailable, cursorRecovery: { ...unavailable.cursorRecovery } })
    store.setConversationAvailability("codex", { kind: "ready" })
    store.setConversationAvailability("cursor", {
      ...unavailable,
      cursorRecovery: {
        reason: "binary_missing",
        action: "install_cursor_cli",
        recheckable: true,
      },
    })

    expect(seen).toEqual([
      unavailable.cursorRecovery,
      { reason: "binary_missing", action: "install_cursor_cli", recheckable: true },
    ])
  })
})

describe("steering selectors", () => {
  it("projects compact idle, queued, sending, and failed status", () => {
    const store = createAppStore()
    const selectStatus = selectSessionSteeringStatus("claude-code")

    expect(selectStatus(store.getState())).toEqual({
      phase: "idle",
      queueCount: 0,
      recoveryAvailable: false,
    })
    expect(selectSessionSteeringPhase("claude-code")(store.getState())).toBe("idle")
    expect(selectSessionSteeringQueueCount("claude-code")(store.getState())).toBe(0)
    expect(selectSessionSteeringRecoveryAvailable("claude-code")(store.getState())).toBe(false)

    enqueueSteering(store, "claude-code", "steer-1", "change direction")
    enqueueSteering(store, "claude-code", "steer-2", "then preserve order")
    expect(selectStatus(store.getState())).toEqual({
      phase: "queued",
      queueCount: 2,
      recoveryAvailable: false,
    })

    store.applyEvent("claude-code", {
      kind: "steering_cancel",
      requestId: "steer-1",
      generation: 4,
    })
    store.applyEvent("claude-code", {
      kind: "steering_settle",
      requestId: "steer-1",
      generation: 4,
    })
    store.applyEvent("claude-code", {
      kind: "steering_send",
      requestId: "steer-1",
      generation: 4,
    })
    expect(selectStatus(store.getState())).toEqual({
      phase: "sending",
      queueCount: 2,
      recoveryAvailable: false,
    })

    store.applyEvent("claude-code", {
      kind: "steering_recover",
      requestId: "steer-1",
      generation: 4,
    })
    expect(selectStatus(store.getState())).toEqual({
      phase: "failed",
      queueCount: 2,
      recoveryAvailable: true,
    })
    expect(selectSessionSteeringRecoveryAvailable("claude-code")(store.getState())).toBe(true)
  })

  it("uses stable safe fallbacks for null, unknown, idle, and no-recovery sessions", () => {
    const state = createAppStore().getState()
    const nullStatus = selectSessionSteeringStatus(null)(state)

    expect(selectSessionSteeringStatus("missing")(state)).toBe(nullStatus)
    expect(selectSessionSteeringStatus("claude-code")(state)).toBe(nullStatus)
    expect(selectSessionSteeringRecovery(null)(state)).toBeNull()
    expect(selectSessionSteeringRecovery("missing")(state)).toBeNull()
    expect(selectSessionSteeringRecovery("claude-code")(state)).toBeNull()
  })

  it("keeps generic status content-free and reserves exact blocks for focused recovery", () => {
    const store = createAppStore()
    enqueueSteering(store, "claude-code", "steer-secret", "exact unsent text")
    store.applyEvent("claude-code", {
      kind: "steering_recover",
      requestId: "steer-secret",
      generation: 4,
    })

    const status = selectSessionSteeringStatus("claude-code")(store.getState())
    expect(Object.keys(status).sort()).toEqual(["phase", "queueCount", "recoveryAvailable"])
    expect(JSON.stringify(status)).not.toContain("exact unsent text")
    expect(JSON.stringify(status)).not.toContain("steer-secret")
    expect(selectSessionSteeringRecovery("claude-code")(store.getState())).toEqual({
      requestId: "steer-secret",
      blocks: [{ type: "text", text: "exact unsent text" }],
    })
  })

  it("preserves projection identities across token and other-session updates", () => {
    const store = createAppStore()
    enqueueSteering(store, "claude-code", "steer-1", "recover me")
    store.applyEvent("claude-code", {
      kind: "steering_recover",
      requestId: "steer-1",
      generation: 4,
    })
    const selectStatus = selectSessionSteeringStatus("claude-code")
    const selectRecovery = selectSessionSteeringRecovery("claude-code")
    const status = selectStatus(store.getState())
    const recovery = selectRecovery(store.getState())

    store.applyEvent("claude-code", {
      kind: "agent_message",
      messageId: "stream",
      textDelta: "token",
    })
    enqueueSteering(store, "codex", "steer-other", "other session")

    expect(selectStatus(store.getState())).toBe(status)
    expect(selectRecovery(store.getState())).toBe(recovery)
  })
})

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

describe("explorer selectors", () => {
  it("projects hidden and uninitialized explorer state without allocating defaults", () => {
    const store = createAppStore()
    const state = store.getState()

    expect(selectExplorerVisible(state)).toBe(false)
    expect(selectIsExplorerFocused(state)).toBe(false)
    expect(selectSessionExplorerPosition("claude-code")(state)).toBeNull()
    expect(selectSessionExplorerPosition("missing")(state)).toBeNull()
    expect(selectSessionExplorerPosition(null)(state)).toBeNull()
    expect(selectFocusedExplorerPosition(state)).toBeNull()
    expect(selectVisibleExplorerPosition(state)).toBeNull()
  })

  it("preserves an addressed session slice identity across unrelated explorer updates", () => {
    const store = createAppStore()
    store.setExplorerSelection("claude-code", "src/claude.ts")
    store.setExplorerSelection("codex", "src/codex.ts")
    const selectClaude = selectSessionExplorerPosition("claude-code")
    const selected = selectClaude(store.getState())
    const publications: unknown[] = []
    store.subscribeSelector(selectClaude, (position) => publications.push(position))

    store.setExplorerExpanded("codex", "src", true)
    store.setExplorerScrollTop("codex", 12)
    store.setExplorerNotice("codex", { code: "fallback-dispatched" })

    expect(selectClaude(store.getState())).toBe(selected)
    expect(publications).toEqual([])
  })

  it("restores each focused session's position without mutating the other", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.setExplorerSelection("claude-code", "src/claude.ts")
    store.setExplorerExpanded("claude-code", "src", true)
    store.setExplorerScrollTop("claude-code", 4)
    store.setExplorerNotice("claude-code", { code: "refresh-complete" })
    store.setExplorerSelection("codex", "test/codex.test.ts")
    store.setExplorerExpanded("codex", "test", true)
    store.setExplorerScrollTop("codex", 9)
    store.setExplorerNotice("codex", { code: "launch-failed" })
    const claude = selectFocusedExplorerPosition(store.getState())
    const codex = selectSessionExplorerPosition("codex")(store.getState())

    store.toggleExplorer("claude-code")
    expect(selectExplorerVisible(store.getState())).toBe(true)
    expect(selectIsExplorerFocused(store.getState())).toBe(true)
    expect(selectVisibleExplorerPosition(store.getState())).toBe(claude)

    store.setFocus("codex")
    expect(selectFocusedExplorerPosition(store.getState())).toBe(codex)
    expect(selectVisibleExplorerPosition(store.getState())).toBe(codex)
    expect(selectIsExplorerFocused(store.getState())).toBe(false)

    store.setFocus("claude-code")
    expect(selectFocusedExplorerPosition(store.getState())).toBe(claude)
    expect(selectSessionExplorerPosition("codex")(store.getState())).toBe(codex)
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
  it("projects default and configured theme and statusline preferences", () => {
    const defaultStore = createAppStore()
    const configuredStore = createAppStore({
      preferences: {
        theme: "dark",
        statusline: { llmDisclosureAcknowledged: true, layout: STATUSLINE_LAYOUT },
      },
    })

    expect(selectThemePreference(defaultStore.getState())).toBe("auto")
    expect(selectThemePreference(configuredStore.getState())).toBe("dark")
    expect(selectStatuslinePreference(defaultStore.getState())).toEqual({
      llmDisclosureAcknowledged: false,
      layout: null,
    })
    expect(selectStatuslinePreference(configuredStore.getState())).toEqual({
      llmDisclosureAcknowledged: true,
      layout: STATUSLINE_LAYOUT,
    })
  })

  it("keeps the saved statusline preference reference across unrelated updates", () => {
    const store = createAppStore({
      preferences: { statusline: { llmDisclosureAcknowledged: true, layout: STATUSLINE_LAYOUT } },
    })
    const preference = selectStatuslinePreference(store.getState())

    store.applyEvent("codex", { kind: "agent_message", messageId: "stream", textDelta: "token" })
    store.applyShellEvent({ kind: "cwd_changed", cwd: "/other" })
    store.openSettings()

    expect(selectStatuslinePreference(store.getState())).toBe(preference)
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

  it("preserves valid boundary and rounded remaining-context headroom", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", { kind: "usage", used: 0, size: 200_000 })
    expect(selectSessionHeadroom("claude-code")(store.getState())).toBe(100)

    store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    expect(selectSessionHeadroom("claude-code")(store.getState())).toBe(38)

    store.applyEvent("codex", { kind: "usage", used: 200_000, size: 200_000 })

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

  it("returns null when either usage counter is not finite", () => {
    const invalidCounters = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

    for (const used of invalidCounters) {
      const store = createAppStore()
      store.applyEvent("claude-code", { kind: "usage", used, size: 200_000 })
      expect(selectSessionHeadroom("claude-code")(store.getState())).toBeNull()
    }

    for (const size of invalidCounters) {
      const store = createAppStore()
      store.applyEvent("claude-code", { kind: "usage", used: 124_000, size })
      expect(selectSessionHeadroom("claude-code")(store.getState())).toBeNull()
    }
  })

  it("returns null when rounded headroom falls outside zero through one hundred", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", { kind: "usage", used: 202, size: 200 })
    store.applyEvent("codex", { kind: "usage", used: -2, size: 200 })

    expect(selectSessionHeadroom("claude-code")(store.getState())).toBeNull()
    expect(selectSessionHeadroom("codex")(store.getState())).toBeNull()
  })

  it("returns null when finite counters derive non-finite rounded headroom", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", {
      kind: "usage",
      used: -Number.MAX_VALUE,
      size: Number.MAX_VALUE,
    })

    expect(selectSessionHeadroom("claude-code")(store.getState())).toBeNull()
  })

  it("preserves another agent's headroom value and session identity across a usage update", () => {
    const store = createAppStore()
    store.applyEvent("codex", { kind: "usage", used: 50_000, size: 200_000 })
    const before = store.getState()
    const codexHeadroom = selectSessionHeadroom("codex")
    const beforeHeadroom = codexHeadroom(before)

    store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })

    const after = store.getState()
    expect(selectSessionHeadroom("claude-code")(after)).toBe(38)
    expect(beforeHeadroom).toBe(75)
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

function acceptedExplorePolicy(model = "safe-model"): ExplorePolicySnapshot {
  const decision = evaluateExplorePolicy({
    role: "explore",
    restrictions: {
      filesystem: "read-only",
      shell: false,
      externalMcp: false,
      agentControl: false,
      askUser: true,
      maxDepth: 0,
    },
    limits: { perParent: 2, global: 4 },
    attestationVersion: "selector-v1",
    confirmed: { provider: "codex", model, effort: "medium" },
  })
  if (decision.kind !== "eligible") throw new Error("explore policy fixture must be eligible")
  return decision.policy
}

function registerDelegatedChild(
  store: AppStore,
  childId = "child",
  title = "Child",
  policy?: ExplorePolicySnapshot,
): void {
  store.addDelegatedSession({
    seed: { id: childId, providerKind: "codex", title, cwd: `/w/${childId}` },
    parentId: "a",
    parentGeneration: 1,
    childGeneration: 1,
    task: "Inspect the selector seam",
    desiredOutcome: "Return a concise result",
    ...(policy ? { policy } : {}),
  })
}

function publishDelegatedStatus(
  store: AppStore,
  childId: string,
  status: "running" | "needs_input" | "finished" | "failed" | "cancelled",
): void {
  const identity = { parentId: "a", childId, parentGeneration: 1, childGeneration: 1 }
  if (status === "running") {
    store.publishDelegatedChildState({ ...identity, status, sessionStatus: "working" })
  } else if (status === "needs_input") {
    store.publishDelegatedChildState({ ...identity, status, sessionStatus: "awaiting_clarification" })
  } else if (status === "finished") {
    store.publishDelegatedChildState({ ...identity, status: "running", sessionStatus: "working" })
    store.publishDelegatedChildState({ ...identity, status, sessionStatus: "finished", at: 1 })
  } else if (status === "failed") {
    store.publishDelegatedChildState({ ...identity, status, sessionStatus: "error", at: 1 })
  } else {
    store.publishDelegatedChildState({ ...identity, status, sessionStatus: "idle", at: 1 })
  }
}

function managedWorktreeBinding(
  ownerSessionId: string,
  availability: ManagedWorktreeAvailability = "available",
  overrides: Partial<ManagedWorktreeBinding> = {},
): ManagedWorktreeBinding {
  return {
    kind: "managed",
    id: `binding-${ownerSessionId}`,
    repoRoot: "/repo",
    worktreePath: `/repo/.kitten/worktrees/${ownerSessionId}`,
    branch: `kitten/${ownerSessionId}`,
    baseBranch: "main",
    baseSha: "0123456789abcdef",
    ownerSessionId,
    availability,
    ...overrides,
  }
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
  it.each([
    ["running", "Running", false],
    ["needs_input", "Needs input", false],
    ["finished", "Finished", true],
    ["failed", "Failed", true],
    ["cancelled", "Cancelled", true],
  ] as const)("projects stable delegated %s presentation", (status, statusLabel, terminal) => {
    const store = fleetStore()
    registerDelegatedChild(store)
    publishDelegatedStatus(store, "child", status)

    const first = selectSessionList(store.getState())
    const child = first.find((item) => item.id === "child")
    expect(child?.delegation).toEqual({
      kind: "child",
      parentId: "a",
      parentLabel: "A",
      lineageLabel: "Child of A",
      status,
      statusLabel,
      terminalTranscriptAvailable: terminal,
      explore: null,
    })
    expect(selectSessionList(store.getState())).toBe(first)
  })

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

  it("rebuilds the cached list when session status changes", () => {
    const store = fleetStore()
    const before = selectSessionList(store.getState())

    store.applyEvent("b", { kind: "status", status: "working" })
    const after = selectSessionList(store.getState())

    expect(after).not.toBe(before)
    expect(after.find((item) => item.id === "b")?.status).toBe("working")
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

  it("projects live explore policy stably and rebuilds only when the accepted policy changes", () => {
    const store = fleetStore()
    registerDelegatedChild(store, "child", "Child", acceptedExplorePolicy("safe-model-a"))
    publishDelegatedStatus(store, "child", "running")

    const first = selectSessionList(store.getState()).find((item) => item.id === "child")?.delegation
    expect(first?.kind).toBe("child")
    if (first?.kind !== "child") throw new Error("expected delegated child presentation")
    expect(first.explore).toMatchObject({
      role: "explore",
      roleLabel: "explore",
      compactLabel: "explore",
      restrictionSummary: EXPLORE_RESTRICTION_SUMMARY,
      attestationVersion: "selector-v1",
      confirmed: { provider: "codex", model: "safe-model-a", effort: "medium" },
    })

    store.applyEvent("child", { kind: "agent_message", messageId: "stream", textDelta: "token" })
    const streamed = selectSessionList(store.getState()).find((item) => item.id === "child")?.delegation
    expect(streamed).toBe(first)

    store.applyEvent("b", { kind: "agent_message", messageId: "other", textDelta: "token" })
    const unrelated = selectSessionList(store.getState()).find((item) => item.id === "child")?.delegation
    expect(unrelated).toBe(first)

    const currentState = store.getState()
    const currentChild = currentState.delegation.children.child
    if (!currentChild) throw new Error("expected delegated child snapshot")
    const changedState = {
      ...currentState,
      delegation: {
        ...currentState.delegation,
        children: {
          ...currentState.delegation.children,
          child: { ...currentChild, policy: acceptedExplorePolicy("safe-model-b") },
        },
      },
    }
    const changed = selectSessionList(changedState).find((item) => item.id === "child")?.delegation
    expect(changed).not.toBe(first)
    expect(changed?.kind === "child" ? changed.explore?.confirmed.model : null).toBe("safe-model-b")
  })
})

describe("managed worktree review presentation", () => {
  it.each([
    ["unverified", "Review status unverified"],
    ["available", "Review available"],
    ["unavailable", "Review unavailable"],
    ["cleanup_refused", "Cleanup refused"],
  ] as const)("maps %s to bounded explicit text", (availability, availabilityLabel) => {
    const binding = managedWorktreeBinding("child", availability, {
      ...(availability === "available" ? {} : { reason: "verification_failed" }),
    })
    const store = createAppStore({
      seeds: [{
        id: "child",
        providerKind: "codex",
        title: "Child",
        cwd: binding.worktreePath,
        worktreeBinding: binding,
      }],
    })

    const review = selectManagedWorktreeReview("child")(store.getState())
    expect(review).toMatchObject({
      kind: "managed-worktree",
      managed: true,
      managedLabel: "Managed worktree",
      provenance: "kitten-managed",
      provenanceLabel: "Kitten-managed workspace",
      worktreePath: binding.worktreePath,
      branch: binding.branch,
      baseBranch: binding.baseBranch,
      baseSha: binding.baseSha,
      availability,
      availabilityLabel,
    })
    expect(review?.availabilityLabel).toBe(MANAGED_WORKTREE_AVAILABILITY_LABELS[availability])
    expect(review?.reasonLabel).toBe(
      binding.reason ? MANAGED_WORKTREE_REASON_LABELS[binding.reason] : null,
    )
    expect(review?.availabilityLabel).not.toContain(binding.worktreePath)
  })

  it("returns null only for an ordinary session and preserves unchanged presentation identity", () => {
    const binding = managedWorktreeBinding("child")
    const store = createAppStore({
      seeds: [
        { id: "ordinary", providerKind: "claude-code", title: "Ordinary", cwd: "/repo" },
        {
          id: "child",
          providerKind: "codex",
          title: "Child",
          cwd: binding.worktreePath,
          worktreeBinding: binding,
        },
      ],
    })
    const selectReview = selectManagedWorktreeReview("child")
    const first = selectReview(store.getState())

    expect(selectManagedWorktreeReview("ordinary")(store.getState())).toBeNull()
    expect(first).not.toBeNull()
    store.applyEvent("child", { kind: "agent_message", messageId: "stream", textDelta: "token" })
    store.applyShellEvent({ kind: "cwd_changed", cwd: "/elsewhere" })
    expect(selectReview(store.getState())).toBe(first)
  })

  it("shares one cached review object across restored row/view projections without delegation", () => {
    const unavailable = managedWorktreeBinding("child", "unavailable", { reason: "missing" })
    const store = createAppStore({
      seeds: [
        { id: "sibling", providerKind: "claude-code", title: "Sibling", cwd: "/repo" },
        {
          id: "child",
          providerKind: "codex",
          title: "Restored child",
          cwd: unavailable.worktreePath,
          worktreeBinding: unavailable,
        },
      ],
    })

    const row = selectSessionList(store.getState()).find((item) => item.id === "child")
    const view = selectVisibleTabs(store.getState()).find((item) => item.id === "child")
    expect(row?.cwd).toBe(unavailable.worktreePath)
    expect(view?.cwd).toBe(unavailable.worktreePath)
    expect(row?.delegation).toBeNull()
    expect(view?.delegation).toBeNull()
    expect(row?.review).toBe(view?.review)
    expect(row?.review).toBe(selectManagedWorktreeReview("child")(store.getState()))
    expect(row?.review).toMatchObject({
      availability: "unavailable",
      availabilityLabel: "Review unavailable",
      reason: "missing",
      reasonLabel: "Managed workspace is missing",
    })
  })

  it("replaces only the updated child row/view while siblings remain stable", () => {
    const binding = managedWorktreeBinding("child", "available")
    const store = createAppStore({
      seeds: [
        { id: "sibling", providerKind: "claude-code", title: "Sibling", cwd: "/repo" },
        {
          id: "child",
          providerKind: "codex",
          title: "Child",
          cwd: binding.worktreePath,
          worktreeBinding: binding,
        },
      ],
    })
    const rowsBefore = selectSessionList(store.getState())
    const viewsBefore = selectVisibleTabs(store.getState())

    store.publishManagedWorktreeBinding(
      "child",
      managedWorktreeBinding("child", "cleanup_refused", { reason: "dirty" }),
    )

    const rowsAfter = selectSessionList(store.getState())
    const viewsAfter = selectVisibleTabs(store.getState())
    expect(rowsAfter[0]).toBe(rowsBefore[0])
    expect(rowsAfter[1]).not.toBe(rowsBefore[1])
    expect(viewsAfter[0]).toBe(viewsBefore[0])
    expect(viewsAfter[1]).not.toBe(viewsBefore[1])
    expect(rowsAfter[1]?.review).toBe(viewsAfter[1]?.review)
    expect(rowsAfter[1]?.review).toMatchObject({
      availability: "cleanup_refused",
      availabilityLabel: "Cleanup refused",
      reason: "dirty",
      reasonLabel: "Managed workspace has uncommitted changes",
    })
  })
})

describe("explore availability presentation", () => {
  it("maps every closed denial to fixed content-free text with stable selector output", () => {
    const store = fleetStore()
    for (const reason of EXPLORE_DENIAL_REASONS) {
      const selector = selectExploreAvailabilityPresentation(reason)
      const first = selector(store.getState())
      expect(first).toEqual({
        kind: "unavailable",
        roleLabel: "Role: explore",
        restrictionSummary: EXPLORE_RESTRICTION_SUMMARY,
        statusLabel: `Unavailable: ${EXPLORE_DENIAL_LABELS[reason]}`,
        reason,
      })
      expect(first.statusLabel).not.toMatch(/\/|config|error|task/i)
      store.applyEvent("b", { kind: "agent_message", messageId: reason, textDelta: "unrelated" })
      expect(selector(store.getState())).toBe(first)
    }
  })

  it("projects an explicit textual available state and the complete V1 restriction contract", () => {
    const presentation = selectExploreAvailabilityPresentation(null)(fleetStore().getState())
    expect(presentation.kind).toBe("available")
    expect(presentation.statusLabel).toContain("Available")
    expect(presentation.restrictionSummary).toContain("Read-only filesystem")
    expect(presentation.restrictionSummary).toContain("No shell")
    expect(presentation.restrictionSummary).toContain("No external MCP or agent control")
    expect(presentation.restrictionSummary).toContain("Scoped ask_user only")
    expect(presentation.restrictionSummary).toContain("No recursion")
  })
})

describe("delegated parent close summary", () => {
  it("projects only active children with explicit status labels and stable identity", () => {
    const store = fleetStore()
    registerDelegatedChild(store, "running-child")
    publishDelegatedStatus(store, "running-child", "running")
    registerDelegatedChild(store, "input-child")
    publishDelegatedStatus(store, "input-child", "needs_input")
    registerDelegatedChild(store, "finished-child")
    publishDelegatedStatus(store, "finished-child", "finished")
    const selectSummary = selectDelegatedParentCloseSummary("a")

    const first = selectSummary(store.getState())
    expect(first).toEqual({
      activeChildCount: 2,
      statuses: [
        { status: "running", label: "Running", count: 1 },
        { status: "needs_input", label: "Needs input", count: 1 },
      ],
    })
    expect(selectSummary(store.getState())).toBe(first)

    store.applyEvent("b", { kind: "status", status: "working" })
    expect(selectSummary(store.getState())).toBe(first)
  })

  it("returns null when a parent has no children or only terminal children", () => {
    const store = fleetStore()
    const selectSummary = selectDelegatedParentCloseSummary("a")
    expect(selectSummary(store.getState())).toBeNull()

    registerDelegatedChild(store, "failed-child")
    publishDelegatedStatus(store, "failed-child", "failed")
    registerDelegatedChild(store, "cancelled-child")
    publishDelegatedStatus(store, "cancelled-child", "cancelled")

    expect(selectSummary(store.getState())).toBeNull()
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
    expect(selectClarificationOverlay(state)).toBeNull()
    expect(selectHandoffPreview(state)).toBeNull()
    expect(selectSettingsOverlay(state)).toBeNull()
    expect(selectStatuslineOverlay(state)).toBeNull()
    expect(selectHasOpenOverlay(state)).toBe(false)
    expect(selectIsApprovalOpen(state)).toBe(false)
    expect(selectIsClarificationOpen(state)).toBe(false)
    expect(selectIsSessionsOpen(state)).toBe(false)
    expect(selectSessionPicker(state)).toBe(false)
  })

  it("projects the statusline modal slot by reference and includes it in modal gating", () => {
    const store = createAppStore()
    const overlay = {
      sessionId: "codex" as const,
      phase: "request" as const,
      requestText: "show workspace and model",
    }

    store.openStatusline(overlay)
    const opened = store.getState()

    expect(selectStatuslineOverlay(opened)).toBe(overlay)
    expect(selectHasOpenOverlay(opened)).toBe(true)
    expect(selectActiveModal(opened)).toEqual({ kind: "statusline", sessionId: "codex" })

    store.applyEvent("claude-code", { kind: "agent_message", messageId: "stream", textDelta: "token" })
    expect(selectStatuslineOverlay(store.getState())).toBe(overlay)
  })

  it("gives clarification modal priority and reports it as the only open-overlay gate", () => {
    const store = createAppStore()
    store.openApproval({
      sessionId: "codex",
      title: "Codex",
      cwd: "/workspace/kitten",
      request: { sessionId: "s1", toolCall: { toolCallId: "c1" }, options: [] },
    })
    store.openSettings()
    store.openClarification({
      requestId: "clarification-1",
      generation: 2,
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      payload: CLARIFICATION_PAYLOAD,
    })
    const state = store.getState()

    expect(selectClarificationOverlay(state)?.payload).toBe(CLARIFICATION_PAYLOAD)
    expect(selectIsClarificationOpen(state)).toBe(true)
    expect(selectHasOpenOverlay(state)).toBe(true)
    expect(selectActiveModal(state)).toEqual({
      kind: "clarification",
      sessionId: "claude-code",
      requestId: "clarification-1",
    })
    expect(selectApprovalOverlay(state)?.sessionId).toBe("codex")
    expect(selectSettingsOverlay(state)).toEqual({ tab: "theme" })
  })

  it("places delegation below approval and clarification while retaining its captured parent", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.openDelegation({ parentId: "claude-code" })
    expect(selectDelegationOverlay(store.getState())).toEqual({ parentId: "claude-code" })
    expect(selectActiveModal(store.getState())).toEqual({ kind: "delegation", sessionId: "claude-code" })

    store.openApproval({
      sessionId: "codex",
      title: "Codex",
      cwd: "/workspace/kitten",
      request: { sessionId: "s1", toolCall: { toolCallId: "c1" }, options: [] },
    })
    expect(selectActiveModal(store.getState())).toEqual({ kind: "approval", sessionId: "codex" })
    expect(selectDelegationOverlay(store.getState())).toEqual({ parentId: "claude-code" })

    store.openClarification({
      requestId: "clarification-delegation",
      generation: 1,
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      payload: CLARIFICATION_PAYLOAD,
    })
    expect(selectActiveModal(store.getState())).toEqual({
      kind: "clarification",
      sessionId: "claude-code",
      requestId: "clarification-delegation",
    })
    expect(selectDelegationOverlay(store.getState())).toEqual({ parentId: "claude-code" })
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

describe("clarification capability selector", () => {
  it("returns a stable per-session supported or unsupported view", () => {
    const store = createAppStore()
    const unsupported = selectClarificationCapability("claude-code")
    const supported = selectClarificationCapability("codex")

    expect(unsupported(store.getState())).toEqual({ status: "unsupported", reason: "unknown_recipe" })
    store.setClarificationCapability("codex", {
      status: "supported",
      adapterPackage: "@agentclientprotocol/codex-acp",
      adapterVersion: "1.1.2",
    })
    expect(supported(store.getState())).toEqual({
      status: "supported",
      adapterPackage: "@agentclientprotocol/codex-acp",
      adapterVersion: "1.1.2",
    })
    expect(unsupported(store.getState())).toEqual({ status: "unsupported", reason: "unknown_recipe" })
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

describe("default-application result selector", () => {
  it("returns null for unknown and untouched sessions", () => {
    const store = createAppStore()
    const state = store.getState()

    expect(selectSessionDefaultApplyResult(null)(state)).toBeNull()
    expect(selectSessionDefaultApplyResult("unknown")(state)).toBeNull()
    expect(selectSessionDefaultApplyResult("claude-code")(state)).toBeNull()
  })

  it("projects every stored terminal result unchanged", () => {
    const results: DefaultApplyResult[] = [
      { kind: "none" },
      { kind: "applied", model: "opus", effort: "high" },
      { kind: "partial", model: "sonnet", unavailable: "effort" },
      { kind: "unavailable", unavailable: "model" },
      { kind: "unavailable", unavailable: "session" },
    ]

    for (const result of results) {
      const store = createAppStore()
      store.applyEvent("claude-code", { kind: "default_apply_result", result })

      expect(selectSessionDefaultApplyResult("claude-code")(store.getState())).toBe(result)
    }
  })

  it("retains the stored result reference across an unrelated-session event", () => {
    const store = createAppStore()
    const selectResult = selectSessionDefaultApplyResult("claude-code")
    const result: DefaultApplyResult = { kind: "applied", model: "opus", effort: "medium" }
    store.applyEvent("claude-code", { kind: "default_apply_result", result })
    const before = selectResult(store.getState())

    store.applyEvent("codex", { kind: "status", status: "working" })

    expect(selectResult(store.getState())).toBe(before)
    expect(before).toBe(result)
  })

  it("notifies in order for two terminal result replacements", () => {
    const store = createAppStore()
    const observed: DefaultApplyResult[] = []
    store.subscribeSelector(selectSessionDefaultApplyResult("claude-code"), (value) => {
      if (value) observed.push(value)
    })
    const partial: DefaultApplyResult = { kind: "partial", model: "opus", unavailable: "effort" }
    const applied: DefaultApplyResult = { kind: "applied", model: "opus", effort: "high" }

    store.applyEvent("claude-code", { kind: "default_apply_result", result: partial })
    store.applyEvent("claude-code", { kind: "default_apply_result", result: applied })

    expect(observed).toEqual([partial, applied])
  })

  it("does not notify when config options refresh without replacing the result", () => {
    const store = createAppStore()
    const result: DefaultApplyResult = { kind: "applied", model: "opus", effort: "medium" }
    store.applyEvent("claude-code", { kind: "default_apply_result", result })
    let notifications = 0
    store.subscribeSelector(selectSessionDefaultApplyResult("claude-code"), () => notifications++)

    store.applyEvent("claude-code", { kind: "config_options", options: [MODEL_OPTION, EFFORT_OPTION] })

    expect(notifications).toBe(0)
    expect(selectSessionDefaultApplyResult("claude-code")(store.getState())).toBe(result)
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

  it("keeps parent group presentation active until every child is terminal", () => {
    const store = workspaceStore()
    registerDelegatedChild(store, "child-1", "Research")
    publishDelegatedStatus(store, "child-1", "needs_input")
    registerDelegatedChild(store, "child-2", "Verify")
    publishDelegatedStatus(store, "child-2", "finished")

    const active = selectVisibleTabs(store.getState()).find((item) => item.id === "a")
    expect(active?.delegation).toEqual({
      kind: "parent",
      childCount: 2,
      groupStatus: "active",
      groupLabel: "Group active",
    })

    publishDelegatedStatus(store, "child-1", "running")
    publishDelegatedStatus(store, "child-1", "finished")
    const settled = selectVisibleTabs(store.getState()).find((item) => item.id === "a")
    expect(settled?.delegation).toEqual({
      kind: "parent",
      childCount: 2,
      groupStatus: "settled",
      groupLabel: "Group settled",
    })
  })

  it("does not notify visible tabs when only a background child's active lifecycle changes", () => {
    const store = workspaceStore()
    registerDelegatedChild(store)
    const before = selectVisibleTabs(store.getState())
    let notifications = 0
    const stop = store.subscribeSelector(selectVisibleTabs, () => notifications++)

    publishDelegatedStatus(store, "child", "running")
    publishDelegatedStatus(store, "child", "needs_input")

    expect(selectVisibleTabs(store.getState())).toBe(before)
    expect(notifications).toBe(0)
    stop()
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

describe("transcript projection selectors", () => {
  const addProjectionFixture = (store: AppStore, sessionId: "claude-code" | "codex") => {
    store.applyEvent(sessionId, { kind: "user_message", messageId: "u0", text: "zero" })
    store.applyEvent(sessionId, {
      kind: "tool_call",
      call: {
        toolCallId: "historical-tool",
        kind: "edit",
        title: "Historical edit",
        status: "completed",
        locations: [],
      },
    })
    store.applyEvent(sessionId, { kind: "user_message", messageId: "u2", text: "two" })
    store.applyEvent(sessionId, { kind: "agent_message", messageId: "a3", textDelta: "three" })
    store.applyEvent(sessionId, { kind: "user_message", messageId: "u4", text: "four" })
    store.applyEvent(sessionId, { kind: "agent_message", messageId: "a5", textDelta: "five" })
  }

  it("projects stable per-session windows and complete disabled presentations", () => {
    const store = createAppStore()
    addProjectionFixture(store, "claude-code")
    const selectWindow = selectSessionTranscriptWindow("claude-code")
    const selectProjection = selectSessionTranscriptProjection("claude-code", {
      enabled: false,
      tailTurnCount: 2,
    })
    const window = selectWindow(store.getState())
    const projection = selectProjection(store.getState())

    expect(window).toEqual({ revealedTurnCount: 0, detachedFromLive: false, scrollTop: null })
    expect(projection.hiddenTurnCount).toBe(0)
    expect(projection.rows).toHaveLength(6)
    expect(projection.rows.every((row) => row.kind === "turn")).toBe(true)

    store.setTranscriptDetached("claude-code", true)
    store.captureTranscriptScrollTop("claude-code", 4)
    store.revealTranscriptHistory("claude-code", 2)
    store.applyEvent("claude-code", { kind: "status", status: "working" })
    expect(selectProjection(store.getState())).toBe(projection)

    store.applyEvent("codex", { kind: "agent_message", messageId: "other", textDelta: "token" })
    expect(selectWindow(store.getState())).not.toBe(window)
    expect(selectProjection(store.getState())).toBe(projection)
  })

  it("protects only a matching approval tool and gives clarification no transcript ownership", () => {
    const store = createAppStore()
    addProjectionFixture(store, "claude-code")
    const selectProjection = selectSessionTranscriptProjection("claude-code", {
      enabled: true,
      tailTurnCount: 2,
    })
    const collapsed = selectProjection(store.getState())
    expect(collapsed.hiddenTurnCount).toBe(4)

    store.openApproval({
      sessionId: "codex",
      title: "Codex",
      cwd: "/work",
      request: { sessionId: "acp-codex", toolCall: { toolCallId: "historical-tool" }, options: [] },
    })
    expect(selectProjection(store.getState())).toBe(collapsed)

    store.openApproval({
      sessionId: "claude-code",
      title: "Claude",
      cwd: "/work",
      request: { sessionId: "acp-claude", toolCall: { toolCallId: "historical-tool" }, options: [] },
    })
    expect(selectProjection(store.getState()).hiddenTurnCount).toBe(1)

    store.closeApproval()
    const withoutApproval = selectProjection(store.getState())
    expect(withoutApproval.hiddenTurnCount).toBe(4)
    store.openClarification({
      requestId: "clarification-projection",
      generation: 1,
      sessionId: "claude-code",
      title: "Claude",
      cwd: "/work",
      payload: CLARIFICATION_PAYLOAD,
    })
    expect(selectProjection(store.getState())).toBe(withoutApproval)
  })

  it("keeps a focused projection subscription silent for background streams", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    addProjectionFixture(store, "claude-code")
    const selectProjection = selectFocusedTranscriptProjection({ enabled: true, tailTurnCount: 2 })
    const focusedWindow = selectFocusedTranscriptWindow(store.getState())
    const before = selectProjection(store.getState())
    const notifications: unknown[] = []
    store.subscribeSelector(selectProjection, (projection) => notifications.push(projection))

    store.applyEvent("codex", { kind: "agent_message", messageId: "background", textDelta: "token" })

    expect(selectProjection(store.getState())).toBe(before)
    expect(selectFocusedTranscriptWindow(store.getState())).toBe(focusedWindow)
    expect(notifications).toEqual([])
  })

  it("re-projects only the addressed session when history is revealed", () => {
    const store = createAppStore()
    addProjectionFixture(store, "claude-code")
    addProjectionFixture(store, "codex")
    const selectClaude = selectSessionTranscriptProjection("claude-code", {
      enabled: true,
      tailTurnCount: 2,
    })
    const selectCodex = selectSessionTranscriptProjection("codex", {
      enabled: true,
      tailTurnCount: 2,
    })
    const codexBefore = selectCodex(store.getState())
    const claudeBefore = selectClaude(store.getState())

    store.setTranscriptDetached("claude-code", true)
    store.captureTranscriptScrollTop("claude-code", 3)
    expect(selectClaude(store.getState())).toBe(claudeBefore)

    store.revealTranscriptHistory("claude-code", 2)

    expect(selectClaude(store.getState()).hiddenTurnCount).toBe(2)
    expect(selectCodex(store.getState())).toBe(codexBefore)
  })
})
