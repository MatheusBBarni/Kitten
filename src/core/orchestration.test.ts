import { describe, expect, it } from "bun:test"

import {
  createDelegationState,
  delegationReducer,
  isDelegatedChildCleanupEligible,
  isDelegationCleanupEligible,
  isDelegationSettled,
  selectDelegatedChild,
  selectDelegationAggregateStatus,
  selectDelegationParent,
  selectDelegationTerminalOutcomes,
  selectOrderedDelegatedChildIds,
  selectOrderedDelegatedChildren,
} from "./orchestration.ts"
import type {
  DelegatedChildStatus,
  DelegatedChildTerminalStatus,
  DelegationEvent,
  DelegationState,
} from "./types.ts"

const registration = (
  parentId = "parent",
  childId = "child-1",
  parentGeneration = 4,
  childGeneration = 9,
): Extract<DelegationEvent, { kind: "register_child" }> => ({
  kind: "register_child",
  parentId,
  childId,
  parentGeneration,
  childGeneration,
  task: `Implement ${childId}`,
  desiredOutcome: `Verified ${childId}`,
})

const register = (
  state = createDelegationState(),
  event = registration(),
): DelegationState => delegationReducer(state, event)

function publish(
  state: DelegationState,
  status: DelegatedChildStatus,
  overrides: Partial<{
    parentId: string
    childId: string
    parentGeneration: number
    childGeneration: number
    at: number
  }> = {},
): DelegationState {
  const identity = {
    parentId: overrides.parentId ?? "parent",
    childId: overrides.childId ?? "child-1",
    parentGeneration: overrides.parentGeneration ?? 4,
    childGeneration: overrides.childGeneration ?? 9,
  }
  return status === "finished" || status === "failed" || status === "cancelled"
    ? delegationReducer(state, { ...identity, kind: "publish_child_status", status, at: overrides.at ?? 100 })
    : delegationReducer(state, { ...identity, kind: "publish_child_status", status })
}

describe("delegation registration", () => {
  it("creates ordered immutable ownership with explicit task and outcome text", () => {
    const empty = createDelegationState()
    const first = register(empty)
    const firstChild = selectDelegatedChild(first, "child-1")
    const second = register(first, registration("parent", "child-2", 4, 10))

    expect(first).not.toBe(empty)
    expect(selectDelegationParent(second, "parent")).toEqual({
      parentId: "parent",
      parentGeneration: 4,
      childIds: ["child-1", "child-2"],
      closeState: "open",
    })
    expect(selectOrderedDelegatedChildIds(second, "parent")).toEqual(["child-1", "child-2"])
    expect(selectOrderedDelegatedChildren(second, "parent").map((child) => child.childId)).toEqual([
      "child-1",
      "child-2",
    ])
    expect(firstChild).toEqual({
      childId: "child-1",
      parentId: "parent",
      parentGeneration: 4,
      childGeneration: 9,
      status: "starting",
      task: "Implement child-1",
      desiredOutcome: "Verified child-1",
    })
    expect(selectDelegatedChild(second, "child-1")).toBe(firstChild)
    expect(first.parents.parent?.childIds).toEqual(["child-1"])
  })

  it("rejects duplicate, self, nested, re-parented, malformed, and stale-parent registrations", () => {
    const initial = register()
    const withSecondParent = register(initial, registration("other-parent", "other-child", 2, 3))
    const nestedParent = registration("child-1", "grandchild", 9, 1)
    const nestedChild = registration("root", "parent", 1, 4)
    const attempts: DelegationEvent[] = [
      registration(),
      registration("child-1", "child-1", 9, 10),
      registration("new-parent", "child-1", 1, 9),
      nestedParent,
      nestedChild,
      registration("parent", "new-child", 5, 11),
      { ...registration("parent", "blank-task", 4, 12), task: "  " },
      { ...registration("parent", "blank-outcome", 4, 13), desiredOutcome: "" },
      { ...registration("parent", "bad-generation", 4, 14), childGeneration: -1 },
    ]

    for (const event of attempts) expect(delegationReducer(withSecondParent, event)).toBe(withSecondParent)
  })

  it("rejects new children after close intent and preserves duplicate close identity", () => {
    const initial = register()
    const closing = delegationReducer(initial, {
      kind: "mark_parent_closing",
      parentId: "parent",
      parentGeneration: 4,
    })

    expect(closing).not.toBe(initial)
    expect(closing.parents.parent?.closeState).toBe("closing")
    expect(
      delegationReducer(closing, {
        kind: "mark_parent_closing",
        parentId: "parent",
        parentGeneration: 4,
      }),
    ).toBe(closing)
    expect(register(closing, registration("parent", "late-child", 4, 10))).toBe(closing)
    expect(
      delegationReducer(initial, {
        kind: "mark_parent_closing",
        parentId: "parent",
        parentGeneration: 99,
      }),
    ).toBe(initial)
  })
})

describe("delegation lifecycle", () => {
  it("accepts exactly the legal lifecycle transition matrix", () => {
    const statuses = [
      "starting",
      "running",
      "needs_input",
      "finished",
      "failed",
      "cancelled",
    ] satisfies DelegatedChildStatus[]
    const allowed: Readonly<Record<DelegatedChildStatus, readonly DelegatedChildStatus[]>> = {
      starting: ["running", "needs_input", "failed", "cancelled"],
      running: ["needs_input", "finished", "failed", "cancelled"],
      needs_input: ["running", "failed", "cancelled"],
      finished: [],
      failed: [],
      cancelled: [],
    }
    const stateAt = (status: DelegatedChildStatus): DelegationState => {
      let state = register()
      if (status === "starting") return state
      state = publish(state, "running")
      if (status === "running") return state
      if (status === "needs_input") return publish(state, "needs_input")
      return publish(state, status)
    }

    for (const source of statuses) {
      const state = stateAt(source)
      for (const target of statuses) {
        const next = publish(state, target)
        expect(next === state).toBe(!allowed[source].includes(target))
      }
    }
  })

  it("reduces starting through needs-input to one immutable finished snapshot", () => {
    const starting = register()
    const running = publish(starting, "running")
    const needsInput = publish(running, "needs_input")
    const resumed = publish(needsInput, "running")
    const finished = publish(resumed, "finished", { at: 1_234 })

    expect(selectDelegatedChild(starting, "child-1")?.status).toBe("starting")
    expect(selectDelegatedChild(running, "child-1")?.status).toBe("running")
    expect(selectDelegatedChild(needsInput, "child-1")?.status).toBe("needs_input")
    expect(selectDelegatedChild(resumed, "child-1")?.status).toBe("running")
    expect(selectDelegatedChild(finished, "child-1")).toMatchObject({
      status: "finished",
      terminal: { status: "finished", at: 1_234 },
    })
    expect(selectDelegatedChild(resumed, "child-1")?.terminal).toBeUndefined()
  })

  it.each(["failed", "cancelled"] satisfies DelegatedChildTerminalStatus[])(
    "makes %s terminal exactly once and rejects every later publication",
    (terminalStatus) => {
      const terminal = publish(publish(register(), "running"), terminalStatus, { at: 77 })
      const child = selectDelegatedChild(terminal, "child-1")

      for (const status of [
        "starting",
        "running",
        "needs_input",
        "finished",
        "failed",
        "cancelled",
      ] satisfies DelegatedChildStatus[]) {
        expect(publish(terminal, status, { at: 999 })).toBe(terminal)
      }
      expect(selectDelegatedChild(terminal, "child-1")).toBe(child)
      expect(child?.terminal).toEqual({ status: terminalStatus, at: 77 })
    },
  )

  it("rejects unknown ids, stale generations, ownership mismatch, duplicates, and illegal regressions", () => {
    const starting = register()
    const running = publish(starting, "running")

    expect(publish(starting, "starting")).toBe(starting)
    expect(publish(running, "running")).toBe(running)
    expect(publish(running, "starting")).toBe(running)
    expect(publish(running, "failed", { childId: "unknown" })).toBe(running)
    expect(publish(running, "failed", { parentId: "unknown" })).toBe(running)
    expect(publish(running, "failed", { parentGeneration: 5 })).toBe(running)
    expect(publish(running, "failed", { childGeneration: 10 })).toBe(running)
    expect(publish(running, "failed", { at: Number.NaN })).toBe(running)
  })
})

describe("delegation selectors and cleanup", () => {
  it("distinguishes active, needs-input, and settled groups in registration order", () => {
    let state = register()
    state = register(state, registration("parent", "child-2", 4, 10))

    expect(selectDelegationAggregateStatus(state, "parent")).toBe("active")
    expect(isDelegationSettled(state, "parent")).toBe(false)
    state = publish(state, "needs_input", { childId: "child-2", childGeneration: 10 })
    expect(selectDelegationAggregateStatus(state, "parent")).toBe("needs_input")
    state = publish(state, "running", { childId: "child-1" })
    state = publish(state, "finished", { childId: "child-1", at: 10 })
    expect(selectDelegationAggregateStatus(state, "parent")).toBe("needs_input")
    state = publish(state, "failed", { childId: "child-2", childGeneration: 10, at: 20 })

    expect(selectDelegationAggregateStatus(state, "parent")).toBe("settled")
    expect(isDelegationSettled(state, "parent")).toBe(true)
    expect(selectDelegationTerminalOutcomes(state, "parent")).toEqual([
      { status: "finished", at: 10 },
      { status: "failed", at: 20 },
    ])
    expect(selectDelegationAggregateStatus(state, "missing")).toBeNull()
    expect(selectOrderedDelegatedChildIds(state, "missing")).toBe(
      selectOrderedDelegatedChildIds(createDelegationState(), "also-missing"),
    )
  })

  it("preserves unrelated selector identities and permits terminal-only cleanup", () => {
    let state = register()
    state = register(state, registration("other-parent", "other-child", 2, 3))
    const otherParent = selectDelegationParent(state, "other-parent")
    const otherChild = selectDelegatedChild(state, "other-child")
    const otherIds = selectOrderedDelegatedChildIds(state, "other-parent")

    expect(isDelegatedChildCleanupEligible(state, "child-1")).toBe(false)
    expect(isDelegationCleanupEligible(state, "parent")).toBe(false)
    expect(
      delegationReducer(state, {
        kind: "remove_child",
        parentId: "parent",
        childId: "child-1",
        parentGeneration: 4,
        childGeneration: 9,
      }),
    ).toBe(state)

    const terminal = publish(state, "cancelled", { at: 88 })
    expect(selectDelegationParent(terminal, "other-parent")).toBe(otherParent)
    expect(selectDelegatedChild(terminal, "other-child")).toBe(otherChild)
    expect(selectOrderedDelegatedChildIds(terminal, "other-parent")).toBe(otherIds)
    expect(isDelegatedChildCleanupEligible(terminal, "child-1")).toBe(true)
    expect(isDelegationCleanupEligible(terminal, "parent")).toBe(true)

    const removed = delegationReducer(terminal, {
      kind: "remove_child",
      parentId: "parent",
      childId: "child-1",
      parentGeneration: 4,
      childGeneration: 9,
    })
    expect(selectDelegatedChild(removed, "child-1")).toBeUndefined()
    expect(selectDelegationParent(removed, "parent")).toBeUndefined()
    expect(selectDelegationParent(removed, "other-parent")).toBe(otherParent)
    expect(selectDelegatedChild(removed, "other-child")).toBe(otherChild)
  })
})
