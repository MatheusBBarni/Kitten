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
import { createAppStore } from "../store/appStore.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { HEADROOM_UNKNOWN } from "./headroom.ts"
import { KEYMAP_HINT, SHELL_EXIT_HINT } from "./keymap.ts"
import {
  BACKGROUND_STATUS_LABEL,
  EMPTY_WORKSPACE_STATUS_LABEL,
  FOCUS_MARKER,
  MCP_STATUS_LABEL,
  RESUMED_RUN_LABEL,
  STATUS_LABELS,
  StatusStrip,
  type StatusSlotSelectors,
} from "./StatusStrip.tsx"
import { DARK_PALETTE, type StatusTone } from "./theme.ts"

const HEIGHT = 1

function expectNoOverflow(frame: string, width: number): void {
  const rows = frame.replace(/\n$/, "").split("\n")
  expect(rows).toHaveLength(HEIGHT)
  expect([...rows[0]!]).toHaveLength(width)
  expect(frame).not.toContain("਀")
}

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
  it("shows the focused session's loaded and skipped MCP declarations", async () => {
    const [claude, codex] = readyRuntimes()
    claude!.mcp = {
      loaded: ["github"],
      skipped: [{ name: "linear", reason: 'environment variable "LINEAR_TOKEN" is not set' }],
    }
    const setup = await renderStrip(createFakeController({ runtimes: [claude!, codex!] }), 180)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(`${MCP_STATUS_LABEL} +github; !linear (environment variable "LINEAR_TOKEN" is not set)`)
    await destroyMounted(setup.renderer)
  })

  it("renders workspace and background state without consulting stale runtime or model slots", async () => {
    const store = createAppStore({
      seeds: [{ id: "background", providerKind: "codex", title: "Background", cwd: "/work" }],
      selectedVisibleId: "background",
    })
    store.backgroundConversation("background")
    const controller = createFakeController({ store, runtimes: [] })
    controller.runtimes = () => {
      throw new Error("no selected workspace must not consult runtimes")
    }
    const throwingSelectors: StatusSlotSelectors = {
      model: () => () => {
        throw new Error("no selected workspace must not consult model")
      },
      effort: () => () => {
        throw new Error("no selected workspace must not consult effort")
      },
    }
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <StatusStrip selectors={throwingSelectors} />
      </CockpitProvider>,
      { width: 100, height: HEIGHT },
    )

    const frame = await setup.waitForFrame((value) => value.includes(EMPTY_WORKSPACE_STATUS_LABEL))
    expect(frame).toContain(`${BACKGROUND_STATUS_LABEL}: 1`)
    expect(frame).not.toContain("codex:")
    expect(frame).not.toContain(STATUS_LABELS.working)

    await destroyMounted(setup.renderer)
  })

  it("renders both agent statuses and moves the focus marker", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain(`claude:— - ${STATUS_LABELS.idle}`)
    expect(setup.captureCharFrame()).toContain(`codex:— - ${STATUS_LABELS.idle}`)
    expect(setup.captureCharFrame()).toContain(`${FOCUS_MARKER} claude:`)

    await actAsync(() => controller.actions.switchFocus())
    const codex = await setup.waitForFrame((frame) => frame.includes(`${FOCUS_MARKER} codex:`))
    expect(codex).toContain(`claude:— - ${STATUS_LABELS.idle}`)
    expect(codex).not.toContain(`${FOCUS_MARKER} claude:`)

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

  it("renders clarification with a question-mark label and its clarification tone", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "status", status: "awaiting_clarification" })
    const setup = await renderStrip(controller)

    expect(STATUS_LABELS.awaiting_clarification).toStartWith("? ")
    expect(STATUS_LABELS.awaiting_clarification).toContain("clarification")
    expect(STATUS_LABELS.awaiting_clarification).not.toBe(STATUS_LABELS.awaiting_approval)
    expect(setup.captureCharFrame()).toContain(`claude:— - ${STATUS_LABELS.awaiting_clarification}`)
    expect(foregroundOf(setup, STATUS_LABELS.awaiting_clarification)).toBe(
      paletteColor(DARK_PALETTE.status.awaiting_clarification),
    )

    await destroyMounted(setup.renderer)
  })

  it("renders an unavailable runtime as not ready", async () => {
    const [claude, codex] = readyRuntimes()
    const runtimes: AgentRuntimeState[] = [{ ...claude!, ready: false, error: "claude-acp: command not found" }, codex!]
    const setup = await renderStrip(createFakeController({ runtimes }))

    expect(setup.captureCharFrame()).toContain(`claude:— - ${STATUS_LABELS.not_ready}`)
    expect(foregroundOf(setup, STATUS_LABELS.not_ready)).toBe(paletteColor(DARK_PALETTE.status.not_ready))

    await destroyMounted(setup.renderer)
  })
})

describe("StatusStrip headroom", () => {
  it("composes focus, name, status, percent, and a neutral fixed-width bar in order", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    const setup = await renderStrip(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain("▸ claude:— - idle 38% █░░")
    expect(foregroundOf(setup, "█")).toBe(paletteColor(DARK_PALETTE.text))
    expect(foregroundOf(setup, "░░")).toBe(paletteColor(DARK_PALETTE.muted))

    await destroyMounted(setup.renderer)
  })

  it("shows honest unknown headroom for absent usage on the other agent", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    const setup = await renderStrip(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain("claude:— - idle 38% █░░")
    expect(frame).toContain(`codex:— - idle ${HEADROOM_UNKNOWN}`)

    await destroyMounted(setup.renderer)
  })

  it("shows unknown rather than reported usage for a not-ready runtime", async () => {
    const [claude, codex] = readyRuntimes()
    const runtimes: AgentRuntimeState[] = [claude!, { ...codex!, ready: false, error: "codex unavailable" }]
    const controller = createFakeController({ runtimes })
    controller.store.applyEvent("codex", { kind: "usage", used: 100_000, size: 200_000 })
    const setup = await renderStrip(controller)

    const frame = setup.captureCharFrame()
    expect(frame).toContain(`codex:— - ${STATUS_LABELS.not_ready} ${HEADROOM_UNKNOWN}`)
    expect(frame).not.toContain("codex:— - not ready 50%")

    await destroyMounted(setup.renderer)
  })

  it("keeps both populated chips and the discovery hint within exactly 80 columns", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    controller.store.applyEvent("codex", { kind: "usage", used: 50_000, size: 200_000 })
    const setup = await renderStrip(controller, 80)

    const frame = setup.captureCharFrame()
    expect(frame).toContain("claude:— - idle 38% █░░")
    expect(frame).toContain("codex:— - idle 75% ██░")
    expect(frame).toContain(KEYMAP_HINT)
    expectNoOverflow(frame, 80)

    await destroyMounted(setup.renderer)
  })

  it("does not change the other agent's chip output for a Claude-only usage event", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)
    expect(setup.captureCharFrame()).toContain(`codex:— - idle ${HEADROOM_UNKNOWN}`)

    await actAsync(() => {
      controller.store.applyEvent("claude-code", { kind: "usage", used: 124_000, size: 200_000 })
    })
    const frame = await setup.waitForFrame((value) => value.includes("38%"))
    expect(frame).toContain(`codex:— - idle ${HEADROOM_UNKNOWN}`)
    expect(frame).not.toContain("codex:— - idle 38%")

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
    expect(claude).toContain("codex:— - idle")
    expect(claude).not.toContain("codex:gpt-5.6-terra")
    expect(claude).toContain(KEYMAP_HINT)
    expect(claude).toContain("^T hand-off")
    expect(claude).not.toContain("^R resume")

    await destroyMounted(setup.renderer)
  })

  it("keeps the hand-off and slash-menu discovery hint after Kitty confirmation", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller, 100, models)

    expect(setup.captureCharFrame()).toContain(KEYMAP_HINT)
    await actAsync(() => controller.store.confirmKittyKeyboard())
    expect(setup.captureCharFrame()).toContain(KEYMAP_HINT)

    await destroyMounted(setup.renderer)
  })

  it("moves the compact model readout with focus while retaining both chips", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller, 100, models)

    await actAsync(() => controller.actions.switchFocus("codex"))
    const codex = await setup.waitForFrame((frame) => frame.includes(`${FOCUS_MARKER} codex:gpt-5.6-terra:ultra - idle`))

    expect(codex).toContain("claude:— - idle")
    expect(codex).not.toContain("claude:opus:high")
    expect(codex).toContain(`${FOCUS_MARKER} codex:`)
    expect(codex).not.toContain(`${FOCUS_MARKER} claude:`)

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
