import { describe, expect, it } from "bun:test"

import { createTestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted, ESCAPE_DISAMBIGUATION_MS, sleep } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { CockpitApp, HELP_TITLE } from "./CockpitApp.tsx"
import { EMPTY_TRANSCRIPT_HINT } from "./ConversationView.tsx"
import { HELP_ENTRIES } from "./keymap.ts"
import { renderCockpit } from "./main.tsx"
import { STATUS_LABELS } from "./StatusStrip.tsx"

/** The frame's rows. `captureCharFrame` terminates the last row with a newline. */
function lines(frame: string): string[] {
  return frame.replace(/\n$/, "").split("\n")
}

/**
 * Every rendered line fits the viewport, the frame fits the row budget, and no cell
 * was left holding the buffer's uninitialized filler (`U+0A00`) from a larger frame.
 */
function expectNoOverflow(frame: string, width: number, height: number): void {
  const rows = lines(frame)
  expect(rows.length).toBe(height)
  for (const row of rows) {
    expect([...row].length).toBe(width)
  }
  expect(frame).not.toContain("਀")
}

async function renderCockpitApp(controller: FakeController, width = 80, height = 24) {
  const setup = await testRender(<CockpitApp controller={controller} />, { width, height })
  await setup.waitForFrame((f) => f.includes("Claude Code"))
  return setup
}

describe("CockpitApp layout", () => {
  it("renders the focused conversation region above a persistent status strip", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderCockpitApp(controller)

    const frame = captureCharFrame()
    const rows = lines(frame)

    // The focused agent titles the conversation region.
    expect(rows[0]).toContain("Claude Code")
    expect(frame).toContain(EMPTY_TRANSCRIPT_HINT)

    // The strip is the last painted row, and it names both agents.
    const strip = rows.at(-1) ?? ""
    expect(strip).toContain(`Claude Code: ${STATUS_LABELS.idle}`)
    expect(strip).toContain(`Codex: ${STATUS_LABELS.idle}`)
    expect(strip).toContain("F1 help")

    await destroyMounted(renderer)
  })

  it("matches the expected frame at a fixed size", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderCockpitApp(controller)

    expect(captureCharFrame()).toMatchSnapshot()

    await destroyMounted(renderer)
  })

  it("explains a not-ready focused agent instead of an empty transcript", async () => {
    const runtimes: AgentRuntimeState[] = [
      { sessionId: "claude-code", providerKind: "claude-code", displayName: "Claude Code", title: "Claude Code", cwd: "/workspace/kitten", ready: false, error: "claude-agent-acp: command not found" },
      readyRuntimes()[1]!,
    ]
    const controller = createFakeController({ runtimes })
    const { renderer, waitForFrame } = await renderCockpitApp(controller)

    const frame = await waitForFrame((f) => f.includes("not ready"))
    expect(frame).toContain("This agent is not ready.")
    expect(frame).toContain("claude-agent-acp: command not found")
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)

    await destroyMounted(renderer)
  })
})

describe("CockpitApp resize", () => {
  it("re-lays out the frame on a resize without overflow artifacts", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame, resize, waitForFrame } = await renderCockpitApp(controller, 100, 30)

    expectNoOverflow(captureCharFrame(), 100, 30)
    expect(lines(captureCharFrame()).length).toBe(30)

    await actAsync(() => {
      resize(64, 12)
    })
    const shrunk = await waitForFrame((f) => lines(f).length === 12 && f.includes(`Codex: ${STATUS_LABELS.idle}`))

    expectNoOverflow(shrunk, 64, 12)
    // The strip survives the shrink and stays pinned to the bottom row.
    expect(lines(shrunk).at(-1)).toContain(`Codex: ${STATUS_LABELS.idle}`)

    await actAsync(() => {
      resize(120, 40)
    })
    const grown = await waitForFrame((f) => lines(f).length === 40 && f.includes(EMPTY_TRANSCRIPT_HINT))

    expectNoOverflow(grown, 120, 40)
    expect(lines(grown).at(-1)).toContain(`Codex: ${STATUS_LABELS.idle}`)

    await destroyMounted(renderer)
  })
})

describe("CockpitApp keymap", () => {
  it("switches the focused agent through the controller action", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey("o", { ctrl: true })
    })

    expect(controller.calls.switchFocus).toEqual([undefined])
    // The action really moved focus, so the region retitles to the other agent.
    const frame = await waitForFrame((f) => lines(f)[0]?.includes("Codex") === true)
    expect(lines(frame)[0]).not.toContain("Claude Code")

    await destroyMounted(renderer)
  })

  it("leaves printable keys to the prompt editor", async () => {
    const controller = createFakeController()
    const { renderer, mockInput } = await renderCockpitApp(controller)

    await actAsync(async () => {
      await mockInput.typeText("o")
    })

    expect(controller.calls.switchFocus).toEqual([])

    await destroyMounted(renderer)
  })

  it("shows and hides the help panel on the help key", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, captureCharFrame, waitForFrame } = await renderCockpitApp(controller)

    expect(captureCharFrame()).not.toContain(HELP_TITLE)

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    const opened = await waitForFrame((f) => f.includes(HELP_TITLE))
    // The panel documents the shell's chords and the editor's alike.
    for (const entry of HELP_ENTRIES) {
      expect(opened).toContain(entry.keys)
      expect(opened).toContain(entry.description)
    }

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    const closed = await waitForFrame((f) => !f.includes(HELP_TITLE))
    expect(closed).toContain(EMPTY_TRANSCRIPT_HINT)

    await destroyMounted(renderer)
  })

  it("closes the open help panel on Escape", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    await waitForFrame((f) => f.includes(HELP_TITLE))

    await actAsync(async () => {
      mockInput.pressEscape()
      // A lone ESC is held briefly in case it prefixes a longer escape sequence.
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    expect(await waitForFrame((f) => !f.includes(HELP_TITLE))).toContain(EMPTY_TRANSCRIPT_HINT)

    await destroyMounted(renderer)
  })

  it("spends Escape on the help panel rather than interrupting the working agent", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    const { renderer, mockInput, waitForFrame } = await renderCockpitApp(controller)

    await actAsync(() => {
      mockInput.pressKey("F1")
    })
    await waitForFrame((f) => f.includes(HELP_TITLE))

    await actAsync(async () => {
      mockInput.pressEscape()
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    await waitForFrame((f) => !f.includes(HELP_TITLE))
    // The shell consumed the key, so the editor never saw it and the turn survives.
    expect(controller.calls.cancel).toEqual([])

    // With help gone, the same key now reaches the editor.
    await actAsync(async () => {
      mockInput.pressEscape()
      await sleep(ESCAPE_DISAMBIGUATION_MS)
    })
    expect(controller.calls.cancel).toEqual([undefined])

    await destroyMounted(renderer)
  })
})

describe("renderCockpit", () => {
  it("mounts the cockpit into a bare renderer", async () => {
    const { renderer, waitForFrame } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()

    let root: ReturnType<typeof renderCockpit> | undefined
    await actAsync(() => {
      root = renderCockpit(renderer, controller)
    })

    expect(root).toBeDefined()
    expect(await waitForFrame((f) => f.includes(EMPTY_TRANSCRIPT_HINT))).toContain("Claude Code")

    await destroyMounted(renderer)
  })
})
