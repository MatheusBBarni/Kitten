import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"

import {
  registerSyntaxParsers,
  resolveInjectedNodeFiletype,
  resolveSyntaxFiletype,
  syntaxParserManifest,
  type SyntaxParserRegistrar,
} from "./syntaxParsers.ts"

describe("syntaxParserManifest", () => {
  it("preserves the baseline JavaScript, TypeScript, and Markdown fence labels", () => {
    expect(resolveSyntaxFiletype("javascript")).toBe("javascript")
    expect(resolveSyntaxFiletype("js")).toBe("javascript")
    expect(resolveSyntaxFiletype("jsx")).toBe("javascriptreact")
    expect(resolveSyntaxFiletype("javascriptreact")).toBe("javascriptreact")
    expect(resolveSyntaxFiletype("typescript")).toBe("typescript")
    expect(resolveSyntaxFiletype("ts")).toBe("typescript")
    expect(resolveSyntaxFiletype("tsx")).toBe("typescriptreact")
    expect(resolveSyntaxFiletype("typescriptreact")).toBe("typescriptreact")
    expect(resolveSyntaxFiletype("markdown")).toBe("markdown")
    expect(resolveSyntaxFiletype("md")).toBe("markdown")
    expect(resolveSyntaxFiletype("unknown")).toBeUndefined()
  })

  it("preserves the Markdown inline node mappings", () => {
    expect(resolveInjectedNodeFiletype("inline")).toBe("markdown_inline")
    expect(resolveInjectedNodeFiletype("pipe_table_cell")).toBe("markdown_inline")
    expect(resolveInjectedNodeFiletype("paragraph")).toBeUndefined()

    const markdown = syntaxParserManifest.parsers.find(({ filetype }) => filetype === "markdown")
    expect(markdown?.injectionMapping?.nodeTypes).toEqual({
      inline: "markdown_inline",
      pipe_table_cell: "markdown_inline",
    })
    expect(markdown?.injectionMapping?.infoStringMap).toEqual({
      javascript: "javascript",
      js: "javascript",
      jsx: "javascriptreact",
      javascriptreact: "javascriptreact",
      typescript: "typescript",
      ts: "typescript",
      tsx: "typescriptreact",
      typescriptreact: "typescriptreact",
      markdown: "markdown",
      md: "markdown",
    })
  })

  it("keeps filetypes, aliases, and fixtures unique", () => {
    const filetypes = syntaxParserManifest.capabilities.map(({ filetype }) => filetype)
    const aliases = syntaxParserManifest.capabilities.flatMap(({ aliases }) => aliases)
    const fixtureLabels = syntaxParserManifest.capabilities.flatMap(({ fixtures }) =>
      fixtures.map(({ label }) => label),
    )

    expect(new Set(filetypes).size).toBe(filetypes.length)
    expect(new Set(aliases).size).toBe(aliases.length)
    expect(new Set([...filetypes, ...aliases]).size).toBe(filetypes.length + aliases.length)
    expect(new Set(fixtureLabels).size).toBe(fixtureLabels.length)
    expect(fixtureLabels.sort()).toEqual(
      [
        "javascript",
        "javascriptreact",
        "js",
        "jsx",
        "markdown",
        "md",
        "typescript",
        "typescriptreact",
        "ts",
        "tsx",
      ].sort(),
    )
  })

  it("uses existing local WASM and query assets for every parser option", () => {
    expect(syntaxParserManifest.parsers.map(({ filetype }) => filetype)).toEqual(["markdown", "markdown_inline"])

    for (const parser of syntaxParserManifest.parsers) {
      const paths = [parser.wasm, ...parser.queries.highlights, ...(parser.queries.injections ?? [])]
      expect(paths.length).toBeGreaterThanOrEqual(2)
      for (const path of paths) {
        expect(path.replaceAll("\\", "/")).toContain("/src/ui/syntax-assets/")
        expect(path.startsWith("http://") || path.startsWith("https://")).toBeFalse()
        expect(existsSync(path)).toBeTrue()
      }
    }
  })

  it("registers the complete parser override exactly once", () => {
    const calls: Parameters<SyntaxParserRegistrar>[0][] = []
    const registrar: SyntaxParserRegistrar = (parsers) => calls.push(parsers)

    registerSyntaxParsers(registrar)
    registerSyntaxParsers(registrar)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual([...syntaxParserManifest.parsers])
  })

  it("keeps injected registrar state isolated", () => {
    let firstCalls = 0
    let secondCalls = 0
    const first: SyntaxParserRegistrar = () => firstCalls++
    const second: SyntaxParserRegistrar = () => secondCalls++

    registerSyntaxParsers(first)
    registerSyntaxParsers(first)
    registerSyntaxParsers(second)
    registerSyntaxParsers(second)

    expect(firstCalls).toBe(1)
    expect(secondCalls).toBe(1)
  })
})
