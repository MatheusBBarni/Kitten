// Suite: PromptEditor presentation and controller interaction
// Invariant: visual restyling never changes prompt composition, submission, interruption, or readiness behavior.
// Boundary IN: real React rendering, OpenTUI textarea/layout, palette resolution, and controller actions.
// Boundary OUT: agent transport behavior, owned by controller and adapter integration suites.

import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { HandoffBundle } from "../core/types.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  PROMPT_DISABLED_PLACEHOLDER,
  PROMPT_DISABLED_TITLE,
  PROMPT_CHEVRON,
  PROMPT_PLACEHOLDER,
  PROMPT_TITLE,
  PromptEditor,
} from "./PromptEditor.tsx"
import type { CockpitCommand } from "./keymap.ts"
import { DARK_PALETTE } from "./theme.ts"

/**
 * Mount the editor on a Kitty-keyboard terminal.
 *
 * Only the Kitty protocol reports Shift+Enter as a modified `return` rather than as a
 * bare carriage return, and it encodes Escape as a complete sequence rather than a
 * lone byte the parser must wait out. Both are what this component's key handling is
 * about, so the tests speak the protocol that can express them.
 */
async function renderEditor(
  controller: FakeController,
  height = 10,
  onRunCommand?: (command: CockpitCommand) => void,
  dockPromptAtBottom = false,
): Promise<TestRendererSetup> {
  const editor = <PromptEditor onRunCommand={onRunCommand} />
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      {dockPromptAtBottom ? (
        <box style={{ height, flexDirection: "column" }}>
          <box style={{ flexGrow: 1 }} />
          {editor}
        </box>
      ) : (
        editor
      )}
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
  const { input, sessionId } = controller.calls.sendPrompt[0]!
  // The editor always addresses the focused agent, never one by name.
  expect(sessionId).toBeUndefined()
  expect(typeof input).toBe("string")
  return input as string
}

/** The painted foreground of the first span containing `needle`. */
function foregroundOf(setup: TestRendererSetup, needle: string): string | undefined {
  return setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.includes(needle))
    ?.fg.toString()
}

function paletteColor(hex: string): string {
  return RGBA.fromHex(hex).toString()
}

describe("PromptEditor presentation", () => {
  it("renders a spaced warm-accent chevron before the unchanged ready placeholder", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)
    const frame = setup.captureCharFrame()
    const contentLine = frame.split("\n").find((line) => line.includes(PROMPT_PLACEHOLDER))

    expect(frame).toContain("╭")
    expect(contentLine).toBeDefined()
    expect(contentLine).toContain(PROMPT_CHEVRON)
    expect(contentLine!.indexOf(PROMPT_CHEVRON)).toBeGreaterThan(contentLine!.indexOf("│") + 1)
    expect(contentLine!.indexOf(PROMPT_PLACEHOLDER)).toBeGreaterThan(
      contentLine!.indexOf(PROMPT_CHEVRON) + PROMPT_CHEVRON.length,
    )
    expect(foregroundOf(setup, PROMPT_CHEVRON)).toBe(paletteColor(DARK_PALETTE.accent))

    await destroyMounted(setup.renderer)
  })
})

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

describe("PromptEditor slash commands", () => {
  it("filters agent commands and inserts the selected command without sending it", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", {
      kind: "commands",
      commands: [
        { name: "review", description: "Review the current diff", hint: "[scope]" },
        { name: "test", description: "Run the focused tests" },
      ],
    })
    // The menu is positioned above the prompt, as it is in the real cockpit. Dock
    // the standalone editor to the bottom so the test observes that real layout.
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "/review")
    const menu = await frameWith(setup, "Commands", "Agent commands", "/review", "[scope]")
    expect(menu).not.toContain("/settings")

    await pressEnter(setup)
    expect(controller.calls.sendPrompt).toEqual([])
    await frameWith(setup, "/review")

    // Selecting an agent command owns the separating space; subsequent prompt text
    // must append directly instead of creating an accidental double space.
    await type(setup, "src/ui")
    await pressEnter(setup)
    expect(sentText(controller)).toBe("/review src/ui")

    await destroyMounted(setup.renderer)
  })

  it("dispatches a selected Kitten command instead of sending it to the agent", async () => {
    const controller = createFakeController()
    const dispatched: CockpitCommand[] = []
    const setup = await renderEditor(controller, 32, (command) => dispatched.push(command), true)

    await type(setup, "/model")
    const menu = await frameWith(setup, "Commands", "/model")
    expect(menu).not.toContain("Choose an agent model")
    await pressEnter(setup)

    expect(dispatched).toEqual(["model-select"])
    expect(controller.calls.sendPrompt).toEqual([])
    expect(await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))).not.toContain("/model")

    await destroyMounted(setup.renderer)
  })
})

describe("PromptEditor shell shortcut", () => {
  it("opens the shell when bang is the first prompt character", async () => {
    const controller = createFakeController()
    const dispatched: CockpitCommand[] = []
    const setup = await renderEditor(controller, 10, (command) => dispatched.push(command))

    await type(setup, "!")

    expect(dispatched).toEqual(["toggle-shell"])
    expect(controller.calls.sendPrompt).toEqual([])
    expect(await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))).not.toContain("!")

    await destroyMounted(setup.renderer)
  })

  it("keeps bang as prompt text after the prompt already has content", async () => {
    const controller = createFakeController()
    const dispatched: CockpitCommand[] = []
    const setup = await renderEditor(controller, 10, (command) => dispatched.push(command))

    await type(setup, "inspect !")
    await pressEnter(setup)

    expect(dispatched).toEqual([])
    expect(sentText(controller)).toBe("inspect !")

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
    { sessionId: "claude-code", providerKind: "claude-code", displayName: "Claude Code", title: "Claude Code", cwd: "/workspace/kitten", ready: false, error: "claude-agent-acp: not found" },
    readyRuntimes()[1]!,
  ]

  it("refuses to submit while the focused agent is not ready, and says so", async () => {
    const controller = createFakeController({ runtimes: notReady })
    const setup = await renderEditor(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(PROMPT_DISABLED_TITLE)
    expect(frame).toContain(PROMPT_DISABLED_PLACEHOLDER)
    expect(foregroundOf(setup, "╭")).toBe(paletteColor(DARK_PALETTE.status.not_ready))

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

  it("does not send an ordinary prompt while a restored context must be started fresh", async () => {
    const controller = createFakeController()
    const bundle: HandoffBundle = {
      intent: "continue",
      summary: "Continue from the persisted hand-off.",
      files: [],
      pendingDiffs: [],
      redactionCount: 0,
    }
    controller.store.setRestorationBundle(bundle)
    controller.store.setRestoration("claude-code", "unavailable")
    const setup = await renderEditor(controller)

    await type(setup, "do not hide this turn")
    await pressEnter(setup)

    expect(controller.calls.sendPrompt).toEqual([])
    expect(await frameWith(setup, "do not hide this turn")).toContain("do not hide this turn")

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
