// Suite: shared statusline segment presentation
// Invariant: core-owned text and order are preserved while fields and separators receive distinct foreground policy.

import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { renderStatusline, type StatuslineSegment } from "../core/statusline.ts"
import { destroyMounted } from "../../test/reactTui.ts"
import { StatuslineSegments } from "./statuslineSegments.tsx"
import { DARK_PALETTE } from "./theme.ts"

function foregroundOf(setup: TestRendererSetup, text: string): string | undefined {
  return setup
    .captureSpans()
    .lines.flatMap((line) => line.spans)
    .find((span) => span.text === text)
    ?.fg.toString()
}

function paletteColor(hex: string): string {
  return RGBA.fromHex(hex).toString()
}

async function renderSegments(segments: readonly StatuslineSegment[]): Promise<TestRendererSetup> {
  const setup = await testRender(
    <text wrapMode="none">
      <StatuslineSegments segments={segments} palette={DARK_PALETTE} />
    </text>,
    { width: 80, height: 1 },
  )
  await setup.renderOnce()
  return setup
}

describe("StatuslineSegments", () => {
  it("applies explicit color only to its field and theme colors to uncolored fields and separators", async () => {
    const setup = await renderSegments([
      { kind: "FOLDER", text: "kitten", color: "#123456", separatorBefore: "" },
      { kind: "BRANCH", text: "main", separatorBefore: " | " },
      { kind: "MODEL", text: "Opus", color: "#ABCDEF", separatorBefore: " / " },
    ])

    expect(setup.captureCharFrame()).toContain("kitten | main / Opus")
    expect(foregroundOf(setup, "kitten")).toBe(paletteColor("#123456"))
    expect(foregroundOf(setup, "main")).toBe(paletteColor(DARK_PALETTE.text))
    expect(foregroundOf(setup, "Opus")).toBe(paletteColor("#ABCDEF"))
    expect(foregroundOf(setup, " | ")).toBe(paletteColor(DARK_PALETTE.muted))
    expect(foregroundOf(setup, " / ")).toBe(paletteColor(DARK_PALETTE.muted))
    expect(setup.captureCharFrame()).not.toContain("\u001b")

    await destroyMounted(setup.renderer)
  })

  it("preserves core-owned order, text, missing-value omission, and width omission", async () => {
    const segments = renderStatusline(
      { separator: " · ", line: [{ kind: "FOLDER", color: "#123456" }, "BRANCH", "MODEL"] },
      { cwd: "/workspace/kitten", branch: null, model: "Opus" },
      6,
    )
    const setup = await renderSegments(segments)

    expect(segments).toEqual([{ kind: "FOLDER", text: "kitten", color: "#123456", separatorBefore: "" }])
    expect(setup.captureCharFrame().trim()).toBe("kitten")

    await destroyMounted(setup.renderer)
  })
})
