import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { DelegatedChildStatus, SessionId, SessionStatus } from "../core/types.ts"
import { createInMemoryShellRuntimeFactory } from "../shell/shellRuntime.ts"
import { CockpitApp } from "./CockpitApp.tsx"
import { TAB_CLOSE_HINT, TAB_RENAME_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"
import {
  BACKGROUND_LABEL,
  CANCEL_DELIBERATELY_LABEL,
  CLOSE_DIALOG_TITLE,
  EMPTY_RENAME_ERROR,
  IDLE_CLOSE_LABEL,
  KEEP_OPEN_LABEL,
  KEEP_WORKING_LABEL,
  RENAME_DIALOG_TITLE,
} from "./TabDialog.tsx"

const DRAFT_MARKER = "zzq-dialog-leak"

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

async function openDialog(
  setup: TestRendererSetup,
  controller: FakeController,
  kind: "rename" | "close",
  sessionId: SessionId = "claude-code",
): Promise<string> {
  await actAsync(() => controller.store.openTabDialog({ kind, sessionId }))
  const hint = kind === "rename" ? TAB_RENAME_HINT : TAB_CLOSE_HINT
  return setup.waitForFrame((frame) => frame.includes(hint))
}

function setStatus(controller: FakeController, sessionId: SessionId, status: SessionStatus): void {
  controller.store.applyEvent(sessionId, { kind: "status", status })
}

function addDelegatedChild(
  controller: FakeController,
  parentId: SessionId,
  childId: SessionId,
  status: DelegatedChildStatus,
): void {
  const selected = controller.store.getState().workspace.selectedVisibleId
  if (selected !== parentId) controller.store.selectConversation(parentId)
  controller.store.addDelegatedSession({
    seed: { id: childId, providerKind: "codex", title: childId, cwd: "/workspace/kitten" },
    parentId,
    parentGeneration: 1,
    childGeneration: 1,
    task: `Handle ${childId}`,
    desiredOutcome: `Report ${childId}`,
  })
  if (selected && selected !== parentId) controller.store.selectConversation(selected)

  const identity = { parentId, childId, parentGeneration: 1, childGeneration: 1 }
  if (status === "starting") return
  if (status === "running") {
    controller.store.publishDelegatedChildState({ ...identity, status, sessionStatus: "working" })
  } else if (status === "needs_input") {
    controller.store.publishDelegatedChildState({
      ...identity,
      status,
      sessionStatus: "awaiting_clarification",
    })
  } else if (status === "finished") {
    controller.store.publishDelegatedChildState({ ...identity, status: "running", sessionStatus: "working" })
    controller.store.publishDelegatedChildState({ ...identity, status, sessionStatus: "finished", at: 1 })
  } else if (status === "failed") {
    controller.store.publishDelegatedChildState({ ...identity, status, sessionStatus: "error", at: 1 })
  } else {
    controller.store.publishDelegatedChildState({ ...identity, status, sessionStatus: "idle", at: 1 })
  }
}

function openApproval(controller: FakeController): void {
  controller.store.openApproval({
    sessionId: "codex",
    title: "Codex",
    cwd: "/workspace/kitten",
    request: {
      sessionId: "codex",
      toolCall: { toolCallId: "approval-over-dialog", kind: "other", title: "Topmost action" },
      options: [{ optionId: "reject", name: "Reject", kind: "reject_once" }],
    },
  })
}

async function replaceRenameDraft(setup: TestRendererSetup, value: string): Promise<void> {
  await actAsync(async () => {
    setup.mockInput.pressKey("u", { ctrl: true })
    await setup.mockInput.typeText(value)
  })
}

describe("TabDialog rename", () => {
  it("prefills the captured conversation name, trims confirmation, and has no runtime effect", async () => {
    const controller = createFakeController()
    controller.store.renameConversation("claude-code", "Current task")
    const setup = await renderCockpit(controller)

    try {
      const opened = await openDialog(setup, controller, "rename")
      expect(opened).toContain(RENAME_DIALOG_TITLE)
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("Current task")

      await replaceRenameDraft(setup, "  Focused task  ")
      await actAsync(() => setup.mockInput.pressEnter())
      await setup.waitForFrame((frame) => !frame.includes(TAB_RENAME_HINT))

      expect(controller.calls.renameConversation).toEqual([
        { sessionId: "claude-code", displayName: "Focused task" },
      ])
      expect(controller.calls.cancel).toEqual([])
      expect(controller.calls.closeConversation).toEqual([])
      expect(controller.store.getState().workspace.conversations["claude-code"]?.displayName).toBe("Focused task")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("refuses whitespace-only confirmation and keeps the dialog focused", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    try {
      await openDialog(setup, controller, "rename")
      await replaceRenameDraft(setup, "   ")
      await actAsync(() => setup.mockInput.pressEnter())
      const refused = await setup.waitForFrame((frame) => frame.includes(EMPTY_RENAME_ERROR))

      expect(refused).toContain(TAB_RENAME_HINT)
      expect(controller.calls.renameConversation).toEqual([])
      expect(controller.store.getState().overlays.tabDialog).toEqual({
        kind: "rename",
        sessionId: "claude-code",
      })
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("   ")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("lets approval stand down the dialog and resumes the same target and draft afterward", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    try {
      await openDialog(setup, controller, "rename")
      await replaceRenameDraft(setup, "Retained draft")
      await actAsync(() => openApproval(controller))
      const approval = await setup.waitForFrame((frame) => frame.includes("Topmost action"))

      expect(approval).not.toContain(RENAME_DIALOG_TITLE)
      expect(controller.store.getState().overlays.tabDialog).toEqual({
        kind: "rename",
        sessionId: "claude-code",
      })

      await actAsync(() => setup.mockInput.pressEscape())
      const resumed = await setup.waitForFrame((frame) => frame.includes(TAB_RENAME_HINT))
      expect(resumed).toContain(RENAME_DIALOG_TITLE)
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("Retained draft")

      await actAsync(() => setup.mockInput.pressEnter())
      expect(controller.calls.renameConversation).toEqual([
        { sessionId: "claude-code", displayName: "Retained draft" },
      ])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})

describe("TabDialog close policy", () => {
  it("shows active child count and statuses with only cancel-and-close or keep-working", async () => {
    const controller = createFakeController()
    setStatus(controller, "claude-code", "working")
    addDelegatedChild(controller, "claude-code", "running-child", "running")
    addDelegatedChild(controller, "claude-code", "input-child", "needs_input")
    const setup = await renderCockpit(controller)

    try {
      const opened = await openDialog(setup, controller, "close")
      expect(opened).toContain("2 active child tasks affected")
      expect(opened).toContain("Running (1)")
      expect(opened).toContain("Needs input (1)")
      expect(opened).toContain("Cancel 2 child tasks and close")
      expect(opened).toContain(KEEP_WORKING_LABEL)
      expect(opened).not.toContain(BACKGROUND_LABEL)
      expect(opened).not.toContain("detach")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("confirms delegated parent cancellation once through the parent close action only", async () => {
    const controller = createFakeController()
    setStatus(controller, "claude-code", "working")
    addDelegatedChild(controller, "claude-code", "running-child", "running")
    const setup = await renderCockpit(controller)

    try {
      await openDialog(setup, controller, "close")
      await actAsync(() => setup.mockInput.pressEnter())

      expect(controller.calls.closeConversation).toEqual([
        { sessionId: "claude-code", choice: "cancel" },
      ])
      expect(controller.calls.cancelDelegatedChild).toEqual([])
      expect(controller.calls.cancel).toEqual([])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("keeps delegated lifecycle unchanged on Keep working and Escape", async () => {
    const controller = createFakeController()
    setStatus(controller, "claude-code", "working")
    addDelegatedChild(controller, "claude-code", "running-child", "running")
    const setup = await renderCockpit(controller)
    const before = controller.store.getState().delegation

    try {
      await openDialog(setup, controller, "close")
      await actAsync(() => {
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressEnter()
      })
      expect(controller.calls.closeConversation).toEqual([
        { sessionId: "claude-code", choice: "keep-open" },
      ])
      expect(controller.store.getState().delegation).toBe(before)

      await openDialog(setup, controller, "close")
      await actAsync(() => setup.mockInput.pressEscape())
      expect(controller.calls.closeConversation).toHaveLength(1)
      expect(controller.store.getState().delegation).toBe(before)
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("returns to ordinary close policy for terminal-only delegated children", async () => {
    const controller = createFakeController()
    addDelegatedChild(controller, "claude-code", "finished-child", "finished")
    addDelegatedChild(controller, "claude-code", "failed-child", "failed")
    const setup = await renderCockpit(controller)

    try {
      const opened = await openDialog(setup, controller, "close")
      expect(opened).toContain(IDLE_CLOSE_LABEL)
      expect(opened).not.toContain("child tasks affected")
      expect(opened).not.toContain(KEEP_WORKING_LABEL)
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("updates live child summary copy and keeps the selected choice clamped", async () => {
    const controller = createFakeController()
    setStatus(controller, "claude-code", "working")
    addDelegatedChild(controller, "claude-code", "running-child", "running")
    addDelegatedChild(controller, "claude-code", "input-child", "needs_input")
    const setup = await renderCockpit(controller)

    try {
      await openDialog(setup, controller, "close")
      await actAsync(() => setup.mockInput.pressArrow("down"))
      await actAsync(() => controller.store.publishDelegatedChildState({
        parentId: "claude-code",
        childId: "input-child",
        parentGeneration: 1,
        childGeneration: 1,
        status: "running",
        sessionStatus: "working",
      }))
      const updated = await setup.waitForFrame((frame) => frame.includes("Running (2)"))
      expect(updated).not.toContain("Needs input")

      await actAsync(() => controller.store.publishDelegatedChildState({
        parentId: "claude-code",
        childId: "input-child",
        parentGeneration: 1,
        childGeneration: 1,
        status: "finished",
        sessionStatus: "finished",
        at: 2,
      }))
      const reduced = await setup.waitForFrame((frame) => frame.includes("1 active child task affected"))
      expect(reduced).toContain("Cancel 1 child task and close")
      await actAsync(() => setup.mockInput.pressEnter())
      expect(controller.calls.closeConversation).toEqual([
        { sessionId: "claude-code", choice: "keep-open" },
      ])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("uses the direct close outcome for idle work and does not expose active choices", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    try {
      const opened = await openDialog(setup, controller, "close")
      expect(opened).toContain(CLOSE_DIALOG_TITLE)
      expect(opened).toContain(IDLE_CLOSE_LABEL)
      expect(opened).not.toContain(BACKGROUND_LABEL)
      expect(opened).not.toContain(CANCEL_DELIBERATELY_LABEL)
      expect(opened).not.toContain(KEEP_OPEN_LABEL)

      await actAsync(() => setup.mockInput.pressEnter())
      expect(controller.calls.closeConversation).toEqual([
        { sessionId: "claude-code", choice: "close" },
      ])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  for (const status of ["working", "awaiting_approval", "error", "finished"] as const) {
    it(`offers exactly the three explicit active choices for ${status}`, async () => {
      const controller = createFakeController()
      setStatus(controller, "claude-code", status)
      const setup = await renderCockpit(controller)

      try {
        const opened = await openDialog(setup, controller, "close")
        expect(opened).toContain(BACKGROUND_LABEL)
        expect(opened).toContain(CANCEL_DELIBERATELY_LABEL)
        expect(opened).toContain(KEEP_OPEN_LABEL)
        expect(opened).not.toContain("Close it, stop retaining live work")
        if (status === "error" || status === "finished") {
          expect(opened).toContain("no active turn will be")
          expect(opened).toContain("cancelled.")
        } else {
          expect(opened).toContain("Stop the current work deliberately")
        }
      } finally {
        await destroyMounted(setup.renderer)
      }
    })
  }

  it("backgrounds without ACP cancellation and remains bound to a non-selected target", async () => {
    const controller = createFakeController()
    setStatus(controller, "codex", "working")
    const setup = await renderCockpit(controller)

    try {
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
      await openDialog(setup, controller, "close", "codex")
      await actAsync(() => setup.mockInput.pressEnter())

      expect(controller.calls.closeConversation).toEqual([{ sessionId: "codex", choice: "background" }])
      expect(controller.calls.cancel).toEqual([])
      expect(controller.store.getState().workspace.conversations.codex?.lifecycle).toBe("background")
      expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("routes Cancel deliberately to the captured SessionId", async () => {
    const controller = createFakeController()
    setStatus(controller, "codex", "working")
    const setup = await renderCockpit(controller)

    try {
      await openDialog(setup, controller, "close", "codex")
      await actAsync(() => {
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressEnter()
      })

      expect(controller.calls.closeConversation).toEqual([{ sessionId: "codex", choice: "cancel" }])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("Keep open and Escape leave lifecycle and runtime state unchanged", async () => {
    const controller = createFakeController()
    setStatus(controller, "claude-code", "working")
    const setup = await renderCockpit(controller)
    const runtime = controller.runtime("claude-code")

    try {
      await openDialog(setup, controller, "close")
      await actAsync(() => {
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressArrow("down")
        setup.mockInput.pressEnter()
      })
      expect(controller.calls.closeConversation).toEqual([
        { sessionId: "claude-code", choice: "keep-open" },
      ])
      expect(controller.store.getState().workspace.conversations["claude-code"]?.lifecycle).toBe("visible")
      expect(controller.runtime("claude-code")).toBe(runtime)

      await openDialog(setup, controller, "close")
      await actAsync(() => setup.mockInput.pressEscape())
      expect(controller.calls.closeConversation).toHaveLength(1)
      expect(controller.store.getState().workspace.conversations["claude-code"]?.lifecycle).toBe("visible")
      expect(controller.runtime("claude-code")).toBe(runtime)
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})

describe("TabDialog modal integration", () => {
  it("blocks prompt and global tab-key leakage, then restores prompt focus on Escape", async () => {
    const controller = createFakeController()
    setStatus(controller, "claude-code", "working")
    addDelegatedChild(controller, "claude-code", "modal-child", "running")
    controller.store.confirmKittyKeyboard()
    const setup = await renderCockpit(controller)

    try {
      await openDialog(setup, controller, "close")
      await actAsync(async () => {
        await setup.mockInput.typeText(DRAFT_MARKER)
        setup.mockInput.pressKey("l", { ctrl: true })
        setup.mockInput.pressKey("`", { ctrl: true })
      })

      expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
      expect(controller.store.getState().focusedPane).toEqual({ kind: "agent", sessionId: "claude-code" })
      expect(setup.captureCharFrame()).not.toContain(DRAFT_MARKER)

      await actAsync(() => setup.mockInput.pressEscape())
      const closed = await setup.waitForFrame((frame) => !frame.includes(TAB_CLOSE_HINT))
      expect(closed).toContain(PROMPT_PLACEHOLDER)
      expect(setup.renderer.currentFocusedEditor?.plainText).toBe("")
    } finally {
      await destroyMounted(setup.renderer)
    }
  })

  it("blocks shell bytes while mounted", async () => {
    const shell = createInMemoryShellRuntimeFactory()
    const runtime = shell.factory({ cwd: process.cwd() })
    const controller = createFakeController({ shell: { ready: true, runtime } })
    controller.store.setFocusedPane({ kind: "shell" })
    setStatus(controller, "claude-code", "working")
    addDelegatedChild(controller, "claude-code", "shell-child", "running")
    const setup = await renderCockpit(controller)

    try {
      await openDialog(setup, controller, "close")
      await actAsync(async () => {
        await setup.mockInput.typeText("ls")
        setup.mockInput.pressEnter()
      })
      expect(shell.writes).toEqual([])
    } finally {
      await destroyMounted(setup.renderer)
      await runtime.dispose()
    }
  })

  it("stands down the delegated close warning while approval has priority", async () => {
    const controller = createFakeController()
    setStatus(controller, "claude-code", "working")
    addDelegatedChild(controller, "claude-code", "approval-child", "running")
    const setup = await renderCockpit(controller)

    try {
      await openDialog(setup, controller, "close")
      await actAsync(() => openApproval(controller))
      const approval = await setup.waitForFrame((frame) => frame.includes("Topmost action"))
      expect(approval).not.toContain("Cancel 1 child task and close")
      expect(controller.store.getState().overlays.tabDialog).toEqual({
        kind: "close",
        sessionId: "claude-code",
      })

      await actAsync(() => setup.mockInput.pressEscape())
      const resumed = await setup.waitForFrame((frame) => frame.includes("Cancel 1 child task and close"))
      expect(resumed).toContain(KEEP_WORKING_LABEL)
      expect(controller.calls.closeConversation).toEqual([])
    } finally {
      await destroyMounted(setup.renderer)
    }
  })
})
