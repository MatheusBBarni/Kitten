// Suite: SlashMenu presentation and activation
// Invariant: supplied groups render in order, one flattened row is highlighted, and activation returns that exact row.
// Boundary IN: real React rendering, OpenTUI layout/palette resolution, and mouse-event dispatch.
// Boundary OUT: menu state and keyboard selection, owned by PromptEditor.test.tsx.

import { describe, expect, it } from "bun:test"

import { MouseEvent, RGBA, type Renderable } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  HIGHLIGHTED_COMMAND_ROW_ID,
  NO_COMMANDS_MATCH,
  SlashMenu,
  type MenuRow,
} from "./SlashMenu.tsx"
import { DARK_PALETTE } from "./theme.ts"

const handoffRow: MenuRow = {
  source: "cockpit",
  command: "hand-off",
  label: "Hand off",
  shortcut: "Ctrl+T",
}
const reviewRow: MenuRow = { source: "agent", name: "review", label: "/review", hint: "topic" }

const groups = [
  { source: "Cockpit", rows: [handoffRow] },
  { source: "Codex", rows: [reviewRow] },
]

async function renderMenu(
  highlightedIndex: number,
  onSelect: (row: MenuRow) => void = () => {},
): Promise<TestRendererSetup> {
  const setup = await testRender(
    <CockpitProvider controller={createFakeController()}>
      <SlashMenu groups={groups} highlightedIndex={highlightedIndex} onSelect={onSelect} />
    </CockpitProvider>,
    { width: 64, height: 12, useMouse: true },
  )
  await setup.waitForFrame((frame) => frame.includes(reviewRow.label))
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

describe("SlashMenu", () => {
  it("renders ordered source headers with cockpit shortcuts and agent hints", async () => {
    const setup = await renderMenu(0)
    const frame = setup.captureCharFrame()

    expect(frame.indexOf("Cockpit")).toBeLessThan(frame.indexOf("Codex"))
    expect(frame).toContain(handoffRow.label)
    expect(frame).toContain(handoffRow.shortcut)
    expect(frame).toContain(reviewRow.label)
    expect(frame).toContain(reviewRow.hint!)

    await destroyMounted(setup.renderer)
  })

  it("applies the highlight style only to the flattened highlighted row", async () => {
    const setup = await renderMenu(0)

    expect(foregroundOf(setup, handoffRow.label)).toBe(paletteColor(DARK_PALETTE.text))
    expect(foregroundOf(setup, reviewRow.label)).toBe(paletteColor(DARK_PALETTE.muted))

    await destroyMounted(setup.renderer)
  })

  it("shows an explicit empty state", async () => {
    const setup = await testRender(
      <CockpitProvider controller={createFakeController()}>
        <SlashMenu groups={[]} highlightedIndex={0} onSelect={() => {}} />
      </CockpitProvider>,
      { width: 64, height: 8 },
    )

    expect(await setup.waitForFrame((frame) => frame.includes(NO_COMMANDS_MATCH))).toContain(NO_COMMANDS_MATCH)
    await destroyMounted(setup.renderer)
  })

  it("activates the highlighted row with the exact supplied object", async () => {
    const selected: MenuRow[] = []
    const setup = await renderMenu(1, (row) => selected.push(row))
    const target = setup.renderer.root.findDescendantById(HIGHLIGHTED_COMMAND_ROW_ID) as Renderable | undefined
    expect(target).toBeDefined()
    target!.processMouseEvent(new MouseEvent(target!, {
      type: "down",
      button: 0,
      x: target!.screenX,
      y: target!.screenY,
      modifiers: { shift: false, alt: false, ctrl: false },
    }))

    expect(selected).toEqual([reviewRow])
    expect(selected[0]).toBe(reviewRow)

    await destroyMounted(setup.renderer)
  })
})
