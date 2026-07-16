import { describe, expect, it } from "bun:test"

import { CodeRenderable, type BaseRenderable } from "@opentui/core"
import { createMockMouse } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { destroyMounted, settleMountedHighlights } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { formatMcpToolCallTitle, ToolCallDiffView, ToolCallRow } from "./ToolCallRow.tsx"
import type { ToolCallRecord } from "../core/types.ts"
import type { SyntaxDiagnostic } from "./syntaxParsers.ts"

function collectCodeRenderables(root: BaseRenderable): CodeRenderable[] {
  const codes = root instanceof CodeRenderable ? [root] : []
  for (const child of root.getChildren()) codes.push(...collectCodeRenderables(child))
  return codes
}

function unified(path: string, before: string, after: string): string {
  return [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1 @@", `-${before}`, `+${after}`].join("\n")
}

function toolRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolCallId: "tool-1",
    kind: "other",
    title: "wait",
    status: "in_progress",
    locations: [],
    ...overrides,
  }
}

describe("ToolCallRow activity labels", () => {
  it("explains a generic wait tool call without exposing it as Tool(wait)", async () => {
    const controller = createFakeController()
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <ToolCallRow record={toolRecord()} />
      </CockpitProvider>,
      { width: 64, height: 8 },
    )

    const frame = await setup.waitForFrame((candidate) => candidate.includes("Waiting for a tool result · running"))

    expect(frame).not.toContain("Tool(wait)")
    await destroyMounted(setup.renderer)
  })

  it("keeps a normal tool's technical label while stating its terminal status", async () => {
    const controller = createFakeController()
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <ToolCallRow record={toolRecord({ kind: "execute", title: "git status", status: "completed" })} />
      </CockpitProvider>,
      { width: 64, height: 8 },
    )

    const frame = await setup.waitForFrame((candidate) => candidate.includes("Run(git status) · done"))

    expect(frame).toContain("Run(git status) · done")
    await destroyMounted(setup.renderer)
  })

  it("shows every MCP path segment as a compact, scan-friendly label", async () => {
    const controller = createFakeController()
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <ToolCallRow record={toolRecord({ kind: "execute", title: "mcp.codex_apps.github.create_issue" })} />
      </CockpitProvider>,
      { width: 64, height: 8 },
    )

    const frame = await setup.waitForFrame((candidate) => candidate.includes("MCP(codex_apps -> github -> create_issue)"))

    expect(frame).toContain("MCP(codex_apps -> github -> create_issue) · running")
    expect(frame).not.toContain("Run(mcp.codex_apps.github.create_issue)")
    await destroyMounted(setup.renderer)
  })

  it("only formats complete MCP tool titles", () => {
    expect(formatMcpToolCallTitle("mcp.kitten-ask-user.ask_user")).toBe("MCP(kitten-ask-user -> ask_user)")
    expect(formatMcpToolCallTitle("mcp.server.function.with.dots")).toBe("MCP(server -> function -> with -> dots)")
    expect(formatMcpToolCallTitle("mcp.kitten-ask-user")).toBeNull()
    expect(formatMcpToolCallTitle("git status")).toBeNull()
  })
})

describe("ToolCallDiffView syntax fallback", () => {
  for (const path of ["src/archive.privateext", "Makefile", ".gitignore"]) {
    it(`keeps ${path} plaintext without guessing a filetype`, async () => {
      const before = "original fallback source"
      const after = "updated fallback source"
      const events: SyntaxDiagnostic[] = []
      const controller = createFakeController()
      const setup = await testRender(
        <CockpitProvider controller={controller}>
          <ToolCallDiffView
            diff={{ path, unified: unified(path, before, after) }}
            diagnosticReporter={(event) => events.push(event)}
          />
        </CockpitProvider>,
        { width: 64, height: 12 },
      )
      const frame = await setup.waitForFrame((candidate) => candidate.includes(after))
      await settleMountedHighlights(setup.renderer)
      const codes = collectCodeRenderables(setup.renderer.root)

      expect(codes.length).toBeGreaterThan(0)
      expect(codes.every(({ filetype }) => filetype === undefined)).toBeTrue()
      expect(frame).toContain(before)
      expect(frame).toContain(after)
      if (path.endsWith("privateext")) {
        expect(events).toContainEqual({ kind: "unknown_label", surface: "diff" })
        expect(JSON.stringify(events)).not.toContain("privateext")
      } else {
        expect(events).toEqual([])
      }

      await destroyMounted(setup.renderer)
    })
  }

  for (const [status, kind] of [
    ["warning", "parser_warning"],
    ["error", "parser_error"],
  ] as const) {
    it(`keeps a known parser ${status} visible and reports only canonical metadata`, async () => {
      const path = "src/lib.rs"
      const before = "fn original_source() {}"
      const after = "fn updated_source() {}"
      const events: SyntaxDiagnostic[] = []
      const controller = createFakeController()
      const setup = await testRender(
        <CockpitProvider controller={controller}>
          <ToolCallDiffView
            diff={{ path, unified: unified(path, before, after) }}
            diagnosticReporter={(event) => events.push(event)}
            parserStatus={() => status}
          />
        </CockpitProvider>,
        { width: 64, height: 12 },
      )
      const frame = await setup.waitForFrame((candidate) => candidate.includes(after))
      await settleMountedHighlights(setup.renderer)
      const codes = collectCodeRenderables(setup.renderer.root)

      expect(codes.length).toBeGreaterThan(0)
      expect(codes.every(({ filetype }) => filetype === undefined)).toBeTrue()
      expect(frame).toContain(before)
      expect(frame).toContain(after)
      expect(events).toContainEqual({ kind, filetype: "rust", surface: "diff" })
      const serialized = JSON.stringify(events)
      expect(serialized).not.toContain(path)
      expect(serialized).not.toContain("original_source")

      const rows = frame.split("\n")
      const first = rows.findIndex((row) => row.includes(before))
      const last = rows.findIndex((row) => row.includes(after))
      const column = rows[first]!.indexOf(before)
      const mouse = createMockMouse(setup.renderer)
      await mouse.drag(column, first, rows[last]!.indexOf(after) + after.length, last)
      expect(setup.renderer.getSelection()?.getSelectedText()).toBe(`${before}\n${after}`)

      await destroyMounted(setup.renderer)
    })
  }
})
