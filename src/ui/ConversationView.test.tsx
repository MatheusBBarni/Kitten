import { describe, expect, it } from "bun:test"

import { destroyTreeSitterClient, RGBA } from "@opentui/core"
import { createMockMouse, type TestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { composeHandoffBlocks, createHandoffEdits } from "../app/handoff.ts"
import { bannerVariant, type BannerVariant } from "../config/appState.ts"
import type { HandoffBundle, ProviderKind, ToolCallKind, ToolCallUpdate } from "../core/types.ts"
import { CockpitApp } from "./CockpitApp.tsx"
import {
  ConversationView,
  EMPTY_TRANSCRIPT_HINT,
  RESTORATION_CONTEXT_LABEL,
  RESTORATION_FRESH_LABEL,
  RESTORATION_LIVE_LABEL,
  RESTORATION_UNAVAILABLE_LABEL,
  START_FRESH_LABEL,
} from "./ConversationView.tsx"
import { ROLE_LABELS } from "./MessageView.tsx"
import { KEYMAP_HINT } from "./keymap.ts"
import { DARK_PALETTE } from "./theme.ts"
import { CONNECTOR, filetypeFor, STATUS_BULLET, TOOL_KIND_NAMES } from "./ToolCallRow.tsx"
import { WELCOME_GREETING, WELCOME_KITTEN, WELCOME_ON_RAMP } from "./WelcomeBanner.tsx"

/** The `rgba(...)` string OpenTUI stores for a palette hex, for comparing to a captured cell. */
function paletteColor(hex: string): string {
  return RGBA.fromHex(hex).toString()
}

const WIDTH = 72
const HEIGHT = 20

/** A unified diff of the shape `toUnifiedDiff` produces in the adapter. */
const UNIFIED = ["--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1,2 +1,2 @@", " const a = 1", "-const b = 2", "+const b = 3"].join("\n")

const RESTORED_BUNDLE: HandoffBundle = {
  intent: "continue",
  summary: "Preserve the restoration selector seam.",
  files: [{ path: "src/ui/ConversationView.tsx", reason: "edited" }],
  pendingDiffs: [],
  redactionCount: 0,
}

/** Mount the conversation inside the real shell, so focus and the store are wired as in production. */
async function renderConversation(
  controller: FakeController,
  width = WIDTH,
  height = HEIGHT,
  welcomeBannerVariant: BannerVariant = "full",
) {
  const setup = await testRender(
    <CockpitApp controller={controller}>
      <ConversationView welcomeBannerVariant={welcomeBannerVariant} />
    </CockpitApp>,
    { width, height },
  )
  // The frame title is present for both the normal banner and degraded restoration
  // states; the latter intentionally omit the greeting.
  await setup.waitForFrame((f) => f.includes("Kitten"))
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

/** Push a user turn onto an agent's transcript. */
function userMessage(controller: FakeController, agentId: ProviderKind, messageId: string, text: string): void {
  controller.store.applyEvent(agentId, { kind: "user_message", messageId, text })
}

/** Append a streamed delta to an agent's message, exactly as the coalescer would. */
function agentDelta(controller: FakeController, agentId: ProviderKind, messageId: string, textDelta: string): void {
  controller.store.applyEvent(agentId, { kind: "agent_message", messageId, textDelta })
}

/** Upsert a tool call by id. */
function toolCall(controller: FakeController, agentId: ProviderKind, call: ToolCallUpdate): void {
  controller.store.applyEvent(agentId, { kind: "tool_call", call })
}

/**
 * What the terminal would put on the clipboard for a drag from `from` to `to`.
 *
 * The focus column is exclusive, so `to` names the cell just past the last one the
 * user wants. A drag that *starts* on an unselectable cell (a box border, a diff's
 * line-number gutter) selects nothing at all.
 */
async function selectText(renderer: TestRenderer, from: [number, number], to: [number, number]): Promise<string> {
  const mouse = createMockMouse(renderer)
  await mouse.drag(from[0], from[1], to[0], to[1])
  return renderer.getSelection()?.getSelectedText() ?? ""
}

/** The box-drawing and gutter glyphs the cockpit paints around the transcript. */
const CHROME_GLYPHS = /[│┌┐└┘─█▄▌▸]/

function expectAlignedTranscriptTable(frame: string): void {
  const rows = frame
    .split("\n")
    .filter((row) => [...row.matchAll(/│/g)].length >= 4)
  expect(rows.length).toBeGreaterThanOrEqual(3)

  const expectedBoundaries = [...rows[0]!.matchAll(/│/g)].map((match) => match.index)
  for (const row of rows) {
    expect([...row.matchAll(/│/g)].map((match) => match.index)).toEqual(expectedBoundaries)
  }
}

describe("ConversationView turns", () => {
  it("shows the ASCII Kitten banner, neutral ready states, cwd, and command on-ramp before the first turn", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderConversation(controller)

    const frame = captureCharFrame()
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).toContain(WELCOME_KITTEN[0])
    expect(frame).toContain(WELCOME_KITTEN[1])
    expect(frame).toContain(WELCOME_KITTEN[2])
    expect(frame).toContain("Agents: ready · ready")
    expect(frame).toContain(`Working directory: ${process.cwd()}`)
    expect(frame).toContain(WELCOME_ON_RAMP)
    expect(frame).toContain("[selected] Claude Code")
    expect(frame).not.toContain("Codex")
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)

    await destroyMounted(renderer)
  })

  it("keeps the ASCII kitten mascot in the quiet first-run variant", async () => {
    const controller = createFakeController()
    const variant = bannerVariant("auto", true)
    expect(variant).toBe("quiet")
    const { renderer, captureCharFrame } = await renderConversation(controller, WIDTH, HEIGHT, variant)

    const frame = captureCharFrame()
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).toContain(WELCOME_KITTEN[0])
    expect(frame).not.toContain("Agents:")
    expect(frame).not.toContain(WELCOME_ON_RAMP)

    await destroyMounted(renderer)
  })

  it("falls back to the one-line greeting at narrow width", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderConversation(controller, 48, 14)

    const frame = captureCharFrame()
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).not.toContain(WELCOME_KITTEN[0])
    expect(frame).not.toContain("Agents:")
    expect(frame).not.toContain(WELCOME_ON_RAMP)

    await destroyMounted(renderer)
  })

  it("replaces the idle banner with the transcript when the first turn arrives", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame, waitForFrame } = await renderConversation(controller)

    expect(captureCharFrame()).toContain(WELCOME_GREETING)

    await actAsync(() => userMessage(controller, "claude-code", "m1", "FIRST_TRANSCRIPT_TURN"))
    const frame = await waitForFrame((candidate) => candidate.includes("FIRST_TRANSCRIPT_TURN"))

    expect(frame).not.toContain(WELCOME_GREETING)
    expect(frame).not.toContain(WELCOME_ON_RAMP)
    expect(frame).not.toContain(EMPTY_TRANSCRIPT_HINT)

    await destroyMounted(renderer)
  })

  it("renders the user turn unlabelled and the agent turn under its role label, in order", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() => {
      userMessage(controller, "claude-code", "m1", "rename the flag")
      agentDelta(controller, "claude-code", "m2", "Renaming it now.")
    })
    const frame = await waitForFrame((f) => f.includes("Renaming it now."))

    const rows = frame.split("\n")
    const userText = rows.findIndex((r) => r.includes("rename the flag"))
    const agentLabel = rows.findIndex((r) => r.includes(ROLE_LABELS.agent))
    const agentText = rows.findIndex((r) => r.includes("Renaming it now."))

    // The user's turn carries no "you" label - its tinted band alone sets it apart.
    expect(frame).not.toContain("you")
    // The agent still sits under its role label, and the user spoke first.
    expect(userText).toBeGreaterThanOrEqual(0)
    expect(agentText).toBe(agentLabel + 1)
    expect(userText).toBeLessThan(agentLabel)

    await destroyMounted(renderer)
  })

  it("keeps a transcript table aligned across a terminal resize", async () => {
    const controller = createFakeController()
    const setup = await renderConversation(controller, 72, 24)
    const table = [
      "| Service | Status | Notes |",
      "| --- | --- | --- |",
      "| api | ready | short |",
      "| worker | active | wraps cleanly when the terminal narrows |",
    ].join("\n")

    await actAsync(() => agentDelta(controller, "claude-code", "m1", table))
    const wide = await setup.waitForFrame(
      (frame) => frame.includes("worker") && frame.includes("terminal narrows"),
    )
    expectAlignedTranscriptTable(wide)

    await actAsync(() => setup.resize(44, 24))
    const narrow = await setup.waitForFrame((frame) => frame.includes("terminal narrows") && frame !== wide)
    expectAlignedTranscriptTable(narrow)
    expect(narrow).not.toContain("…")

    await destroyMounted(setup.renderer)
  })

  it("sets the user's words on a tinted band the agent's words do not share", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureSpans } = await renderConversation(controller)

    await actAsync(() => {
      userMessage(controller, "claude-code", "m1", "USERWORD")
      agentDelta(controller, "claude-code", "m2", "AGENTWORD")
    })
    await waitForFrame((f) => f.includes("AGENTWORD"))

    const spanOf = (needle: string) =>
      captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes(needle))

    const userWord = spanOf("USERWORD")
    const agentWord = spanOf("AGENTWORD")
    expect(userWord).toBeDefined()
    expect(agentWord).toBeDefined()

    // The user's words sit on the band; the agent's sit on the plain surface. The band
    // is a background attribute, not a border, so it never lands in a copied selection.
    expect(userWord!.bg.toString()).toBe(paletteColor(DARK_PALETTE.userMessageSurface))
    expect(agentWord!.bg.toString()).not.toBe(userWord!.bg.toString())

    await destroyMounted(renderer)
  })

  it("renders a Markdown heading with a non-default transcript foreground", async () => {
    await destroyTreeSitterClient()
    const controller = createFakeController()
    const { renderer, waitForFrame, waitFor, captureSpans } = await renderConversation(controller)

    await actAsync(() => agentDelta(controller, "claude-code", "m1", "## STRUCTURED_HEADING"))
    await waitForFrame((frame) => frame.includes("STRUCTURED_HEADING"))

    const headingSpan = () =>
      captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes("STRUCTURED_HEADING"))
    await waitFor(() => {
      const styled = headingSpan()?.fg?.toString() === paletteColor(DARK_PALETTE.accent)
      if (!styled) renderer.requestRender()
      return styled
    })

    expect(headingSpan()?.fg?.toString()).toBe(paletteColor(DARK_PALETTE.accent))
    expect(headingSpan()?.fg?.toString()).not.toBe(paletteColor(DARK_PALETTE.text))

    await destroyMounted(renderer)
  })
})

describe("ConversationView restoration degradation", () => {
  it("shows an unobtrusive live badge without claiming history is unavailable", async () => {
    const controller = createFakeController()
    controller.store.setRestoration("claude-code", "live")

    const { renderer, captureCharFrame } = await renderConversation(controller)
    const frame = captureCharFrame()

    expect(frame).toContain(RESTORATION_LIVE_LABEL)
    expect(frame).not.toContain(RESTORATION_UNAVAILABLE_LABEL)

    await destroyMounted(renderer)
  })

  it("shows persisted hand-off context when restored history is unavailable", async () => {
    const controller = createFakeController()
    controller.store.setRestorationBundle(RESTORED_BUNDLE)
    controller.store.setRestoration("claude-code", "unavailable")

    const { renderer, captureCharFrame } = await renderConversation(controller)
    const frame = captureCharFrame()

    expect(frame).toContain(RESTORATION_UNAVAILABLE_LABEL)
    expect(frame).toContain(RESTORATION_CONTEXT_LABEL)
    expect(frame).toContain(RESTORED_BUNDLE.summary)
    expect(frame).toContain("/new")
    expect(frame).toContain(START_FRESH_LABEL)

    await destroyMounted(renderer)
  })

  it("keeps a fresh replacement session usable when its previous history is unavailable", async () => {
    const controller = createFakeController()
    controller.store.setRestoration("claude-code", "unavailable")

    const { renderer, captureCharFrame } = await renderConversation(controller)
    const frame = captureCharFrame()

    expect(frame).toContain(RESTORATION_FRESH_LABEL)
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).not.toContain(RESTORATION_CONTEXT_LABEL)

    await destroyMounted(renderer)
  })

  it("starts one fresh agent session from the canonical persisted bundle blocks", async () => {
    const controller = createFakeController()
    controller.store.setRestorationBundle(RESTORED_BUNDLE)
    controller.store.setRestoration("claude-code", "unavailable")
    const setup = await renderConversation(controller)

    await runSlashCommand(setup, "new")

    expect(controller.calls.startFreshFromContext).toEqual([
      {
        input: composeHandoffBlocks(RESTORED_BUNDLE, createHandoffEdits(RESTORED_BUNDLE)),
        sessionId: "claude-code",
      },
    ])

    await destroyMounted(setup.renderer)
  })

  it("leaves a normal null-restoration pane on the existing welcome path", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderConversation(controller)
    const frame = captureCharFrame()

    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).not.toContain(RESTORATION_LIVE_LABEL)
    expect(frame).not.toContain(RESTORATION_UNAVAILABLE_LABEL)
    expect(frame).not.toContain(START_FRESH_LABEL)

    await destroyMounted(renderer)
  })

  it("shows no fabricated transcript or seed action when unavailable without a bundle", async () => {
    const controller = createFakeController({
      runtimes: [
        {
          sessionId: "claude-code",
          providerKind: "claude-code",
          displayName: "Claude Code",
          title: "Claude Code",
          cwd: process.cwd(),
          ready: false,
          error: "restoration failed",
        },
        readyRuntimes()[1]!,
      ],
    })
    userMessage(controller, "claude-code", "stale", "TRANSCRIPT_MUST_STAY_HIDDEN")
    controller.store.setRestoration("claude-code", "unavailable")

    const { renderer, captureCharFrame } = await renderConversation(controller)
    const frame = captureCharFrame()

    expect(frame).toContain(RESTORATION_UNAVAILABLE_LABEL)
    expect(frame).not.toContain("TRANSCRIPT_MUST_STAY_HIDDEN")
    expect(frame).not.toContain(RESTORATION_CONTEXT_LABEL)
    expect(frame).not.toContain(START_FRESH_LABEL)

    await destroyMounted(renderer)
  })
})

describe("ConversationView streaming", () => {
  it("settles a streamed agent message over several coalesced updates without losing earlier blocks", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() => agentDelta(controller, "claude-code", "m1", "## Plan\n\nI will "))
    const first = await waitForFrame((f) => f.includes("I will"))
    expect(first).toContain("Plan")

    await actAsync(() => agentDelta(controller, "claude-code", "m1", "read the file"))
    const second = await waitForFrame((f) => f.includes("read the file"))

    await actAsync(() => agentDelta(controller, "claude-code", "m1", " and edit it."))
    const third = await waitForFrame((f) => f.includes("and edit it."))

    // The heading survives every append: the block above the streaming tail is never
    // torn down and rebuilt, which is what "no flicker" means for a Markdown block.
    for (const frame of [first, second, third]) expect(frame).toContain("Plan")
    // Deltas concatenate rather than replace, and only one message exists.
    expect(third).toContain("I will read the file and edit it.")
    expect(third.match(/I will/g)).toHaveLength(1)

    await destroyMounted(renderer)
  })

  it("keeps user and streamed agent content distinct as the message settles", async () => {
    const controller = createFakeController()
    // Tall enough that the transcript, prompt editor, and strip all fit, so each
    // assertion observes the streaming content rather than a scrolled-away row.
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller, WIDTH, 18)

    await actAsync(() => userMessage(controller, "claude-code", "m1", "ping"))
    // The user turn carries no label now, and the prompt editor's hint already holds
    // "Shift" (which contains "hi"), so the sentinel must be a word the chrome never
    // paints. "ping" appears only once the user's band renders.
    await waitForFrame((f) => f.includes("ping"))
    const userFrame = captureCharFrame()
    expect(userFrame).toContain("ping")
    expect(userFrame).not.toContain("Hello")
    expect(userFrame).toContain("Kitten")
    expect(userFrame).toContain("[selected] Claude Code")

    await actAsync(() => agentDelta(controller, "claude-code", "m2", "Hello"))
    await waitForFrame((f) => f.includes("Hello"))
    const firstChunk = captureCharFrame()
    expect(firstChunk).toContain("ping")
    expect(firstChunk).toContain(ROLE_LABELS.agent)
    expect(firstChunk).toContain("Hello")
    expect(firstChunk).not.toContain("Hello, world.")

    await actAsync(() => agentDelta(controller, "claude-code", "m2", ", world."))
    await waitForFrame((f) => f.includes("Hello, world."))
    const settled = captureCharFrame()
    expect(settled).toContain("ping")
    expect(settled).toContain("Hello, world.")
    expect(settled.match(/Hello, world\./g)).toHaveLength(1)
    expect(settled).toContain(KEYMAP_HINT)
    expect(settled).toContain("[selected] Claude Code")

    await destroyMounted(renderer)
  })
})

describe("ConversationView tool calls", () => {
  it("heads the row with `● Name(title)`, the status carried by the bullet's color, no status word", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, waitFor, captureSpans, captureCharFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Update app.ts",
        status: "in_progress",
      }),
    )
    const running = await waitForFrame((f) => f.includes("Update app.ts"))

    // The header reads `● Edit(Update app.ts)`: capitalized name, title in parentheses,
    // and none of the old trailing status words.
    expect(running).toContain(STATUS_BULLET)
    expect(running).toContain(TOOL_KIND_NAMES.edit)
    expect(running).toContain("Update app.ts")
    for (const word of ["in_progress", "completed", "pending", "failed"]) {
      expect(running).not.toContain(word)
    }

    // The bullet, not a word, carries the status - here the in-progress tool color.
    const bulletColor = () =>
      captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes(STATUS_BULLET))
        ?.fg?.toString()
    expect(bulletColor()).toBe(paletteColor(DARK_PALETTE.tool.in_progress))

    // Upserted by id: the same single row restyles the bullet in place on completion.
    await actAsync(() => toolCall(controller, "claude-code", { toolCallId: "t1", status: "completed" }))
    await waitFor(() => bulletColor() === paletteColor(DARK_PALETTE.tool.completed))

    const done = captureCharFrame()
    expect(done.match(/Update app\.ts/g)).toHaveLength(1)
    expect(done).toContain(TOOL_KIND_NAMES.edit)

    await destroyMounted(renderer)
  })

  it("colors the bullet by status for pending and failed too", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureSpans } = await renderConversation(controller)

    // The test above pins in_progress and completed; these are the other two states, so
    // every ToolCallStatus now asserts a rendered bullet in its own palette color.
    await actAsync(() => {
      toolCall(controller, "claude-code", { toolCallId: "t1", kind: "read", title: "queued.ts", status: "pending" })
      toolCall(controller, "claude-code", { toolCallId: "t2", kind: "read", title: "broken.ts", status: "failed" })
    })
    await waitForFrame((f) => f.includes("broken.ts"))

    // Only tool rows paint the bullet glyph, so every match here is a status light.
    const bulletColors = captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.text.includes(STATUS_BULLET))
      .map((span) => span.fg?.toString())
    expect(bulletColors).toContain(paletteColor(DARK_PALETTE.tool.pending))
    expect(bulletColors).toContain(paletteColor(DARK_PALETTE.tool.failed))

    await destroyMounted(renderer)
  })

  it("renders a bold tool name so the header reads like an agent action", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureSpans } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", { toolCallId: "t1", kind: "read", title: "app.ts", status: "completed" }),
    )
    await waitForFrame((f) => f.includes(TOOL_KIND_NAMES.read))

    const nameSpan = captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.trim() === TOOL_KIND_NAMES.read)
    expect(nameSpan).toBeDefined()
    // `TextAttributes.BOLD` is bit 0; the name span sets it, the title does not.
    expect(nameSpan!.attributes & 1).toBe(1)

    await destroyMounted(renderer)
  })

  it("renders a non-edit tool call without a diff", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "read",
        title: "Read app.ts",
        status: "completed",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    const frame = await waitForFrame((f) => f.includes("Read app.ts"))

    expect(frame).toContain(TOOL_KIND_NAMES.read)
    expect(frame).not.toContain("const b = 3")

    await destroyMounted(renderer)
  })

  it("hangs a non-edit call's extra locations off a `└ ` connector, and suppresses an echo of the title", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    // Locations that add nothing beyond the title earn no connector line.
    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "search",
        title: "src/app.ts",
        status: "completed",
        locations: ["src/app.ts"],
      }),
    )
    await waitForFrame((f) => f.includes("Search"))
    expect(captureCharFrame()).not.toContain(CONNECTOR)

    // Locations that do add information hang off the connector in muted.
    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t2",
        kind: "search",
        title: "TODO",
        status: "completed",
        locations: ["src/app.ts", "src/main.ts"],
      }),
    )
    const frame = await waitForFrame((f) => f.includes("src/main.ts"))
    const connector = frame.split("\n").find((row) => row.includes(CONNECTOR))
    expect(connector).toBeDefined()
    expect(connector).toContain("src/app.ts, src/main.ts")

    await destroyMounted(renderer)
  })

  it("draws no connector for a non-edit call whose locations are empty", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    // An empty locations array collapses to an empty summary - the other way the connector
    // is suppressed, alongside a title echo - so the header stands alone.
    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "read",
        title: "app.ts",
        status: "completed",
        locations: [],
      }),
    )
    await waitForFrame((f) => f.includes("app.ts"))
    expect(captureCharFrame()).not.toContain(CONNECTOR)

    await destroyMounted(renderer)
  })

  it("renders an edit tool call's diff through the <diff> component", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Bump b",
        status: "in_progress",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    const frame = await waitForFrame((f) => f.includes("const b = 3"))

    // The diff's own unified view: context, removal and addition, each on its own row,
    // with the `-`/`+` signs the gutter draws. The `---`/`+++`/`@@` header is consumed.
    expect(frame).toContain("src/app.ts")
    expect(frame).toContain("const a = 1")
    expect(frame).toContain("const b = 2")
    expect(frame).toContain("const b = 3")
    expect(frame).not.toContain("@@")

    const rows = frame.split("\n")
    expect(rows.find((r) => r.includes("const b = 2"))).toContain("-")
    expect(rows.find((r) => r.includes("const b = 3"))).toContain("+")

    await destroyMounted(renderer)
  })

  it("hangs an edit call's diff path off a `└ ` connector, above the diff body", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Bump b",
        status: "in_progress",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    const frame = await waitForFrame((f) => f.includes("const b = 3"))

    // The path rides the connector in the same quiet shape a non-edit call's locations do;
    // the diff's own gutter uses line numbers, not `└ `, so this row is unambiguous.
    const connector = frame.split("\n").find((row) => row.includes(CONNECTOR))
    expect(connector).toBeDefined()
    expect(connector).toContain(`${CONNECTOR}src/app.ts`)

    await destroyMounted(renderer)
  })
})

describe("ConversationView focus", () => {
  it("renders only the focused agent's transcript and swaps it when focus moves", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() => {
      agentDelta(controller, "claude-code", "m1", "CLAUDE_TRANSCRIPT")
      agentDelta(controller, "codex", "m2", "CODEX_TRANSCRIPT")
    })

    const claudeFocused = await waitForFrame((f) => f.includes("CLAUDE_TRANSCRIPT"))
    expect(claudeFocused).not.toContain("CODEX_TRANSCRIPT")

    await actAsync(() => controller.actions.switchFocus())

    const codexFocused = await waitForFrame((f) => f.includes("CODEX_TRANSCRIPT"))
    expect(codexFocused).not.toContain("CLAUDE_TRANSCRIPT")

    await destroyMounted(renderer)
  })

  it("leaves the transcript alone when the unfocused agent streams", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    await actAsync(() => agentDelta(controller, "claude-code", "m1", "FOCUSED_TEXT"))
    const before = await waitForFrame((f) => f.includes("FOCUSED_TEXT"))

    await actAsync(() => agentDelta(controller, "codex", "m2", "BACKGROUND_TEXT"))
    const after = captureCharFrame()

    expect(after).toBe(before)
    expect(after).not.toContain("BACKGROUND_TEXT")

    await destroyMounted(renderer)
  })
})

describe("ConversationView selection", () => {
  it("copies a message's words without the surrounding chrome", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    await actAsync(() => userMessage(controller, "claude-code", "m1", "copy me cleanly"))
    await waitForFrame((f) => f.includes("copy me cleanly"))

    const rows = captureCharFrame().split("\n")
    const row = rows.findIndex((r) => r.includes("copy me cleanly"))
    const start = rows[row]!.indexOf("copy me cleanly")

    // Dragged across the words only: the pane's border sits on the same screen rows.
    const selected = await selectText(renderer, [start, row], [start + "copy me cleanly".length, row])
    expect(selected).toBe("copy me cleanly")
    expect(selected).not.toMatch(CHROME_GLYPHS)

    await destroyMounted(renderer)
  })

  it("selects nothing when the drag starts on the pane border", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() => userMessage(controller, "claude-code", "m1", "copy me cleanly"))
    await waitForFrame((f) => f.includes("copy me cleanly"))

    // Column 0 is the box's left border, and a border is not selectable.
    expect(await selectText(renderer, [0, 1], [WIDTH - 1, 3])).toBe("")

    await destroyMounted(renderer)
  })

  it("copies a diff's code without its line numbers or sign gutter", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Bump b",
        status: "completed",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    await waitForFrame((f) => f.includes("const b = 3"))

    const rows = captureCharFrame().split("\n")
    const first = rows.findIndex((r) => r.includes("const a = 1"))
    const last = rows.findIndex((r) => r.includes("const b = 3"))
    const codeColumn = rows[first]!.indexOf("const a = 1")

    const selected = await selectText(renderer, [codeColumn, first], [rows[last]!.length, last])

    // Exactly the code. The gutter drew ` 1  `, ` 2 -` and ` 2 +` beside these lines
    // and the pane drew a border around them; none of it reaches the clipboard.
    expect(selected).toBe("const a = 1\nconst b = 2\nconst b = 3")
    expect(selected).not.toMatch(CHROME_GLYPHS)
    for (const line of selected.split("\n")) expect(line).not.toMatch(/^\s*[\d+-]/)

    await destroyMounted(renderer)
  })

  it("selects nothing when the drag starts on the diff's line-number gutter", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Bump b",
        status: "completed",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    await waitForFrame((f) => f.includes("const b = 3"))

    const rows = captureCharFrame().split("\n")
    const first = rows.findIndex((r) => r.includes("const a = 1"))
    const last = rows.findIndex((r) => r.includes("const b = 3"))
    const gutterColumn = rows[first]!.indexOf("1")

    expect(await selectText(renderer, [gutterColumn, first], [rows[last]!.length, last])).toBe("")

    await destroyMounted(renderer)
  })
})

describe("filetypeFor", () => {
  it("reads the extension off a path", () => {
    expect(filetypeFor("src/app.ts")).toBe("ts")
    expect(filetypeFor("a/b/c/main.py")).toBe("py")
    expect(filetypeFor("archive.tar.gz")).toBe("gz")
  })

  it("has nothing to offer for a path without a usable extension", () => {
    expect(filetypeFor("Makefile")).toBeUndefined()
    expect(filetypeFor("src/Makefile")).toBeUndefined()
    // A dotfile's leading dot does not name a filetype.
    expect(filetypeFor(".gitignore")).toBeUndefined()
    expect(filetypeFor("src/.gitignore")).toBeUndefined()
    // A trailing dot names nothing either.
    expect(filetypeFor("weird.")).toBeUndefined()
    expect(filetypeFor("")).toBeUndefined()
  })
})

describe("TOOL_KIND_NAMES", () => {
  it("gives every kind a capitalized header name", () => {
    const expected: Record<ToolCallKind, string> = {
      read: "Read",
      edit: "Edit",
      delete: "Delete",
      move: "Move",
      search: "Search",
      execute: "Run",
      think: "Think",
      fetch: "Fetch",
      other: "Tool",
    }
    expect(TOOL_KIND_NAMES).toEqual(expected)
    // Every name leads with an uppercase letter, so a header reads as a proper noun.
    for (const name of Object.values(TOOL_KIND_NAMES)) {
      expect(name[0]).toBe(name[0]!.toUpperCase())
    }
  })
})
