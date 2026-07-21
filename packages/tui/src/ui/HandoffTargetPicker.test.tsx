import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { HANDOFF_INSTRUCTION } from "../app/handoff.ts"
import type { PromptBlock } from "../agent/agentConnection.ts"
import type { SessionId, SessionSeed } from "../core/types.ts"
import { PROVIDER_DISPLAY_NAMES } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import { CockpitApp, HELP_TITLE } from "./CockpitApp.tsx"
import { HANDOFF_TARGET_TITLE } from "./HandoffTargetPicker.tsx"
import { HANDOFF_HINT, HANDOFF_TARGET_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"
import { SESSION_MARKER } from "./SessionsOverlay.tsx"

/**
 * The target picker is exercised inside the real shell, because most of what it
 * promises is about the shell: the `/handoff` command must reach it when the fleet gives a
 * choice of recipient, it must paint over the cockpit, it must take every key from the
 * composer, and choosing a target must open the redacted preview over the chosen
 * session. Hand-off and hand-back across three sessions run end-to-end through here.
 *
 * The terminal speaks the Kitty keyboard protocol so a bare Escape arrives as a
 * complete sequence rather than a lone byte the parser holds for 20ms.
 */

const WIDTH = 80
const HEIGHT = 30

/** Typed at the modal picker; must never reach the composer beneath it. */
const DRAFT_MARKER = "zzq"

/** A ready Claude Code, Codex, and Cursor fleet, each in its own directory. */
const FLEET: SessionSeed[] = [
  { id: "a", providerKind: "claude-code", title: "Alpha", cwd: "/work/alpha" },
  { id: "b", providerKind: "codex", title: "Beta", cwd: "/work/beta" },
  { id: "c", providerKind: "cursor", title: "Cursor", cwd: "/work/cursor" },
]

/** A ready runtime per seed, so the shell mounts a live cockpit over the fleet. */
function fleetRuntimes(): AgentRuntimeState[] {
  return FLEET.map((seed) => ({
    sessionId: seed.id,
    providerKind: seed.providerKind,
    displayName: PROVIDER_DISPLAY_NAMES[seed.providerKind],
    title: seed.title,
    cwd: seed.cwd,
    ready: true,
    acpSessionId: `session-${seed.id}`,
  }))
}

/** Give `sessionId` a transcript worth handing over. */
function seedWork(controller: FakeController, sessionId: SessionId): void {
  controller.store.applyEvent(sessionId, { kind: "user_message", messageId: `m-${sessionId}`, text: "bump b" })
}

/** A fake controller over the three-session fleet, focused on `source` with work to hand over. */
function fleetController(source: SessionId = "a"): FakeController {
  const controller = createFakeController({ store: createAppStore({ seeds: FLEET }), runtimes: fleetRuntimes() })
  controller.store.setFocus(source)
  seedWork(controller, source)
  return controller
}

async function renderCockpit(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await testRender(<CockpitApp controller={controller} />, {
    width: WIDTH,
    height: HEIGHT,
    kittyKeyboard: true,
  })
  await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))
  return setup
}

/** Run one cockpit slash command through the real prompt menu. */
async function runSlashCommand(setup: TestRendererSetup, command: string): Promise<void> {
  await actAsync(async () => {
    await setup.mockInput.typeText(`/${command}`)
  })
  await setup.waitForFrame((frame) => frame.includes(`/${command}`))
  await actAsync(() => {
    setup.mockInput.pressEnter()
  })
}

/** Run `/handoff` through the real prompt menu and wait for the target picker to paint. */
async function openPicker(setup: TestRendererSetup): Promise<string> {
  await runSlashCommand(setup, "handoff")
  return setup.waitForFrame((frame) => frame.includes(HANDOFF_TARGET_HINT))
}

/** Open the real top-priority clarification overlay over the mounted target picker. */
async function openClarification(controller: FakeController, requestId: string): Promise<void> {
  await actAsync(() => {
    controller.store.openClarification({
      requestId,
      generation: 1,
      sessionId: "b",
      title: "Clarification owner",
      cwd: "/work/beta",
      payload: {
        prompt: "Choose a boundary",
        fields: [{
          id: "boundary",
          label: "Boundary",
          mode: "single",
          allowsCustom: false,
          required: true,
          options: [
            { id: "controller", label: "Controller" },
            { id: "store", label: "Store" },
          ],
        }],
      },
    })
  })
}

/** Every block's text of the nth recorded prompt, joined the way `sendPrompt` records it. */
function sentText(controller: FakeController, index = 0): string {
  const call = controller.calls.sendPrompt[index]
  if (!call) throw new Error(`expected a prompt at index ${index}`)
  return (call.input as PromptBlock[]).map((block) => block.text).join("\n")
}

describe("HandoffTargetPicker visibility", () => {
  it("opens through /handoff and lists every ready session but the source", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)

    const frame = await openPicker(setup)

    expect(frame).toContain(HANDOFF_TARGET_TITLE)
    // Both candidates, and not the source: you cannot hand a task to yourself.
    expect(frame).toContain("Beta")
    expect(frame).toContain("Cursor")
    // The source is absent from the candidate list. Assert on its directory, which the
    // picker card shows but the status strip (now labeled by title) does not, so the
    // source's title appearing in the strip cannot mask a leak into the picker.
    expect(frame).not.toContain("/work/alpha")
    // The picker is up; the redacted preview is not, and nothing has been sent.
    expect(controller.store.getState().overlays.handoffTarget).toEqual({ sourceSessionId: "a" })
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.calls.sendPrompt).toHaveLength(0)

    await destroyMounted(setup.renderer)
  })

  it("skips the picker and opens the preview when only one other session is ready", async () => {
    // The default two-session fleet: exactly one recipient, so there is nothing to choose.
    const controller = createFakeController()
    seedWork(controller, "claude-code")
    const setup = await renderCockpit(controller)

    await runSlashCommand(setup, "handoff")
    const frame = await setup.waitForFrame((f) => f.includes(HANDOFF_HINT))

    expect(frame).not.toContain(HANDOFF_TARGET_HINT)
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()
    expect(controller.store.getState().overlays.handoffPreview!.targetSessionId).toBe("codex")

    await destroyMounted(setup.renderer)
  })
})

describe("HandoffTargetPicker selection", () => {
  it("opens the redacted preview over the chosen target on Enter", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openPicker(setup)

    // Move the highlight from Codex to Cursor, then choose it.
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((frame) => {
      const line = frame.split("\n").find((l) => l.includes("Cursor"))
      return line?.includes(SESSION_MARKER) === true
    })

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => f.includes(HANDOFF_HINT))

    const preview = controller.store.getState().overlays.handoffPreview!
    expect(preview.sourceSessionId).toBe("a")
    expect(preview.targetSessionId).toBe("c")
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()

    await destroyMounted(setup.renderer)
  })

  it("returns the keyboard to the composer on Escape, sending nothing", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openPicker(setup)

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const closed = await setup.waitForFrame((frame) => !frame.includes(HANDOFF_TARGET_HINT))

    expect(controller.store.getState().overlays.handoffTarget).toBeNull()
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    // The composer took the keyboard back: typing now lands in the prompt.
    await actAsync(async () => {
      await setup.mockInput.typeText(DRAFT_MARKER)
    })
    const typed = await setup.waitForFrame((frame) => frame.includes(DRAFT_MARKER))
    expect(typed).not.toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })
})

describe("HandoffTargetPicker modality", () => {
  it("preserves selection and blocks choose or close while clarification owns input", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openPicker(setup)
    const suspendedPicker = controller.store.getState().overlays.handoffTarget

    // Select Cursor locally before preemption. This index lives only in the mounted
    // picker and therefore proves the dialog was resumed rather than reconstructed.
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((frame) => {
      const line = frame.split("\n").find((candidate) => candidate.includes("Cursor"))
      return line?.includes(SESSION_MARKER) === true
    })

    await openClarification(controller, "clarification-target-enter")
    await setup.waitForFrame((frame) => frame.includes("Choose a boundary"))
    await actAsync(() => {
      setup.mockInput.pressArrow("up")
      setup.mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification).toHaveLength(1)
    expect(controller.store.getState().overlays.handoffTarget).toBe(suspendedPicker)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    await setup.waitForFrame((frame) => {
      const line = frame.split("\n").find((candidate) => candidate.includes("Cursor"))
      return line?.includes(SESSION_MARKER) === true
    })

    await openClarification(controller, "clarification-target-escape")
    await setup.waitForFrame((frame) => frame.includes("Choose a boundary"))
    await actAsync(() => {
      setup.mockInput.pressEscape()
    })

    expect(controller.calls.respondClarification.at(-1)?.outcome).toEqual({ kind: "cancelled" })
    expect(controller.store.getState().overlays.handoffTarget).toBe(suspendedPicker)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))
    expect(controller.store.getState().overlays.handoffPreview?.targetSessionId).toBe("c")

    await destroyMounted(setup.renderer)
  })

  it("keeps every key from the shell and the prompt editor while it is open", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openPicker(setup)

    await actAsync(async () => {
      setup.mockInput.pressKey("`", { ctrl: true })
      await setup.mockInput.typeText("/help")
      await setup.mockInput.typeText(DRAFT_MARKER)
    })

    // The shell chord never fired, and the prompt command never opened help over the picker.
    expect(controller.store.getState().focusedPane.kind).toBe("agent")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")
    expect(await setup.waitForFrame((frame) => frame.includes(HANDOFF_TARGET_HINT))).not.toContain(HELP_TITLE)

    // Dismiss, then read the composer: nothing typed at the picker leaked into it.
    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const closed = await setup.waitForFrame((frame) => !frame.includes(HANDOFF_TARGET_HINT))
    expect(closed).not.toContain(DRAFT_MARKER)
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })
})

describe("integration - hand-off and hand-back across three sessions", () => {
  it("hands off from Claude Code to Cursor, then hands back through the same picker and preview", async () => {
    const controller = fleetController("a")
    const setup = await renderCockpit(controller)

    // Hand off from Claude Code. Two candidates (Codex, Cursor); choose Cursor.
    await openPicker(setup)
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((frame) => {
      const line = frame.split("\n").find((l) => l.includes("Cursor"))
      return line?.includes(SESSION_MARKER) === true
    })
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => f.includes(HANDOFF_HINT))
    expect(controller.calls.sendPrompt).toHaveLength(0)

    // Confirm the preview: the bundle lands in C and focus moves to it.
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))

    expect(controller.calls.sendPrompt).toHaveLength(1)
    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("c")
    expect(sentText(controller, 0)).toContain(HANDOFF_INSTRUCTION)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("c")

    // The fake records the send but, unlike the real controller, does not echo the user
    // turn into the store. Mirror the delivered turn so C has a transcript to hand back.
    await actAsync(() => {
      controller.store.applyEvent("c", { kind: "user_message", messageId: "handed", text: "continue" })
    })

    // Cursor now holds the handed-over turn, so hand-back is the same flow pointed back.
    // From Cursor the candidates are Claude Code and Codex; choose Claude Code directly.
    await openPicker(setup)
    // Source Cursor is excluded from the picker; assert on its directory, which the
    // strip does not show, rather than its title, which the strip now does.
    expect(setup.captureCharFrame()).not.toContain("/work/cursor")
    await setup.waitForFrame((frame) => {
      const line = frame.split("\n").find((l) => l.includes("Alpha"))
      return line?.includes(SESSION_MARKER) === true
    })
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => f.includes(HANDOFF_HINT))
    expect(controller.calls.sendPrompt).toHaveLength(1)
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))

    expect(controller.calls.sendPrompt).toHaveLength(2)
    expect(controller.calls.sendPrompt[1]!.sessionId).toBe("a")
    expect(sentText(controller, 1)).toContain(HANDOFF_INSTRUCTION)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")

    await destroyMounted(setup.renderer)
  })
})
