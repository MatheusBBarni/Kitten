import { describe, expect, it } from "bun:test"

import { createSessionState, sessionReducer } from "./sessionReducer.ts"
import type { AvailableCommand, ConfigOption, DomainSessionEvent, ManagedWorktreeBinding, SessionState, ToolCallTurn } from "./types.ts"
import { createWorkspaceState, workspaceReducer } from "./workspace.ts"

/**
 * Fixture-driven tests for the pure `SessionState` reducer. The core has no I/O,
 * so every case is exercised by feeding event fixtures and asserting the resulting
 * immutable state. No ACP SDK is imported anywhere in `src/core`.
 */

const initial = (): SessionState => createSessionState({ id: "claude-code", providerKind: "claude-code", title: "claude-code", cwd: "/w", acpSessionId: "session-1" })

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

/** Fold a sequence of events over a fresh session state. */
const fold = (events: DomainSessionEvent[], start: SessionState = initial()): SessionState =>
  events.reduce(sessionReducer, start)

/** Pull the tool-call turns out of a state for focused assertions. */
const toolTurns = (state: SessionState): ToolCallTurn[] =>
  state.turns.filter((t): t is ToolCallTurn => t.kind === "tool_call")

describe("createSessionState", () => {
  it("starts empty and idle for the given session seed", () => {
    const state = createSessionState({ id: "codex", providerKind: "codex", title: "codex", cwd: "/w", acpSessionId: "s-42" })
    expect(state).toEqual({
      id: "codex",
      providerKind: "codex",
      title: "codex",
      cwd: "/w",
      branch: undefined,
      task: undefined,
      worktreeBinding: undefined,
      acpSessionId: "s-42",
      turns: [],
      status: "idle",
      referencedFiles: new Map(),
      pendingDiffs: [],
      plan: [],
      usage: undefined,
      configOptions: [],
      defaultApplyResult: null,
      commands: [],
      promptHistory: { entries: [], cursor: null },
      steering: { activeTurnId: null, queue: [], recovery: null },
    })
  })

  it("preserves a managed seed binding while ordinary seeds remain unbound", () => {
    const managed = createSessionState({
      id: "managed-child",
      providerKind: "codex",
      title: "Managed child",
      cwd: managedBinding.worktreePath,
      worktreeBinding: managedBinding,
    })

    expect(managed.worktreeBinding).toBe(managedBinding)
    expect(initial().worktreeBinding).toBeUndefined()
  })

  it("defaults configOptions to an empty array", () => {
    expect(initial().configOptions).toEqual([])
  })

  it("defaults commands to an empty array", () => {
    expect(initial().commands).toEqual([])
  })

  it("defaults usage to unknown", () => {
    expect(initial().usage).toBeUndefined()
  })

  it("defaults prompt history to no entries and no active recall cursor", () => {
    expect(initial().promptHistory).toEqual({ entries: [], cursor: null })
  })
})

describe("prompt history events", () => {
  it("delegates record, previous, and next transitions to the prompt-history policy", () => {
    const recorded = sessionReducer(initial(), {
      kind: "prompt_history",
      action: "record",
      text: "inspect the reducer",
    })
    const recalled = sessionReducer(recorded, { kind: "prompt_history", action: "previous" })
    const cleared = sessionReducer(recalled, { kind: "prompt_history", action: "next" })

    expect(recorded.promptHistory).toEqual({ entries: ["inspect the reducer"], cursor: null })
    expect(recalled.promptHistory).toEqual({ entries: ["inspect the reducer"], cursor: 0 })
    expect(cleared.promptHistory).toEqual({ entries: ["inspect the reducer"], cursor: null })
  })

  it("changes only prompt history and preserves every unrelated reference", () => {
    const before = fold([
      { kind: "user_message", messageId: "u1", text: "existing turn" },
      { kind: "plan", entries: [{ content: "Existing plan", status: "in_progress" }] },
      { kind: "commands", commands: [{ name: "review", description: "Review changes" }] },
    ])

    const after = sessionReducer(before, {
      kind: "prompt_history",
      action: "record",
      text: "new prompt",
    })

    expect(after).toEqual({
      ...before,
      promptHistory: { entries: ["new prompt"], cursor: null },
    })
    expect(after.turns).toBe(before.turns)
    expect(after.plan).toBe(before.plan)
    expect(after.commands).toBe(before.commands)
    expect(after.configOptions).toBe(before.configOptions)
    expect(after.referencedFiles).toBe(before.referencedFiles)
    expect(after.pendingDiffs).toBe(before.pendingDiffs)
  })

  it("returns the same session for a prompt-history no-op", () => {
    const before = initial()

    expect(sessionReducer(before, { kind: "prompt_history", action: "next" })).toBe(before)
  })
})

describe("steering events", () => {
  const enqueue = {
    kind: "steering_enqueue",
    activeTurnId: "turn-active",
    requestId: "steer-1",
    generation: 4,
    blocks: [{ type: "text", text: "change direction" }],
  } as const

  it("preserves every unrelated transcript-derived reference during steering-only transitions", () => {
    const before = fold([
      { kind: "user_message", messageId: "u1", text: "original task" },
      {
        kind: "tool_call",
        call: {
          toolCallId: "edit-1",
          kind: "edit",
          title: "Edit source",
          status: "pending",
          locations: ["src/source.ts"],
          diff: { path: "src/source.ts", unified: "@@ -1 +1 @@" },
        },
      },
    ])

    const after = sessionReducer(before, enqueue)

    expect(after.turns).toBe(before.turns)
    expect(after.referencedFiles).toBe(before.referencedFiles)
    expect(after.pendingDiffs).toBe(before.pendingDiffs)
    expect(after.plan).toBe(before.plan)
    expect(after.promptHistory).toBe(before.promptHistory)
  })

  it("returns the existing session for stale or invalid lifecycle events", () => {
    const state = sessionReducer(initial(), enqueue)
    expect(
      sessionReducer(state, {
        kind: "steering_wait",
        requestId: "steer-1",
        generation: 3,
      }),
    ).toBe(state)
    expect(
      sessionReducer(state, {
        kind: "steering_send",
        requestId: "steer-1",
        generation: 4,
      }),
    ).toBe(state)
  })

  it("folds enqueue through confirmed delivery into exactly one ordered user turn", () => {
    const state = fold([
      { kind: "user_message", messageId: "u1", text: "original task" },
      enqueue,
      {
        kind: "steering_enqueue",
        activeTurnId: "turn-active",
        requestId: "steer-2",
        generation: 4,
        blocks: [
          { type: "text", text: "then do this" },
          { type: "text", text: "and preserve order" },
        ],
      },
      { kind: "steering_wait", requestId: "steer-1", generation: 4 },
      { kind: "steering_cancel", requestId: "steer-1", generation: 4 },
      { kind: "steering_settle", requestId: "steer-1", generation: 4 },
      { kind: "steering_send", requestId: "steer-1", generation: 4 },
      {
        kind: "steering_deliver",
        requestId: "steer-1",
        generation: 4,
        messageId: "u-steering",
      },
    ])

    expect(state.turns).toEqual([
      { kind: "user", messageId: "u1", text: "original task" },
      {
        kind: "user",
        messageId: "u-steering",
        text: "change direction\nthen do this\nand preserve order",
      },
    ])
    expect(state.steering).toEqual({ activeTurnId: null, queue: [], recovery: null })
  })

  it("folds recovery and acknowledgement without adding a user turn", () => {
    const failed = fold([
      enqueue,
      { kind: "steering_recover", requestId: "steer-1", generation: 4 },
    ])

    expect(failed.turns).toEqual([])
    expect(failed.steering.recovery).toEqual([{ type: "text", text: "change direction" }])

    const acknowledged = sessionReducer(failed, {
      kind: "steering_acknowledge_recovery",
      requestId: "steer-1",
      generation: 4,
    })
    expect(acknowledged.turns).toBe(failed.turns)
    expect(acknowledged.steering).toEqual({ activeTurnId: null, queue: [], recovery: null })
  })
})

describe("usage", () => {
  it("sets raw usage without changing unrelated session fields", () => {
    const before = fold([
      { kind: "user_message", messageId: "u1", text: "inspect usage" },
      { kind: "status", status: "working" },
      { kind: "plan", entries: [{ content: "Measure context", status: "in_progress" }] },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit gauge",
          status: "pending",
          locations: ["src/gauge.ts"],
          diff: { path: "src/gauge.ts", unified: "@@ -1 +1 @@" },
        },
      },
    ])

    const after = sessionReducer(before, { kind: "usage", used: 124_000, size: 200_000 })

    expect(after.usage).toEqual({ used: 124_000, size: 200_000 })
    expect(after.turns).toBe(before.turns)
    expect(after.status).toBe(before.status)
    expect(after.plan).toBe(before.plan)
    expect(after.referencedFiles).toBe(before.referencedFiles)
    expect(after.pendingDiffs).toBe(before.pendingDiffs)
  })

  it("replaces the prior usage value wholesale", () => {
    const first = fold([{ kind: "usage", used: 124_000, size: 200_000 }])

    const second = sessionReducer(first, { kind: "usage", used: 80_000, size: 160_000 })

    expect(second.usage).toEqual({ used: 80_000, size: 160_000 })
    expect(second.usage).not.toBe(first.usage)
  })

  it("does not mutate the input state", () => {
    const before = initial()

    const after = sessionReducer(before, { kind: "usage", used: 124_000, size: 200_000 })

    expect(after).not.toBe(before)
    expect(before.usage).toBeUndefined()
  })
})

describe("agent_message", () => {
  it("appends a new agent turn for a new messageId", () => {
    const state = fold([{ kind: "agent_message", messageId: "m1", textDelta: "Hello" }])
    expect(state.turns).toEqual([{ kind: "agent", messageId: "m1", text: "Hello" }])
  })

  it("concatenates textDelta onto the existing turn for the same messageId", () => {
    const state = fold([
      { kind: "agent_message", messageId: "m1", textDelta: "Hel" },
      { kind: "agent_message", messageId: "m1", textDelta: "lo world" },
    ])
    expect(state.turns).toEqual([{ kind: "agent", messageId: "m1", text: "Hello world" }])
  })

  it("starts a fresh turn when a new messageId interrupts the previous one", () => {
    const state = fold([
      { kind: "agent_message", messageId: "m1", textDelta: "first" },
      { kind: "agent_message", messageId: "m2", textDelta: "second" },
      // A late delta for m1 does not merge because m1 is no longer the last turn.
      { kind: "agent_message", messageId: "m1", textDelta: "!" },
    ])
    expect(state.turns).toEqual([
      { kind: "agent", messageId: "m1", text: "first" },
      { kind: "agent", messageId: "m2", text: "second" },
      { kind: "agent", messageId: "m1", text: "!" },
    ])
  })
})

describe("user_message", () => {
  it("appends a user turn without merging", () => {
    const state = fold([
      { kind: "user_message", messageId: "u1", text: "do the thing" },
      { kind: "user_message", messageId: "u1", text: "again" },
    ])
    expect(state.turns).toEqual([
      { kind: "user", messageId: "u1", text: "do the thing" },
      { kind: "user", messageId: "u1", text: "again" },
    ])
  })
})

describe("tool_call upsert semantics", () => {
  it("merges an update by toolCallId, preserving omitted fields and clearing null fields", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit config",
          status: "pending",
          locations: ["src/config.ts"],
          diff: { path: "src/config.ts", unified: "@@ -1 +1 @@\n-a\n+b" },
        },
      },
      {
        // Only status changes; kind/title/locations are omitted and must be preserved.
        // diff is explicitly null and must be cleared.
        kind: "tool_call",
        call: { toolCallId: "t1", status: "completed", diff: null },
      },
    ])

    const turns = toolTurns(state)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.record).toEqual({
      toolCallId: "t1",
      kind: "edit",
      title: "Edit config",
      status: "completed",
      locations: ["src/config.ts"],
    })
    expect(turns[0]!.record.diff).toBeUndefined()
  })

  it("defaults missing fields when the first event for an id is partial", () => {
    const state = fold([{ kind: "tool_call", call: { toolCallId: "t9", status: "in_progress" } }])
    expect(toolTurns(state)[0]!.record).toEqual({
      toolCallId: "t9",
      kind: "other",
      title: "",
      status: "in_progress",
      locations: [],
    })
  })

  it("preserves transcript position when a later update merges an earlier tool call", () => {
    const state = fold([
      { kind: "tool_call", call: { toolCallId: "t1", kind: "read", title: "read", status: "completed", locations: [] } },
      { kind: "agent_message", messageId: "m1", textDelta: "thinking" },
      { kind: "tool_call", call: { toolCallId: "t1", status: "failed" } },
    ])
    expect(state.turns.map((t) => (t.kind === "tool_call" ? t.record.toolCallId : t.kind))).toEqual([
      "t1",
      "agent",
    ])
    expect(toolTurns(state)[0]!.record.status).toBe("failed")
  })
})

describe("referencedFiles derivation", () => {
  it("marks an edit-kind tool call location as edited and records its pending diff", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit file",
          status: "pending",
          locations: ["src/a.ts"],
          diff: { path: "src/a.ts", unified: "@@ -1 +1 @@\n-x\n+y" },
        },
      },
    ])
    expect(state.referencedFiles.get("src/a.ts")).toBe("edited")
    expect(state.pendingDiffs).toEqual([
      { toolCallId: "t1", path: "src/a.ts", unified: "@@ -1 +1 @@\n-x\n+y" },
    ])
  })

  it("marks a read-kind tool call location as read and creates no pending diff", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: { toolCallId: "t2", kind: "read", title: "Read file", status: "completed", locations: ["src/b.ts"] },
      },
    ])
    expect(state.referencedFiles.get("src/b.ts")).toBe("read")
    expect(state.pendingDiffs).toEqual([])
  })

  it("keeps a path edited even after a later read of the same path", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: { toolCallId: "t1", kind: "edit", title: "e", status: "pending", locations: ["src/x.ts"] },
      },
      {
        kind: "tool_call",
        call: { toolCallId: "t2", kind: "read", title: "r", status: "completed", locations: ["src/x.ts"] },
      },
    ])
    expect(state.referencedFiles.get("src/x.ts")).toBe("edited")
  })

  it("drops a pending diff once the edit tool call completes (applied)", () => {
    const state = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "e",
          status: "in_progress",
          locations: ["src/x.ts"],
          diff: { path: "src/x.ts", unified: "d" },
        },
      },
      { kind: "tool_call", call: { toolCallId: "t1", status: "completed" } },
    ])
    expect(state.pendingDiffs).toEqual([])
  })
})

describe("plan and status events", () => {
  it("stores the latest plan without altering turns", () => {
    const withTurn = fold([{ kind: "agent_message", messageId: "m1", textDelta: "hi" }])
    const state = sessionReducer(withTurn, {
      kind: "plan",
      entries: [{ content: "step one", status: "in_progress" }],
    })
    expect(state.plan).toEqual([{ content: "step one", status: "in_progress" }])
    expect(state.turns).toEqual(withTurn.turns)
  })

  it("enters and leaves clarification without replacing session content", () => {
    const withWork = fold([
      { kind: "agent_message", messageId: "m1", textDelta: "hi" },
      { kind: "plan", entries: [{ content: "Wait for input", status: "in_progress" }] },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Prepare edit",
          status: "pending",
          locations: ["src/core/types.ts"],
          diff: { path: "src/core/types.ts", unified: "diff" },
        },
      },
    ])

    const awaiting = sessionReducer(withWork, { kind: "status", status: "awaiting_clarification" })
    const resumed = sessionReducer(awaiting, { kind: "status", status: "working" })

    expect(awaiting.status).toBe("awaiting_clarification")
    expect(resumed.status).toBe("working")
    for (const state of [awaiting, resumed]) {
      expect(state.turns).toBe(withWork.turns)
      expect(state.plan).toBe(withWork.plan)
      expect(state.referencedFiles).toBe(withWork.referencedFiles)
      expect(state.pendingDiffs).toBe(withWork.pendingDiffs)
      expect(state.configOptions).toBe(withWork.configOptions)
      expect(state.commands).toBe(withWork.commands)
      expect(state.promptHistory).toBe(withWork.promptHistory)
    }
  })
})

describe("branch events", () => {
  it("replaces only the branch field", () => {
    const withWork = fold([
      { kind: "status", status: "awaiting_approval" },
      { kind: "user_message", messageId: "u1", text: "inspect the branch" },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit branch-aware code",
          status: "pending",
          locations: ["src/app/controller.ts"],
          diff: { path: "src/app/controller.ts", unified: "diff" },
        },
      },
    ])

    const state = sessionReducer(withWork, { kind: "branch", branch: "feature/status-bar" })

    expect(state.branch).toBe("feature/status-bar")
    expect(state.turns).toBe(withWork.turns)
    expect(state.status).toBe(withWork.status)
    expect(state.referencedFiles).toBe(withWork.referencedFiles)
    expect(state.pendingDiffs).toBe(withWork.pendingDiffs)
    expect(state.plan).toBe(withWork.plan)
    expect(state.configOptions).toBe(withWork.configOptions)
  })

  it("clears a previously stored branch when the event is blank", () => {
    const withBranch = sessionReducer(initial(), { kind: "branch", branch: "main" })

    const state = sessionReducer(withBranch, { kind: "branch", branch: "" })

    expect(state.branch).toBeUndefined()
    expect(state.turns).toBe(withBranch.turns)
    expect(state.status).toBe(withBranch.status)
  })
})

describe("config_options events", () => {
  const modelOption: ConfigOption = {
    id: "cfg-model",
    category: "model",
    label: "Model",
    currentValue: "opus",
    options: [
      { value: "opus", name: "Opus" },
      { value: "sonnet", name: "Sonnet" },
    ],
  }
  const effortOption: ConfigOption = {
    id: "cfg-effort",
    category: "thought_level",
    label: "Reasoning effort",
    currentValue: "high",
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  }

  it("replaces an empty configOptions with exactly the advertised options", () => {
    const state = fold([{ kind: "config_options", options: [modelOption, effortOption] }])
    expect(state.configOptions).toEqual([modelOption, effortOption])
  })

  it("fully replaces the prior set on a second event (no merge, no duplicates)", () => {
    const nextModel: ConfigOption = { ...modelOption, currentValue: "sonnet" }
    const state = fold([
      { kind: "config_options", options: [modelOption, effortOption] },
      { kind: "config_options", options: [nextModel] },
    ])
    expect(state.configOptions).toEqual([nextModel])
  })

  it("leaves turns, status, and pendingDiffs unchanged when applied", () => {
    const withWork = fold([
      { kind: "status", status: "awaiting_approval" },
      { kind: "user_message", messageId: "u1", text: "go" },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "e",
          status: "pending",
          locations: ["src/x.ts"],
          diff: { path: "src/x.ts", unified: "d" },
        },
      },
    ])
    const state = sessionReducer(withWork, { kind: "config_options", options: [modelOption] })
    expect(state.turns).toEqual(withWork.turns)
    expect(state.status).toBe(withWork.status)
    expect(state.pendingDiffs).toEqual(withWork.pendingDiffs)
    expect(state.configOptions).toEqual([modelOption])
  })

  it("returns a new object and does not mutate the input state", () => {
    const before = initial()
    sessionReducer(before, { kind: "config_options", options: [modelOption] })
    expect(before.configOptions).toEqual([])
  })
})

describe("default_apply_result events", () => {
  it("replaces only the terminal result while retaining confirmed options and unrelated references", () => {
    const options: ConfigOption[] = [
      {
        id: "cfg-model",
        category: "model",
        label: "Model",
        currentValue: "gpt-5.4",
        options: [{ value: "gpt-5.4", name: "GPT-5.4" }],
      },
    ]
    const before = fold([
      { kind: "user_message", messageId: "u1", text: "keep this turn" },
      { kind: "plan", entries: [{ content: "Keep this plan", status: "in_progress" }] },
      { kind: "config_options", options },
      { kind: "default_apply_result", result: { kind: "none" } },
    ])
    const result = { kind: "partial", model: "gpt-5.4", unavailable: "effort" } as const

    const after = sessionReducer(before, { kind: "default_apply_result", result })

    expect(after).toEqual({ ...before, defaultApplyResult: result })
    expect(after.defaultApplyResult).toBe(result)
    expect(after.configOptions).toBe(before.configOptions)
    expect(after.turns).toBe(before.turns)
    expect(after.plan).toBe(before.plan)
    expect(after.commands).toBe(before.commands)
    expect(after.promptHistory).toBe(before.promptHistory)
    expect(after.referencedFiles).toBe(before.referencedFiles)
    expect(after.pendingDiffs).toBe(before.pendingDiffs)
  })
})

describe("commands events", () => {
  const review: AvailableCommand = { name: "review", description: "Review the current diff", hint: "[scope]" }
  const test: AvailableCommand = { name: "test", description: "Run the test suite" }

  it("sets commands to exactly the advertised list", () => {
    const commands = [review, test]
    const state = sessionReducer(initial(), { kind: "commands", commands })

    expect(state.commands).toBe(commands)
    expect(state.commands).toEqual([review, test])
  })

  it("replaces the advertised list wholesale", () => {
    const first = sessionReducer(initial(), { kind: "commands", commands: [review, test] })
    const replacement = [test]
    const state = sessionReducer(first, { kind: "commands", commands: replacement })

    expect(state.commands).toBe(replacement)
    expect(state.commands).toEqual([test])
  })

  it("changes no other session field when commands are replaced", () => {
    const withWork = fold([
      { kind: "status", status: "awaiting_approval" },
      { kind: "user_message", messageId: "u1", text: "review this" },
      { kind: "plan", entries: [{ content: "Inspect diff", status: "in_progress" }] },
    ])
    const commands = [review, test]

    const next = sessionReducer(withWork, { kind: "commands", commands })

    expect(next).toEqual({ ...withWork, commands })
    expect(next.turns).toBe(withWork.turns)
    expect(next.plan).toBe(withWork.plan)
    expect(next.referencedFiles).toBe(withWork.referencedFiles)
    expect(next.pendingDiffs).toBe(withWork.pendingDiffs)
    expect(next.configOptions).toBe(withWork.configOptions)
  })

  it("leaves the command-list reference intact for unrelated events", () => {
    const withCommands = fold([{ kind: "commands", commands: [review] }])
    const next = sessionReducer(withCommands, { kind: "status", status: "working" })

    expect(next.commands).toBe(withCommands.commands)
    expect(next.turns).toBe(withCommands.turns)
  })
})

describe("purity", () => {
  it("does not mutate the input state", () => {
    const before = initial()
    const snapshot = JSON.parse(JSON.stringify({ ...before, referencedFiles: [...before.referencedFiles] }))
    sessionReducer(before, { kind: "agent_message", messageId: "m1", textDelta: "x" })
    expect(before.turns).toEqual([])
    expect([...before.referencedFiles]).toEqual(snapshot.referencedFiles)
  })
})

describe("integration: workspace ownership boundary", () => {
  it("keeps execution state and status unchanged across workspace-only transitions", () => {
    const sessionBefore = sessionReducer(initial(), { kind: "status", status: "working" })
    const workspaceBefore = createWorkspaceState({
      conversations: [{ sessionId: sessionBefore.id, displayName: "Task", availability: { kind: "ready" } }],
      selectedVisibleId: sessionBefore.id,
    })

    const workspaceAfter = [
      { kind: "rename", sessionId: sessionBefore.id, displayName: "Renamed task" } as const,
      { kind: "background", sessionId: sessionBefore.id } as const,
      { kind: "reopen", sessionId: sessionBefore.id } as const,
    ].reduce(workspaceReducer, workspaceBefore)

    expect(sessionBefore.status).toBe("working")
    expect(sessionBefore.turns).toEqual([])
    expect(workspaceAfter.conversations[sessionBefore.id]?.displayName).toBe("Renamed task")
    expect(workspaceAfter.selectedVisibleId).toBe(sessionBefore.id)
  })

  it("records attention acknowledgement without clearing the session reducer status", () => {
    const sessionBefore = sessionReducer(initial(), { kind: "status", status: "awaiting_approval" })
    const workspaceBefore = createWorkspaceState({
      conversations: [{ sessionId: sessionBefore.id, displayName: "Approval", availability: { kind: "ready" } }],
      selectedVisibleId: sessionBefore.id,
    })
    const withAttention = workspaceReducer(workspaceBefore, {
      kind: "execution_status",
      sessionId: sessionBefore.id,
      status: sessionBefore.status,
    })
    const acknowledged = workspaceReducer(withAttention, { kind: "select", sessionId: sessionBefore.id })

    expect(acknowledged.conversations[sessionBefore.id]?.attention.seen).toBe(true)
    expect(sessionBefore.status).toBe("awaiting_approval")
  })
})

describe("integration: folding a scripted multi-event sequence", () => {
  it("yields the expected final SessionState", () => {
    const events: DomainSessionEvent[] = [
      { kind: "status", status: "working" },
      { kind: "user_message", messageId: "u1", text: "Refactor the config loader" },
      { kind: "agent_message", messageId: "a1", textDelta: "On it. " },
      { kind: "agent_message", messageId: "a1", textDelta: "Reading the file first." },
      {
        kind: "tool_call",
        call: {
          toolCallId: "read-1",
          kind: "read",
          title: "Read config loader",
          status: "completed",
          locations: ["src/config/loader.ts"],
        },
      },
      {
        kind: "tool_call",
        call: {
          toolCallId: "edit-1",
          kind: "edit",
          title: "Rewrite loader",
          status: "pending",
          locations: ["src/config/loader.ts"],
          diff: { path: "src/config/loader.ts", unified: "@@ -1 +1 @@\n-old\n+new" },
        },
      },
      { kind: "status", status: "awaiting_approval" },
    ]

    const state = fold(events)

    expect(state.status).toBe("awaiting_approval")
    expect(state.turns).toEqual([
      { kind: "user", messageId: "u1", text: "Refactor the config loader" },
      { kind: "agent", messageId: "a1", text: "On it. Reading the file first." },
      {
        kind: "tool_call",
        record: {
          toolCallId: "read-1",
          kind: "read",
          title: "Read config loader",
          status: "completed",
          locations: ["src/config/loader.ts"],
        },
      },
      {
        kind: "tool_call",
        record: {
          toolCallId: "edit-1",
          kind: "edit",
          title: "Rewrite loader",
          status: "pending",
          locations: ["src/config/loader.ts"],
          diff: { path: "src/config/loader.ts", unified: "@@ -1 +1 @@\n-old\n+new" },
        },
      },
    ])
    // The file was read then edited; the edit wins.
    expect([...state.referencedFiles]).toEqual([["src/config/loader.ts", "edited"]])
    expect(state.pendingDiffs).toEqual([
      { toolCallId: "edit-1", path: "src/config/loader.ts", unified: "@@ -1 +1 @@\n-old\n+new" },
    ])
  })

  it("folds user_message -> config_options -> status into the expected final state", () => {
    const options: ConfigOption[] = [
      {
        id: "cfg-model",
        category: "model",
        label: "Model",
        currentValue: "sonnet",
        options: [
          { value: "opus", name: "Opus" },
          { value: "sonnet", name: "Sonnet" },
        ],
      },
    ]
    const events: DomainSessionEvent[] = [
      { kind: "user_message", messageId: "u1", text: "switch model" },
      { kind: "config_options", options },
      { kind: "status", status: "working" },
    ]

    const state = fold(events)

    expect(state.status).toBe("working")
    expect(state.configOptions).toEqual(options)
    expect(state.turns).toEqual([{ kind: "user", messageId: "u1", text: "switch model" }])
  })
})
