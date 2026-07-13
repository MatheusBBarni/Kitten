import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { SessionId, SessionStatus } from "../core/types.ts"
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
})
