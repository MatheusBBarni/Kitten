// Suite: explicit focused-parent delegation dialog
// Invariant: local drafts launch exactly once while parent focus and modal priority remain stable.
// Boundary IN: real AppStore, CockpitApp command routing, OpenTUI renderer/input, and fake ControllerActions.
// Boundary OUT: delegated runtime creation and lifecycle publication, covered by controller integration tests.

import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { ExploreLaunchResult } from "../app/actions.ts"
import {
  EXPLORE_DENIAL_LABELS,
  EXPLORE_ROLE_LABEL,
} from "../store/selectors.ts"
import { APPROVAL_TITLE } from "./ApprovalPrompt.tsx"
import { CLARIFICATION_TITLE } from "./ClarificationPrompt.tsx"
import { CockpitApp } from "./CockpitApp.tsx"
import {
  DELEGATION_DIALOG_TITLE,
  DELEGATION_DENIED_PREFIX,
  DELEGATION_OUTCOME_ERROR,
  DELEGATION_PENDING,
  DELEGATION_TASK_ERROR,
} from "./DelegationDialog.tsx"
import { DELEGATION_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"

async function renderCockpit(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await testRender(<CockpitApp controller={controller} />, {
    width: 100,
    height: 24,
    kittyKeyboard: true,
    exitOnCtrlC: false,
  })
  await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))
  return setup
}

async function openWithChord(setup: TestRendererSetup): Promise<string> {
  await actAsync(() => setup.mockInput.pressKey("g", { ctrl: true }))
  return setup.waitForFrame((frame) => frame.includes(DELEGATION_HINT))
}

async function openWithSlash(setup: TestRendererSetup): Promise<string> {
  await actAsync(async () => setup.mockInput.typeText("/delegate"))
  await actAsync(() => setup.mockInput.pressEnter())
  return setup.waitForFrame((frame) => frame.includes(DELEGATION_HINT))
}

async function enterLaunch(setup: TestRendererSetup, task: string, outcome: string): Promise<void> {
  await typeExact(setup, task)
  await actAsync(() => setup.mockInput.pressTab())
  await typeExact(setup, outcome)
}

/** Bracketed paste preserves exact whitespace in the focused OpenTUI input. */
async function typeExact(setup: TestRendererSetup, value: string): Promise<void> {
  await actAsync(async () => setup.mockInput.pasteBracketedText(value))
}

function openApproval(controller: FakeController): void {
  controller.store.openApproval({
    sessionId: "codex",
    title: "Codex",
    cwd: "/workspace/kitten",
    request: {
      sessionId: "codex",
      toolCall: { toolCallId: "approval-over-delegation", kind: "other", title: "Approve background action" },
      options: [{ optionId: "reject", name: "Reject", kind: "reject_once" }],
    },
  })
}

function openClarification(controller: FakeController): void {
  controller.store.openClarification({
    requestId: "clarification-over-delegation",
    generation: 1,
    sessionId: "codex",
    title: "Codex",
    cwd: "/workspace/kitten",
    payload: {
      prompt: "Choose a boundary",
      fields: [{
        id: "boundary",
        label: "Boundary",
        mode: "single",
        allowsCustom: false,
        required: true,
        options: [{ id: "store", label: "Store" }],
      }],
    },
  })
}

function deferredExplore() {
  let resolve!: (value: ExploreLaunchResult) => void
  const promise = new Promise<ExploreLaunchResult>((settle) => { resolve = settle })
  return { promise, resolve }
}

describe("DelegationDialog launch", () => {
  it("opens through Ctrl+G and /delegate only with a focused parent", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    try {
      expect(await openWithChord(setup)).toContain(DELEGATION_DIALOG_TITLE)
      await actAsync(() => setup.mockInput.pressEscape())
      await setup.waitForFrame((frame) => !frame.includes(DELEGATION_HINT))

      expect(await openWithSlash(setup)).toContain(DELEGATION_DIALOG_TITLE)
      await actAsync(() => setup.mockInput.pressEscape())
      await actAsync(() => controller.store.setFocusedPane({ kind: "shell" }))
      await actAsync(() => setup.mockInput.pressKey("g", { ctrl: true }))
      expect(controller.store.getState().overlays.delegation).toBeNull()
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("shows field-specific errors for whitespace and records no launch", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    try {
      await openWithChord(setup)
      await enterLaunch(setup, "   ", "   ")
      await actAsync(() => setup.mockInput.pressEnter())
      const frame = await setup.waitForFrame(
        (value) => value.includes(DELEGATION_TASK_ERROR) && value.includes(DELEGATION_OUTCOME_ERROR),
      )

      expect(frame).toContain(DELEGATION_DIALOG_TITLE)
      expect(controller.calls.startDelegatedChild).toEqual([])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("submits trimmed values exactly once while pending and retains parent focus on success", async () => {
    const deferred = deferredExplore()
    const controller = createFakeController({ startExploreChild: () => deferred.promise })
    const setup = await renderCockpit(controller)
    const selected = controller.store.getState().workspace.selectedVisibleId
    const focusedPane = controller.store.getState().focusedPane

    try {
      await openWithChord(setup)
      await enterLaunch(setup, "  Inspect parser  ", "  Return findings  ")
      await actAsync(() => {
        setup.mockInput.pressEnter()
        setup.mockInput.pressEnter()
      })
      expect(await setup.waitForFrame((frame) => frame.includes(DELEGATION_PENDING))).toContain(DELEGATION_DIALOG_TITLE)
      expect(controller.calls.startExploreChild).toEqual([{
        parentId: "claude-code",
        task: "Inspect parser",
        desiredOutcome: "Return findings",
      }])
      expect(controller.calls.startDelegatedChild).toEqual([])

      await actAsync(() => deferred.resolve({ kind: "started", childId: "delegated-success" }))
      await setup.waitForFrame((frame) => !frame.includes(DELEGATION_HINT))
      expect(controller.store.getState().workspace.selectedVisibleId).toBe(selected)
      expect(controller.store.getState().focusedPane).toEqual(focusedPane)
      expect(controller.store.getState().overlays.delegation).toBeNull()
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("prevents an unavailable launch and presents the exact advisory reason without a fallback", async () => {
    const controller = createFakeController({
      exploreAvailability: () => ({ kind: "denied", reason: "unsupported-provider" }),
      startExploreChild: () => ({ kind: "started", childId: "must-not-start" }),
    })
    const setup = await renderCockpit(controller)

    try {
      await openWithChord(setup)
      await enterLaunch(setup, "Investigate", "Explain the cause")
      await actAsync(() => setup.mockInput.pressEnter())
      const frame = await setup.waitForFrame(
        (value) => value.includes(EXPLORE_DENIAL_LABELS["unsupported-provider"]),
      )

      expect(frame).toContain(DELEGATION_DIALOG_TITLE)
      expect(frame).toContain(EXPLORE_ROLE_LABEL)
      expect(frame).toContain("Read-only filesystem · No shell")
      expect(frame).toContain("No external MCP or agent control")
      expect(frame).toContain("Scoped ask_user only")
      expect(frame).toContain("No recursion")
      expect(controller.store.getState().overlays.delegation).toEqual({ parentId: "claude-code" })
      expect(controller.calls.startExploreChild).toEqual([])
      expect(controller.calls.startDelegatedChild).toEqual([])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it.each([
    [
      "typed denial",
      () => Promise.resolve({ kind: "denied", reason: "capacity-exhausted" } as const),
      "capacity-exhausted" as const,
    ],
    [
      "startup failure",
      () => Promise.reject(new Error("provider leaked /private/task config")),
      "startup-failed" as const,
    ],
  ])("retains drafts and focused field after a %s", async (_label, startExploreChild, reason) => {
    const controller = createFakeController({ startExploreChild })
    const setup = await renderCockpit(controller)

    try {
      await openWithChord(setup)
      await enterLaunch(setup, "Retained investigation", "Retained findings")
      await actAsync(() => setup.mockInput.pressEnter())
      const frame = await setup.waitForFrame(
        (value) => value.includes(`${DELEGATION_DENIED_PREFIX} ${EXPLORE_DENIAL_LABELS[reason]}`),
      )

      expect(frame).toContain("Retained investigation")
      expect(frame).toContain("Retained findings")
      expect(frame).not.toContain(DELEGATION_PENDING)
      expect(frame).not.toContain("provider leaked")
      expect(frame).not.toContain("/private/task")
      expect(controller.store.getState().overlays.delegation).toEqual({ parentId: "claude-code" })
      expect(controller.calls.startExploreChild).toHaveLength(1)
      expect(controller.calls.startDelegatedChild).toEqual([])
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("Retained findings")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("cancels with Escape without launching and restores the parent composer draft", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    try {
      await actAsync(async () => setup.mockInput.typeText("parent draft"))
      await openWithChord(setup)
      await actAsync(async () => setup.mockInput.typeText("child draft"))
      await actAsync(() => setup.mockInput.pressEscape())
      await setup.waitForFrame((frame) => !frame.includes(DELEGATION_HINT))

      expect(controller.calls.startDelegatedChild).toEqual([])
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
      expect(controller.store.getState().focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("parent draft")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})

describe("DelegationDialog modal behavior", () => {
  it("lets approval and clarification preempt without discarding local drafts", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    try {
      await openWithChord(setup)
      await enterLaunch(setup, "Retained task", "Retained outcome")

      await actAsync(() => openApproval(controller))
      const approval = await setup.waitForFrame((frame) => frame.includes(APPROVAL_TITLE))
      expect(approval).not.toContain(DELEGATION_DIALOG_TITLE)
      expect(controller.store.getState().overlays.delegation).toEqual({ parentId: "claude-code" })
      await actAsync(() => setup.mockInput.pressEscape())
      const afterApproval = await setup.waitForFrame((frame) => frame.includes(DELEGATION_HINT))
      expect(afterApproval).toContain("Retained outcome")

      await actAsync(() => openClarification(controller))
      const clarification = await setup.waitForFrame((frame) => frame.includes(CLARIFICATION_TITLE))
      expect(clarification).not.toContain(DELEGATION_DIALOG_TITLE)
      await actAsync(() => setup.mockInput.pressEscape())
      const resumed = await setup.waitForFrame((frame) => frame.includes(DELEGATION_HINT))
      expect(resumed).toContain("Retained task")
      expect(resumed).toContain("Retained outcome")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("keeps printable text and unrelated global or shell commands inside the open dialog", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    try {
      await openWithChord(setup)
      await actAsync(async () => setup.mockInput.typeText("g-dialog"))
      await actAsync(() => {
        setup.mockInput.pressKey("`", { ctrl: true })
        setup.mockInput.pressKey("t", { ctrl: true })
        setup.mockInput.pressKey("g", { ctrl: true })
      })

      expect(controller.store.getState().focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })
      expect(controller.store.getState().overlays.handoffPreview).toBeNull()
      expect(controller.store.getState().overlays.delegation).toEqual({ parentId: "claude-code" })
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("g-dialog")

      await actAsync(() => setup.mockInput.pressEscape())
      await setup.waitForFrame((frame) => !frame.includes(DELEGATION_HINT))
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})
