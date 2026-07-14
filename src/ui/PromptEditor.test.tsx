// Suite: PromptEditor presentation and controller interaction
// Invariant: visual restyling never changes prompt composition, submission, interruption, or readiness behavior.
// Boundary IN: real React rendering, OpenTUI textarea/layout, palette resolution, and controller actions.
// Boundary OUT: agent transport behavior, owned by controller and adapter integration suites.

import { describe, expect, it } from "bun:test"

import { RGBA, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { Profiler } from "react"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { RepositoryFileList } from "../app/fileDiscovery.ts"
import type { HandoffBundle } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import { selectHasOpenOverlay } from "../store/selectors.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { ConversationView } from "./ConversationView.tsx"
import {
  FILE_SELECTOR_EMPTY,
  FILE_SELECTOR_LOADING,
  FILE_SELECTOR_UNAVAILABLE,
} from "./FileSelector.tsx"
import {
  PROMPT_DISABLED_PLACEHOLDER,
  PROMPT_CHEVRON,
  PROMPT_PLACEHOLDER,
  PROMPT_WORKSPACE_TITLE,
  MAX_EDITOR_ROWS,
  MAX_SLASH_MENU_ROWS,
  PromptEditor,
  cockpitCommandForDraft,
  slashMenuRows,
  slashTokenAt,
} from "./PromptEditor.tsx"
import { COCKPIT_COMMANDS, type CockpitCommand } from "./keymap.ts"
import { SLASH_MENU_ID, SLASH_MENU_SCROLLBOX_ID } from "./SlashMenu.tsx"
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
  await setup.waitForFrame((frame) =>
    frame.includes(PROMPT_PLACEHOLDER) ||
    frame.includes(PROMPT_DISABLED_PLACEHOLDER) ||
    frame.includes(PROMPT_WORKSPACE_TITLE),
  )
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

/** Press Tab in either menu-navigation direction. */
async function pressTab(setup: TestRendererSetup, shift = false): Promise<void> {
  await actAsync(() => {
    setup.mockInput.pressTab(shift ? { shift: true } : undefined)
  })
}

/** Press Backspace through the same Kitty keyboard parser as production. */
async function pressBackspace(setup: TestRendererSetup): Promise<void> {
  await actAsync(() => {
    setup.mockInput.pressBackspace()
  })
}

/** Kitty's functional-key code point for keypad Enter. */
async function pressKeypadEnter(setup: TestRendererSetup): Promise<void> {
  await actAsync(async () => {
    await setup.mockInput.pressKeys(["\u001b[57414u"])
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** Press a vertical arrow, optionally with modifiers held. */
async function pressArrow(
  setup: TestRendererSetup,
  direction: "up" | "down" | "left" | "right",
  modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; super?: boolean; hyper?: boolean },
): Promise<void> {
  await actAsync(() => {
    setup.mockInput.pressArrow(direction, modifiers)
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
    expect(frame).not.toContain("Prompt")
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
  it("does not consult or invoke selected-session behavior without a visible selection", async () => {
    const controller = createFakeController({ store: createAppStore({ seeds: [] }), runtimes: [] })
    let readinessChecks = 0
    controller.isReady = () => {
      readinessChecks += 1
      return true
    }
    const dispatched: CockpitCommand[] = []
    const setup = await renderEditor(controller, 10, (command) => dispatched.push(command))

    await type(setup, "/model")
    await pressEnter(setup)
    await pressEscape(setup)

    expect(readinessChecks).toBe(0)
    expect(dispatched).toEqual([])
    expect(controller.calls.sendPrompt).toEqual([])
    expect(controller.calls.cancel).toEqual([])

    await destroyMounted(setup.renderer)
  })

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

  it("records an accepted submission before invoking the existing send action", async () => {
    const controller = createFakeController()
    const events: string[] = []
    const record = controller.actions.recordPromptHistory.bind(controller.actions)
    controller.actions.recordPromptHistory = (text, sessionId) => {
      events.push(`record:${text}:${sessionId}`)
      record(text, sessionId)
    }
    controller.actions.sendPrompt = async (input) => {
      events.push(`send:${String(input)}`)
      return null
    }
    const setup = await renderEditor(controller)

    await type(setup, "accepted locally")
    await pressEnter(setup)

    expect(events).toEqual(["record:accepted locally:claude-code", "send:accepted locally"])

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

  it("caps a long multiline draft and keeps the remaining text in the editor", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller, 20)
    const draft = Array.from({ length: MAX_EDITOR_ROWS + 3 }, (_, index) => `line ${index}`).join("\n")

    await actAsync(() => {
      setup.renderer.currentFocusedEditor!.setText(draft)
    })
    await setup.waitFor(() => setup.renderer.currentFocusedEditor?.height === MAX_EDITOR_ROWS)

    expect(setup.renderer.currentFocusedEditor?.plainText).toBe(draft)
    expect(setup.renderer.currentFocusedEditor?.height).toBe(MAX_EDITOR_ROWS)
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
  const agentCommands = [
    { name: "review", description: "Review the current diff", hint: "[scope]" },
    { name: "test", description: "Run the focused tests" },
  ]

  function seedAgentCommands(controller: FakeController): void {
    controller.store.applyEvent("claude-code", { kind: "commands", commands: agentCommands })
  }

  it("detects only slash tokens that begin at a token boundary and still own the caret", () => {
    expect(slashTokenAt("/", 1)).toEqual({ start: 0, end: 1, filter: "" })
    expect(slashTokenAt("foo /", 5)).toEqual({ start: 4, end: 5, filter: "" })
    expect(slashTokenAt("foo/bar", 7)).toBeNull()
    expect(slashTokenAt("/usr/", 5)).toBeNull()
    expect(slashTokenAt("/review", 0)).toBeNull()
    expect(slashTokenAt("/review ", 8)).toBeNull()
  })

  it("recognizes only complete cockpit-command drafts for immediate submission", () => {
    expect(cockpitCommandForDraft("/sessions", 9)).toBe("sessions")
    expect(cockpitCommandForDraft("/new", 4)).toBe("start-new-run")
    expect(cockpitCommandForDraft("/clear", 6)).toBe("clear-run")
    expect(cockpitCommandForDraft("/model ", 7)).toBe("model-select")
    expect(cockpitCommandForDraft("/statusline", 11)).toBe("statusline")
    expect(cockpitCommandForDraft("/statusline describe compact", 28)).toBeNull()
    expect(cockpitCommandForDraft("/review", 7)).toBeNull()
    expect(cockpitCommandForDraft("/sessions now", 13)).toBeNull()
  })

  it("produces no candidates for an unmatched token", () => {
    expect(slashMenuRows("xyz", agentCommands)).toEqual([])
  })

  it("opens with the Cockpit group first and hand-off on top", async () => {
    const controller = createFakeController()
    seedAgentCommands(controller)
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "/")
    const menu = await frameWith(setup, "Commands", "Cockpit", "/handoff")

    expect(menu.indexOf("/handoff")).toBeLessThan(menu.indexOf("/shell"))
    expect(menu).toContain("▸ /handoff")
    expect(selectHasOpenOverlay(controller.store.getState())).toBeFalse()

    await destroyMounted(setup.renderer)
  })

  it("caps a long command palette at a compact scrolling height", async () => {
    const controller = createFakeController()
    seedAgentCommands(controller)
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "/")
    await frameWith(setup, "Commands", "Cockpit")
    const menu = setup.renderer.root.findDescendantById(SLASH_MENU_ID) as Renderable | undefined
    const scrollbox = setup.renderer.root.findDescendantById(SLASH_MENU_SCROLLBOX_ID) as ScrollBoxRenderable | undefined

    expect(menu?.height).toBe(MAX_SLASH_MENU_ROWS)
    expect(scrollbox?.height).toBe(menu!.height - 2)
    expect(scrollbox?.verticalScrollBar.height).toBe(scrollbox?.height)
    expect(scrollbox?.verticalScrollBar.y).toBe(scrollbox?.y)
    expect(scrollbox?.scrollTop).toBe(0)
    await destroyMounted(setup.renderer)
  })

  it("scrolls a compact command palette to off-screen agent commands", async () => {
    const controller = createFakeController()
    seedAgentCommands(controller)
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "/")
    await frameWith(setup, "Commands", "Cockpit", "▸ /handoff")
    await actAsync(() => {
      for (let index = 0; index < COCKPIT_COMMANDS.length; index++) {
        setup.mockInput.pressArrow("down")
      }
    })

    const scrolled = await frameWith(setup, "Agent commands", "▸ /review")
    expect(scrolled).not.toContain("▸ /handoff")

    await destroyMounted(setup.renderer)
  })

  it("filters to and highlights /review, then inserts it with the cursor after the trailing space", async () => {
    const controller = createFakeController()
    seedAgentCommands(controller)
    // The menu is positioned above the prompt, as it is in the real cockpit. Dock
    // the standalone editor to the bottom so the test observes that real layout.
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "/rev")
    const menu = await frameWith(setup, "Commands", "Agent commands", "/review", "[scope]")
    expect(menu).not.toContain("/settings")
    expect(menu).toContain("▸ /review")

    await pressEnter(setup)
    expect(controller.calls.sendPrompt).toEqual([])
    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("/review ")
    expect(setup.renderer.currentFocusedEditor?.cursorOffset).toBe(8)
    expect(await setup.waitForFrame((frame) => frame.includes("/review ") && !frame.includes("Commands"))).not.toContain("Commands")

    // Selecting an agent command owns the separating space; subsequent prompt text
    // must append directly instead of creating an accidental double space.
    await type(setup, "src/ui")
    await pressEnter(setup)
    expect(sentText(controller)).toBe("/review src/ui")

    await destroyMounted(setup.renderer)
  })

  it("dispatches hand-off from the top row instead of sending it to the agent", async () => {
    const controller = createFakeController()
    const dispatched: CockpitCommand[] = []
    const setup = await renderEditor(controller, 32, (command) => dispatched.push(command), true)

    await type(setup, "/")
    await frameWith(setup, "Commands", "▸ /handoff")
    await pressEnter(setup)

    expect(dispatched).toEqual(["hand-off"])
    expect(controller.calls.sendPrompt).toEqual([])
    expect(await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))).not.toContain("/handoff")

    await destroyMounted(setup.renderer)
  })

  it("runs a complete cockpit draft through the same submission path as an armed menu", async () => {
    const controller = createFakeController()
    const dispatched: CockpitCommand[] = []
    const setup = await renderEditor(controller, 32, (command) => dispatched.push(command), true)

    await type(setup, "/sessions")
    await pressEnter(setup)

    await setup.waitFor(() => dispatched.length === 1)
    expect(dispatched).toEqual(["sessions"])
    expect(controller.calls.sendPrompt).toEqual([])
    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("")
    await destroyMounted(setup.renderer)
  })

  it("runs a cockpit draft with trailing whitespace instead of sending it to the agent", async () => {
    const controller = createFakeController()
    const dispatched: CockpitCommand[] = []
    const setup = await renderEditor(controller, 32, (command) => dispatched.push(command), true)

    await type(setup, "/model ")
    await pressEnter(setup)

    await setup.waitFor(() => dispatched.length === 1)
    expect(dispatched).toEqual(["model-select"])
    expect(controller.calls.sendPrompt).toEqual([])
    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("")
    await destroyMounted(setup.renderer)
  })

  it("dismisses without clearing text, then lets Enter submit normally", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "/")
    await frameWith(setup, "Commands", "/handoff")
    await pressEscape(setup)

    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("/")
    expect(await setup.waitForFrame((frame) => frame.includes("/") && !frame.includes("Commands"))).not.toContain("Commands")
    await pressEnter(setup)
    expect(sentText(controller)).toBe("/")

    await destroyMounted(setup.renderer)
  })

  it("submits /usr/bin as literal prompt text after the second slash disarms the menu", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "/usr/bin")

    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("/usr/bin")
    expect(setup.captureCharFrame()).not.toContain("Commands")
    await pressEnter(setup)
    expect(sentText(controller)).toBe("/usr/bin")

    await destroyMounted(setup.renderer)
  })

  it("does not re-render the transcript while navigating the editor-local menu", async () => {
    const controller = createFakeController()
    seedAgentCommands(controller)
    let transcriptCommits = 0
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <box style={{ height: 32, flexDirection: "column" }}>
          <box style={{ flexGrow: 1 }}>
            <Profiler id="transcript" onRender={() => { transcriptCommits += 1 }}>
              <ConversationView welcomeBannerVariant="none" />
            </Profiler>
          </box>
          <PromptEditor />
        </box>
      </CockpitProvider>,
      { width: 64, height: 32, kittyKeyboard: true },
    )
    await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))
    const baselineCommits = transcriptCommits

    await type(setup, "/")
    await frameWith(setup, "Commands", "Cockpit", "/handoff")
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("up")
    })

    expect(transcriptCommits).toBe(baselineCommits)
    expect(controller.calls.navigatePromptHistory).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("keeps armed-menu arrows out of history even when prompts are recallable", async () => {
    const controller = createFakeController()
    controller.actions.recordPromptHistory("session secret", "claude-code")
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "/")
    await frameWith(setup, "Commands", "▸ /handoff")
    await pressArrow(setup, "down")
    await pressArrow(setup, "up")

    expect(controller.calls.navigatePromptHistory).toEqual([])
    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("/")
    expect(setup.captureCharFrame()).not.toContain("session secret")

    await destroyMounted(setup.renderer)
  })
})

describe("PromptEditor @ file completion", () => {
  it("discovers once, filters the warm list locally, inserts a visible reference, then submits on the following Enter", async () => {
    const controller = createFakeController({
      listRepositoryFiles: () => ({
        kind: "ready",
        paths: ["src/app/actions.ts", "src/ui/PromptEditor.tsx", "test/fakeController.ts"],
      }),
    })
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "@")
    await frameWith(setup, "Files", "src/app/actions.ts", "src/ui/PromptEditor.tsx")
    expect(controller.calls.listRepositoryFiles).toEqual(["claude-code"])
    expect(controller.calls.fileSelectorOpened).toEqual(["claude-code"])

    await type(setup, "prompt")
    expect(await frameWith(setup, "▸ src/ui/PromptEditor.tsx")).not.toContain("src/app/actions.ts")
    expect(controller.calls.listRepositoryFiles).toEqual(["claude-code"])
    expect(controller.calls.fileSelectorQueryRendered).toHaveLength(1)

    await pressEnter(setup)
    expect(controller.calls.sendPrompt).toEqual([])
    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("@src/ui/PromptEditor.tsx ")
    expect(controller.calls.fileSelectorSelected).toHaveLength(1)

    await pressEnter(setup)
    expect(sentText(controller)).toBe("@src/ui/PromptEditor.tsx ")

    const metricPayload = JSON.stringify({
      opened: controller.calls.fileSelectorOpened,
      discovery: controller.calls.fileSelectorDiscovery,
      rendered: controller.calls.fileSelectorQueryRendered,
      selected: controller.calls.fileSelectorSelected,
    })
    expect(metricPayload).not.toContain("PromptEditor.tsx")
    expect(metricPayload).not.toContain("@prompt")
    expect(controller.calls.fileSelectorDiscovery[0]?.outcome).toBe("ready")
    expect(controller.calls.fileSelectorQueryRendered[0]?.state).toBe("results")

    await destroyMounted(setup.renderer)
  })

  it("reuses arrows, Tab, Shift+Tab, and Return to select the highlighted path", async () => {
    const controller = createFakeController({
      listRepositoryFiles: () => ({ kind: "ready", paths: ["a.ts", "b.ts", "c.ts"] }),
    })
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "@")
    await frameWith(setup, "▸ a.ts")
    await pressTab(setup)
    await frameWith(setup, "▸ b.ts")
    await pressTab(setup, true)
    await frameWith(setup, "▸ a.ts")
    await pressArrow(setup, "down")
    await frameWith(setup, "▸ b.ts")
    await pressArrow(setup, "up")
    await frameWith(setup, "▸ a.ts")
    await pressTab(setup)
    await pressEnter(setup)

    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("@b.ts ")
    expect(controller.calls.sendPrompt).toEqual([])
    expect(controller.calls.navigatePromptHistory).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("accepts keypad Enter and formats whitespace paths with JSON-style quotes", async () => {
    const controller = createFakeController({
      listRepositoryFiles: () => ({ kind: "ready", paths: ["src/My File.ts"] }),
    })
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "@")
    await frameWith(setup, "src/My File.ts")
    await pressKeypadEnter(setup)

    expect(setup.renderer.currentFocusedEditor?.plainText).toBe('@"src/My File.ts" ')
    expect(controller.calls.sendPrompt).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("keeps loading, empty, and unavailable states non-selectable so Enter remains ordinary submission", async () => {
    const pending = deferred<RepositoryFileList>()
    const cases: { label: string; result: RepositoryFileList | Promise<RepositoryFileList>; message: string }[] = [
      { label: "loading", result: pending.promise, message: FILE_SELECTOR_LOADING },
      { label: "empty", result: { kind: "ready", paths: [] }, message: FILE_SELECTOR_EMPTY },
      {
        label: "unavailable",
        result: { kind: "unavailable", reason: "discovery_failed" },
        message: FILE_SELECTOR_UNAVAILABLE,
      },
    ]

    for (const { label, result, message } of cases) {
      const controller = createFakeController({ listRepositoryFiles: () => result })
      const setup = await renderEditor(controller, 32, undefined, true)
      await type(setup, `@${label}`)
      await frameWith(setup, message)
      await pressEnter(setup)
      expect(sentText(controller)).toBe(`@${label}`)
      await destroyMounted(setup.renderer)
    }
    pending.resolve({ kind: "ready", paths: ["late.ts"] })
  })

  it("contains a rejected discovery callback and records continued unavailable feedback as a warm render", async () => {
    const controller = createFakeController({
      listRepositoryFiles: () => Promise.reject(new Error("source failed")),
    })
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "@")
    await frameWith(setup, FILE_SELECTOR_UNAVAILABLE)
    await type(setup, "still-typing")
    await frameWith(setup, FILE_SELECTOR_UNAVAILABLE, "@still-typing")

    expect(controller.calls.fileSelectorDiscovery[0]?.outcome).toBe("unavailable")
    expect(controller.calls.fileSelectorQueryRendered.at(-1)?.state).toBe("unavailable")
    expect(controller.calls.sendPrompt).toEqual([])

    await destroyMounted(setup.renderer)
  })

  it("suppresses one dismissed token until deletion, cursor departure, or a new token resets it", async () => {
    const controller = createFakeController({
      listRepositoryFiles: () => ({ kind: "ready", paths: ["src/a.ts"] }),
    })
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "@")
    await frameWith(setup, "Files", "src/a.ts")
    await pressEscape(setup)
    await setup.waitForFrame((frame) => !frame.includes("Files"))
    await type(setup, "src")
    expect(setup.captureCharFrame()).not.toContain("Files")
    expect(controller.calls.fileSelectorOpened).toHaveLength(1)

    for (let index = 0; index < 4; index += 1) await pressBackspace(setup)
    await type(setup, "@")
    await frameWith(setup, "Files", "src/a.ts")
    expect(controller.calls.listRepositoryFiles).toHaveLength(1)
    expect(controller.calls.fileSelectorOpened).toHaveLength(2)

    await pressEscape(setup)
    await type(setup, "x")
    await pressArrow(setup, "left")
    await pressArrow(setup, "left")
    await pressArrow(setup, "right")
    await type(setup, "y")
    await frameWith(setup, FILE_SELECTOR_EMPTY)
    expect(controller.calls.fileSelectorOpened).toHaveLength(3)

    await pressEscape(setup)
    await actAsync(() => {
      const editor = setup.renderer.currentFocusedEditor
      if (editor) editor.cursorOffset = editor.plainText.length
    })
    await type(setup, " @")
    await frameWith(setup, "Files", "src/a.ts")

    await destroyMounted(setup.renderer)
  })

  it("invalidates a deferred old-session result and starts explicit discovery for the new focus", async () => {
    const claude = deferred<RepositoryFileList>()
    const codex = deferred<RepositoryFileList>()
    const controller = createFakeController({
      listRepositoryFiles: (sessionId) => sessionId === "claude-code" ? claude.promise : codex.promise,
    })
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "@")
    await frameWith(setup, FILE_SELECTOR_LOADING)
    await actAsync(() => controller.actions.switchFocus("codex"))
    await type(setup, "c")
    await frameWith(setup, FILE_SELECTOR_LOADING)
    expect(controller.calls.listRepositoryFiles).toEqual(["claude-code", "codex"])

    await actAsync(async () => {
      claude.resolve({ kind: "ready", paths: ["old/session.ts"] })
      await claude.promise
      await Promise.resolve()
    })
    expect(setup.captureCharFrame()).not.toContain("old/session.ts")
    await actAsync(async () => {
      codex.resolve({ kind: "ready", paths: ["current/session.ts"] })
      await codex.promise
      await Promise.resolve()
    })
    expect(await frameWith(setup, "current/session.ts")).not.toContain("old/session.ts")

    await destroyMounted(setup.renderer)
  })

  it("records one correction for an edited accepted range and clears pending tracking on submission", async () => {
    const controller = createFakeController({
      listRepositoryFiles: () => ({ kind: "ready", paths: ["src/a.ts"] }),
    })
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "@")
    await frameWith(setup, "src/a.ts")
    await pressEnter(setup)
    await pressBackspace(setup)
    expect(controller.calls.fileSelectorCorrected).toEqual([])
    await pressBackspace(setup)
    await type(setup, "x")
    expect(controller.calls.fileSelectorCorrected).toEqual(["claude-code"])

    await pressEnter(setup)
    await type(setup, "ordinary")
    expect(controller.calls.fileSelectorCorrected).toEqual(["claude-code"])

    await destroyMounted(setup.renderer)
  })

  it("shows selectable files for a not-ready session but keeps the existing send gate", async () => {
    const runtimes: AgentRuntimeState[] = [
      {
        sessionId: "claude-code",
        providerKind: "claude-code",
        displayName: "Claude Code",
        title: "Claude Code",
        cwd: "/workspace/kitten",
        ready: false,
        error: "not ready",
      },
      readyRuntimes()[1]!,
    ]
    const controller = createFakeController({
      runtimes,
      listRepositoryFiles: () => ({ kind: "ready", paths: ["src/a.ts"] }),
    })
    const setup = await renderEditor(controller, 32, undefined, true)

    await type(setup, "@")
    await frameWith(setup, "src/a.ts")
    await pressEnter(setup)
    await pressEnter(setup)
    expect(controller.calls.sendPrompt).toEqual([])
    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("@src/a.ts ")

    runtimes[0]!.ready = true
    await actAsync(() => controller.actions.switchFocus("codex"))
    await actAsync(() => controller.actions.switchFocus("claude-code"))
    await setup.waitForFrame((frame) => frame.includes("@src/a.ts") && !frame.includes(PROMPT_DISABLED_PLACEHOLDER))
    await pressEnter(setup)
    expect(sentText(controller)).toBe("@src/a.ts ")

    await destroyMounted(setup.renderer)
  })
})

describe("PromptEditor history recall", () => {
  it("recalls newest-to-oldest, moves forward, then clears after the newest entry", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await type(setup, "first prompt")
    await pressEnter(setup)
    await type(setup, "second prompt")
    await pressEnter(setup)

    await pressArrow(setup, "up")
    expect(await frameWith(setup, "second prompt", "History 2/2")).toContain("History 2/2")
    await pressArrow(setup, "up")
    expect(await frameWith(setup, "first prompt", "History 1/2")).not.toContain("second prompt")
    await pressArrow(setup, "down")
    expect(await frameWith(setup, "second prompt", "History 2/2")).not.toContain("first prompt")
    await pressArrow(setup, "down")

    const cleared = await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER) && !frame.includes("History"))
    expect(cleared).not.toContain("second prompt")
    expect(controller.calls.navigatePromptHistory.map(({ direction }) => direction)).toEqual([
      "previous",
      "previous",
      "next",
      "next",
    ])

    await destroyMounted(setup.renderer)
  })

  it("leaves the draft unchanged when history navigation returns null", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await type(setup, "ordinary draft")
    await pressArrow(setup, "up")

    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("ordinary draft")
    expect(controller.calls.navigatePromptHistory).toEqual([{ direction: "previous", sessionId: "claude-code" }])
    expect(setup.captureCharFrame()).not.toContain("History")

    await destroyMounted(setup.renderer)
  })

  it("keeps modified vertical arrows outside the recall path", async () => {
    const controller = createFakeController()
    controller.actions.recordPromptHistory("recallable", "claude-code")
    const setup = await renderEditor(controller)

    await type(setup, "draft")
    await pressArrow(setup, "up", { shift: true })
    await pressArrow(setup, "down", { ctrl: true })
    await pressArrow(setup, "up", { meta: true })

    expect(controller.calls.navigatePromptHistory).toEqual([])
    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("draft")

    await destroyMounted(setup.renderer)
  })

  it("uses native multiline movement before entering history at the true boundary", async () => {
    const controller = createFakeController()
    controller.actions.recordPromptHistory("recalled prompt", "claude-code")
    const setup = await renderEditor(controller)

    await type(setup, "top line")
    await pressEnter(setup, { shift: true })
    await type(setup, "bottom line")
    const before = setup.renderer.currentFocusedEditor?.cursorOffset

    await pressArrow(setup, "up")
    expect(controller.calls.navigatePromptHistory).toEqual([])
    expect(setup.renderer.currentFocusedEditor?.plainText).toBe("top line\nbottom line")
    expect(setup.renderer.currentFocusedEditor?.cursorOffset).not.toBe(before)

    await pressArrow(setup, "up")
    expect(controller.calls.navigatePromptHistory).toEqual([{ direction: "previous", sessionId: "claude-code" }])
    expect(await frameWith(setup, "recalled prompt", "History 1/1")).not.toContain("top line")

    await destroyMounted(setup.renderer)
  })

  it("keeps recalled text and indicators isolated when focus changes sessions", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    await type(setup, "claude only")
    await pressEnter(setup)
    await actAsync(() => controller.actions.switchFocus("codex"))
    await type(setup, "codex only")
    await pressEnter(setup)
    await pressArrow(setup, "up")
    await frameWith(setup, "codex only", "History 1/1")

    await actAsync(() => controller.actions.switchFocus("claude-code"))
    const claudePlain = await setup.waitForFrame(
      (frame) => frame.includes(PROMPT_PLACEHOLDER) && !frame.includes("codex only") && !frame.includes("History"),
    )
    expect(claudePlain).not.toContain("codex only")

    await pressArrow(setup, "up")
    expect(await frameWith(setup, "claude only", "History 1/1")).not.toContain("codex only")

    await actAsync(() => controller.actions.switchFocus("codex"))
    expect(await frameWith(setup, "codex only", "History 1/1")).not.toContain("claude only")

    await destroyMounted(setup.renderer)
  })

  it("collapses consecutive duplicate submissions into one visible recall entry", async () => {
    const controller = createFakeController()
    const setup = await renderEditor(controller)

    for (let count = 0; count < 2; count += 1) {
      await type(setup, "same prompt")
      await pressEnter(setup)
    }
    await pressArrow(setup, "up")

    expect(await frameWith(setup, "same prompt", "History 1/1")).toContain("History 1/1")
    expect(controller.store.getState().sessions["claude-code"]!.promptHistory.entries).toEqual(["same prompt"])

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
    expect(frame).not.toContain("Prompt")
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
    await setup.waitForFrame((frame) => frame.includes("ping") && !frame.includes(PROMPT_DISABLED_PLACEHOLDER))

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
