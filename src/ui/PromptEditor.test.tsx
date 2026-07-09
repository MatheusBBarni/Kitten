import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  PROMPT_DISABLED_PLACEHOLDER,
  PROMPT_DISABLED_TITLE,
  PROMPT_PLACEHOLDER,
  PROMPT_TITLE,
  PromptEditor,
} from "./PromptEditor.tsx"

/**
 * Mount the editor on a Kitty-keyboard terminal.
 *
 * Only the Kitty protocol reports Shift+Enter as a modified `return` rather than as a
 * bare carriage return, and it encodes Escape as a complete sequence rather than a
 * lone byte the parser must wait out. Both are what this component's key handling is
 * about, so the tests speak the protocol that can express them.
 */
async function renderEditor(controller: FakeController, height = 10): Promise<TestRendererSetup> {
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <PromptEditor />
    </CockpitProvider>,
    { width: 64, height, kittyKeyboard: true },
  )
  await setup.waitForFrame((frame) => frame.includes(PROMPT_TITLE) || frame.includes(PROMPT_DISABLED_TITLE))
  return setup
}

/** Type `text` into the focused editor, one key at a time. */
async function type(setup: TestRendererSetup, text: string): Promise<void> {
  await actAsync(async () => {
    await setup.mockInput.typeText(text)
  })
}

/** Press Enter, optionally with Shift held. */
async function pressEnter(setup: TestRendererSetup, modifiers?: { shift: true }): Promise<void> {
  await actAsync(() => {
    setup.mockInput.pressEnter(modifiers)
  })
}

/** Press a bare Escape. */
async function pressEscape(setup: TestRendererSetup): Promise<void> {
  await actAsync(() => {
    setup.mockInput.pressEscape()
  })
}

/**
 * Wait until the painted frame contains every one of `needles`.
 *
 * A keystroke reaches the textarea's edit buffer immediately but only shows up after
 * the next render pass, so nothing about the draft can be asserted on a bare capture.
 */
function frameWith(setup: TestRendererSetup, ...needles: string[]): Promise<string> {
  return setup.waitForFrame((frame) => needles.every((needle) => frame.includes(needle)))
}

/** The single text argument the editor passed to `sendPrompt`. */
function sentText(controller: FakeController): string {
  expect(controller.calls.sendPrompt).toHaveLength(1)
  const { input, agentId } = controller.calls.sendPrompt[0]!
  // The editor always addresses the focused agent, never one by name.
  expect(agentId).toBeUndefined()
  expect(typeof input).toBe("string")
  return input as string
}

describe("PromptEditor submit", () => {
  it("sends the composed text to the focused agent on Enter and clears the editor", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await type(setup, "explain this repo")
    await frameWith(setup, "explain this repo")

    await pressEnter(setup)

    expect(sentText(controller)).toBe("explain this repo")
    // The draft is gone: the placeholder is back, which only shows on an empty buffer.
    expect(await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))).not.toContain("explain this repo")

    await destroyMounted(setup.renderer)
  })

  it("ignores Enter on a whitespace-only draft", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await type(setup, "   ")
    await pressEnter(setup)

    expect(controller.calls.sendPrompt).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("inserts a newline on Shift+Enter without submitting", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await type(setup, "first")
    await pressEnter(setup, { shift: true })
    await type(setup, "second")

    expect(controller.calls.sendPrompt).toEqual([])
    // Adjacent rows of the frame, so the newline broke the line and the editor grew
    // to keep the whole draft visible.
    const rows = (await frameWith(setup, "first", "second")).split("\n")
    const withFirst = rows.findIndex((row) => row.includes("first"))
    const withSecond = rows.findIndex((row) => row.includes("second"))
    expect(withSecond).toBe(withFirst + 1)

    // The whole multi-line draft submits as one prompt.
    await pressEnter(setup)
    expect(sentText(controller)).toBe("first\nsecond")

    await destroyMounted(setup.renderer)
  })
})

describe("PromptEditor interrupt", () => {
  it("cancels the focused agent on Escape while it is working", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    const setup = await renderEditor(controller)

    await pressEscape(setup)

    expect(controller.calls.cancel).toEqual([undefined])

    await destroyMounted(setup.renderer)
  })

  it("leaves Escape alone while the focused agent is idle", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await pressEscape(setup)

    expect(controller.calls.cancel).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("interrupts the agent that has focus, not the one that is working", async () => {
    const controller = createFakeController()
    // Codex is working, but Claude Code holds focus and is idle.
    controller.store.applyEvent("codex", { kind: "status", status: "working" })
    const setup = await renderEditor(controller)

    await pressEscape(setup)
    expect(controller.calls.cancel).toEqual([])

    await actAsync(() => {
      controller.actions.switchFocus("codex")
    })
    await pressEscape(setup)
    expect(controller.calls.cancel).toEqual([undefined])

    await destroyMounted(setup.renderer)
  })
})

describe("PromptEditor paste", () => {
  it("inserts a large bracketed paste intact, without submitting on its newlines", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    // Far larger than the stdin parser's 64KiB pending-byte budget for ordinary
    // input, and multi-line, so a paste that leaked into the keypress path would
    // both truncate and submit early.
    const pasted = Array.from({ length: 800 }, (_, index) => `line ${index}: ${"x".repeat(100)}`).join("\n")
    expect(pasted.length).toBeGreaterThan(64 * 1024)

    await actAsync(async () => {
      await setup.mockInput.pasteBracketedText(pasted)
    })

    expect(controller.calls.sendPrompt).toEqual([])

    await pressEnter(setup)
    expect(sentText(controller)).toBe(pasted)

    await destroyMounted(setup.renderer)
  })

  it("splices a paste into the draft already in the editor", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await type(setup, "review ")
    await actAsync(async () => {
      await setup.mockInput.pasteBracketedText("src/ui/PromptEditor.tsx")
    })
    await type(setup, " please")
    await pressEnter(setup)

    expect(sentText(controller)).toBe("review src/ui/PromptEditor.tsx please")

    await destroyMounted(setup.renderer)
  })
})

describe("PromptEditor readiness gate", () => {
  const notReady: AgentRuntimeState[] = [
    { agentId: "claude-code", displayName: "Claude Code", ready: false, error: "claude-agent-acp: not found" },
    readyRuntimes()[1]!,
  ]

  it("refuses to submit while the focused agent is not ready, and says so", async () => {
    const controller = createFakeController({ runtimes: notReady })
    const setup = await renderEditor(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(PROMPT_DISABLED_TITLE)
    expect(frame).toContain(PROMPT_DISABLED_PLACEHOLDER)

    await type(setup, "are you there")
    await pressEnter(setup)

    expect(controller.calls.sendPrompt).toEqual([])
    // The draft survives, so switching to a ready agent does not cost the user's words.
    await frameWith(setup, "are you there")

    await destroyMounted(setup.renderer)
  })

  it("re-enables submission when focus moves to a ready agent", async () => {
    const controller = createFakeController({ runtimes: notReady })
    const setup = await renderEditor(controller)

    await type(setup, "ping")
    await actAsync(() => {
      controller.actions.switchFocus("codex")
    })
    await setup.waitForFrame((frame) => frame.includes(PROMPT_TITLE))

    await pressEnter(setup)
    expect(sentText(controller)).toBe("ping")

    await destroyMounted(setup.renderer)
  })
})

describe("PromptEditor round-trip", () => {
  it("composes, submits, then interrupts through the controller in that order", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await type(setup, "refactor the store")
    await pressEnter(setup, { shift: true })
    await type(setup, "keep the selectors narrow")

    // Nothing has reached the controller yet: composing is purely local.
    expect(controller.calls.sendPrompt).toEqual([])
    expect(controller.calls.cancel).toEqual([])

    await pressEnter(setup)
    expect(sentText(controller)).toBe("refactor the store\nkeep the selectors narrow")
    // Submit happened strictly before any interrupt.
    expect(controller.calls.cancel).toEqual([])

    // The agent picks the turn up; only now does Escape mean anything.
    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    })
    await pressEscape(setup)

    expect(controller.calls.sendPrompt).toHaveLength(1)
    expect(controller.calls.cancel).toEqual([undefined])

    await destroyMounted(setup.renderer)
  })
})
