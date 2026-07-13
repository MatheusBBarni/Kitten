// Suite: SlashMenu presentation and activation
// Invariant: supplied groups render in order, one flattened row is highlighted, and activation returns that exact row.
// Boundary IN: real React rendering, OpenTUI layout/palette resolution, and mouse-event dispatch.
// Boundary OUT: menu state and keyboard selection, owned by PromptEditor.test.tsx.

import { describe, expect, it } from "bun:test"

import { MouseEvent, RGBA, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  HIGHLIGHTED_COMMAND_ROW_ID,
  NO_COMMANDS_MATCH,
  SLASH_MENU_ID,
  SLASH_MENU_SCROLLBOX_ID,
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
      <SlashMenu groups={groups} highlightedIndex={highlightedIndex} maxHeight={12} onSelect={onSelect} />
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
    const menu = setup.renderer.root.findDescendantById(SLASH_MENU_ID) as Renderable | undefined

    expect(frame.indexOf("Cockpit")).toBeLessThan(frame.indexOf("Codex"))
    expect(frame).toContain(handoffRow.label)
    expect(frame).toContain(handoffRow.shortcut)
    expect(frame).toContain(reviewRow.label)
    expect(frame).toContain(reviewRow.hint!)
    // Two headings, two rows, and the top/bottom border: the menu must hug
    // its content rather than filling the available terminal height.
    expect(menu?.height).toBe(6)

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
        <SlashMenu groups={[]} highlightedIndex={0} maxHeight={8} onSelect={() => {}} />
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

  it("constrains a long command list to its viewport and scrolls the highlighted row into view", async () => {
    const longRows: MenuRow[] = Array.from({ length: 24 }, (_, index) => ({
      source: "agent" as const,
      name: `command-${index + 1}`,
      label: `/command-${index + 1}`,
    }))
    const setup = await testRender(
      <CockpitProvider controller={createFakeController()}>
        <SlashMenu
          groups={[{ source: "Agent commands", rows: longRows }]}
          highlightedIndex={23}
          maxHeight={6}
          onSelect={() => {}}
        />
      </CockpitProvider>,
      { width: 48, height: 10 },
    )

    const frame = await setup.waitForFrame((value) => value.includes("/command-24"))
    const menu = setup.renderer.root.findDescendantById(SLASH_MENU_ID) as Renderable | undefined
    const scrollbox = setup.renderer.root.findDescendantById(SLASH_MENU_SCROLLBOX_ID) as ScrollBoxRenderable | undefined
    expect(frame.replace(/\n$/, "").split("\n")).toHaveLength(10)
    expect(frame).not.toContain("਀")
    expect(menu?.height).toBe(6)
    // The ScrollBox itself fills the menu interior; OpenTUI reserves one of
    // those rows inside its own viewport for scrollbar machinery.
    expect(scrollbox?.height).toBe(menu!.height - 2)
    expect(scrollbox?.viewport.height).toBe(scrollbox!.height - 1)

    await destroyMounted(setup.renderer)
  })
})
