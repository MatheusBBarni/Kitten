// Suite: WelcomeBanner presentation
// Invariant: full and compact welcome variants keep the Kitten ASCII wordmark while only full exposes runtime detail.
// Boundary IN: real React rendering, OpenTUI layout, terminal dimensions, and live palette resolution.
// Boundary OUT: boot-root and idle-screen mounting, owned by task_05 and task_06.

import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { createAppStore } from "../store/appStore.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { DARK_PALETTE, LIGHT_PALETTE } from "./theme.ts"
import {
  WELCOME_GREETING,
  WELCOME_WORDMARK,
  WELCOME_WORDMARK_MIN_WIDTH,
  WELCOME_ON_RAMP,
  WelcomeBanner,
  type WelcomeAgentState,
  type WelcomeBannerProps,
} from "./WelcomeBanner.tsx"

const FULL_WIDTH = 80
const HEIGHT = 12
const CWD = "/workspace/kitten"

const AGENTS: WelcomeBannerProps["agents"] = [
  { displayName: "Claude Code", state: "connecting" },
  { displayName: "Codex", state: "ready" },
]

async function renderBanner(
  props: WelcomeBannerProps,
  width = FULL_WIDTH,
): Promise<TestRendererSetup> {
  const store = createAppStore({ preferences: { theme: "auto" } })
  const controller = createFakeController({ store })
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <WelcomeBanner {...props} />
    </CockpitProvider>,
    { width, height: HEIGHT },
  )
  await setup.waitForFrame((frame) => frame.includes(WELCOME_GREETING))
  return setup
}

function nonBlankLines(frame: string): string[] {
  return frame.split("\n").filter((line) => line.trim().length > 0)
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

describe("WelcomeBanner full variant", () => {
  it("renders the ASCII Kitten wordmark, generic agent state, cwd, and hand-off on-ramp", async () => {
    const setup = await renderBanner({ variant: "full", agents: AGENTS, cwd: CWD })
    const frame = setup.captureCharFrame()

    expect(frame).toContain("╭")
    for (const line of WELCOME_WORDMARK) expect(frame).toContain(line)
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).toContain("Agents: connecting · ready")
    expect(frame).not.toContain("Claude Code:")
    expect(frame).not.toContain("Codex:")
    expect(frame).toContain(`Working directory: ${CWD}`)
    expect(frame).toContain(WELCOME_ON_RAMP)

    await destroyMounted(setup.renderer)
  })

  for (const state of ["connecting", "ready", "unavailable"] satisfies WelcomeAgentState[]) {
    it(`renders the exact ${state} agent state`, async () => {
      const setup = await renderBanner({
        variant: "full",
        agents: [{ displayName: "Agent", state }],
        cwd: CWD,
      })

      const frame = setup.captureCharFrame()
      expect(frame).toContain(`Agents: ${state}`)
      expect(frame).not.toContain("Agent:")

      await destroyMounted(setup.renderer)
    })
  }

  it("keeps every wordmark cell in the printable ASCII range", () => {
    expect(WELCOME_WORDMARK.join("\n")).toMatch(/^[\x20-\x7e\n]+$/)
  })
})

describe("WelcomeBanner compact rendering", () => {
  it("keeps the ASCII Kitten wordmark but omits runtime detail for the quiet variant", async () => {
    const setup = await renderBanner({ variant: "quiet", agents: AGENTS, cwd: CWD })
    const frame = setup.captureCharFrame()

    expect(nonBlankLines(frame)).toHaveLength(WELCOME_WORDMARK.length + 1)
    expect(frame).toContain(WELCOME_GREETING)
    for (const line of WELCOME_WORDMARK) expect(frame).toContain(line)
    expect(frame).not.toContain("Claude Code")
    expect(frame).not.toContain(CWD)
    expect(frame).not.toContain(WELCOME_ON_RAMP)

    await destroyMounted(setup.renderer)
  })

  it("falls back to a one-line greeting below the wordmark threshold", async () => {
    const setup = await renderBanner(
      { variant: "full", agents: AGENTS, cwd: CWD },
      WELCOME_WORDMARK_MIN_WIDTH - 1,
    )
    const frame = setup.captureCharFrame()

    expect(nonBlankLines(frame)).toHaveLength(1)
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame).not.toContain(WELCOME_WORDMARK[0])
    expect(frame).not.toContain("Claude Code")
    expect(frame).not.toContain(CWD)
    expect(frame).not.toContain(WELCOME_ON_RAMP)

    await destroyMounted(setup.renderer)
  })
})

describe("WelcomeBanner palette integration", () => {
  it("stays legible and repaints the brand accent from dark to light", async () => {
    const setup = await renderBanner({ variant: "full", agents: AGENTS, cwd: CWD })

    expect(setup.captureCharFrame()).toContain(WELCOME_GREETING)
    expect(foregroundOf(setup, "Kitten")).toBe(paletteColor(DARK_PALETTE.accent))

    await actAsync(() => {
      setup.renderer.emit("theme_mode", "light")
    })
    await setup.waitFor(() => foregroundOf(setup, "Kitten") === paletteColor(LIGHT_PALETTE.accent))

    expect(setup.captureCharFrame()).toContain(WELCOME_GREETING)
    expect(foregroundOf(setup, "Kitten")).toBe(paletteColor(LIGHT_PALETTE.accent))

    await destroyMounted(setup.renderer)
  })
})
