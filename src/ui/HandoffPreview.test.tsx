import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { startMockAgent, type MockPromptScript } from "../../test/mockAgent.ts"
import { createAgentConnection, type AgentConnection, type PromptBlock } from "../agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import { createSessionController } from "../app/controller.ts"
import { FILES_HEADING as BLOCK_FILES_HEADING, HANDOFF_INSTRUCTION, pendingDiffHeading } from "../app/handoff.ts"
import type { AgentConfig, AppConfig, ProviderKind, SessionId } from "../core/types.ts"
import { REDACTION_PLACEHOLDER } from "../core/secretRedactor.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { CockpitApp, HELP_TITLE } from "./CockpitApp.tsx"
import {
  DIFFS_HEADING,
  DROPPED_BOX,
  FILES_HEADING,
  handoffTitleFor,
  ITEM_MARKER,
  KEPT_BOX,
  NO_FILES,
  redactionNotice,
  SUMMARY_HEADING,
} from "./HandoffPreview.tsx"
import { APPROVAL_HINT, HANDOFF_EDIT_HINT, HANDOFF_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"

/**
 * The preview is exercised inside the real shell, because most of what it promises is
 * about the shell: the hand-off chord must reach it, it must paint over the cockpit,
 * it must take every key from the composer, and on confirm the focused pane must
 * retitle to the agent that received the bundle.
 *
 * The terminal speaks the Kitty keyboard protocol so a bare Escape arrives as a
 * complete sequence rather than a lone byte the parser holds for 20ms.
 */

const WIDTH = 80
const HEIGHT = 30

/** Typed at the modal overlay; must never appear anywhere, least of all in the composer. */
const DRAFT_MARKER = "zzq"

/** A credential of a shape the redactor recognizes, planted in the source transcript. */
const SECRET = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789"

const UNIFIED = ["--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1,1 +1,1 @@", "-const b = 2", "+const b = 3"].join("\n")

/** Give `agentId` a transcript worth handing over: a turn, a file it read, a diff. */
function seed(controller: FakeController, sessionId: SessionId, text = "bump b"): void {
  const { store } = controller
  store.applyEvent(sessionId, { kind: "user_message", messageId: "m1", text })
  store.applyEvent(sessionId, {
    kind: "tool_call",
    call: { toolCallId: "call-read", kind: "read", title: "Read config", status: "completed", locations: ["cfg.json"] },
  })
  store.applyEvent(sessionId, {
    kind: "tool_call",
    call: {
      toolCallId: "call-edit",
      kind: "edit",
      title: "Bump b",
      status: "pending",
      locations: ["src/app.ts"],
      diff: { path: "src/app.ts", unified: UNIFIED },
    },
  })
}

async function renderCockpit(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await testRender(<CockpitApp controller={controller} />, {
    width: WIDTH,
    height: HEIGHT,
    kittyKeyboard: true,
  })
  await setup.waitForFrame((frame) => frame.includes("Claude Code"))
  return setup
}

/** Press the hand-off chord and wait for the preview to paint. */
async function handoff(setup: TestRendererSetup): Promise<string> {
  await actAsync(() => {
    setup.mockInput.pressKey("t", { ctrl: true })
  })
  return setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))
}

/** Mount the cockpit over a seeded session and open the preview. */
async function renderWithPreview(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await renderCockpit(controller)
  await handoff(setup)
  return setup
}

/** Every block's text, joined the way `sendPrompt` records the turn. */
function sentText(controller: FakeController): string {
  const call = controller.calls.sendPrompt[0]
  if (!call) throw new Error("expected a prompt to have been sent")
  return (call.input as PromptBlock[]).map((block) => block.text).join("\n")
}

describe("HandoffPreview visibility", () => {
  it("renders nothing until the hand-off chord is pressed", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const { renderer, captureCharFrame } = await renderCockpit(controller)

    const frame = captureCharFrame()
    expect(frame).not.toContain(HANDOFF_HINT)
    expect(frame).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("assembles the focused session into a preview aimed at the other agent", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderCockpit(controller)

    const frame = await handoff(setup)

    expect(frame).toContain(handoffTitleFor("Claude Code", "Codex"))
    expect(frame).toContain(SUMMARY_HEADING)
    expect(frame).toContain(FILES_HEADING)
    expect(frame).toContain(DIFFS_HEADING)
    // The bundle's contents: the transcript excerpt, both referenced files, the diff.
    expect(frame).toContain("bump b")
    expect(frame).toContain("cfg.json")
    expect(frame).toContain("src/app.ts")

    await destroyMounted(setup.renderer)
  })

  it("shows how many secrets were stripped before the bundle reached the screen", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code", `the key is ${SECRET}`)
    const setup = await renderCockpit(controller)

    const frame = await handoff(setup)

    expect(frame).toContain(redactionNotice(1))
    expect(frame).toContain(REDACTION_PLACEHOLDER)
    expect(frame).not.toContain(SECRET)

    await destroyMounted(setup.renderer)
  })

  it("says so plainly when the redactor found nothing", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    expect(setup.captureCharFrame()).toContain(redactionNotice(0))

    await destroyMounted(setup.renderer)
  })

  it("does not open on an empty transcript, so the chord cannot hand over nothing", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    await actAsync(() => {
      setup.mockInput.pressKey("t", { ctrl: true })
    })

    expect(setup.captureCharFrame()).not.toContain(HANDOFF_HINT)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()

    await destroyMounted(setup.renderer)
  })

  it("does not open when the agent that would receive the bundle never came up", async () => {
    const runtimes: AgentRuntimeState[] = [
      readyRuntimes()[0]!,
      {
        sessionId: "codex",
        providerKind: "codex",
        displayName: "Codex",
        title: "Codex",
        ready: false,
        error: "codex-acp: command not found",
      },
    ]
    const controller = createFakeController({ runtimes })
    seed(controller, "claude-code")
    const setup = await renderCockpit(controller)

    await actAsync(() => {
      setup.mockInput.pressKey("t", { ctrl: true })
    })

    // The store is the authority here: a frame captured right after a keypress can miss
    // a paint, so a frame-only assertion would pass whether or not the preview opened.
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(setup.captureCharFrame()).not.toContain(HANDOFF_HINT)

    await destroyMounted(setup.renderer)
  })

  it("names a section with nothing in it rather than leaving it blank", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "user_message", messageId: "m1", text: "just talking" })
    const setup = await renderWithPreview(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(FILES_HEADING)
    expect(frame).toContain(NO_FILES)

    // Navigating a bundle with nothing to navigate must not walk the highlight off the
    // list, and Space on no row must not throw into the React tree.
    await actAsync(async () => {
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
      await setup.mockInput.typeText(" ")
    })
    expect(await setup.waitForFrame((f) => f.includes(HANDOFF_HINT))).toContain(NO_FILES)

    // The summary alone is still worth handing over.
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    expect(sentText(controller)).toContain("just talking")

    await destroyMounted(setup.renderer)
  })

  it("never sends without a confirm", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")

    await destroyMounted(setup.renderer)
  })
})

describe("HandoffPreview curation", () => {
  it("keeps every file and diff until the developer drops one", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(`${ITEM_MARKER} ${KEPT_BOX} cfg.json (read)`)
    expect(frame).toContain(`${KEPT_BOX} src/app.ts (edited)`)
    expect(frame).not.toContain(DROPPED_BOX)

    await destroyMounted(setup.renderer)
  })

  it("drops the highlighted file on Space, and the composed prompt loses it", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    // The highlight starts on the first file: cfg.json, sorted ahead of src/app.ts.
    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    await setup.waitForFrame((f) => f.includes(`${DROPPED_BOX} cfg.json`))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    const text = sentText(controller)
    expect(text).toContain(BLOCK_FILES_HEADING)
    expect(text).toContain("src/app.ts (edited)")
    // Dropped from the file list the target is told to look at. The transcript excerpt
    // still records the read that happened - that is the summary's job, and the summary
    // is the developer's to trim separately.
    expect(text).not.toContain("- cfg.json (read)")

    await destroyMounted(setup.renderer)
  })

  it("drops a pending diff arrowed onto, and the composed prompt loses that diff", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    // Two files, then the diff row.
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
    })
    // Selecting the diff row reveals the diff itself, which is how the developer judges it.
    await setup.waitForFrame((f) => f.includes("const b = 3"))

    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    await setup.waitForFrame((f) => f.includes(`${DROPPED_BOX} src/app.ts`))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    const text = sentText(controller)
    expect(text).not.toContain(pendingDiffHeading("src/app.ts"))
    expect(text).not.toContain("const b = 3")
    // The file it edited is still worth naming, even with the diff dropped.
    expect(text).toContain("src/app.ts (edited)")

    await destroyMounted(setup.renderer)
  })

  it("clamps the highlight at both ends of the list", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    await actAsync(() => {
      setup.mockInput.pressArrow("up")
    })
    await setup.waitForFrame((f) => f.includes(`${ITEM_MARKER} ${KEPT_BOX} cfg.json`))

    await actAsync(() => {
      for (let i = 0; i < 5; i += 1) setup.mockInput.pressArrow("down")
    })
    // Past the last row is still the last row: the diff.
    const frame = await setup.waitForFrame((f) => f.includes("const b = 3"))
    expect(frame).toContain(`${ITEM_MARKER} ${KEPT_BOX} src/app.ts`)

    await destroyMounted(setup.renderer)
  })

  it("hands the keyboard to the summary editor on e, and takes it back on Escape", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    await actAsync(() => {
      setup.mockInput.pressKey("e")
    })
    await setup.waitForFrame((f) => f.includes(HANDOFF_EDIT_HINT))

    // Now every key is text - including the ones the list mode spends on navigation.
    await actAsync(async () => {
      await setup.mockInput.typeText(" and e")
    })
    await setup.waitForFrame((f) => f.includes("and e"))

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const back = await setup.waitForFrame((f) => f.includes(HANDOFF_HINT))
    expect(back).not.toContain(HANDOFF_EDIT_HINT)

    // The rewritten summary is what the target receives.
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    expect(sentText(controller)).toContain("and e")

    await destroyMounted(setup.renderer)
  })

  it("leaves the bundle untouched when nothing is curated", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)
    const bundle = controller.store.getState().overlays.handoffPreview!.bundle

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    const text = sentText(controller)
    expect(text).toContain(bundle.summary)
    expect(text).toContain("cfg.json (read)")
    expect(text).toContain(pendingDiffHeading("src/app.ts"))

    await destroyMounted(setup.renderer)
  })
})

describe("HandoffPreview outcome", () => {
  it("sends the bundle to the target and moves focus to it on Enter", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    expect(controller.calls.sendPrompt).toHaveLength(1)
    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("codex")
    expect(sentText(controller)).toContain(HANDOFF_INSTRUCTION)
    expect(controller.store.getState().focusedSessionId).toBe("codex")

    // The preview is gone and the focused pane has retitled to the receiving agent.
    const closed = await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))
    expect(closed.split("\n")[0]).toContain("Codex")
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })

  it("sends nothing and leaves focus alone on Escape", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const closed = await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))

    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
    expect(closed.split("\n")[0]).toContain("Claude Code")

    await destroyMounted(setup.renderer)
  })

  it("returns the keyboard to the composer once the preview is dismissed", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    // Go through the summary editor: that is what actually takes the terminal's single
    // focused renderable away from the composer. Leaving the editor blurs it again and
    // focuses nothing, so only the composer's own prop can bring the cursor back.
    await actAsync(() => {
      setup.mockInput.pressKey("e")
    })
    await setup.waitForFrame((f) => f.includes(HANDOFF_EDIT_HINT))
    await actAsync(async () => {
      await setup.mockInput.typeText(" tail")
    })
    await setup.waitForFrame((f) => f.includes("tail"))
    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    await setup.waitForFrame((f) => f.includes(HANDOFF_HINT))

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))

    // The composer gave up terminal focus to the summary editor; it must have taken it
    // back, or the cockpit is left with no way to type.
    await actAsync(async () => {
      await setup.mockInput.typeText(DRAFT_MARKER)
    })
    const typed = await setup.waitForFrame((f) => f.includes(DRAFT_MARKER))
    expect(typed).not.toContain(PROMPT_PLACEHOLDER)
    // And nothing the developer wrote into the summary leaked into the composer.
    expect(typed).not.toContain(` tail${DRAFT_MARKER}`)

    await destroyMounted(setup.renderer)
  })

  it("hands back from the other agent through the very same flow", async () => {
    const controller = createFakeController()
    seed(controller, "codex")
    controller.store.setFocus("codex")
    const setup = await renderCockpit(controller)
    await setup.waitForFrame((f) => f.split("\n")[0]?.includes("Codex") === true)

    const frame = await handoff(setup)
    expect(frame).toContain(handoffTitleFor("Codex", "Claude Code"))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("claude-code")
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")

    await destroyMounted(setup.renderer)
  })
})

describe("HandoffPreview modality", () => {
  it("keeps every key from the shell and the prompt editor while it is open", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    await actAsync(async () => {
      setup.mockInput.pressKey("o", { ctrl: true })
      setup.mockInput.pressKey("F1")
      await setup.mockInput.typeText(DRAFT_MARKER)
    })

    // `toEqual([])` would also accept `[undefined]`, which is exactly the call the focus
    // chord makes. Assert on the length so a leaked chord cannot hide here.
    expect(controller.calls.switchFocus).toHaveLength(0)
    expect(controller.store.getState().focusedSessionId).toBe("claude-code")
    expect(await setup.waitForFrame((f) => f.includes(HANDOFF_HINT))).not.toContain(HELP_TITLE)

    // Dismiss, and only then read the composer. A keystroke paints a pass after it lands,
    // so a frame captured while the overlay is up would show an empty composer whether or
    // not the marker had leaked into its buffer.
    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const closed = await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))
    expect(closed).not.toContain(DRAFT_MARKER)
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
  })

  it("stands down for a permission request, which has an agent blocked on it", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    await actAsync(() => {
      controller.store.openApproval({
        sessionId: "claude-code",
        request: {
          sessionId: "s",
          toolCall: { toolCallId: "call-1", kind: "edit", title: "Bump b" },
          options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
        },
      })
    })
    await setup.waitForFrame((f) => f.includes(APPROVAL_HINT))

    // Enter now answers the agent. It must not also send the bundle behind the dialog.
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: "allow" }])
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.store.getState().overlays.handoffPreview).not.toBeNull()

    await destroyMounted(setup.renderer)
  })

  it("closes the help panel it would otherwise bury, since it spends Escape itself", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderCockpit(controller)

    await actAsync(() => {
      setup.mockInput.pressKey("F1")
    })
    await setup.waitForFrame((f) => f.includes(HELP_TITLE))

    const frame = await handoff(setup)
    expect(frame).not.toContain(HELP_TITLE)

    await destroyMounted(setup.renderer)
  })
})

const CLAUDE: AgentConfig = { id: "claude-code", displayName: "Claude Code", command: "claude-acp", args: [], env: {} }
const CODEX: AgentConfig = { id: "codex", displayName: "Codex", command: "codex-acp", args: [], env: {} }
const APP_CONFIG: AppConfig = { agents: [CLAUDE, CODEX], telemetryEnabled: false }

/** Wire a real `AgentConnection` to a fresh in-process mock ACP agent. */
function connectionToMockAgent(config: AgentConfig, onPrompt?: MockPromptScript) {
  const pair = createInMemoryTransportPair()
  const agent = startMockAgent(pair.agent, { sessionId: `${config.id}-session`, onPrompt })
  const connection = createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    scheduler: { schedule: (flush) => flush(), dispose: () => {} },
  })
  return { connection, agent }
}

describe("integration - hand-off across two mock agents", () => {
  it("assembles, edits, confirms, delivers to the target, and moves focus", async () => {
    // Claude reads a file and proposes an edit it has not applied.
    const claude = connectionToMockAgent(CLAUDE, async (_request, ctx) => {
      await ctx.update({
        sessionUpdate: "tool_call",
        toolCallId: "call-read",
        kind: "read",
        title: "Read config",
        status: "completed",
        locations: [{ path: "cfg.json" }],
      })
      await ctx.update({
        sessionUpdate: "tool_call",
        toolCallId: "call-edit",
        kind: "edit",
        title: "Bump b",
        status: "pending",
        locations: [{ path: "src/app.ts" }],
        content: [{ type: "diff", path: "src/app.ts", oldText: "const b = 2\n", newText: "const b = 3\n" }],
      })
      await ctx.update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `I got stuck. Token was ${SECRET}` },
      })
    })
    const codex = connectionToMockAgent(CODEX)
    const connections: Record<ProviderKind, AgentConnection> = { "claude-code": claude.connection, codex: codex.connection }

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: "/workspace/kitten",
      createConnection: (config) => connections[config.id],
    })

    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: WIDTH,
      height: HEIGHT,
      kittyKeyboard: true,
    })
    await setup.waitForFrame((frame) => frame.includes("Claude Code"))

    await actAsync(async () => {
      await controller.actions.sendPrompt("bump b")
    })

    // One keystroke assembles the bundle. Nothing has reached Codex yet.
    await actAsync(() => {
      setup.mockInput.pressKey("t", { ctrl: true })
    })
    const preview = await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))
    expect(preview).toContain(handoffTitleFor("Claude Code", "Codex"))
    expect(preview).toContain(redactionNotice(1))
    expect(codex.agent.prompts).toHaveLength(0)

    // Drop the file Claude only read; keep the edit and its diff.
    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    await setup.waitForFrame((f) => f.includes(`${DROPPED_BOX} cfg.json`))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))

    // Codex received the curated bundle, redacted, and holds focus.
    expect(codex.agent.prompts).toHaveLength(1)
    const delivered = codex.agent.prompts[0]!.prompt.map((block) => (block.type === "text" ? block.text : "")).join("\n")
    expect(delivered).toContain(HANDOFF_INSTRUCTION)
    expect(delivered).toContain("I got stuck.")
    expect(delivered).toContain(REDACTION_PLACEHOLDER)
    expect(delivered).not.toContain(SECRET)
    expect(delivered).toContain(pendingDiffHeading("src/app.ts"))
    expect(delivered).toContain(`${BLOCK_FILES_HEADING}\n- src/app.ts (edited)`)
    expect(delivered).not.toContain("- cfg.json (read)")

    // The source agent was prompted once, by the user, and never by the hand-off.
    expect(claude.agent.prompts).toHaveLength(1)
    expect(controller.store.getState().focusedSessionId).toBe("codex")
    expect(controller.store.getState().sessions.codex!.turns).toHaveLength(1)

    await destroyMounted(setup.renderer)
    await controller.dispose()
  })
})
