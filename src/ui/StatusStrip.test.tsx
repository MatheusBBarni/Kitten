// Suite: dual-agent status bar
// Invariant: truthful status slots stay visible within the width budget and collapse only in declared priority order.
// Boundary IN: real store subscriptions, React rendering, OpenTUI layout/colors, and terminal resize.
// Boundary OUT: branch acquisition and hand-off execution, owned by controller/handoff integration suites.

import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, readyRuntimes } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentRuntimeState } from "../app/controller.ts"
import type { ContextUsage, SessionId, SessionStatus } from "../core/types.ts"
import { selectSessionBranch } from "../store/selectors.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { SHELL_HINT } from "./keymap.ts"
import {
  COLLAPSE_WIDTHS,
  FOCUS_MARKER,
  HANDOFF_BLOCKED_LABELS,
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
  branch?: Partial<Record<SessionId, string>>
  model?: Partial<Record<SessionId, string>>
  context?: Partial<Record<SessionId, ContextUsage>>
  effort?: Partial<Record<SessionId, string>>
}): StatusSlotSelectors {
  return {
    branch: (sessionId) => () => values.branch?.[sessionId] ?? null,
    model: (sessionId) => () => values.model?.[sessionId] ?? null,
    context: (sessionId) => () => values.context?.[sessionId] ?? null,
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
  await setup.waitForFrame((frame) => frame.includes("Claude Code"))
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

function addSourceTurn(controller: ReturnType<typeof createFakeController>, sessionId: SessionId = "claude-code"): void {
  controller.store.applyEvent(sessionId, { kind: "user_message", messageId: `turn-${sessionId}`, text: "Continue" })
}

describe("StatusStrip agent lozenges", () => {
  it("shows the focus marker only on the focused agent and moves it with focus", async () => {
    const controller = createFakeController()
    const setup = await renderStrip(controller)

    const initial = setup.captureCharFrame()
    expect(initial).toContain(`${FOCUS_MARKER} ${RUN_STATE_GLYPHS.idle} Claude Code`)
    expect(initial).not.toContain(`${FOCUS_MARKER} ${RUN_STATE_GLYPHS.idle} Codex`)
    expect(initial.split(FOCUS_MARKER)).toHaveLength(2)

    await actAsync(() => controller.actions.switchFocus())
    const switched = await setup.waitForFrame((frame) => frame.includes(`${FOCUS_MARKER} ${RUN_STATE_GLYPHS.idle} Codex`))
    expect(switched).not.toContain(`${FOCUS_MARKER} ${RUN_STATE_GLYPHS.idle} Claude Code`)

    await destroyMounted(setup.renderer)
  })

  const runStates: { status: SessionStatus; tone: StatusTone }[] = [
    { status: "idle", tone: "idle" },
    { status: "working", tone: "working" },
    { status: "awaiting_approval", tone: "awaiting_approval" },
  ]

  for (const { status, tone } of runStates) {
    it(`renders ${status} with its glyph, label, and palette color`, async () => {
      const controller = createFakeController()
      controller.store.applyEvent("claude-code", { kind: "status", status })
      const setup = await renderStrip(controller)

      expect(setup.captureCharFrame()).toContain(`${RUN_STATE_GLYPHS[tone]} Claude Code: ${STATUS_LABELS[tone]}`)
      expect(foregroundOf(setup, STATUS_LABELS[tone])).toBe(paletteColor(DARK_PALETTE.status[tone]))

      await destroyMounted(setup.renderer)
    })
  }

  it("renders not-ready from runtime readiness with its glyph, label, and palette color", async () => {
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

    expect(setup.captureCharFrame()).toContain(`${RUN_STATE_GLYPHS.not_ready} Codex: ${STATUS_LABELS.not_ready}`)
    expect(foregroundOf(setup, STATUS_LABELS.not_ready)).toBe(paletteColor(DARK_PALETTE.status.not_ready))

    await destroyMounted(setup.renderer)
  })
})

describe("StatusStrip nullable slots", () => {
  it("shows a model returned by selectSessionModel", async () => {
    const setup = await renderStrip(
      createFakeController(),
      80,
      slotSelectors({ model: { "claude-code": "opus" } }),
    )

    expect(setup.captureCharFrame()).toContain("Claude Code: idle opus")

    await destroyMounted(setup.renderer)
  })

  it("gives a null model zero width", async () => {
    const setup = await renderStrip()

    expect(setup.captureCharFrame()).not.toContain(" opus")

    await destroyMounted(setup.renderer)
  })

  const contextCases = [
    { percent: 0.69, text: "69%", color: DARK_PALETTE.context.ok },
    { percent: 0.7, text: "70%", color: DARK_PALETTE.context.warn },
    { percent: 0.85, text: "85%", color: DARK_PALETTE.context.warn },
    { percent: 0.86, text: "86%", color: DARK_PALETTE.context.critical },
  ]

  for (const { percent, text, color } of contextCases) {
    it(`colors ${text} with the matching context threshold`, async () => {
      const context: ContextUsage = { used: percent * 100, size: 100, percent }
      const setup = await renderStrip(
        createFakeController(),
        80,
        slotSelectors({ context: { "claude-code": context } }),
      )

      expect(setup.captureCharFrame()).toContain(text)
      expect(foregroundOf(setup, text)).toBe(paletteColor(color))

      await destroyMounted(setup.renderer)
    })
  }

  it("gives a null context zero width", async () => {
    const setup = await renderStrip()

    expect(setup.captureCharFrame()).not.toContain("0%")

    await destroyMounted(setup.renderer)
  })

  it("shows a resolved branch beside the shared cwd", async () => {
    const controller = createFakeController()
    addSourceTurn(controller)
    controller.store.applyEvent("claude-code", { kind: "branch", branch: "feature/status-bar" })
    const setup = await renderStrip(controller, 80, {
      ...HIDDEN_SELECTORS,
      branch: selectSessionBranch,
    })

    expect(setup.captureCharFrame()).toContain("kitten · feature/status-bar")

    await destroyMounted(setup.renderer)
  })

  it("removes the branch delimiter when the branch is unresolved", async () => {
    const setup = await renderStrip()
    const workspaceRow = setup.captureCharFrame().split("\n")[0] ?? ""

    expect(workspaceRow).toContain("kitten")
    expect(workspaceRow).not.toContain(" · ")

    await destroyMounted(setup.renderer)
  })
})

describe("StatusStrip hand-off affordance", () => {
  it("shows the resumed-run label and start-fresh chord only after a restore", async () => {
    const freshController = createFakeController()
    const fresh = await renderStrip(freshController)
    expect(fresh.captureCharFrame()).not.toContain(RESUMED_RUN_LABEL)
    await destroyMounted(fresh.renderer)

    const resumedController = createFakeController()
    resumedController.store.setRestoration("claude-code", "live")
    resumedController.store.setRestoration("codex", "unavailable")
    const resumed = await renderStrip(resumedController)
    expect(resumed.captureCharFrame()).toContain(`${RESUMED_RUN_LABEL} · ^N new run`)
    await destroyMounted(resumed.renderer)
  })

  it("shows the compact shell toggle hint from the canonical keymap", async () => {
    const setup = await renderStrip()

    expect(setup.captureCharFrame()).toContain(SHELL_HINT)

    await destroyMounted(setup.renderer)
  })

  it("shows the key and direction when hand-off can begin", async () => {
    const controller = createFakeController()
    addSourceTurn(controller)
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain("^T hand off -> Codex")

    await destroyMounted(setup.renderer)
  })

  it("shows the direction and empty-source reason before the key can run", async () => {
    const setup = await renderStrip()

    expect(setup.captureCharFrame()).toContain(`^T hand off -> Codex — ${HANDOFF_BLOCKED_LABELS["empty-source"]}`)

    await destroyMounted(setup.renderer)
  })

  it("shows the no-target reason when the other agent is unavailable", async () => {
    const runtimes: AgentRuntimeState[] = [
      readyRuntimes()[0]!,
      {
        sessionId: "codex",
        providerKind: "codex",
        displayName: "Codex",
        title: "Codex",
        cwd: "/workspace/kitten",
        ready: false,
        error: "not installed",
      },
    ]
    const controller = createFakeController({ runtimes })
    addSourceTurn(controller)
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain(`^T hand off — ${HANDOFF_BLOCKED_LABELS["no-target"]}`)

    await destroyMounted(setup.renderer)
  })

  it("shows the overlay-open reason ahead of other guards", async () => {
    const controller = createFakeController()
    addSourceTurn(controller)
    controller.store.openSessions()
    const setup = await renderStrip(controller)

    expect(setup.captureCharFrame()).toContain(`^T hand off -> Codex — ${HANDOFF_BLOCKED_LABELS["overlay-open"]}`)

    await destroyMounted(setup.renderer)
  })
})

describe("StatusStrip width integration", () => {
  const richestSelectors = slotSelectors({
    branch: { "claude-code": "feature/status" },
    model: { "claude-code": "opus", codex: "gpt-5" },
    effort: { "claude-code": "high", codex: "med" },
    context: {
      "claude-code": { used: 85, size: 100, percent: 0.85 },
      codex: { used: 85, size: 100, percent: 0.85 },
    },
  })

  function richController() {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "status", status: "awaiting_approval" })
    controller.store.applyEvent("codex", { kind: "status", status: "awaiting_approval" })
    addSourceTurn(controller)
    return controller
  }

  it("keeps the richest dual-agent state visible on an exactly 80-code-point row", async () => {
    const setup = await renderStrip(richController(), 80, richestSelectors)
    const frame = setup.captureCharFrame()
    const rows = frame.split("\n")

    expect([...(rows[0] ?? "")]).toHaveLength(80)
    expect(frame).toContain("Claude Code: waiting opus/high 85%")
    expect(frame).toContain("Codex: waiting gpt-5/med 85%")
    expect(frame).toContain("kitten · feature/status")
    expect(frame).toContain(SHELL_HINT)
    expect(frame).toContain("^T hand off -> Codex")

    await destroyMounted(setup.renderer)
  })

  it("sheds branch, then context, then effort as width narrows", async () => {
    const setup = await renderStrip(richController(), 80, richestSelectors)
    expect(setup.captureCharFrame()).toContain("feature/status")
    expect(setup.captureCharFrame()).toContain("85%")
    expect(setup.captureCharFrame()).toContain("/high")

    await actAsync(() => setup.resize(COLLAPSE_WIDTHS.branch - 1, HEIGHT))
    const withoutBranch = await setup.waitForFrame(
      (frame) => !frame.includes("feature/status") && frame.includes("85%") && frame.includes("/high"),
    )
    expect(withoutBranch).toContain("85%")
    expect(withoutBranch).toContain("/high")

    await actAsync(() => setup.resize(COLLAPSE_WIDTHS.context - 1, HEIGHT))
    const withoutContext = await setup.waitForFrame(
      (frame) => !frame.includes("85%") && frame.includes("/high") && frame.includes("opus"),
    )
    expect(withoutContext).toContain("/high")
    expect(withoutContext).toContain("opus")

    await actAsync(() => setup.resize(COLLAPSE_WIDTHS.effort - 1, HEIGHT))
    const withoutEffort = await setup.waitForFrame(
      (frame) => !frame.includes("/high") && frame.includes("opus") && frame.includes("^T hand off -> Codex"),
    )
    expect(withoutEffort).toContain("opus")
    expect(withoutEffort).toContain("^T hand off -> Codex")

    await destroyMounted(setup.renderer)
  })
})
