import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { SessionId, SessionSeed, SessionStatus } from "../core/types.ts"
import { PROVIDER_DISPLAY_NAMES } from "../core/types.ts"
import { createAppStore } from "../store/appStore.ts"
import { CockpitApp, HELP_TITLE } from "./CockpitApp.tsx"
import { SESSIONS_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"
import { NEEDS_YOU_LABEL, SESSION_MARKER, SESSIONS_TITLE } from "./SessionsOverlay.tsx"
import { STATUS_LABELS } from "./StatusStrip.tsx"
import { WELCOME_GREETING } from "./WelcomeBanner.tsx"

/**
 * The overview is exercised inside the real shell, because most of what it promises is
 * about the shell: `/sessions` must reach it, it must paint over the cockpit, it must
 * take every key from the composer, and Esc must return the keyboard to the prompt.
 *
 * The terminal speaks the Kitty keyboard protocol so a bare Escape arrives as a
 * complete sequence rather than a lone byte the parser holds for 20ms.
 */

const WIDTH = 80
const HEIGHT = 24

/** Typed at the modal overview; must never reach the composer beneath it. */
const DRAFT_MARKER = "zzq"

/** A three-session fleet (two sharing a provider), each in its own directory. */
const FLEET: SessionSeed[] = [
  { id: "a", providerKind: "claude-code", title: "Alpha", cwd: "/work/alpha" },
  { id: "b", providerKind: "codex", title: "Beta", cwd: "/work/beta" },
  { id: "c", providerKind: "claude-code", title: "Gamma", cwd: "/work/gamma" },
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

/** A fake controller over the three-session fleet, focused on the first session. */
function fleetController(): FakeController {
  return createFakeController({ store: createAppStore({ seeds: FLEET }), runtimes: fleetRuntimes() })
}

/** Set a session's live status the way the reducer does. */
function setStatus(controller: FakeController, sessionId: SessionId, status: SessionStatus): void {
  controller.store.applyEvent(sessionId, { kind: "status", status })
}

async function renderCockpit(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await testRender(<CockpitApp controller={controller} />, {
    width: WIDTH,
    height: HEIGHT,
    kittyKeyboard: true,
  })
  await setup.waitForFrame((frame) => frame.includes(WELCOME_GREETING))
  return setup
}

/** Run a Kitten slash command through the real prompt menu. */
async function runSlashCommand(setup: TestRendererSetup, command: string): Promise<void> {
  await actAsync(async () => {
    await setup.mockInput.typeText(`/${command}`)
  })
  await setup.waitForFrame((frame) => frame.includes(`/${command}`))
  await actAsync(() => {
    setup.mockInput.pressEnter()
  })
}

/** Run `/sessions` and wait for the overview to paint. */
async function openOverview(setup: TestRendererSetup): Promise<string> {
  await runSlashCommand(setup, "sessions")
  return setup.waitForFrame((frame) => frame.includes(SESSIONS_HINT))
}

describe("SessionsOverlay visibility", () => {
  it("renders nothing until /sessions is run", async () => {
    const controller = fleetController()
    const { renderer, captureCharFrame } = await renderCockpit(controller)

    const frame = captureCharFrame()
    expect(frame).not.toContain(SESSIONS_HINT)
    expect(frame).not.toContain(SESSIONS_TITLE)
    expect(frame).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("opens through /sessions, marking selectHasOpenOverlay open", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)

    await openOverview(setup)

    expect(controller.store.getState().overlays.sessions).toBe(true)

    await destroyMounted(setup.renderer)
  })
})

describe("SessionsOverlay card list", () => {
  it("renders one card per session in order, with its title, provider, directory, and state", async () => {
    const controller = fleetController()
    setStatus(controller, "b", "awaiting_approval")
    setStatus(controller, "c", "finished")
    const setup = await renderCockpit(controller)

    const frame = await openOverview(setup)

    // Every session's title, provider display name, and working directory.
    for (const seed of FLEET) {
      expect(frame).toContain(seed.title)
      expect(frame).toContain(seed.cwd)
    }
    expect(frame).toContain(PROVIDER_DISPLAY_NAMES["claude-code"])
    expect(frame).toContain(PROVIDER_DISPLAY_NAMES.codex)

    // Each session's live state, drawn from selectSessionList.
    expect(frame).toContain(STATUS_LABELS.idle)
    expect(frame).toContain(STATUS_LABELS.awaiting_approval)
    expect(frame).toContain(STATUS_LABELS.finished)

    // The order is the display order, top to bottom.
    const lines = frame.split("\n")
    const rowOf = (title: string): number => lines.findIndex((line) => line.includes(title))
    expect(rowOf("Alpha")).toBeLessThan(rowOf("Beta"))
    expect(rowOf("Beta")).toBeLessThan(rowOf("Gamma"))

    await destroyMounted(setup.renderer)
  })

  it("calls out the sessions that need the developer", async () => {
    const controller = fleetController()
    setStatus(controller, "b", "awaiting_approval")
    const setup = await renderCockpit(controller)

    const frame = await openOverview(setup)
    // The needs-you badge appears for the one waiting session, and no idle session gets it.
    expect(frame).toContain(NEEDS_YOU_LABEL)
    expect(frame.split(NEEDS_YOU_LABEL)).toHaveLength(2)

    await destroyMounted(setup.renderer)
  })

  it("marks the first card highlighted and moves the marker with the arrows", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openOverview(setup)

    // The highlight starts on the first card.
    const first = setup.captureCharFrame().split("\n").find((line) => line.includes("Alpha"))!
    expect(first).toContain(SESSION_MARKER)

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    const moved = await setup.waitForFrame((frame) => {
      const line = frame.split("\n").find((l) => l.includes("Beta"))
      return line?.includes(SESSION_MARKER) === true
    })
    // The marker left the first card once it moved to the second.
    expect(moved.split("\n").find((l) => l.includes("Alpha"))).not.toContain(SESSION_MARKER)

    await destroyMounted(setup.renderer)
  })
})

describe("SessionsOverlay routing", () => {
  it("jumps focus into the highlighted session on Enter and closes", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openOverview(setup)

    // Move the highlight to the second session, then jump into it.
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((frame) => {
      const line = frame.split("\n").find((l) => l.includes("Beta"))
      return line?.includes(SESSION_MARKER) === true
    })

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    const closed = await setup.waitForFrame((frame) => !frame.includes(SESSIONS_HINT))

    expect(controller.store.getState().workspace.selectedVisibleId).toBe("b")
    expect(controller.calls.selectConversation).toEqual(["b"])
    // The pane stays Kitten-branded after the focus change, and the composer is back.
    expect(closed.split("\n")[0]).toContain("Kitten")
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })

  it("reopens highlighted background work on Enter", async () => {
    const controller = fleetController()
    controller.store.backgroundConversation("b")
    const setup = await renderCockpit(controller)
    await openOverview(setup)

    await actAsync(() => setup.mockInput.pressArrow("down"))
    await actAsync(() => setup.mockInput.pressEnter())
    await setup.waitForFrame((frame) => !frame.includes(SESSIONS_HINT))

    expect(controller.calls.reopenConversation).toEqual(["b"])
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("b")
    expect(controller.store.getState().workspace.conversations.b?.lifecycle).toBe("visible")
    await destroyMounted(setup.renderer)
  })

  it("jumps to the session that needs you on n, and closes", async () => {
    const controller = fleetController()
    // Focused "a" is idle; "b" finished; "c" awaiting approval - the approval outranks.
    setStatus(controller, "b", "finished")
    setStatus(controller, "c", "awaiting_approval")
    const setup = await renderCockpit(controller)
    await openOverview(setup)

    await actAsync(() => {
      setup.mockInput.pressKey("n")
    })
    await setup.waitForFrame((frame) => !frame.includes(SESSIONS_HINT))

    expect(controller.calls.jumpToNextNeedy).toBe(1)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("c")

    await destroyMounted(setup.renderer)
  })

  it("does nothing on n when no session needs you", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openOverview(setup)

    await actAsync(() => {
      setup.mockInput.pressKey("n")
    })
    await setup.waitForFrame((frame) => !frame.includes(SESSIONS_HINT))

    // The action fired but found no candidate, so focus stayed put.
    expect(controller.calls.jumpToNextNeedy).toBe(1)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")

    await destroyMounted(setup.renderer)
  })

  it("restores prior focus on Esc and returns the keyboard to the prompt", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openOverview(setup)

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const closed = await setup.waitForFrame((frame) => !frame.includes(SESSIONS_HINT))

    // Focus never moved, and no routing action fired.
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.calls.jumpToNextNeedy).toBe(0)
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

describe("SessionsOverlay modality", () => {
  it("keeps every key from the shell and the prompt editor while it is open", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openOverview(setup)

    await actAsync(async () => {
      setup.mockInput.pressKey("`", { ctrl: true })
      await setup.mockInput.typeText("/help")
      await setup.mockInput.typeText(DRAFT_MARKER)
    })

    // The shell's focus chord never fired, and `/help` never opened over the overview.
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")
    expect(await setup.waitForFrame((frame) => frame.includes(SESSIONS_HINT))).not.toContain(HELP_TITLE)

    // Dismiss, then read the composer: nothing typed at the overview leaked into it.
    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const closed = await setup.waitForFrame((frame) => !frame.includes(SESSIONS_HINT))
    expect(closed).not.toContain(DRAFT_MARKER)
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })

  it("closes a help panel it would otherwise bury, since it spends Escape itself", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)

    await runSlashCommand(setup, "help")
    await setup.waitForFrame((frame) => frame.includes(HELP_TITLE))

    await actAsync(() => {
      controller.store.openSessions()
    })
    const frame = await setup.waitForFrame((candidate) => candidate.includes(SESSIONS_HINT))
    expect(frame).not.toContain(HELP_TITLE)

    await destroyMounted(setup.renderer)
  })

  it("leaves Enter to an approval that opens over the sessions overview", async () => {
    const controller = fleetController()
    const setup = await renderCockpit(controller)
    await openOverview(setup)
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((frame) =>
      frame.split("\n").some((line) => line.includes("Beta") && line.includes(SESSION_MARKER)),
    )

    await actAsync(() => {
      controller.store.openApproval({
        sessionId: "b",
        title: "Beta",
        cwd: "/work/beta",
        request: {
          sessionId: "session-b",
          toolCall: { toolCallId: "call-approval", kind: "edit", title: "Apply the change" },
          options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
        },
      })
    })

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitFor(() => controller.calls.respondPermission.length === 1)

    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: "allow" }])
    expect(controller.store.getState().overlays.sessions).toBe(true)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("a")

    await destroyMounted(setup.renderer)
  })
})
