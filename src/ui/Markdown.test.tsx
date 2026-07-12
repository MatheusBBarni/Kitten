// Suite: shared Markdown renderer leaf
// Invariant: prose keeps theme styling, multi-block streaming content, and clean selectable text through one leaf.
// Boundary IN: real React mounting, OpenTUI Markdown rendering, theme hooks, syntax parsing, and mouse selection.
// Boundary OUT: role-specific transcript chrome, owned by MessageView.test.tsx; streamed store updates, owned by ConversationView.test.tsx.

import { describe, expect, it } from "bun:test"

import { CodeRenderable, destroyTreeSitterClient, RGBA, type BaseRenderable } from "@opentui/core"
import { createMockMouse, type TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { Markdown } from "./Markdown.tsx"
import { DARK_PALETTE, LIGHT_PALETTE } from "./theme.ts"

const WIDTH = 52
const HEIGHT = 20
const NARROW_WIDTH = 30
const TABLE_BORDER_GLYPHS = /[┌┬┐├┼┤└┴┘│─]/

function paletteColor(hex: string): string {
  return RGBA.fromHex(hex).toString()
}

async function renderMarkdown(content: string, width = WIDTH, height = HEIGHT): Promise<TestRendererSetup> {
  const controller = createFakeController()
  const setup = await testRender(
    <CockpitProvider controller={controller}>
      <Markdown content={content} />
    </CockpitProvider>,
    { width, height },
  )
  return setup
}

function expectAlignedTable(frame: string): void {
  const cellRows = frame.split("\n").filter((row) => row.includes("│"))
  expect(cellRows.length).toBeGreaterThanOrEqual(2)

  const expectedBoundaries = [...cellRows[0]!.matchAll(/│/g)].map((match) => match.index)
  expect(expectedBoundaries.length).toBeGreaterThanOrEqual(3)
  for (const row of cellRows) {
    expect([...row.matchAll(/│/g)].map((match) => match.index)).toEqual(expectedBoundaries)
  }
}

function spanContaining(setup: TestRendererSetup, needle: string) {
  return setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text.includes(needle))
}

function collectCodeRenderables(root: BaseRenderable): CodeRenderable[] {
  const codes = root instanceof CodeRenderable ? [root] : []
  for (const child of root.getChildren()) {
    codes.push(...collectCodeRenderables(child))
  }
  return codes
}

async function destroyMarkdown(setup: TestRendererSetup): Promise<void> {
  await Promise.all(collectCodeRenderables(setup.renderer.root).map((code) => code.highlightingDone))
  await setup.flush()
  await destroyMounted(setup.renderer)
}

describe("Markdown", () => {
  it("styles a heading with the theme accent instead of the reading foreground", async () => {
    await destroyTreeSitterClient()
    const setup = await renderMarkdown("# HEADING_SENTINEL")
    await setup.waitForFrame((frame) => frame.includes("HEADING_SENTINEL"))
    await setup.waitFor(() => {
      const styled = spanContaining(setup, "HEADING_SENTINEL")?.fg.toString() === paletteColor(DARK_PALETTE.accent)
      if (!styled) setup.renderer.requestRender()
      return styled
    })

    const heading = spanContaining(setup, "HEADING_SENTINEL")
    expect(heading?.fg.toString()).toBe(paletteColor(DARK_PALETTE.accent))
    expect(heading?.fg.toString()).not.toBe(paletteColor(DARK_PALETTE.text))

    await destroyMarkdown(setup)
  })

  it("renders strong Markdown with the bold text attribute", async () => {
    const setup = await renderMarkdown("**BOLD_SENTINEL**")
    await setup.waitForFrame((frame) => frame.includes("BOLD_SENTINEL"))

    const strong = spanContaining(setup, "BOLD_SENTINEL")
    expect(strong).toBeDefined()
    expect(strong!.attributes & 1).toBe(1)

    await destroyMarkdown(setup)
  })

  it("keeps heading, paragraph, and fenced code blocks visible together", async () => {
    const content = "# MULTI_HEADING\n\nMULTI_PARAGRAPH\n\n```\nMULTI_CODE\n```"
    const setup = await renderMarkdown(content)
    const frame = await setup.waitForFrame(
      (candidate) =>
        candidate.includes("MULTI_HEADING") &&
        candidate.includes("MULTI_PARAGRAPH") &&
        candidate.includes("MULTI_CODE"),
    )

    expect(frame).toContain("MULTI_HEADING")
    expect(frame).toContain("MULTI_PARAGRAPH")
    expect(frame).toContain("MULTI_CODE")

    expect(collectCodeRenderables(setup.renderer.root).length).toBeGreaterThan(0)

    await destroyMarkdown(setup)
  })

  it("keeps table columns aligned and word-wraps cells after a narrower resize", async () => {
    const content = [
      "| Item | Notes |",
      "| --- | --- |",
      "| Alpha | stable wrapping preserves every important word |",
      "| Beta | short |",
    ].join("\n")
    const setup = await renderMarkdown(content)
    const wide = await setup.waitForFrame((frame) => frame.includes("important") && frame.includes("word"))

    expectAlignedTable(wide)
    const wideTableRows = wide.split("\n").filter((row) => TABLE_BORDER_GLYPHS.test(row)).length

    await actAsync(() => setup.resize(NARROW_WIDTH, HEIGHT))
    const narrow = await setup.waitForFrame(
      (frame) => frame.includes("important") && frame.includes("word") && frame !== wide,
    )

    expectAlignedTable(narrow)
    expect(narrow).not.toContain("…")
    expect(narrow.split("\n").filter((row) => TABLE_BORDER_GLYPHS.test(row)).length).toBeGreaterThan(wideTableRows)

    await destroyMarkdown(setup)
  })

  it("renders an unbalanced fence as legible code without leaking fence markers", async () => {
    const setup = await renderMarkdown("```ts\nconst unfinished = true")
    const frame = await setup.waitForFrame((candidate) => candidate.includes("const unfinished = true"))

    expect(frame).not.toContain("```")

    await destroyMarkdown(setup)
  })

  it("keeps malformed nested and partial-table content legible", async () => {
    const content = [
      "> - **nested content",
      "",
      "| Broken | Table |",
      "| --- | --- |",
      "| retained |",
    ].join("\n")
    const setup = await renderMarkdown(content)
    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("nested content") && candidate.includes("retained"),
    )

    expect(frame).not.toContain("**")
    expect(frame).not.toContain("| retained |")

    await destroyMarkdown(setup)
  })

  it("keeps unsupported task-list text legible without raw checkbox markers", async () => {
    const setup = await renderMarkdown("- [ ] preserve this task\n- [x] keep completed text")
    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("preserve this task") && candidate.includes("keep completed text"),
    )

    expect(frame).not.toContain("[ ]")
    expect(frame).not.toContain("[x]")

    await destroyMarkdown(setup)
  })

  it("keeps unsupported footnote content legible without raw footnote markers", async () => {
    const setup = await renderMarkdown("Claim with a note[^1].\n\n[^1]: Supporting detail.")
    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("Claim with a note") && candidate.includes("Supporting detail."),
    )

    expect(frame).not.toContain("[^1]")

    await destroyMarkdown(setup)
  })

  it("copies only the rendered words selected with the mouse", async () => {
    const words = "copy me cleanly"
    const setup = await renderMarkdown(words)
    const frame = await setup.waitForFrame((candidate) => candidate.includes(words))
    const rows = frame.split("\n")
    const row = rows.findIndex((candidate) => candidate.includes(words))
    const start = rows[row]!.indexOf(words)

    const mouse = createMockMouse(setup.renderer)
    await mouse.drag(start, row, start + words.length, row)
    const selected = setup.renderer.getSelection()?.getSelectedText() ?? ""

    expect(selected).toBe(words)
    expect(selected).not.toMatch(/[│┌┐└┘─█▄▌▸]/)

    await destroyMarkdown(setup)
  })

  it("copies a rendered table row without box-drawing artifacts", async () => {
    const setup = await renderMarkdown("| Left | Right |\n| --- | --- |\n| TABLE_ALPHA | TABLE_BETA |")
    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("TABLE_ALPHA") && candidate.includes("TABLE_BETA"),
    )
    const rows = frame.split("\n")
    const row = rows.findIndex((candidate) => candidate.includes("TABLE_ALPHA"))
    const start = rows[row]!.indexOf("TABLE_ALPHA")
    const end = rows[row]!.indexOf("TABLE_BETA") + "TABLE_BETA".length

    const mouse = createMockMouse(setup.renderer)
    await mouse.drag(start, row, end, row)
    const selected = setup.renderer.getSelection()?.getSelectedText() ?? ""

    expect(selected).toBe("TABLE_ALPHA\tTABLE_BETA")
    expect(selected).not.toMatch(TABLE_BORDER_GLYPHS)

    await destroyMarkdown(setup)
  })

  it("copies fenced code source without line-number or gutter artifacts", async () => {
    const setup = await renderMarkdown("Code sample:\n\n```\nconst alpha = 1\nconst beta = 2\n```")
    await Promise.all(collectCodeRenderables(setup.renderer.root).map((code) => code.highlightingDone))
    setup.renderer.requestRender()
    await setup.flush()
    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("const alpha = 1") && candidate.includes("const beta = 2"),
    )
    const rows = frame.split("\n")
    const first = rows.findIndex((candidate) => candidate.includes("const alpha = 1"))
    const last = rows.findIndex((candidate) => candidate.includes("const beta = 2"))
    const codeColumn = rows[first]!.indexOf("const alpha = 1")

    const mouse = createMockMouse(setup.renderer)
    await mouse.drag(codeColumn, first, codeColumn + "const beta = 2".length, last)
    const selected = setup.renderer.getSelection()?.getSelectedText() ?? ""

    expect(selected).toBe("const alpha = 1\nconst beta = 2")
    expect(selected).not.toMatch(/[│┌┐└┘─█▄▌▸]/)
    for (const line of selected.split("\n")) expect(line).not.toMatch(/^\s*[\d+-]+\s/)

    await destroyMarkdown(setup)
  })

  it("recolors its default foreground when the terminal theme changes", async () => {
    const setup = await renderMarkdown("THEME_SENTINEL")
    await setup.waitForFrame((frame) => frame.includes("THEME_SENTINEL"))
    expect(spanContaining(setup, "THEME_SENTINEL")?.fg.toString()).toBe(paletteColor(DARK_PALETTE.text))

    await actAsync(() => {
      setup.renderer.emit("theme_mode", "light")
    })
    await setup.waitFor(
      () => spanContaining(setup, "THEME_SENTINEL")?.fg.toString() === paletteColor(LIGHT_PALETTE.text),
    )

    expect(spanContaining(setup, "THEME_SENTINEL")?.fg.toString()).toBe(paletteColor(LIGHT_PALETTE.text))

    await destroyMarkdown(setup)
  })
})
