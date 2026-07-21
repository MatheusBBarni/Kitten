// Suite: FileSelector presentation
// Invariant: already-safe relative paths and owner-selected status render without owning discovery or navigation.
// Boundary IN: real React rendering, OpenTUI layout, and palette resolution.
// Boundary OUT: discovery, filtering, mutable completion state, and keyboard dispatch.

import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  FILE_SELECTOR_EMPTY,
  FILE_SELECTOR_LOADING,
  FILE_SELECTOR_READY_ID,
  FILE_SELECTOR_UNAVAILABLE,
  FileSelector,
  HIGHLIGHTED_FILE_ROW_ID,
  MAX_VISIBLE_FILE_ROWS,
  type FileSelectorProps,
} from "./FileSelector.tsx"
import { DARK_PALETTE } from "./theme.ts"

const readyPaths = ["src/client/index.ts", "src/server/index.ts", "src/ui/PromptEditor.tsx"]

async function renderSelector(props: FileSelectorProps, height = 16): Promise<TestRendererSetup> {
  const setup = await testRender(
    <CockpitProvider controller={createFakeController()}>
      <FileSelector {...props} />
    </CockpitProvider>,
    { width: 72, height },
  )
  await setup.renderOnce()
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

describe("FileSelector", () => {
  it("shows concise loading feedback without an empty selector border", async () => {
    const setup = await renderSelector({ status: "loading", paths: [], highlightedIndex: 0 })

    expect(setup.captureCharFrame()).toContain(FILE_SELECTOR_LOADING)
    expect(setup.renderer.root.findDescendantById(FILE_SELECTOR_READY_ID)).toBeUndefined()
    expect(setup.renderer.root.findDescendantById(HIGHLIGHTED_FILE_ROW_ID)).toBeUndefined()

    await destroyMounted(setup.renderer)
  })

  it("renders complete duplicate-basename paths with exactly one visible highlight", async () => {
    const setup = await renderSelector({ status: "ready", paths: readyPaths, highlightedIndex: 1 })
    const frame = setup.captureCharFrame()

    expect(frame).toContain("src/client/index.ts")
    expect(frame).toContain("src/server/index.ts")
    expect(foregroundOf(setup, "src/client/index.ts")).toBe(paletteColor(DARK_PALETTE.muted))
    expect(foregroundOf(setup, "src/server/index.ts")).toBe(paletteColor(DARK_PALETTE.text))
    expect(foregroundOf(setup, "src/ui/PromptEditor.tsx")).toBe(paletteColor(DARK_PALETTE.muted))
    expect(setup.renderer.root.findDescendantById(HIGHLIGHTED_FILE_ROW_ID)).toBeDefined()

    await destroyMounted(setup.renderer)
  })

  it("distinguishes empty and unavailable states without selectable rows", async () => {
    for (const [status, message] of [
      ["empty", FILE_SELECTOR_EMPTY],
      ["unavailable", FILE_SELECTOR_UNAVAILABLE],
    ] as const) {
      const setup = await renderSelector({ status, paths: [], highlightedIndex: 0 })
      const frame = setup.captureCharFrame()

      expect(frame).toContain(message)
      expect(setup.renderer.root.findDescendantById(FILE_SELECTOR_READY_ID)).toBeUndefined()
      expect(setup.renderer.root.findDescendantById(HIGHLIGHTED_FILE_ROW_ID)).toBeUndefined()

      await destroyMounted(setup.renderer)
    }
  })

  it("renders no more than eight supplied candidates", async () => {
    const paths = Array.from({ length: MAX_VISIBLE_FILE_ROWS + 2 }, (_, index) => `src/path-${index + 1}.ts`)
    const setup = await renderSelector({ status: "ready", paths, highlightedIndex: 0 })
    const frame = setup.captureCharFrame()

    for (const path of paths.slice(0, MAX_VISIBLE_FILE_ROWS)) expect(frame).toContain(path)
    for (const path of paths.slice(MAX_VISIBLE_FILE_ROWS)) expect(frame).not.toContain(path)

    await destroyMounted(setup.renderer)
  })

  it("keeps every selector status visible above a prompt-sized owner", async () => {
    const cases: readonly [FileSelectorProps, string][] = [
      [{ status: "loading", paths: [], highlightedIndex: 0 }, FILE_SELECTOR_LOADING],
      [{ status: "ready", paths: ["src/ui/FileSelector.tsx"], highlightedIndex: 0 }, "src/ui/FileSelector.tsx"],
      [{ status: "empty", paths: [], highlightedIndex: 0 }, FILE_SELECTOR_EMPTY],
      [{ status: "unavailable", paths: [], highlightedIndex: 0 }, FILE_SELECTOR_UNAVAILABLE],
    ]

    for (const [props, visibleText] of cases) {
      const setup = await testRender(
        <CockpitProvider controller={createFakeController()}>
          <box style={{ height: 8, flexDirection: "column" }}>
            <FileSelector {...props} />
            <box style={{ height: 3, border: true }}>
              <text>Prompt owner</text>
            </box>
          </box>
        </CockpitProvider>,
        { width: 72, height: 10 },
      )
      const frame = await setup.waitForFrame((value) => value.includes(visibleText) && value.includes("Prompt owner"))

      expect(frame.indexOf(visibleText)).toBeLessThan(frame.indexOf("Prompt owner"))
      await destroyMounted(setup.renderer)
    }
  })
})
