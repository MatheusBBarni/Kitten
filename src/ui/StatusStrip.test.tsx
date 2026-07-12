// Suite: compact slash-first status bar
// Invariant: model identity is readable without provider-name chrome or a shortcut wall.

import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { ConfigOption, SessionId, SessionStatus } from "../core/types.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { KEYMAP_HINT, SHELL_EXIT_HINT } from "./keymap.ts"
import {
  RESUMED_RUN_LABEL,
  STATUS_LABELS,
  StatusStrip,
  type StatusSlotSelectors,
} from "./StatusStrip.tsx"
import { DARK_PALETTE, type StatusTone } from "./theme.ts"

const HEIGHT = 1

const HIDDEN_SELECTORS: StatusSlotSelectors = {
  model: () => () => null,
  effort: () => () => undefined,
}

function slotSelectors(values: {
  model?: Partial<Record<SessionId, string>>
  effort?: Partial<Record<SessionId, string>>
}): StatusSlotSelectors {
  return {
    ...HIDDEN_SELECTORS,
    model: (sessionId) => () => (sessionId ? values.model?.[sessionId] : undefined) ?? null,
    effort: (sessionId) => () => (sessionId ? values.effort?.[sessionId] : undefined),
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
  it("renders only the focused status beside the provider and model", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain(`claude:— - ${STATUS_LABELS.idle}`)
    expect(setup.captureCharFrame()).not.toContain("codex:—")

    await actAsync(() => controller.actions.switchFocus())
    const codex = await setup.waitForFrame((frame) => frame.includes(`codex:— - ${STATUS_LABELS.idle}`))
    expect(codex).not.toContain("claude:—")

    await destroyMounted(setup.renderer)
  })

  for (const { status, tone } of [
    { status: "idle", tone: "idle" },
    { status: "working", tone: "working" },
    { status: "awaiting_approval", tone: "awaiting_approval" },
  ] as const satisfies readonly { status: SessionStatus; tone: StatusTone }[]) {
    it(`renders ${status} with an inline label and semantic color`, async () => {
      const controller = createFakeController()
      controller.store.applyEvent("claude-code", { kind: "status", status })
      const setup = await renderStrip(controller)

      expect(setup.captureCharFrame()).toContain(`claude:— - ${STATUS_LABELS[tone]}`)
      expect(foregroundOf(setup, STATUS_LABELS[tone])).toBe(paletteColor(DARK_PALETTE.status[tone]))

      await destroyMounted(setup.renderer)
    })
  }

  it("renders an unavailable runtime as not ready", async () => {
    const [claude, codex] = readyRuntimes()
    const runtimes: AgentRuntimeState[] = [{ ...claude!, ready: false, error: "claude-acp: command not found" }, codex!]
    const setup = await renderStrip(createFakeController({ runtimes }))

    expect(setup.captureCharFrame()).toContain(`claude:— - ${STATUS_LABELS.not_ready}`)
    expect(foregroundOf(setup, STATUS_LABELS.not_ready)).toBe(paletteColor(DARK_PALETTE.status.not_ready))

    await destroyMounted(setup.renderer)
  })
})

describe("StatusStrip model identity and discovery", () => {
  const models = slotSelectors({
    model: { "claude-code": "opus", codex: "gpt-5.6-terra" },
    effort: { "claude-code": "high", codex: "ultra" },
  })

  it("puts the focused provider, model, effort, and status in the compact row", async () => {
    const setup = await renderStrip(createFakeController(), 100, models)
    const claude = setup.captureCharFrame()

    expect(claude).toContain("claude:opus:high - idle")
    expect(claude).not.toContain("codex:gpt-5.6-terra")
    expect(claude).not.toContain("codex:gpt-5.6-terra:ultra")
    expect(claude).toContain(KEYMAP_HINT)
    expect(claude).not.toContain("^T hand off")
    expect(claude).not.toContain("^R resume")

    await destroyMounted(setup.renderer)
  })

  it("changes the compact model readout with focus", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller, 100, models)

    await actAsync(() => controller.actions.switchFocus("codex"))
    const codex = await setup.waitForFrame((frame) => frame.includes("codex:gpt-5.6-terra:ultra - idle"))

    expect(codex).not.toContain("claude:opus")
    expect(codex).not.toContain("claude:opus:high")

    await destroyMounted(setup.renderer)
  })

  it("uses the advertised label instead of a provider's opaque model value", async () => {
    const controller = createFakeController()
    const rawModel: ConfigOption = {
      id: "model",
      category: "model",
      label: "Model",
      currentValue: "opus[1m]",
      options: [{ value: "opus[1m]", name: "Opus" }],
    }
    controller.store.applyEvent("claude-code", { kind: "config_options", options: [rawModel] })
    const setup = await renderStrip(controller, 100, slotSelectors({ model: { "claude-code": "opus[1m]" } }))

    const frame = setup.captureCharFrame()
    expect(frame).toContain("claude:Opus")
    expect(frame).not.toContain("opus[1m]")

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

  it("shows the shell exit chord instead of the generic help hint while the shell owns focus", async () => {
    const controller = createFakeController()
    controller.store.setFocusedPane({ kind: "shell" })
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain(SHELL_EXIT_HINT)
    expect(setup.captureCharFrame()).not.toContain(KEYMAP_HINT)

    await destroyMounted(setup.renderer)
  })
})
