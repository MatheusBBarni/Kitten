import { describe, expect, it } from "bun:test"

import type { PermissionRequest } from "../agent/agentConnection.ts"
import { createSessionState, sessionReducer } from "../core/sessionReducer.ts"
import {
  assembleCandidate,
  sealCandidate,
} from "../core/contextPack.ts"
import { createSecretRedactor } from "../core/secretRedactor.ts"
import { createShellState } from "../core/shellReducer.ts"
import { countOccupiedDelegatedChildren } from "../core/orchestration.ts"
import {
  evaluateExplorePolicy,
  EXPLORE_RESTRICTIONS,
  type ExplorePolicySnapshot,
} from "../core/explorePolicy.ts"
import type { StatuslineLayout, StatuslinePreference } from "../core/statusline.ts"
import { HARNESS_DELIVERY_FAILED_NOTICE, isHarnessDeliveryNotice } from "../core/types.ts"
import type { ClarificationPayload, ContextBuildBinding, ContextPackReviewCandidate, DraftContextPack, DomainSessionEvent, HandoffBundle, ManagedWorktreeBinding, SealedContextPack, SessionId, SessionSeed, SessionState } from "../core/types.ts"
import {
  createAppStore,
  defaultSessionSeeds,
  type AppStore,
  type AppState,
  type StatuslineModalPhase,
} from "./appStore.ts"
import {
  selectApprovalOverlay,
  selectActiveModal,
  selectClarificationCapability,
  selectDelegatedChild,
  selectDelegatedChildIds,
  selectDelegationGroupStatus,
  selectDelegationParent,
  selectDelegationOverlay,
  selectClarificationOverlay,
  selectHandoffPreview,
  selectFocusedPane,
  selectFocusedHarnessDeliveryNotice,
  selectHarnessDeliveryNotice,
  selectHasOpenOverlay,
  selectIsFocused,
  selectKeyboardCapability,
  selectRestoration,
  selectRestorationBundle,
  selectSessionPicker,
  selectShell,
  selectSessionPromptHistory,
  selectSessionSteeringRecovery,
  selectSessionSteeringStatus,
  selectSessionStatus,
  selectSessionTurns,
  selectTabDialogOverlay,
  selectSettingsOverlay,
  selectStatuslineOverlay,
  selectStatuslinePreference,
  selectThemePreference,
} from "./selectors.ts"

describe("steering store integration", () => {
  it("routes enqueue and recovery acknowledgement through the reducer", () => {
    const store = createAppStore()
    const before = store.getState()
    const untouched = before.sessions.codex
    const workspace = before.workspace

    store.applyEvent("claude-code", {
      kind: "steering_enqueue",
      activeTurnId: "turn-active",
      requestId: "steer-1",
      generation: 7,
      blocks: [{ type: "text", text: "restore exactly" }],
    })
    store.applyEvent("claude-code", {
      kind: "steering_recover",
      requestId: "steer-1",
      generation: 7,
    })

    const failed = store.getState()
    expect(failed.sessions.codex).toBe(untouched)
    expect(failed.workspace).toBe(workspace)
    expect(selectSessionSteeringRecovery("claude-code")(failed)).toEqual({
      requestId: "steer-1",
      blocks: [{ type: "text", text: "restore exactly" }],
    })

    store.acknowledgeSteeringRecovery("claude-code", "stale")
    expect(store.getState()).toBe(failed)

    store.acknowledgeSteeringRecovery("claude-code", "steer-1")
    const acknowledged = store.getState()
    expect(acknowledged.sessions["claude-code"]?.steering).toEqual({
      activeTurnId: null,
      queue: [],
      recovery: null,
    })
    expect(acknowledged.sessions.codex).toBe(untouched)
    expect(acknowledged.workspace).toBe(workspace)
  })

  it("keeps selected steering subscribers silent for tokens and other sessions", () => {
    const store = createAppStore()
    const selector = selectSessionSteeringStatus("claude-code")
    const selected = selector(store.getState())
    let notifications = 0
    store.subscribeSelector(selector, () => {
      notifications += 1
    })

    store.applyEvent("claude-code", {
      kind: "agent_message",
      messageId: "stream",
      textDelta: "token",
    })
    store.applyEvent("codex", {
      kind: "steering_enqueue",
      activeTurnId: "turn-other",
      requestId: "steer-other",
      generation: 2,
      blocks: [{ type: "text", text: "other session" }],
    })

    expect(selector(store.getState())).toBe(selected)
    expect(notifications).toBe(0)
  })

  it("publishes focused recovery only for target recovery and acknowledgement", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", {
      kind: "steering_enqueue",
      activeTurnId: "turn-active",
      requestId: "steer-1",
      generation: 7,
      blocks: [{ type: "text", text: "recover me" }],
    })
    const selector = selectSessionSteeringRecovery("claude-code")
    const publications: unknown[] = []
    store.subscribeSelector(selector, (recovery) => {
      publications.push(recovery)
    })

    store.applyEvent("codex", {
      kind: "steering_enqueue",
      activeTurnId: "turn-other",
      requestId: "steer-other",
      generation: 2,
      blocks: [{ type: "text", text: "other session" }],
    })
    store.applyEvent("claude-code", {
      kind: "steering_recover",
      requestId: "steer-1",
      generation: 7,
    })
    store.applyEvent("claude-code", {
      kind: "agent_message",
      messageId: "stream",
      textDelta: "token",
    })
    store.acknowledgeSteeringRecovery("claude-code", "steer-1")

    expect(publications).toEqual([
      {
        requestId: "steer-1",
        blocks: [{ type: "text", text: "recover me" }],
      },
      null,
    ])
  })
})

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

const STATUSLINE_LAYOUT: StatuslineLayout = {
  separator: " · ",
  line: ["FOLDER", { kind: "ELLIPSIS_BRANCH", maxChars: 24 }, "MODEL"],
}

const SAVED_STATUSLINE: StatuslinePreference = {
  llmDisclosureAcknowledged: true,
  layout: STATUSLINE_LAYOUT,
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

const message = (messageId: string, textDelta: string): DomainSessionEvent => ({
  kind: "agent_message",
  messageId,
  textDelta,
})

const delegatedChildSeed: SessionSeed = {
  id: "delegated-child",
  providerKind: "codex",
  title: "Delegated child",
  cwd: "/work/child",
}

const managedBinding: ManagedWorktreeBinding = {
  kind: "managed",
  id: "managed-child",
  repoRoot: "/repo",
  worktreePath: "/repo/.kitten/worktrees/managed-child",
  branch: "kitten/managed-child",
  baseBranch: "main",
  baseSha: "abc123",
  ownerSessionId: "managed-child",
  availability: "unverified",
}

const managedChildSeed: SessionSeed = {
  ...delegatedChildSeed,
  id: managedBinding.ownerSessionId,
  cwd: managedBinding.worktreePath,
  worktreeBinding: managedBinding,
}

function acceptedPolicy(perParent = 3, global = 6): ExplorePolicySnapshot {
  const decision = evaluateExplorePolicy({
    role: "explore",
    restrictions: EXPLORE_RESTRICTIONS,
    limits: { perParent, global },
    attestationVersion: "app-store-test-v1",
    confirmed: { provider: "codex", model: "test-model", effort: "high" },
  })
  if (decision.kind !== "eligible") throw new Error("expected eligible policy fixture")
  return decision.policy
}

const delegatedRegistration = (policy = acceptedPolicy()) => ({
  seed: delegatedChildSeed,
  parentId: "claude-code",
  parentGeneration: 4,
  childGeneration: 1,
  task: "Inspect the parser",
  desiredOutcome: "Report concrete failure modes",
  policy,
})

const delegatedIdentity = {
  parentId: "claude-code",
  childId: "delegated-child",
  parentGeneration: 4,
  childGeneration: 1,
} as const

/** Record every value a narrow subscription is notified with. */
function trackSelector<T>(store: AppStore, selector: (state: AppState) => T): T[] {
  const seen: T[] = []
  store.subscribeSelector(selector, (value) => seen.push(value))
  return seen
}

describe("createAppStore", () => {
  it("starts all providers empty and idle, unfocused overlays, focus on the first provider", () => {
    const state = createAppStore().getState()
    expect(state.sessions["claude-code"]).toEqual(createSessionState(seed("claude-code")))
    expect(state.sessions.codex).toEqual(createSessionState(seed("codex")))
    expect(state.sessions.cursor).toEqual(createSessionState(seed("cursor")))
    expect(state.delegation).toEqual({ parents: {}, children: {} })
    expect(state.workspace.order).toEqual(["claude-code", "codex", "cursor"])
    expect(state.workspace.selectedVisibleId).toBe("claude-code")
    expect(state.focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })
    expect(state.shell).toEqual(createShellState())
    expect(selectKeyboardCapability(state)).toBe("unknown")
    expect(state.overlays).toEqual({
      approval: null,
      clarification: null,
      delegation: null,
      handoffPreview: null,
      handoffTarget: null,
      modelSelect: null,
      settings: null,
      statusline: null,
      tabDialog: null,
      sessions: false,
      sessionPicker: false,
    })
    expect(state.restoration).toEqual({ "claude-code": null, codex: null, cursor: null })
    expect(state.restorationBundle).toBeNull()
    expect(state.preferences).toEqual({
      theme: "auto",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    })
    expect(selectClarificationCapability("claude-code")(state)).toEqual({
      status: "unsupported",
      reason: "unknown_recipe",
    })
  })

  it("promotes Kitty keyboard capability once without disturbing durable workspace state", () => {
    const store = createAppStore()
    const before = store.getState()
    let notifications = 0
    store.subscribe(() => notifications++)

    store.confirmKittyKeyboard()

    const confirmed = store.getState()
    expect(selectKeyboardCapability(confirmed)).toBe("kittyConfirmed")
    expect(confirmed.workspace).toBe(before.workspace)
    expect(confirmed.sessions).toBe(before.sessions)
    expect(notifications).toBe(1)

    store.confirmKittyKeyboard()
    expect(store.getState()).toBe(confirmed)
    expect(notifications).toBe(1)
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
  it("routes clarification status through the reducer and preserves the other session identity", () => {
    const store = createAppStore()
    store.applyEvent("claude-code", message("m1", "Need input"))
    store.applyEvent("claude-code", { kind: "plan", entries: [{ content: "Await decision" }] })
    const before = store.getState()
    const targetBefore = before.sessions["claude-code"]!
    const otherBefore = before.sessions.codex

    store.applyEvent("claude-code", { kind: "status", status: "awaiting_clarification" })

    const after = store.getState()
    expect(after.sessions["claude-code"]!.status).toBe("awaiting_clarification")
    expect(after.sessions["claude-code"]!.turns).toBe(targetBefore.turns)
    expect(after.sessions["claude-code"]!.plan).toBe(targetBefore.plan)
    expect(after.sessions.codex).toBe(otherBefore)
    expect(after.workspace.conversations["claude-code"]!.attention).toMatchObject({
      status: "awaiting_clarification",
      seen: false,
    })
  })

  it("routes prompt history to the addressed session and preserves the other session identity", () => {
    const store = createAppStore()
    const before = store.getState()
    const focusedHistories = trackSelector(store, selectSessionPromptHistory("claude-code"))
    const otherHistories = trackSelector(store, selectSessionPromptHistory("codex"))

    expect(before.workspace.selectedVisibleId).toBe("claude-code")

    store.applyEvent("claude-code", {
      kind: "prompt_history",
      action: "record",
      text: "remember this",
    })
    store.applyEvent("claude-code", { kind: "prompt_history", action: "previous" })

    const after = store.getState()
    expect(selectSessionPromptHistory("claude-code")(after)).toEqual({
      entries: ["remember this"],
      cursor: 0,
    })
    expect(after.sessions.codex).toBe(before.sessions.codex)
    expect(selectSessionPromptHistory("codex")(after)).toBe(before.sessions.codex!.promptHistory)
    expect(focusedHistories).toEqual([
      { entries: ["remember this"], cursor: null },
      { entries: ["remember this"], cursor: 0 },
    ])
    expect(otherHistories).toEqual([])
  })

  it("routes commands through the reducer to only the addressed session", () => {
    const store = createAppStore()
    const before = store.getState()
    const commands = [
      { name: "review", description: "Review the current diff", hint: "[scope]" },
      { name: "test", description: "Run the test suite" },
    ]

    store.applyEvent("claude-code", { kind: "commands", commands })

    const after = store.getState()
    expect(after.sessions["claude-code"]!.commands).toBe(commands)
    expect(after.sessions.codex).toBe(before.sessions.codex)
    expect(after.sessions.codex!.commands).toEqual([])
  })

  it("applies usage to the target session while preserving the other session slice", () => {
    const store = createAppStore()
    const before = store.getState()

    store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })

    const after = store.getState()
    expect(after.sessions["claude-code"]!.usage).toEqual({ used: 124_000, size: 200_000 })
    expect(after.sessions.codex).toBe(before.sessions.codex)
  })

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

  it("preserves and explicitly clears a tool-call failure kind through the public store", () => {
    const store = createAppStore()
    store.setFocus("codex")

    const events: DomainSessionEvent[] = [
      {
        kind: "tool_call",
        call: {
          toolCallId: "capacity-1",
          title: "Start delegated agent",
          status: "failed",
          locations: ["src/agent.ts"],
          failureKind: "temporary_capacity",
        },
      },
      {
        kind: "tool_call",
        call: { toolCallId: "capacity-1", status: "in_progress" },
      },
    ]

    for (const event of events) store.applyEvent("codex", event)

    const preserved = store.getState()
    expect(preserved.workspace.selectedVisibleId).toBe("codex")
    expect(selectSessionTurns("codex")(preserved)).toEqual([
      {
        kind: "tool_call",
        record: {
          toolCallId: "capacity-1",
          kind: "other",
          title: "Start delegated agent",
          status: "in_progress",
          locations: ["src/agent.ts"],
          failureKind: "temporary_capacity",
        },
      },
    ])

    store.applyEvent("codex", {
      kind: "tool_call",
      call: { toolCallId: "capacity-1", status: "failed", failureKind: null },
    })

    expect(selectSessionTurns("codex")(store.getState())).toEqual([
      {
        kind: "tool_call",
        record: {
          toolCallId: "capacity-1",
          kind: "other",
          title: "Start delegated agent",
          status: "failed",
          locations: ["src/agent.ts"],
        },
      },
    ])
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

  it("recreates the addressed session with empty prompt history", () => {
    const store = createAppStore()
    store.applyEvent("codex", {
      kind: "prompt_history",
      action: "record",
      text: "prior run prompt",
    })
    const priorHistory = selectSessionPromptHistory("codex")(store.getState())

    store.startSession("codex", "session-new-run")

    const freshHistory = selectSessionPromptHistory("codex")(store.getState())
    expect(freshHistory).toEqual({ entries: [], cursor: null })
    expect(freshHistory).not.toBe(priorHistory)
  })

  it("resets ACP execution state without removing a managed-worktree binding", () => {
    const store = createAppStore({ seeds: [managedChildSeed] })
    store.applyEvent(managedChildSeed.id, message("m1", "stale"))
    store.applyEvent(managedChildSeed.id, { kind: "status", status: "working" })

    store.startSession(managedChildSeed.id, "acp-managed")

    const session = store.getState().sessions[managedChildSeed.id]!
    expect(session.acpSessionId).toBe("acp-managed")
    expect(session.turns).toEqual([])
    expect(session.status).toBe("idle")
    expect(session.worktreeBinding).toBe(managedBinding)
  })
})

describe("managed-worktree binding publication", () => {
  it("is a complete no-op for unknown sessions, mismatched owners, and semantic repeats", () => {
    const store = createAppStore({ seeds: [managedChildSeed] })
    const initial = store.getState()
    const observed: AppState[] = []
    store.subscribe((state) => observed.push(state))

    store.publishManagedWorktreeBinding("missing", {
      ...managedBinding,
      ownerSessionId: "missing",
    })
    store.publishManagedWorktreeBinding(managedChildSeed.id, {
      ...managedBinding,
      ownerSessionId: "another-session",
    })
    store.publishManagedWorktreeBinding(managedChildSeed.id, { ...managedBinding })

    expect(store.getState()).toBe(initial)
    expect(observed).toEqual([])
  })

  it("replaces only the addressed session for a valid controller publication", () => {
    const sibling: SessionSeed = {
      id: "sibling",
      providerKind: "claude-code",
      title: "Sibling",
      cwd: "/repo",
    }
    const store = createAppStore({ seeds: [managedChildSeed, sibling] })
    const before = store.getState()
    const available = { ...managedBinding, availability: "available" as const }

    store.publishManagedWorktreeBinding(managedChildSeed.id, available)

    const after = store.getState()
    expect(after).not.toBe(before)
    expect(after.sessions).not.toBe(before.sessions)
    expect(after.sessions[managedChildSeed.id]).not.toBe(before.sessions[managedChildSeed.id])
    expect(after.sessions[managedChildSeed.id]?.worktreeBinding).toBe(available)
    expect(after.sessions.sibling).toBe(before.sessions.sibling)
    expect(after.workspace).toBe(before.workspace)
    expect(after.delegation).toBe(before.delegation)
    expect(after.overlays).toBe(before.overlays)
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
  it("captures only the focused parent for delegation and suppresses focus changes", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const before = store.getState()

    store.openDelegation({ parentId: "claude-code" })
    const opened = store.getState()
    expect(selectDelegationOverlay(opened)).toEqual({ parentId: "claude-code" })
    expect(Object.keys(opened.overlays.delegation!)).toEqual(["parentId"])
    expect(opened.workspace).toBe(before.workspace)
    expect(opened.focusedPane).toBe(before.focusedPane)

    store.setFocus("codex")
    expect(store.getState().workspace.selectedVisibleId).toBe("claude-code")
    store.closeDelegation()
    expect(selectDelegationOverlay(store.getState())).toBeNull()
  })

  it("refuses delegation without a focused parent or while another modal is open", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.openDelegation({ parentId: "codex" })
    expect(store.getState().overlays.delegation).toBeNull()

    store.openSettings()
    store.openDelegation({ parentId: "claude-code" })
    expect(store.getState().overlays.delegation).toBeNull()
  })

  it("projects clarification independently and preserves every unrelated reference on open and close", () => {
    const store = createAppStore()
    store.openApproval({ sessionId: "codex", title: "Codex", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })
    store.openHandoffPreview({ sourceSessionId: "codex", targetSessionId: "claude-code", bundle: HANDOFF_BUNDLE, targetConfigOptions: [] })
    store.openHandoffTarget({ sourceSessionId: "codex" })
    store.openSettings()
    store.openSessions()
    store.openSessionPicker()
    const before = store.getState()
    const overlay = {
      requestId: "clarification-1",
      generation: 7,
      sessionId: "claude-code" as SessionId,
      title: "Claude Code",
      cwd: "/workspace/kitten",
      payload: CLARIFICATION_PAYLOAD,
    }

    store.openClarification(overlay)

    const opened = store.getState()
    expect(selectClarificationOverlay(opened)).toBe(overlay)
    expect(opened.overlays.approval).toBe(before.overlays.approval)
    expect(opened.overlays.handoffPreview).toBe(before.overlays.handoffPreview)
    expect(opened.overlays.handoffTarget).toBe(before.overlays.handoffTarget)
    expect(opened.overlays.settings).toBe(before.overlays.settings)
    expect(opened.overlays.sessions).toBe(before.overlays.sessions)
    expect(opened.overlays.sessionPicker).toBe(before.overlays.sessionPicker)
    expect(opened.sessions).toBe(before.sessions)
    expect(opened.workspace).toBe(before.workspace)
    expect(opened.preferences).toBe(before.preferences)
    expect(opened.restoration).toBe(before.restoration)
    expect(opened.clarificationCapabilities).toBe(before.clarificationCapabilities)

    store.closeClarification()

    const closed = store.getState()
    expect(selectClarificationOverlay(closed)).toBeNull()
    expect(closed.overlays.approval).toBe(before.overlays.approval)
    expect(closed.overlays.handoffPreview).toBe(before.overlays.handoffPreview)
    expect(closed.overlays.handoffTarget).toBe(before.overlays.handoffTarget)
    expect(closed.overlays.settings).toBe(before.overlays.settings)
    expect(closed.overlays.sessions).toBe(before.overlays.sessions)
    expect(closed.overlays.sessionPicker).toBe(before.overlays.sessionPicker)
    expect(closed.sessions).toBe(before.sessions)
    expect(closed.workspace).toBe(before.workspace)
    expect(closed.preferences).toBe(before.preferences)
  })

  it("exposes an opened approval request and clears it on close", () => {
    const store = createAppStore()
    const overlay = { sessionId: "claude-code" as SessionId, title: "Claude Code", cwd: "/workspace/kitten", request: APPROVAL_REQUEST }

    store.openApproval(overlay)
    expect(selectApprovalOverlay(store.getState())).toEqual(overlay)

    store.closeApproval()
    store.closeClarification()
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
    const store = createAppStore({ selectedVisibleId: "codex" })
    const overlay = { sessionId: "codex" as SessionId }

    store.openModelSelect(overlay)
    expect(store.getState().overlays.modelSelect).toEqual(overlay)

    store.closeModelSelect()
    expect(store.getState().overlays.modelSelect).toBeNull()
  })

  it("keeps the model selector independent of the approval slot", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.openApproval({ sessionId: "codex", title: "Codex", cwd: "/workspace/kitten", request: APPROVAL_REQUEST })
    store.openModelSelect({ sessionId: "claude-code" })

    store.closeModelSelect()

    const overlays = store.getState().overlays
    expect(overlays.modelSelect).toBeNull()
    expect(overlays.approval?.sessionId).toBe("codex")
  })

  it("rejects model selectors without the exact selected Visible conversation", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })

    store.openModelSelect({ sessionId: "codex" })
    expect(store.getState().overlays.modelSelect).toBeNull()

    store.backgroundConversation("claude-code")
    store.backgroundConversation("codex")
    store.backgroundConversation("cursor")
    expect(store.getState().workspace.selectedVisibleId).toBeNull()
    store.openModelSelect({ sessionId: "codex" })
    expect(store.getState().overlays.modelSelect).toBeNull()
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

describe("clarification capability state", () => {
  it("updates one session capability without disturbing overlays or session state", () => {
    const store = createAppStore()
    const before = store.getState()
    const capability = {
      status: "supported" as const,
      adapterPackage: "@agentclientprotocol/codex-acp",
      adapterVersion: "1.1.2",
    }

    store.setClarificationCapability("codex", capability)

    const after = store.getState()
    expect(selectClarificationCapability("codex")(after)).toEqual(capability)
    expect(selectClarificationCapability("claude-code")(after)).toEqual({
      status: "unsupported",
      reason: "unknown_recipe",
    })
    expect(after.sessions).toBe(before.sessions)
    expect(after.workspace).toBe(before.workspace)
    expect(after.overlays).toBe(before.overlays)
    expect(after.preferences).toBe(before.preferences)

    store.setClarificationCapability("codex", capability)
    expect(store.getState()).toBe(after)
  })
})

describe("harness delivery recovery notice", () => {
  it("projects one failed session without replacing sibling or unrelated state", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const before = store.getState()
    const codexSession = before.sessions.codex

    store.setHarnessDelivery("claude-code", {
      version: "v1",
      generation: 3,
      state: "failed",
      failureCategory: "unsupported_profile",
    })

    const after = store.getState()
    expect(selectHarnessDeliveryNotice("claude-code")(after)).toBe(HARNESS_DELIVERY_FAILED_NOTICE)
    expect(selectFocusedHarnessDeliveryNotice(after)).toBe(HARNESS_DELIVERY_FAILED_NOTICE)
    expect(selectHarnessDeliveryNotice("codex")(after)).toBeNull()
    expect(after.sessions.codex).toBe(codexSession)
    expect(after.sessions).toBe(before.sessions)
    expect(after.workspace).toBe(before.workspace)
    expect(after.overlays).toBe(before.overlays)
    expect(after.preferences).toBe(before.preferences)

    store.setHarnessDelivery("claude-code", {
      version: "v1",
      generation: 3,
      state: "failed",
      failureCategory: "unsupported_profile",
    })
    expect(store.getState()).toBe(after)
  })

  it("clears the failed notice when a successful replacement publishes a healthy state", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.setHarnessDelivery("claude-code", {
      version: "v1",
      generation: 1,
      state: "failed",
      failureCategory: "dispatch_indeterminate",
    })
    expect(selectFocusedHarnessDeliveryNotice(store.getState())).not.toBeNull()

    for (const state of ["pending", "delivered", "not_required"] as const) {
      store.setHarnessDelivery("claude-code", { version: "v1", generation: 2, state })
      expect(selectFocusedHarnessDeliveryNotice(store.getState())).toBeNull()
    }
  })

  it("accepts only the exact fixed notice fields", () => {
    expect(isHarnessDeliveryNotice(HARNESS_DELIVERY_FAILED_NOTICE)).toBe(true)
    for (const extra of [
      { harnessText: "synthetic harness" },
      { taskText: "private task" },
      { profileId: "claude-certified" },
      { version: "v1" },
      { path: "/private/repo" },
      { rawError: "adapter exploded" },
      { acpSessionId: "provider-session" },
    ]) {
      expect(isHarnessDeliveryNotice({ ...HARNESS_DELIVERY_FAILED_NOTICE, ...extra })).toBe(false)
    }
    expect(Object.keys(HARNESS_DELIVERY_FAILED_NOTICE).sort()).toEqual([
      "reason",
      "recoveryAction",
      "state",
    ])
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
    expect(afterChange.preferences).toEqual({
      theme: "dark",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    })
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

  it("changes only the statusline preference and treats equal resolved writes as no-ops", () => {
    const store = createAppStore()
    const before = store.getState()
    const notifications = trackSelector(store, selectStatuslinePreference)

    store.setStatuslinePreference(SAVED_STATUSLINE)

    const changed = store.getState()
    expect(selectStatuslinePreference(changed)).toBe(SAVED_STATUSLINE)
    expect(changed.preferences).not.toBe(before.preferences)
    expect(changed.sessions).toBe(before.sessions)
    expect(changed.overlays).toBe(before.overlays)
    expect(changed.shell).toBe(before.shell)
    expect(notifications).toEqual([SAVED_STATUSLINE])

    store.setStatuslinePreference({
      llmDisclosureAcknowledged: true,
      layout: {
        separator: " · ",
        line: ["FOLDER", { kind: "ELLIPSIS_BRANCH", maxChars: 24 }, "MODEL"],
      },
    })

    expect(store.getState()).toBe(changed)
    expect(notifications).toEqual([SAVED_STATUSLINE])
  })

  it("does not notify the saved preference for session, shell, or unrelated overlay updates", () => {
    const store = createAppStore({ preferences: { statusline: SAVED_STATUSLINE } })
    const notifications = trackSelector(store, selectStatuslinePreference)

    store.applyEvent("codex", message("stream-1", "delta"))
    store.applyShellEvent({ kind: "cwd_changed", cwd: "/workspace/other" })
    store.openApproval({
      sessionId: "claude-code",
      title: "Claude Code",
      cwd: "/workspace/kitten",
      request: APPROVAL_REQUEST,
    })

    expect(notifications).toEqual([])
  })
})

describe("statusline modal state", () => {
  const phases: readonly StatuslineModalPhase[] = [
    { phase: "disclosure" },
    { phase: "request", requestText: "folder then compact branch" },
    { phase: "waiting", requestText: "folder then compact branch" },
    {
      phase: "preview",
      requestText: "folder then compact branch",
      layout: STATUSLINE_LAYOUT,
      preset: null,
    },
    {
      phase: "failure",
      requestText: "folder then compact branch",
      reason: "The response did not contain one fenced JSON proposal.",
    },
    {
      phase: "presets",
      requestText: "folder then compact branch",
      reason: "Choose a recovery layout.",
      selectedPreset: "Compact",
    },
  ]

  it("opens every valid phase with its selected session and transient payload", () => {
    for (const state of phases) {
      const store = createAppStore({ preferences: { statusline: SAVED_STATUSLINE } })
      const preference = selectStatuslinePreference(store.getState())

      store.openStatusline({ sessionId: "codex", ...state })

      expect(selectStatuslineOverlay(store.getState())).toEqual({ sessionId: "codex", ...state })
      expect(selectStatuslinePreference(store.getState())).toBe(preference)
      expect(selectHasOpenOverlay(store.getState())).toBe(true)
      expect(selectActiveModal(store.getState())).toEqual({ kind: "statusline", sessionId: "codex" })
    }
  })

  it("updates the phase without changing the captured session or saved preference", () => {
    const store = createAppStore({ preferences: { statusline: SAVED_STATUSLINE } })
    store.openStatusline({ sessionId: "codex", phase: "request", requestText: "compact" })
    const preference = selectStatuslinePreference(store.getState())

    const preview: StatuslineModalPhase = {
      phase: "preview",
      requestText: "compact",
      layout: STATUSLINE_LAYOUT,
      preset: "Compact",
    }
    store.updateStatusline(preview)

    expect(selectStatuslineOverlay(store.getState())).toEqual({ sessionId: "codex", ...preview })
    expect(selectStatuslinePreference(store.getState())).toBe(preference)
  })

  it("closing or cancelling a preview clears transient data and preserves the saved layout", () => {
    const store = createAppStore({ preferences: { statusline: SAVED_STATUSLINE } })
    store.openStatusline({
      sessionId: "claude-code",
      phase: "preview",
      requestText: "agent details",
      layout: STATUSLINE_LAYOUT,
      preset: null,
    })
    const preference = selectStatuslinePreference(store.getState())

    store.closeStatusline()

    const closed = store.getState()
    expect(selectStatuslineOverlay(closed)).toBeNull()
    expect(selectStatuslinePreference(closed)).toBe(preference)
    expect(selectStatuslinePreference(closed).layout).toBe(STATUSLINE_LAYOUT)

    store.closeStatusline()
    expect(store.getState()).toBe(closed)
  })

  it("ignores phase updates while the modal is closed", () => {
    const store = createAppStore()
    const before = store.getState()

    store.updateStatusline({ phase: "request", requestText: "ignored" })

    expect(store.getState()).toBe(before)
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
    expect(themed.preferences).toEqual({
      theme: "dark",
      statusline: { llmDisclosureAcknowledged: false, layout: null },
    })
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

  it("atomically replaces runtime placeholders with persisted workspace identity and order", () => {
    const store = createAppStore()
    const background: SessionSeed = {
      id: "background",
      providerKind: "codex",
      title: "Background",
      cwd: "/work/background",
    }
    const visible: SessionSeed = {
      id: "visible",
      providerKind: "claude-code",
      title: "Visible",
      cwd: "/work/visible",
    }

    store.replaceSessions(
      [
        {
          seed: background,
          workspace: {
            sessionId: "background",
            displayName: "Review API",
            lifecycle: "background",
            createdOrdinal: 7,
            availability: { kind: "starting" },
            attention: { status: "finished", seen: false, sequence: 4 },
          },
        },
        {
          seed: visible,
          workspace: {
            sessionId: "visible",
            displayName: "Build CLI",
            createdOrdinal: 9,
            availability: { kind: "starting" },
          },
        },
      ],
      "visible",
    )

    const state = store.getState()
    expect(Object.keys(state.sessions)).toEqual(["background", "visible"])
    expect(state.workspace.order).toEqual(["background", "visible"])
    expect(state.workspace.selectedVisibleId).toBe("visible")
    expect(state.workspace.conversations.background).toMatchObject({
      displayName: "Review API",
      lifecycle: "background",
      createdOrdinal: 7,
      attention: { status: "finished", seen: false, sequence: 4 },
    })
  })

  it("can bind a restored ACP id without resetting persisted attention", () => {
    const store = createAppStore({ seeds: [] })
    const restored: SessionSeed = {
      id: "restored",
      providerKind: "codex",
      title: "Restored",
      cwd: "/work/restored",
    }
    store.replaceSessions(
      [
        {
          seed: restored,
          workspace: {
            sessionId: "restored",
            displayName: "Restored",
            attention: { status: "finished", seen: false, sequence: 3 },
          },
        },
      ],
      "restored",
    )

    store.startSession("restored", "acp-restored", { preserveWorkspaceAttention: true })

    expect(store.getState().sessions.restored?.acpSessionId).toBe("acp-restored")
    expect(store.getState().workspace.conversations.restored?.attention).toEqual({
      status: "finished",
      seen: false,
      sequence: 3,
    })
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

  it("immutably opens, replaces, and closes the one tab-dialog slot under aggregate gating", () => {
    const store = createAppStore()
    const initial = store.getState()

    store.openTabDialog({ kind: "rename", sessionId: "claude-code" })
    const renamed = store.getState()
    expect(renamed).not.toBe(initial)
    expect(renamed.sessions).toBe(initial.sessions)
    expect(renamed.workspace).toBe(initial.workspace)
    expect(selectTabDialogOverlay(renamed)).toEqual({ kind: "rename", sessionId: "claude-code" })
    expect(selectHasOpenOverlay(renamed)).toBe(true)
    expect(selectActiveModal(renamed)).toEqual({ kind: "tab-dialog", sessionId: "claude-code" })

    store.openTabDialog({ kind: "close", sessionId: "codex" })
    const replaced = store.getState()
    expect(replaced.overlays.tabDialog).toEqual({ kind: "close", sessionId: "codex" })
    expect(replaced.overlays.approval).toBeNull()

    store.removeSession("codex")
    const closed = store.getState()
    expect(closed.overlays.tabDialog).toBeNull()
    expect(selectHasOpenOverlay(closed)).toBe(false)
  })
})

describe("delegated session store integration", () => {
  it("retains managed binding state through delegated insertion and restore replacement", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const registration = { ...delegatedRegistration(), seed: managedChildSeed }

    expect(store.addDelegatedSession(registration)).toEqual({ kind: "accepted" })
    expect(store.getState().sessions[managedChildSeed.id]?.worktreeBinding).toBe(managedBinding)
    expect(selectDelegatedChild(managedChildSeed.id)(store.getState())).not.toBeNull()

    store.replaceSessions(
      [{
        seed: managedChildSeed,
        workspace: { sessionId: managedChildSeed.id, displayName: "Managed review" },
      }],
      managedChildSeed.id,
    )

    const restored = store.getState()
    expect(restored.sessions[managedChildSeed.id]?.worktreeBinding).toBe(managedBinding)
    expect(restored.delegation).toEqual({ parents: {}, children: {} })
    expect(selectDelegatedChild(managedChildSeed.id)(restored)).toBeNull()
  })

  it("notifies once with the child session, background workspace entry, and ownership together", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const observed: AppState[] = []
    store.subscribe((state) => observed.push(state))

    const policy = acceptedPolicy()
    const result = store.addDelegatedSession(delegatedRegistration(policy))

    expect(result).toEqual({ kind: "accepted" })
    expect(observed).toHaveLength(1)
    const inserted = observed[0]!
    expect(inserted.sessions[delegatedChildSeed.id]).toEqual(createSessionState(delegatedChildSeed))
    expect(inserted.workspace.conversations[delegatedChildSeed.id]).toMatchObject({
      lifecycle: "background",
      availability: { kind: "starting" },
    })
    expect(selectDelegatedChild(delegatedChildSeed.id)(inserted)).toMatchObject({
      childId: delegatedChildSeed.id,
      parentId: "claude-code",
      status: "starting",
      policy,
    })
    expect(selectDelegatedChild(delegatedChildSeed.id)(inserted)?.policy).toBe(policy)
  })

  it("atomically registers a child for a background parent without changing visible selection", () => {
    const store = createAppStore({ selectedVisibleId: "codex" })
    store.backgroundConversation("claude-code")
    store.openSettings()
    const before = store.getState()
    const observed: Array<{ state: AppState; previous: AppState }> = []
    store.subscribe((state, previous) => observed.push({ state, previous }))
    const childSeed: SessionSeed = {
      ...delegatedChildSeed,
      providerKind: "claude-code",
    }

    const result = store.addDelegatedSession({
      ...delegatedRegistration(),
      seed: childSeed,
    })

    expect(result).toEqual({ kind: "accepted" })
    expect(observed).toHaveLength(1)
    expect(observed[0]?.previous).toBe(before)
    const inserted = observed[0]!.state
    expect(inserted.workspace.selectedVisibleId).toBe("codex")
    expect(inserted.workspace.conversations[childSeed.id]).toMatchObject({
      lifecycle: "background",
      availability: { kind: "starting" },
    })
    expect(selectDelegatedChild(childSeed.id)(inserted)).toMatchObject({
      childId: childSeed.id,
      parentId: "claude-code",
      parentGeneration: 4,
      childGeneration: 1,
      status: "starting",
    })
    expect(inserted.focusedPane).toBe(before.focusedPane)
    expect(inserted.overlays).toBe(before.overlays)
    for (const id of ["claude-code", "codex", "cursor"] as const) {
      expect(inserted.sessions[id]).toBe(before.sessions[id])
      expect(inserted.workspace.conversations[id]).toBe(before.workspace.conversations[id])
    }
  })

  it("retains parent focus and unrelated structural references during registration", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const before = store.getState()

    store.addDelegatedSession(delegatedRegistration())

    const after = store.getState()
    expect(after.workspace.selectedVisibleId).toBe("claude-code")
    expect(after.focusedPane).toBe(before.focusedPane)
    expect(after.sessions["claude-code"]).toBe(before.sessions["claude-code"])
    expect(after.sessions.codex).toBe(before.sessions.codex)
    expect(after.workspace.conversations["claude-code"]).toBe(
      before.workspace.conversations["claude-code"],
    )
    expect(after.workspace.conversations.codex).toBe(before.workspace.conversations.codex)
    expect(after.overlays).toBe(before.overlays)
    expect(after.preferences).toBe(before.preferences)
    const parent = selectDelegationParent("claude-code")(after)
    expect(parent?.childIds).toEqual(["delegated-child"])
    expect(selectDelegatedChildIds("claude-code")(after)).toBe(parent!.childIds)
  })

  it("routes accepted child status through the session reducer and normal attention projection", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.addDelegatedSession(delegatedRegistration())
    const parentSession = store.getState().sessions["claude-code"]
    const parentConversation = store.getState().workspace.conversations["claude-code"]

    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "needs_input",
      sessionStatus: "awaiting_approval",
    })

    const needsInput = store.getState()
    expect(needsInput.sessions["delegated-child"]?.status).toBe("awaiting_approval")
    expect(needsInput.workspace.conversations["delegated-child"]?.attention).toEqual({
      status: "awaiting_approval",
      seen: false,
      sequence: 1,
    })
    expect(selectDelegationGroupStatus("claude-code")(needsInput)).toBe("needs_input")
    expect(needsInput.sessions["claude-code"]).toBe(parentSession)
    expect(needsInput.workspace.conversations["claude-code"]).toBe(parentConversation)
    expect(needsInput.workspace.selectedVisibleId).toBe("claude-code")
    expect(needsInput.focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })

    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "running",
      sessionStatus: "working",
    })
    expect(store.getState().sessions["delegated-child"]?.status).toBe("working")
    expect(store.getState().workspace.conversations["delegated-child"]?.attention).toEqual({
      status: "working",
      seen: true,
      sequence: 1,
    })
    expect(selectDelegationGroupStatus("claude-code")(store.getState())).toBe("active")
  })

  it("preserves the complete state reference for invalid registration and no-op publication", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const initial = store.getState()

    store.addDelegatedSession({ ...delegatedRegistration(), parentId: "missing-parent" })
    expect(store.getState()).toBe(initial)
    store.addDelegatedSession({
      ...delegatedRegistration(),
      seed: { ...delegatedChildSeed, id: "" },
    })
    expect(store.getState()).toBe(initial)
    store.addDelegatedSession({ ...delegatedRegistration(), displayName: "   " })
    expect(store.getState()).toBe(initial)

    store.addDelegatedSession(delegatedRegistration())
    const inserted = store.getState()
    store.addDelegatedSession(delegatedRegistration())
    expect(store.getState()).toBe(inserted)
    store.removeDelegationChild(delegatedIdentity)
    expect(store.getState()).toBe(inserted)
    store.publishDelegatedChildState({
      ...delegatedIdentity,
      childGeneration: 99,
      status: "running",
      sessionStatus: "working",
    })
    expect(store.getState()).toBe(inserted)

    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "running",
      sessionStatus: "working",
    })
    const running = store.getState()
    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "running",
      sessionStatus: "working",
    })
    expect(store.getState()).toBe(running)
  })

  it("denies exhausted capacity without a commit or partial session/workspace mutation", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const policy = acceptedPolicy(1, 4)
    expect(store.addDelegatedSession(delegatedRegistration(policy))).toEqual({ kind: "accepted" })
    const beforeDenial = store.getState()
    const observed: AppState[] = []
    store.subscribe((state) => observed.push(state))

    const result = store.addDelegatedSession({
      ...delegatedRegistration(policy),
      seed: { ...delegatedChildSeed, id: "capacity-denied-child" },
      childGeneration: 2,
    })

    expect(result).toEqual({
      kind: "denied",
      reason: "capacity-exhausted",
      scope: "per-parent",
    })
    expect(store.getState()).toBe(beforeDenial)
    expect(observed).toEqual([])
    expect(store.getState().sessions["capacity-denied-child"]).toBeUndefined()
    expect(store.getState().workspace.conversations["capacity-denied-child"]).toBeUndefined()
    expect(store.getState().delegation.children["capacity-denied-child"]).toBeUndefined()
  })

  it("denies the global limit across parents that remain below their local caps", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const policy = acceptedPolicy(2, 2)
    expect(store.addDelegatedSession(delegatedRegistration(policy))).toEqual({ kind: "accepted" })

    store.selectConversation("codex")
    expect(store.addDelegatedSession({
      ...delegatedRegistration(policy),
      seed: { ...delegatedChildSeed, id: "codex-child" },
      parentId: "codex",
      parentGeneration: 2,
      childGeneration: 2,
    })).toEqual({ kind: "accepted" })

    store.selectConversation("cursor")
    const beforeDenial = store.getState()
    expect(store.addDelegatedSession({
      ...delegatedRegistration(policy),
      seed: { ...delegatedChildSeed, id: "cursor-child" },
      parentId: "cursor",
      parentGeneration: 3,
      childGeneration: 3,
    })).toEqual({
      kind: "denied",
      reason: "capacity-exhausted",
      scope: "global",
    })
    expect(store.getState()).toBe(beforeDenial)
  })

  it("releases on a valid terminal publication once, not on later visible removal", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    const policy = acceptedPolicy(1, 1)
    store.addDelegatedSession(delegatedRegistration(policy))
    expect(countOccupiedDelegatedChildren(store.getState().delegation)).toBe(1)

    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "running",
      sessionStatus: "working",
    })
    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "finished",
      sessionStatus: "finished",
      at: 100,
    })
    const terminal = store.getState()
    expect(countOccupiedDelegatedChildren(terminal.delegation)).toBe(0)
    expect(terminal.delegation.children["delegated-child"]?.terminal).toEqual({
      status: "finished",
      at: 100,
    })

    const replacementResult = store.addDelegatedSession({
      ...delegatedRegistration(policy),
      seed: { ...delegatedChildSeed, id: "replacement-child" },
      childGeneration: 2,
    })
    expect(replacementResult).toEqual({ kind: "accepted" })
    expect(countOccupiedDelegatedChildren(store.getState().delegation)).toBe(1)

    const beforeDuplicate = store.getState()
    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "finished",
      sessionStatus: "finished",
      at: 101,
    })
    expect(store.getState()).toBe(beforeDuplicate)
    store.removeDelegationChild(delegatedIdentity)
    expect(countOccupiedDelegatedChildren(store.getState().delegation)).toBe(1)
  })

  it("marks matching parent close intent once and rejects later child registration", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.addDelegatedSession(delegatedRegistration())

    store.markDelegationParentClosing("claude-code", 4)
    const closing = store.getState()
    expect(closing.delegation.parents["claude-code"]?.closeState).toBe("closing")

    store.markDelegationParentClosing("claude-code", 4)
    store.markDelegationParentClosing("claude-code", 99)
    store.addDelegatedSession({
      ...delegatedRegistration(),
      seed: { ...delegatedChildSeed, id: "late-child" },
      childGeneration: 2,
    })
    expect(store.getState()).toBe(closing)
    expect(store.getState().delegation.children["late-child"]).toBeUndefined()
  })

  it("removes only a terminal child's session, workspace entry, and delegation entry", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.addDelegatedSession(delegatedRegistration())
    const siblingChild: SessionSeed = {
      ...delegatedChildSeed,
      id: "delegated-sibling",
      title: "Delegated sibling",
    }
    store.addDelegatedSession({
      ...delegatedRegistration(),
      seed: siblingChild,
      childGeneration: 2,
      task: "Inspect the renderer",
    })
    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "failed",
      sessionStatus: "error",
      at: 123,
    })
    const beforeRemoval = store.getState()
    const parentSession = beforeRemoval.sessions["claude-code"]
    const siblingSession = beforeRemoval.sessions.codex
    const parentConversation = beforeRemoval.workspace.conversations["claude-code"]
    const siblingConversation = beforeRemoval.workspace.conversations.codex
    const delegatedSiblingSession = beforeRemoval.sessions["delegated-sibling"]
    const delegatedSiblingConversation = beforeRemoval.workspace.conversations["delegated-sibling"]

    store.removeDelegationChild(delegatedIdentity)

    const removed = store.getState()
    expect(removed.sessions["delegated-child"]).toBeUndefined()
    expect(removed.workspace.conversations["delegated-child"]).toBeUndefined()
    expect(selectDelegatedChild("delegated-child")(removed)).toBeNull()
    expect(selectDelegationParent("claude-code")(removed)?.childIds).toEqual([
      "delegated-sibling",
    ])
    expect(selectDelegatedChild("delegated-sibling")(removed)).not.toBeNull()
    expect(removed.sessions["delegated-sibling"]).toBe(delegatedSiblingSession)
    expect(removed.workspace.conversations["delegated-sibling"]).toBe(
      delegatedSiblingConversation,
    )
    expect(removed.sessions["claude-code"]).toBe(parentSession)
    expect(removed.sessions.codex).toBe(siblingSession)
    expect(removed.workspace.conversations["claude-code"]).toBe(parentConversation)
    expect(removed.workspace.conversations.codex).toBe(siblingConversation)
    expect(removed.workspace.selectedVisibleId).toBe("claude-code")
  })

  it("resets ephemeral delegation ownership when ordinary sessions are replaced", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.addDelegatedSession(delegatedRegistration())
    expect(selectDelegatedChild("delegated-child")(store.getState())).not.toBeNull()

    const restored = seed("codex", "restored-acp")
    store.replaceSessions(
      [{ seed: restored, workspace: { sessionId: restored.id, displayName: "Restored" } }],
      restored.id,
    )

    const state = store.getState()
    expect(state.sessions.codex).toEqual(createSessionState(restored))
    expect(state.delegation).toEqual({ parents: {}, children: {} })
    expect(selectDelegatedChild("delegated-child")(state)).toBeNull()
  })
})

describe("transcript window state", () => {
  it("seeds an independent attached window for every live session", () => {
    const state = createAppStore().getState()

    expect(state.transcriptWindows).toEqual({
      "claude-code": { revealedTurnCount: 0, detachedFromLive: false, scrollTop: null },
      codex: { revealedTurnCount: 0, detachedFromLive: false, scrollTop: null },
      cursor: { revealedTurnCount: 0, detachedFromLive: false, scrollTop: null },
    })
    expect(state.transcriptWindows["claude-code"]).not.toBe(state.transcriptWindows.codex)
  })

  it("updates only the addressed window and retains it through focus changes", () => {
    const store = createAppStore()
    const sibling = store.getState().transcriptWindows.codex

    store.revealTranscriptHistory("claude-code", 12)
    store.setTranscriptDetached("claude-code", true)
    store.captureTranscriptScrollTop("claude-code", 7)
    store.setFocus("codex")
    store.setFocus("claude-code")

    expect(store.getState().transcriptWindows["claude-code"]).toEqual({
      revealedTurnCount: 12,
      detachedFromLive: true,
      scrollTop: 7,
    })
    expect(store.getState().transcriptWindows.codex).toBe(sibling)

    store.returnTranscriptToLive("claude-code")
    expect(store.getState().transcriptWindows["claude-code"]).toEqual({
      revealedTurnCount: 12,
      detachedFromLive: false,
      scrollTop: null,
    })
  })

  it("keeps unknown, invalid, and equivalent actions as notification-free state no-ops", () => {
    const store = createAppStore()
    const initial = store.getState()
    const observed: AppState[] = []
    store.subscribe((state) => observed.push(state))

    store.revealTranscriptHistory("missing", 10)
    store.revealTranscriptHistory("claude-code", 0)
    store.revealTranscriptHistory("claude-code", Number.NaN)
    store.setTranscriptDetached("missing", true)
    store.setTranscriptDetached("claude-code", false)
    store.captureTranscriptScrollTop("missing", 3)
    store.captureTranscriptScrollTop("claude-code", -1)
    store.captureTranscriptScrollTop("claude-code", null)
    store.returnTranscriptToLive("missing")
    store.returnTranscriptToLive("claude-code")

    expect(store.getState()).toBe(initial)
    expect(observed).toEqual([])
  })

  it("retains unaffected entries across streams and overlays", () => {
    const store = createAppStore()
    const claudeWindow = store.getState().transcriptWindows["claude-code"]
    const codexWindow = store.getState().transcriptWindows.codex

    store.applyEvent("claude-code", message("stream", "token"))
    store.openApproval({
      sessionId: "codex",
      title: "Codex",
      cwd: "/work",
      request: APPROVAL_REQUEST,
    })
    store.openClarification({
      requestId: "clarification-window",
      generation: 1,
      sessionId: "claude-code",
      title: "Claude",
      cwd: "/work",
      payload: CLARIFICATION_PAYLOAD,
    })

    expect(store.getState().transcriptWindows["claude-code"]).toBe(claudeWindow)
    expect(store.getState().transcriptWindows.codex).toBe(codexWindow)
  })

  it("resets or discards only the correct lifecycle entries", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.revealTranscriptHistory("codex", 5)
    const claudeWindow = store.getState().transcriptWindows["claude-code"]

    store.startSession("codex", "new-acp")
    expect(store.getState().transcriptWindows.codex).toEqual({
      revealedTurnCount: 0,
      detachedFromLive: false,
      scrollTop: null,
    })
    expect(store.getState().transcriptWindows["claude-code"]).toBe(claudeWindow)

    const dynamic: SessionSeed = {
      id: "dynamic-window",
      providerKind: "codex",
      title: "Dynamic",
      cwd: "/work/dynamic",
    }
    store.addSession(dynamic)
    expect(store.getState().transcriptWindows[dynamic.id]).toEqual({
      revealedTurnCount: 0,
      detachedFromLive: false,
      scrollTop: null,
    })
    store.removeSession(dynamic.id)
    expect(store.getState().transcriptWindows[dynamic.id]).toBeUndefined()

    store.addDelegatedSession(delegatedRegistration())
    store.revealTranscriptHistory("delegated-child", 3)
    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "running",
      sessionStatus: "working",
    })
    store.publishDelegatedChildState({
      ...delegatedIdentity,
      status: "finished",
      sessionStatus: "finished",
      at: 1,
    })
    store.removeDelegationChild(delegatedIdentity)
    expect(store.getState().transcriptWindows["delegated-child"]).toBeUndefined()

    const restored = seed("codex", "restored")
    store.replaceSessions(
      [{ seed: restored, workspace: { sessionId: restored.id, displayName: "Restored" } }],
      restored.id,
    )
    expect(store.getState().transcriptWindows).toEqual({
      codex: { revealedTurnCount: 0, detachedFromLive: false, scrollTop: null },
    })
  })
})

describe("session explorer state", () => {
  it("starts hidden and creates independent positions lazily for each session", () => {
    const store = createAppStore()

    expect(store.getState().explorer).toEqual({ visible: false, positions: {} })

    store.setExplorerSelection("claude-code", "src/claude.ts")
    store.setExplorerExpanded("claude-code", "src", true)
    store.setExplorerScrollTop("claude-code", 7)
    store.setExplorerNotice("claude-code", { code: "refresh-complete" })
    store.setExplorerSelection("codex", "test/codex.test.ts")
    store.setExplorerExpanded("codex", "test", true)
    store.setExplorerScrollTop("codex", 19)
    store.setExplorerNotice("codex", { code: "launch-failed" })

    const claude = store.getState().explorer.positions["claude-code"]!
    const codex = store.getState().explorer.positions.codex!
    expect(claude).toMatchObject({
      expandedPaths: ["src"],
      selectedPath: "src/claude.ts",
      scrollTop: 7,
      notice: { code: "refresh-complete" },
      generation: 0,
    })
    expect(codex).toMatchObject({
      expandedPaths: ["test"],
      selectedPath: "test/codex.test.ts",
      scrollTop: 19,
      notice: { code: "launch-failed" },
      generation: 0,
    })
    expect(claude).not.toBe(codex)
    expect(claude.expandedPaths).not.toBe(codex.expandedPaths)
  })

  it("toggles visibility with explorer focus and returns focus to the composer", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })

    store.setFocusedPane({ kind: "explorer", sessionId: "claude-code" })
    expect(store.getState().focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })

    store.toggleExplorer("claude-code")
    expect(store.getState().explorer.visible).toBe(true)
    expect(store.getState().focusedPane).toEqual({ kind: "explorer", sessionId: "claude-code" })
    expect(store.getState().explorer.positions["claude-code"]).toBeDefined()

    store.setFocusedPane({ kind: "agent", sessionId: "claude-code" })
    store.setFocusedPane({ kind: "explorer", sessionId: "claude-code" })
    expect(store.getState().focusedPane).toEqual({ kind: "explorer", sessionId: "claude-code" })

    store.toggleExplorer("claude-code")
    expect(store.getState().explorer.visible).toBe(false)
    expect(store.getState().focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })
  })

  it("generation-fences directory results by session and workspace root", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/work/b" },
      ],
    })
    const firstGeneration = store.beginExplorerDirectoryRequest("a", "/work/a", "")!
    const firstA = store.getState().explorer.positions.a!

    expect(store.beginExplorerDirectoryRequest("a", "/wrong", "src")).toBeNull()
    expect(store.getState().explorer.positions.a).toBe(firstA)
    expect(store.commitExplorerDirectory("b", "/work/a", firstGeneration, "", {
      kind: "ready",
      entries: [],
    })).toBe(false)
    expect(store.commitExplorerDirectory("a", "/wrong", firstGeneration, "", {
      kind: "ready",
      entries: [],
    })).toBe(false)

    const refreshGeneration = store.beginExplorerDirectoryRequest("a", "/work/a", "", {
      refresh: true,
    })!
    expect(refreshGeneration).toBe(firstGeneration + 1)
    expect(store.commitExplorerDirectory("a", "/work/a", firstGeneration, "", {
      kind: "ready",
      entries: [{ relativePath: "stale.ts", name: "stale.ts", kind: "file" }],
    })).toBe(false)
    expect(store.commitExplorerDirectory("a", "/work/a", refreshGeneration, "", {
      kind: "ready",
      entries: [{ relativePath: "src", name: "src", kind: "directory" }],
    })).toBe(true)
    expect(store.getState().explorer.positions.a?.directories[""]).toEqual({
      kind: "ready",
      entries: [{ relativePath: "src", name: "src", kind: "directory" }],
    })
    expect(store.getState().explorer.positions.b).toBeUndefined()
  })

  it("invalidates pending work when session replacement changes the workspace root", () => {
    const store = createAppStore({
      seeds: [{ id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" }],
    })
    const generation = store.beginExplorerDirectoryRequest("a", "/work/a", "")!
    store.setExplorerSelection("a", "src/old.ts")

    store.replaceSessions(
      [{
        seed: { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/new" },
        workspace: { sessionId: "a", displayName: "A" },
      }],
      "a",
    )

    expect(store.getState().explorer.positions.a).toBeUndefined()
    expect(store.commitExplorerDirectory("a", "/work/a", generation, "", {
      kind: "unavailable",
      reason: "not-found",
    })).toBe(false)
  })

  it("removes only the closed session's position and resets all positions on replacement", () => {
    const store = createAppStore({ selectedVisibleId: "claude-code" })
    store.setExplorerSelection("claude-code", "src/keep.ts")
    const removedGeneration = store.beginExplorerDirectoryRequest(
      "codex",
      store.getState().sessions.codex!.cwd,
      "",
    )!
    const retained = store.getState().explorer.positions["claude-code"]

    store.removeSession("codex")

    expect(store.getState().explorer.positions.codex).toBeUndefined()
    expect(store.getState().explorer.positions["claude-code"]).toBe(retained)
    const removed = store.getState()
    expect(store.commitExplorerDirectory("codex", removed.sessions["claude-code"]!.cwd, removedGeneration, "", {
      kind: "ready",
      entries: [],
    })).toBe(false)
    expect(store.getState()).toBe(removed)

    const restored = seed("claude-code", "restored")
    store.replaceSessions(
      [{ seed: restored, workspace: { sessionId: restored.id, displayName: "Restored" } }],
      restored.id,
    )
    expect(store.getState().explorer.positions).toEqual({})
  })

  it("keeps invalid and equivalent position transitions as state no-ops", () => {
    const store = createAppStore()
    store.setExplorerSelection("claude-code", "src/index.ts")
    store.setExplorerExpanded("claude-code", "src", true)
    store.setExplorerScrollTop("claude-code", 5)
    store.setExplorerNotice("claude-code", { code: "custom-dispatched" })
    const before = store.getState()

    store.setExplorerSelection("missing", "nope")
    store.setExplorerSelection("claude-code", "src/index.ts")
    store.setExplorerExpanded("claude-code", "src", true)
    store.setExplorerScrollTop("claude-code", -1)
    store.setExplorerScrollTop("claude-code", Number.NaN)
    store.setExplorerScrollTop("claude-code", 5)
    store.setExplorerNotice("claude-code", { code: "custom-dispatched" })
    store.toggleExplorer("codex")

    expect(store.getState()).toBe(before)
  })
})

function requireDraft(store: AppStore, sessionId: SessionId, instructions: string): DraftContextPack {
  const result = store.createContextPackDraft(sessionId, instructions)
  if (result?.kind !== "created") throw new Error("expected Context Pack draft")
  return result.draft
}

function reviewCandidate(draft: DraftContextPack): ContextPackReviewCandidate {
  const result = assembleCandidate(draft, [], createSecretRedactor())
  if (result.kind !== "assembled") throw new Error("expected Context Pack candidate")
  return result.candidate
}

function sealedCandidate(
  draft: DraftContextPack,
  candidate: ContextPackReviewCandidate,
  sealedAt = 100,
): SealedContextPack {
  const result = sealCandidate({ draft, candidate, currentSourceFences: [], sealedAt })
  if (result.kind !== "sealed") throw new Error("expected sealed Context Pack")
  return result.sealed
}

describe("Context Pack store integration", () => {
  it("initializes every seeded, dynamic, delegated, and replacement session", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/work/b" },
      ],
    })

    expect(store.getState().contextPacks).toEqual({
      a: { draft: null, sealed: null, review: null, build: null },
      b: { draft: null, sealed: null, review: null, build: null },
    })
    expect(store.getState().contextPacks.a).not.toBe(store.getState().contextPacks.b)

    store.addSession({ id: "dynamic", providerKind: "cursor", title: "Dynamic", cwd: "/work/dynamic" })
    expect(store.getState().contextPacks.dynamic).toEqual({
      draft: null,
      sealed: null,
      review: null,
      build: null,
    })

    const registration = {
      seed: { ...delegatedChildSeed, id: "context-child" },
      parentId: "a",
      parentGeneration: 1,
      childGeneration: 2,
      task: "Curate context",
      desiredOutcome: "A reviewed draft",
      policy: acceptedPolicy(),
    } as const
    expect(store.addDelegatedSession(registration)).toEqual({ kind: "accepted" })
    expect(store.getState().contextPacks[registration.seed.id]).toEqual({
      draft: null,
      sealed: null,
      review: null,
      build: null,
    })

    store.replaceSessions(
      [{
        seed: { id: "restored", providerKind: "codex", title: "Restored", cwd: "/work/restored" },
        workspace: { sessionId: "restored", displayName: "Restored" },
      }],
      "restored",
    )
    expect(store.getState().contextPacks).toEqual({
      restored: { draft: null, sealed: null, review: null, build: null },
    })
  })

  it("keeps addressed transitions atomic and preserves sibling references", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/work/b" },
      ],
    })
    const initialDraft = requireDraft(store, "a", "Implement A")
    const initialReview = reviewCandidate(initialDraft)
    expect(store.publishContextPackReview("a", initialReview)).toBe(true)

    const siblingDraft = requireDraft(store, "b", "Implement B")
    const siblingBinding: ContextBuildBinding = {
      parentId: "b",
      childId: "builder-b",
      parentGeneration: 4,
      childGeneration: 1,
      draftRevision: siblingDraft.revision,
      state: "building",
    }
    expect(store.bindContextBuild("b", siblingBinding)).toBe(true)
    const siblingReview = reviewCandidate(siblingDraft)
    expect(store.publishContextPackReview("b", siblingReview)).toBe(true)
    const siblingSealed = sealedCandidate(siblingDraft, siblingReview, 50)
    expect(store.sealContextPack("b", siblingSealed)).toBe(true)
    const sibling = store.getState().contextPacks.b!
    expect(sibling).toMatchObject({
      draft: siblingDraft,
      sealed: siblingSealed,
      review: siblingReview,
      build: { ...siblingBinding, state: "ready_for_review" },
    })

    const operatorResult = store.applyContextPackOperatorMutation("a", {
      kind: "set_brief_section",
      section: "architecture",
      text: "Store-owned",
    })
    expect(operatorResult?.kind).toBe("applied")
    expect(store.getState().contextPacks.a?.review).toBeNull()
    expect(store.publishContextPackReview("a", initialReview)).toBe(false)
    expect(store.getState().contextPacks.b).toBe(sibling)

    const draft = store.getState().contextPacks.a!.draft!
    const binding: ContextBuildBinding = {
      parentId: "a",
      childId: "builder-a",
      parentGeneration: 7,
      childGeneration: 2,
      draftRevision: draft.revision,
      state: "building",
    }
    expect(store.bindContextBuild("a", binding)).toBe(true)
    expect(store.bindContextBuild("a", { ...binding, childId: "other" })).toBe(false)

    const candidate = reviewCandidate(draft)
    expect(store.publishContextPackReview("a", candidate)).toBe(true)
    expect(store.getState().contextPacks.a?.build?.state).toBe("ready_for_review")

    const staleResult = store.applyContextPackBuilderMutation("a", {
      readRevision: draft.revision - 1,
      mutation: { kind: "set_brief_section", section: "relationships", text: "stale" },
    })
    expect(staleResult?.kind).toBe("stale")
    expect(store.getState().contextPacks.a?.review).toBe(candidate)

    const appliedResult = store.applyContextPackBuilderMutation("a", {
      readRevision: draft.revision,
      mutation: { kind: "set_brief_section", section: "relationships", text: "current" },
    })
    expect(appliedResult?.kind).toBe("applied")
    expect(store.getState().contextPacks.a?.review).toBeNull()
    expect(store.getState().contextPacks.a?.build?.state).toBe("building")
    expect(store.getState().contextPacks.b).toBe(sibling)

    const currentDraft = store.getState().contextPacks.a!.draft!
    const currentCandidate = reviewCandidate(currentDraft)
    expect(store.publishContextPackReview("a", currentCandidate)).toBe(true)
    const sealed = sealedCandidate(currentDraft, currentCandidate)
    expect(store.sealContextPack("a", sealed)).toBe(true)
    const beforeRelease = store.getState().contextPacks.a!
    expect(beforeRelease.draft).not.toBe(sibling.draft)
    expect(beforeRelease.review).not.toBe(sibling.review)
    expect(beforeRelease.sealed).not.toBe(sibling.sealed)
    expect(beforeRelease.build).not.toBe(sibling.build)
    expect(store.releaseContextBuild("a", { ...binding, childGeneration: 99 })).toBe(false)
    expect(store.releaseContextBuild("a", binding)).toBe(true)
    expect(store.getState().contextPacks.a).toEqual({
      draft: currentDraft,
      sealed,
      review: currentCandidate,
      build: null,
    })
    expect(store.getState().contextPacks.b).toBe(sibling)

    const refined = store.refineContextPackDraft("a")
    expect(refined?.kind).toBe("created")
    expect(refined?.kind === "created" ? refined.draft.revision : -1).toBe(sealed.revision + 1)
    expect(store.getState().contextPacks.a?.review).toBeNull()
    expect(store.getState().contextPacks.a?.sealed).toBe(sealed)
  })

  it("atomically prepares and binds one exact draft revision, then settles only matching ownership", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "A", cwd: "/work/a" },
        { id: "b", providerKind: "codex", title: "B", cwd: "/work/b" },
      ],
      selectedVisibleId: "a",
    })
    store.openSettings()
    const focus = store.getState().focusedPane
    const overlays = store.getState().overlays
    const selected = store.getState().workspace.selectedVisibleId
    const commits: Array<{ draftRevision: number | null; boundRevision: number | null }> = []
    store.subscribe((state, previous) => {
      if (state.contextPacks.b !== previous.contextPacks.b) {
        commits.push({
          draftRevision: state.contextPacks.b?.draft?.revision ?? null,
          boundRevision: state.contextPacks.b?.build?.draftRevision ?? null,
        })
      }
    })

    const prepared = store.prepareContextBuild("b", {
      kind: "start_fresh",
      original: "Curate B",
    }, {
      parentId: "b",
      childId: "builder-1",
      parentGeneration: 3,
      childGeneration: 7,
    })

    expect(prepared.kind).toBe("prepared")
    if (prepared.kind !== "prepared") throw new Error("expected prepared build")
    expect(prepared.binding.draftRevision).toBe(prepared.draft.revision)
    expect(commits).toEqual([{
      draftRevision: prepared.draft.revision,
      boundRevision: prepared.draft.revision,
    }])
    expect(store.prepareContextBuild("b", {
      kind: "start_fresh",
      original: "Concurrent",
    }, {
      parentId: "b",
      childId: "builder-2",
      parentGeneration: 3,
      childGeneration: 8,
    })).toEqual({ kind: "denied", reason: "build_active" })

    expect(store.settleContextBuild("b", {
      ...prepared.binding,
      childGeneration: 99,
    }, "ready_for_review")).toBe(false)
    expect(store.getState().contextPacks.b?.build).toEqual(prepared.binding)
    expect(store.settleContextBuild("b", prepared.binding, "ready_for_review")).toBe(true)
    expect(store.getState().contextPacks.b?.build).toBeNull()
    expect(store.getState().workspace.conversations.b?.attention).toMatchObject({
      status: "finished",
      seen: false,
    })
    expect(store.getState().workspace.selectedVisibleId).toBe(selected)
    expect(store.getState().focusedPane).toBe(focus)
    expect(store.getState().overlays).toBe(overlays)
  })

  it("cleans up only removed sessions and drops all live state on replacement", () => {
    const store = createAppStore({
      seeds: [
        { id: "parent", providerKind: "claude-code", title: "Parent", cwd: "/work/parent" },
        { id: "sibling", providerKind: "cursor", title: "Sibling", cwd: "/work/sibling" },
      ],
    })
    requireDraft(store, "parent", "Parent task")
    const siblingDraft = requireDraft(store, "sibling", "Sibling task")
    const siblingProjection = store.getState().contextPacks.sibling

    store.addSession({ id: "dynamic", providerKind: "codex", title: "Dynamic", cwd: "/work/dynamic" })
    requireDraft(store, "dynamic", "Dynamic task")
    store.removeSession("dynamic")
    expect(store.getState().contextPacks.dynamic).toBeUndefined()
    expect(store.getState().contextPacks.sibling).toBe(siblingProjection)

    const childId = "context-child"
    const childRegistration = {
      seed: { id: childId, providerKind: "codex", title: "Child", cwd: "/work/child" },
      parentId: "parent",
      parentGeneration: 3,
      childGeneration: 1,
      task: "Curate",
      desiredOutcome: "Review",
      policy: acceptedPolicy(),
    } as const
    expect(store.addDelegatedSession(childRegistration)).toEqual({ kind: "accepted" })
    requireDraft(store, childId, "Child task")
    store.publishDelegatedChildState({
      parentId: "parent",
      childId,
      parentGeneration: 3,
      childGeneration: 1,
      status: "running",
      sessionStatus: "working",
    })
    store.publishDelegatedChildState({
      parentId: "parent",
      childId,
      parentGeneration: 3,
      childGeneration: 1,
      status: "finished",
      sessionStatus: "finished",
      at: 20,
    })
    store.removeDelegationChild({
      parentId: "parent",
      childId,
      parentGeneration: 3,
      childGeneration: 1,
    })
    expect(store.getState().contextPacks[childId]).toBeUndefined()
    expect(store.getState().contextPacks.sibling).toBe(siblingProjection)

    const siblingReview = reviewCandidate(siblingDraft)
    expect(store.publishContextPackReview("sibling", siblingReview)).toBe(true)
    expect(store.bindContextBuild("sibling", {
      parentId: "sibling",
      childId: "builder",
      parentGeneration: 1,
      childGeneration: 1,
      draftRevision: siblingDraft.revision,
      state: "building",
    })).toBe(true)
    expect(store.sealContextPack("sibling", sealedCandidate(siblingDraft, siblingReview))).toBe(true)

    store.replaceSessions(
      [{
        seed: { id: "sibling", providerKind: "cursor", title: "Replacement", cwd: "/work/new" },
        workspace: { sessionId: "sibling", displayName: "Replacement" },
      }],
      "sibling",
    )
    expect(store.getState().contextPacks).toEqual({
      sibling: { draft: null, sealed: null, review: null, build: null },
    })
  })

  it("runs a controller-style lifecycle without altering a sibling session", () => {
    const store = createAppStore({
      seeds: [
        { id: "owner", providerKind: "claude-code", title: "Owner", cwd: "/work/owner" },
        { id: "sibling", providerKind: "codex", title: "Sibling", cwd: "/work/sibling" },
      ],
    })
    const sibling = store.getState().contextPacks.sibling
    const draft = requireDraft(store, "owner", "Prepare the handoff")
    const binding: ContextBuildBinding = {
      parentId: "owner",
      childId: "builder",
      parentGeneration: 4,
      childGeneration: 1,
      draftRevision: draft.revision,
      state: "building",
    }
    expect(store.bindContextBuild("owner", binding)).toBe(true)
    const candidate = reviewCandidate(draft)
    expect(store.publishContextPackReview("owner", candidate)).toBe(true)
    expect(store.releaseContextBuild("owner", binding)).toBe(true)
    expect(store.sealContextPack("owner", sealedCandidate(draft, candidate, 250))).toBe(true)

    expect(store.getState().contextPacks.sibling).toBe(sibling)
    expect(store.getState().contextPacks.owner?.sealed?.payload).toBe(candidate.payload)
  })
})
