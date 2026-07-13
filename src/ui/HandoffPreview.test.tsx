import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import { setRendererCapabilities, type TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { startMockAgent, type MockPromptScript } from "../../test/mockAgent.ts"
import { createAgentConnection, type AgentConnection, type PromptBlock } from "../agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import { createSessionController } from "../app/controller.ts"
import { FILES_HEADING as BLOCK_FILES_HEADING, HANDOFF_INSTRUCTION, pendingDiffHeading } from "../app/handoff.ts"
import { EFFORT_CATEGORY, MODEL_CATEGORY } from "../core/types.ts"
import type { AgentConfig, AppConfig, ConfigOption, ProviderKind, SessionId } from "../core/types.ts"
import { REDACTION_PLACEHOLDER } from "../core/secretRedactor.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import { CockpitApp, HELP_TITLE } from "./CockpitApp.tsx"
import {
  DIFFS_HEADING,
  DROPPED_BOX,
  FILES_HEADING,
  fileProvenanceTarget,
  handoffTitleFor,
  ITEM_MARKER,
  KEPT_BOX,
  NO_FILES,
  NO_TARGET_CONFIG_OPTIONS,
  redactionNotice,
  SHELL_HEADING,
  SUMMARY_HEADING,
  TARGET_HEADROOM_LABEL,
  TARGET_CONFIG_HEADING,
} from "./HandoffPreview.tsx"
import { formatHeadroom, HEADROOM_UNKNOWN } from "./headroom.ts"
import { CURRENT_MARK, EFFORT_HEADING, MID_SWITCH_WARNING, MODEL_HEADING, OTHER_MARK, ROW_MARKER, TARGET_MARK } from "./ModelSelect.tsx"
import { APPROVAL_HINT, HANDOFF_CONFIG_HINT, HANDOFF_EDIT_HINT, HANDOFF_HINT } from "./keymap.ts"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"
import { DARK_PALETTE } from "./theme.ts"

/**
 * The preview is exercised inside the real shell, because most of what it promises is
 * about the shell: the `/handoff` command must reach it, it must paint over the cockpit,
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

/** The target's allowlisted model/effort options as the store and preview receive them. */
function targetConfigOptions(currentModel = "sonnet", currentEffort = "low"): ConfigOption[] {
  return [
    {
      id: "model",
      category: MODEL_CATEGORY,
      label: "Model",
      currentValue: currentModel,
      options: [
        { value: "sonnet", name: "Sonnet" },
        { value: "opus", name: "Opus" },
      ],
    },
    {
      id: "effort",
      category: EFFORT_CATEGORY,
      label: "Reasoning effort",
      currentValue: currentEffort,
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
    },
  ]
}

/** The same options in ACP's wire shape for the real mock-agent integration test. */
function targetAgentConfigOptions(): SessionConfigOption[] {
  return [
    {
      type: "select",
      id: "model",
      name: "Model",
      category: MODEL_CATEGORY,
      currentValue: "sonnet",
      options: [
        { value: "sonnet", name: "Sonnet" },
        { value: "opus", name: "Opus" },
      ],
    },
    {
      type: "select",
      id: "effort",
      name: "Reasoning effort",
      category: EFFORT_CATEGORY,
      currentValue: "low",
      options: [
        { value: "low", name: "Low" },
        { value: "high", name: "High" },
      ],
    },
  ]
}

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

/** Give the next hand-off a trustworthy cwd and two command records to curate. */
function seedShell(controller: FakeController): void {
  controller.store.applyShellEvent({ kind: "cwd_changed", cwd: "/workspace/kitten" })
  controller.store.applyShellEvent({ kind: "command_started", id: "command-test", command: "bun test" })
  controller.store.applyShellEvent({
    kind: "command_finished",
    id: "command-test",
    exitCode: 0,
    output: "12 pass\n0 fail",
  })
  controller.store.applyShellEvent({ kind: "command_started", id: "command-status", command: "git status --short" })
  controller.store.applyShellEvent({
    kind: "command_finished",
    id: "command-status",
    exitCode: 0,
    output: " M src/ui/HandoffPreview.tsx",
  })
}

async function renderCockpit(controller: FakeController, height = HEIGHT): Promise<TestRendererSetup> {
  const setup = await testRender(<CockpitApp controller={controller} />, {
    width: WIDTH,
    height,
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

/** Run `/handoff` and wait for the preview to paint. */
async function handoff(setup: TestRendererSetup): Promise<string> {
  await runSlashCommand(setup, "handoff")
  return setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))
}

/** Mount the cockpit over a seeded session and open the preview. */
async function renderWithPreview(controller: FakeController, hyperlinks?: boolean): Promise<TestRendererSetup> {
  const setup = await renderCockpit(controller)
  if (hyperlinks !== undefined) setRendererCapabilities(setup.renderer, { hyperlinks })
  await handoff(setup)
  return setup
}

/** Open the real top-priority clarification overlay over the mounted preview. */
async function openClarification(controller: FakeController, requestId: string): Promise<void> {
  await actAsync(() => {
    controller.store.openClarification({
      requestId,
      generation: 1,
      sessionId: "codex",
      title: "Clarification owner",
      cwd: "/workspace/kitten",
      payload: {
        prompt: "Choose a boundary",
        fields: [{
          id: "boundary",
          label: "Boundary",
          mode: "single",
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

/** Every block's text, joined the way `sendPrompt` records the turn. */
function sentText(controller: FakeController): string {
  const call = controller.calls.sendPrompt[0]
  if (!call) throw new Error("expected a prompt to have been sent")
  return (call.input as PromptBlock[]).map((block) => block.text).join("\n")
}

function paletteColor(hex: string): string {
  return RGBA.fromHex(hex).toString()
}

function spanContaining(setup: TestRendererSetup, needle: string) {
  return setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.includes(needle))
}

describe("fileProvenanceTarget", () => {
  it("returns a file URL when the terminal supports hyperlinks", () => {
    expect(fileProvenanceTarget("src/app.ts", true)).toBe("file://src/app.ts")
  })

  it("returns no target when the terminal does not support hyperlinks", () => {
    expect(fileProvenanceTarget("src/app.ts", false)).toBeUndefined()
  })
})

describe("HandoffPreview visibility", () => {
  it("renders nothing until /handoff is run", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const { renderer, captureCharFrame } = await renderCockpit(controller)

    const frame = captureCharFrame()
    expect(frame).not.toContain(HANDOFF_HINT)
    expect(frame).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("shows the target's confirmed model and effort choices in the preview", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    controller.store.applyEvent("codex", { kind: "config_options", options: targetConfigOptions() })
    const setup = await renderWithPreview(controller)

    const frame = await setup.waitForFrame((candidate) => !candidate.includes("/handoff"))
    expect(frame).toContain(PROMPT_PLACEHOLDER)
    expect(frame).toContain(TARGET_CONFIG_HEADING)
    expect(frame).toContain(MODEL_HEADING)
    expect(frame).toContain(EFFORT_HEADING)
    expect(frame).toContain(`${CURRENT_MARK} Sonnet`)
    expect(frame).toContain(`${CURRENT_MARK} Low`)
    expect(frame).not.toContain(NO_TARGET_CONFIG_OPTIONS)

    await destroyMounted(setup.renderer)
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

  it("renders the summary heading through styled Markdown in read mode", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code", "\n## PLAN_SENTINEL\n\n- verify the hand-off")
    const setup = await renderWithPreview(controller)

    const frame = await setup.waitForFrame((candidate) => candidate.includes("PLAN_SENTINEL"))
    await setup.waitFor(() => {
      const styled = spanContaining(setup, "PLAN_SENTINEL")?.fg.toString() === paletteColor(DARK_PALETTE.accent)
      if (!styled) setup.renderer.requestRender()
      return styled
    })

    expect(frame).toContain("PLAN_SENTINEL")
    expect(frame).toContain(`${ITEM_MARKER} ${KEPT_BOX} cfg.json (read)`)
    expect(spanContaining(setup, "PLAN_SENTINEL")?.fg.toString()).toBe(paletteColor(DARK_PALETTE.accent))

    await destroyMounted(setup.renderer)
  })

  it("shows cwd and every command when the bundle carries shell context", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    seedShell(controller)
    const setup = await renderWithPreview(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(SHELL_HEADING)
    expect(frame).toContain("/workspace/kitten")
    expect(frame).toContain("bun test")
    expect(frame).toContain("git status --short")

    await destroyMounted(setup.renderer)
  })

  it("shows no shell-related section when the bundle has no snapshot", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    expect(setup.captureCharFrame()).not.toContain(SHELL_HEADING)

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
    expect(spanContaining(setup, redactionNotice(1))?.fg.toString()).toBe(paletteColor(DARK_PALETTE.accent))

    await destroyMounted(setup.renderer)
  })

  it("says so plainly when the redactor found nothing", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    expect(setup.captureCharFrame()).toContain(redactionNotice(0))

    await destroyMounted(setup.renderer)
  })

  it("shows the target's formatted headroom immediately after the redaction notice", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    controller.store.applyEvent("codex", { kind: "usage", used: 36_000, size: 200_000 })
    const setup = await renderWithPreview(controller)

    const display = formatHeadroom(82)
    const expectedLine = `${TARGET_HEADROOM_LABEL}: ${display.label} ${"█".repeat(display.filled)}${"░".repeat(display.cells - display.filled)}`
    const rows = setup.captureCharFrame().split("\n")
    const noticeRow = rows.findIndex((row) => row.includes(redactionNotice(0)))
    const headroomRow = rows.findIndex((row) => row.includes(expectedLine))
    const summaryRow = rows.findIndex((row) => row.includes(SUMMARY_HEADING))

    expect(headroomRow).toBe(noticeRow + 1)
    expect(headroomRow).toBeLessThan(summaryRow)
    expect(spanContaining(setup, TARGET_HEADROOM_LABEL)?.fg.toString()).toBe(paletteColor(DARK_PALETTE.muted))
    expect(spanContaining(setup, display.label)?.fg.toString()).toBe(paletteColor(DARK_PALETTE.text))

    await destroyMounted(setup.renderer)
  })

  it("shows honest unknown target headroom when the target has no usage", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    expect(setup.captureCharFrame()).toContain(`${TARGET_HEADROOM_LABEL}: ${HEADROOM_UNKNOWN}`)

    await destroyMounted(setup.renderer)
  })

  it("keeps the send action visible within a 24-row terminal", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    controller.store.applyEvent("codex", { kind: "usage", used: 36_000, size: 200_000 })
    const setup = await renderCockpit(controller, 24)

    const frame = await handoff(setup)
    const rows = frame.replace(/\n$/, "").split("\n")
    const hintRow = rows.findIndex((row) => row.includes(HANDOFF_HINT))

    expect(rows).toHaveLength(24)
    expect(hintRow).toBeGreaterThanOrEqual(0)
    expect(hintRow).toBeLessThan(23)
    expect(rows[hintRow]).toContain("Enter send")

    await destroyMounted(setup.renderer)
  })

  it("keeps the app stable and the preview closed when /handoff has an empty source", async () => {
    const controller = createFakeController()
    const setup = await renderCockpit(controller)

    await runSlashCommand(setup, "handoff")

    const frame = setup.captureCharFrame()
    expect(frame).not.toContain(HANDOFF_HINT)
    expect(controller.store.getState().overlays.handoffPreview).toBeNull()
    expect(controller.store.getState().overlays.handoffTarget).toBeNull()

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
        cwd: "/workspace/kitten",
        ready: false,
        error: "codex-acp: command not found",
      },
    ]
    const controller = createFakeController({ runtimes })
    seed(controller, "claude-code")
    const setup = await renderCockpit(controller)

    await runSlashCommand(setup, "handoff")

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
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    await destroyMounted(setup.renderer)
  })
})

describe("HandoffPreview curation", () => {
  for (const [mode, hyperlinks] of [
    ["supported", true],
    ["unsupported", false],
  ] as const) {
    it(`keeps referenced-file path text visible when hyperlinks are ${mode}`, async () => {
      const controller = createFakeController()
      seed(controller, "claude-code")
      const setup = await renderWithPreview(controller, hyperlinks)

      expect(setup.captureCharFrame()).toContain(`${ITEM_MARKER} ${KEPT_BOX} cfg.json (read)`)

      await destroyMounted(setup.renderer)
    })
  }

  it("keeps every file and diff until the developer drops one", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(`${ITEM_MARKER} ${KEPT_BOX} cfg.json (read)`)
    expect(frame).toContain(`${KEPT_BOX} src/app.ts (edited)`)
    expect(frame).not.toContain(DROPPED_BOX)
    expect(spanContaining(setup, "cfg.json (read)")?.fg.toString()).toBe(paletteColor(DARK_PALETTE.text))

    await destroyMounted(setup.renderer)
  })

  it("drops the highlighted file on Space, and the composed prompt loses it", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    controller.store.applyEvent("codex", { kind: "config_options", options: targetConfigOptions() })
    const setup = await renderWithPreview(controller)

    // The highlight starts on the first file: cfg.json, sorted ahead of src/app.ts.
    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    const dropped = await setup.waitForFrame((f) => f.includes(`${DROPPED_BOX} cfg.json`))
    expect(dropped).toContain(`${ITEM_MARKER} ${DROPPED_BOX} cfg.json (read)`)
    expect(spanContaining(setup, "cfg.json (read)")?.fg.toString()).toBe(paletteColor(DARK_PALETTE.muted))

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
    controller.store.applyEvent("codex", { kind: "config_options", options: targetConfigOptions() })
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

  it("drops a highlighted shell command by id and sends the surviving command with cwd", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    seedShell(controller)
    const setup = await renderWithPreview(controller)

    // Two files and one diff precede the first shell command in the shared item list.
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((frame) => frame.includes(`${ITEM_MARKER} ${KEPT_BOX} bun test`))

    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    await setup.waitForFrame((frame) => frame.includes(`${DROPPED_BOX} bun test`))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    const text = sentText(controller)
    expect(text).toContain("Working directory: /workspace/kitten")
    expect(text).toContain("Command: git status --short")
    expect(text).not.toContain("Command: bun test")

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
    controller.store.applyEvent("codex", { kind: "config_options", options: targetConfigOptions() })
    const setup = await renderWithPreview(controller)

    await actAsync(() => {
      setup.mockInput.pressKey("e")
    })
    await setup.waitForFrame((f) => f.includes(HANDOFF_EDIT_HINT))

    // Now every key is text - including the ones the list mode spends on navigation.
    await actAsync(async () => {
      await setup.mockInput.typeText(DRAFT_MARKER)
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((f) => f.includes(DRAFT_MARKER))

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const back = await setup.waitForFrame((f) => f.includes(HANDOFF_HINT) && f.includes(DRAFT_MARKER))
    expect(back).not.toContain(HANDOFF_EDIT_HINT)
    expect(back).toContain(`${ITEM_MARKER} ${KEPT_BOX} cfg.json`)

    // The rewritten summary is what the target receives.
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    expect(sentText(controller)).toContain(DRAFT_MARKER)

    await destroyMounted(setup.renderer)
  })

  it("renders an edited Markdown draft after Escape and forwards that exact state", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)
    const originalSummary = controller.store.getState().overlays.handoffPreview!.bundle.summary
    const editedPrefix = "## EDITED_PLAN\n\nKeep the edited draft.\n\n"

    await actAsync(() => {
      setup.mockInput.pressKey("e")
    })
    await setup.waitForFrame((frame) => frame.includes(HANDOFF_EDIT_HINT))
    await actAsync(async () => {
      await setup.mockInput.pasteBracketedText(editedPrefix)
    })
    await setup.waitForFrame((frame) => frame.includes("## EDITED_PLAN"))

    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    const readMode = await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT) && frame.includes("EDITED_PLAN"))
    expect(readMode).toContain("EDITED_PLAN")
    await setup.waitFor(() => {
      const styled = spanContaining(setup, "EDITED_PLAN")?.fg.toString() === paletteColor(DARK_PALETTE.accent)
      if (!styled) setup.renderer.requestRender()
      return styled
    })
    expect(spanContaining(setup, "EDITED_PLAN")?.fg.toString()).toBe(paletteColor(DARK_PALETTE.accent))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    const promptBlocks = controller.calls.sendPrompt[0]!.input as PromptBlock[]
    expect(promptBlocks.some((block) => block.text === `${editedPrefix}${originalSummary}`)).toBe(true)

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

describe("HandoffPreview target configuration", () => {
  it("raises target effort without a mid-conversation warning, then applies it before sending", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    controller.store.applyEvent("codex", { kind: "config_options", options: targetConfigOptions() })
    const setup = await renderWithPreview(controller)

    await actAsync(() => {
      setup.mockInput.pressKey("m")
    })
    const choosing = await setup.waitForFrame((frame) => frame.includes(HANDOFF_CONFIG_HINT))
    expect(choosing).toContain(`${ROW_MARKER} ${CURRENT_MARK} Sonnet`)
    expect(choosing).not.toContain(MID_SWITCH_WARNING)

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
    })
    const selected = await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))
    expect(selected).toContain(`${TARGET_MARK} High`)

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitFor(() => controller.calls.sendPrompt.length === 1)

    expect(controller.calls.setSessionConfigOption).toEqual([{ configId: "effort", value: "high", sessionId: "codex" }])
    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("codex")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

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
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

    // The preview is gone and focus has moved to the receiving agent.
    const closed = await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))
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
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
    expect(closed).toContain(PROMPT_PLACEHOLDER)

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
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")

    const frame = await handoff(setup)
    expect(frame).toContain(handoffTitleFor("Codex", "Claude Code"))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    expect(controller.calls.sendPrompt[0]!.sessionId).toBe("claude-code")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    await destroyMounted(setup.renderer)
  })
})

describe("HandoffPreview modality", () => {
  it("preserves curation and blocks send, discard, and edit while clarification owns input", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    controller.store.applyEvent("codex", { kind: "config_options", options: targetConfigOptions() })
    const setup = await renderWithPreview(controller)
    const suspendedPreview = controller.store.getState().overlays.handoffPreview

    // Establish local state that cannot be reconstructed from the store: select and
    // drop the second file before clarification preempts the mounted preview.
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((frame) => frame.includes(`${ITEM_MARKER} ${KEPT_BOX} src/app.ts (edited)`))
    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    await setup.waitForFrame((frame) => frame.includes(`${ITEM_MARKER} ${DROPPED_BOX} src/app.ts (edited)`))

    await openClarification(controller, "clarification-preview-enter")
    await setup.waitForFrame((frame) => frame.includes("Choose a boundary"))
    await actAsync(async () => {
      setup.mockInput.pressKey("e")
      setup.mockInput.pressKey("m")
      setup.mockInput.pressArrow("up")
      await setup.mockInput.typeText(" ")
      setup.mockInput.pressEnter()
    })

    expect(controller.calls.respondClarification).toHaveLength(1)
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.store.getState().overlays.handoffPreview).toBe(suspendedPreview)
    const resumed = await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))
    expect(resumed).toContain(`${ITEM_MARKER} ${DROPPED_BOX} src/app.ts (edited)`)
    expect(resumed).not.toContain(HANDOFF_EDIT_HINT)
    expect(resumed).not.toContain(HANDOFF_CONFIG_HINT)

    await openClarification(controller, "clarification-preview-escape")
    await setup.waitForFrame((frame) => frame.includes("Choose a boundary"))
    await actAsync(() => {
      setup.mockInput.pressEscape()
    })

    expect(controller.calls.respondClarification.at(-1)?.outcome).toEqual({ kind: "cancelled" })
    expect(controller.calls.sendPrompt).toHaveLength(0)
    expect(controller.store.getState().overlays.handoffPreview).toBe(suspendedPreview)

    // The same preview resumes and performs its unchanged action with the preemption-
    // era curation still applied.
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    expect(controller.calls.sendPrompt).toHaveLength(1)
    expect(sentText(controller)).not.toContain("- src/app.ts (edited)")

    await destroyMounted(setup.renderer)
  })

  it("keeps every key from the shell and the prompt editor while it is open", async () => {
    const controller = createFakeController()
    seed(controller, "claude-code")
    const setup = await renderWithPreview(controller)

    await actAsync(async () => {
      setup.mockInput.pressKey("`", { ctrl: true })
      await setup.mockInput.typeText(DRAFT_MARKER)
    })

    // Neither the global shell chord nor the prompt command reached through the preview.
    expect(controller.store.getState().focusedPane.kind).toBe("agent")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
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
        title: "Claude Code",
        cwd: "/workspace/kitten",
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

    await runSlashCommand(setup, "help")
    await setup.waitForFrame((f) => f.includes(HELP_TITLE))

    const frame = await handoff(setup)
    expect(frame).not.toContain(HELP_TITLE)

    await destroyMounted(setup.renderer)
  })
})

const CLAUDE: AgentConfig = { id: "claude-code", displayName: "Claude Code", command: "claude-acp", args: [], env: {} }
const CODEX: AgentConfig = { id: "codex", displayName: "Codex", command: "codex-acp", args: [], env: {} }
const APP_CONFIG: AppConfig = {
  providers: {
    "claude-code": { displayName: CLAUDE.displayName, command: CLAUDE.command, args: CLAUDE.args, env: CLAUDE.env },
    codex: { displayName: CODEX.displayName, command: CODEX.command, args: CODEX.args, env: CODEX.env },
  },
  sessions: [],
  mcpServers: [],
  shell: { enabled: true, command: "/bin/sh", scrollback: 1_000 },
  persistenceEnabled: true,
  telemetryEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
}

/** Wire a real `AgentConnection` to a fresh in-process mock ACP agent. */
function connectionToMockAgent(config: AgentConfig, onPrompt?: MockPromptScript, configOptions?: SessionConfigOption[]) {
  const pair = createInMemoryTransportPair()
  const agent = startMockAgent(pair.agent, { sessionId: `${config.id}-session`, onPrompt, configOptions })
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
    const codex = connectionToMockAgent(CODEX, undefined, targetAgentConfigOptions())
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
    await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))

    await actAsync(() => controller.actions.switchFocus("claude-code"))
    await actAsync(async () => {
      await controller.actions.sendPrompt("bump b")
    })

    // `/handoff` assembles the bundle. Nothing has reached Codex yet.
    await runSlashCommand(setup, "handoff")
    const preview = await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))
    expect(preview).toContain(handoffTitleFor("Claude Code", "Codex"))
    expect(preview).toContain(redactionNotice(1))
    expect(codex.agent.prompts).toHaveLength(0)
    const originalSummary = controller.store.getState().overlays.handoffPreview!.bundle.summary

    // Raise the target's effort inside the preview. This is a fresh prompt for Codex,
    // so it uses the compact target-config picker rather than the mid-switch warning.
    await actAsync(() => {
      setup.mockInput.pressKey("m")
    })
    await setup.waitForFrame((frame) => frame.includes(HANDOFF_CONFIG_HINT))
    await actAsync(() => {
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressArrow("down")
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT) && frame.includes(`${TARGET_MARK} High`))

    // Drop the file Claude only read; keep the edit and its diff.
    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    await setup.waitForFrame((f) => f.includes(`${DROPPED_BOX} cfg.json`))

    // The summary remains independently editable with the target-config control present.
    const editedPrefix = "## Escalated\n\n"
    await actAsync(() => {
      setup.mockInput.pressKey("e")
    })
    await setup.waitForFrame((frame) => frame.includes(HANDOFF_EDIT_HINT))
    await actAsync(async () => {
      await setup.mockInput.pasteBracketedText(editedPrefix)
    })
    await actAsync(() => {
      setup.mockInput.pressEscape()
    })
    await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))

    await actAsync(() => {
      setup.mockInput.pressEnter()
    })
    await setup.waitForFrame((f) => !f.includes(HANDOFF_HINT))

    // Codex received the curated bundle, redacted, and holds focus.
    expect(codex.agent.prompts).toHaveLength(1)
    const delivered = codex.agent.prompts[0]!.prompt.map((block) => (block.type === "text" ? block.text : "")).join("\n")
    expect(delivered).toContain(HANDOFF_INSTRUCTION)
    expect(codex.agent.prompts[0]!.prompt[1]).toEqual({ type: "text", text: `${editedPrefix}${originalSummary}` })
    expect(delivered).toContain("I got stuck.")
    expect(delivered).toContain(REDACTION_PLACEHOLDER)
    expect(delivered).not.toContain(SECRET)
    expect(delivered).toContain(pendingDiffHeading("src/app.ts"))
    expect(delivered).toContain(`${BLOCK_FILES_HEADING}\n- src/app.ts (edited)`)
    expect(delivered).not.toContain("- cfg.json (read)")

    // The target saw its effort switch before it received the bundle.
    expect(codex.agent.configOptionRequests).toEqual([{ sessionId: "codex-session", configId: "effort", value: "high" }])
    expect(codex.agent.configOptions.find((option) => option.id === "effort" && option.type === "select")?.currentValue).toBe("high")

    // The source agent was prompted once, by the user, and never by the hand-off.
    expect(claude.agent.prompts).toHaveLength(1)
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("codex")
    expect(controller.store.getState().sessions.codex!.turns).toHaveLength(1)

    await destroyMounted(setup.renderer)
    await controller.dispose()
  })
})
