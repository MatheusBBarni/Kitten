// Suite: compact slash-first status bar
// Invariant: model identity is readable without provider-name chrome or a shortcut wall.

import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { SessionId, SessionStatus } from "../core/types.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { KEYMAP_HINT } from "./keymap.ts"
import {
  COLLAPSE_WIDTHS,
  FOCUS_MARKER,
  RUN_STATE_GLYPHS,
  RESUMED_RUN_LABEL,
  STATUS_LABELS,
  StatusStrip,
  type StatusSlotSelectors,
} from "./StatusStrip.tsx"
import { DARK_PALETTE, type StatusTone } from "./theme.ts"

const HEIGHT = 3

const HIDDEN_SELECTORS: StatusSlotSelectors = {
  branch: () => () => null,
  model: () => () => null,
  context: () => () => null,
  effort: () => () => null,
}

function slotSelectors(values: {
  model?: Partial<Record<SessionId, string>>
  effort?: Partial<Record<SessionId, string>>
}): StatusSlotSelectors {
  return {
    ...HIDDEN_SELECTORS,
    model: (sessionId) => () => values.model?.[sessionId] ?? null,
    effort: (sessionId) => () => values.effort?.[sessionId] ?? null,
  }
}

async function renderStrip(
  controller = createFakeController(),
  width = 80,
  selectors: StatusSlotSelectors = HIDDEN_SELECTORS,
): Promise<TestRendererSetup> {
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <StatusStrip selectors={selectors} />
    </CockpitProvider>,
    { width, height: HEIGHT },
  )
  await setup.waitForFrame((frame) => frame.includes("claude:"))
  return setup
}

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

describe("StatusStrip agent state", () => {
  it("keeps only the focused status marker in the lower row", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain(`${FOCUS_MARKER} ${RUN_STATE_GLYPHS.idle} ${STATUS_LABELS.idle}`)
    expect(setup.captureCharFrame().split(FOCUS_MARKER)).toHaveLength(2)

    await actAsync(() => controller.actions.switchFocus())
    expect(await setup.waitForFrame((frame) => frame.split(FOCUS_MARKER).length === 2)).toContain(
      `${FOCUS_MARKER} ${RUN_STATE_GLYPHS.idle} ${STATUS_LABELS.idle}`,
    )

    await destroyMounted(setup.renderer)
  })

  for (const { status, tone } of [
    { status: "idle", tone: "idle" },
    { status: "working", tone: "working" },
    { status: "awaiting_approval", tone: "awaiting_approval" },
  ] as const satisfies readonly { status: SessionStatus; tone: StatusTone }[]) {
    it(`renders ${status} with a glyph, label, and semantic color`, async () => {
      const controller = createFakeController()
      controller.store.applyEvent("claude-code", { kind: "status", status })
      const setup = await renderStrip(controller)

      expect(setup.captureCharFrame()).toContain(`${RUN_STATE_GLYPHS[tone]} ${STATUS_LABELS[tone]}`)
      expect(foregroundOf(setup, STATUS_LABELS[tone])).toBe(paletteColor(DARK_PALETTE.status[tone]))

      await destroyMounted(setup.renderer)
    })
  }

  it("renders an unavailable runtime as not ready", async () => {
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
    const setup = await renderStrip(createFakeController({ runtimes }))

    expect(setup.captureCharFrame()).toContain(`${RUN_STATE_GLYPHS.not_ready} ${STATUS_LABELS.not_ready}`)
    expect(foregroundOf(setup, STATUS_LABELS.not_ready)).toBe(paletteColor(DARK_PALETTE.status.not_ready))

    await destroyMounted(setup.renderer)
  })
})

describe("StatusStrip model identity and discovery", () => {
  const models = slotSelectors({
    model: { "claude-code": "opus", codex: "gpt-5.6-terra" },
    effort: { "claude-code": "high", codex: "ultra" },
  })

  it("puts provider-prefixed model and effort names in the compact upper row", async () => {
    const setup = await renderStrip(createFakeController(), 100, models)
    const frame = setup.captureCharFrame()

    expect(frame).toContain("claude:opus/high")
    expect(frame).toContain("codex:gpt-5.6-terra/ultra")
    expect(frame).toContain(KEYMAP_HINT)
    expect(frame).not.toContain("^T hand off")
    expect(frame).not.toContain("^R resume")

    await destroyMounted(setup.renderer)
  })

  it("keeps the model but sheds the secondary effort at the declared width", async () => {
    const setup = await renderStrip(createFakeController(), 100, models)
    expect(setup.captureCharFrame()).toContain("/high")

    await actAsync(() => setup.resize(COLLAPSE_WIDTHS.effort - 1, HEIGHT))
    const compact = await setup.waitForFrame((frame) => frame.includes("claude:opus") && !frame.includes("/high"))
    expect(compact).toContain("codex:gpt-5.6-terra")

    await destroyMounted(setup.renderer)
  })

  it("shows the resumed state without adding a second command affordance", async () => {
    const controller = createFakeController()
    controller.store.setRestoration("claude-code", "live")
    const setup = await renderStrip(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(RESUMED_RUN_LABEL)
    expect(frame).not.toContain("/new")
    await destroyMounted(setup.renderer)
  })
})
