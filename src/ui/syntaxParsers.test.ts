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

  it("resolves Rust and Go canonical labels and aliases to one capability each", () => {
    expect(resolveSyntaxFiletype("rust")).toBe("rust")
    expect(resolveSyntaxFiletype("rs")).toBe("rust")
    expect(resolveSyntaxFiletype("go")).toBe("go")
    expect(resolveSyntaxFiletype("golang")).toBe("go")

    const rust = syntaxParserManifest.capabilities.filter(({ filetype }) => filetype === "rust")
    const go = syntaxParserManifest.capabilities.filter(({ filetype }) => filetype === "go")
    expect(rust).toHaveLength(1)
    expect(rust[0]?.aliases).toEqual(["rs"])
    expect(rust[0]?.parser.aliases).toEqual(["rs"])
    expect(go).toHaveLength(1)
    expect(go[0]?.aliases).toEqual(["golang"])
    expect(go[0]?.parser.aliases).toEqual(["golang"])
  })

  it("resolves OCaml canonical and extension labels to one asset-backed capability", () => {
    expect(resolveSyntaxFiletype("ocaml")).toBe("ocaml")
    expect(resolveSyntaxFiletype("ml")).toBe("ocaml")
    expect(resolveSyntaxFiletype("mli")).toBe("ocaml")

    const ocaml = syntaxParserManifest.capabilities.filter(({ filetype }) => filetype === "ocaml")
    expect(ocaml).toHaveLength(1)
    expect(ocaml[0]?.aliases).toEqual(["ml", "mli"])
    expect(ocaml[0]?.parser.aliases).toEqual(["ml", "mli"])
  })

  it("resolves JSON and Bash labels to complete local capabilities", () => {
    expect(resolveSyntaxFiletype("json")).toBe("json")
    expect(resolveSyntaxFiletype("bash")).toBe("bash")
    expect(resolveSyntaxFiletype("sh")).toBe("bash")
    expect(resolveSyntaxFiletype("shell")).toBe("bash")

    const json = syntaxParserManifest.capabilities.filter(({ filetype }) => filetype === "json")
    const bash = syntaxParserManifest.capabilities.filter(({ filetype }) => filetype === "bash")
    expect(json).toHaveLength(1)
    expect(json[0]?.aliases).toEqual([])
    expect(json[0]?.parser.aliases).toBeUndefined()
    expect(bash).toHaveLength(1)
    expect(bash[0]?.aliases).toEqual(["sh", "shell"])
    expect(bash[0]?.parser.aliases).toEqual(["sh", "shell"])
  })

  it("keeps blocked ReScript labels out of highlighted resolution with a documented fallback", () => {
    for (const label of ["rescript", "res", "resi"]) {
      expect(resolveSyntaxFiletype(label)).toBeUndefined()
    }
    expect(syntaxParserManifest.capabilities.some(({ filetype }) => filetype === "rescript")).toBeFalse()
    expect(syntaxParserManifest.parsers.some(({ filetype }) => filetype === "rescript")).toBeFalse()
    expect(syntaxParserManifest.plaintextFallbacks).toEqual([
      { filetype: "rescript", aliases: ["res", "resi"], reason: "release_gate_unmet" },
    ])
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
      rust: "rust",
      rs: "rust",
      go: "go",
      golang: "go",
      ocaml: "ocaml",
      ml: "ocaml",
      mli: "ocaml",
      json: "json",
      bash: "bash",
      sh: "bash",
      shell: "bash",
    })
  })

  it("keeps filetypes, aliases, and fixtures unique", () => {
    const filetypes = syntaxParserManifest.capabilities.map(({ filetype }) => filetype)
    const aliases = syntaxParserManifest.capabilities.flatMap(({ aliases }) => aliases)
    const fallbackLabels = syntaxParserManifest.plaintextFallbacks.flatMap(({ filetype, aliases }) => [
      filetype,
      ...aliases,
    ])
    const fixtureKeys = syntaxParserManifest.capabilities.flatMap(({ fixtures }) =>
      fixtures.map(({ label, source }) => `${source}:${label}`),
    )

    expect(new Set(filetypes).size).toBe(filetypes.length)
    expect(new Set(aliases).size).toBe(aliases.length)
    expect(new Set([...filetypes, ...aliases]).size).toBe(filetypes.length + aliases.length)
    expect(new Set(fallbackLabels).size).toBe(fallbackLabels.length)
    expect(new Set([...filetypes, ...aliases, ...fallbackLabels]).size).toBe(
      filetypes.length + aliases.length + fallbackLabels.length,
    )
    expect(new Set(fixtureKeys).size).toBe(fixtureKeys.length)
    expect(fixtureKeys.sort()).toEqual(
      [
        "markdown:javascript",
        "markdown:javascriptreact",
        "markdown:js",
        "markdown:jsx",
        "markdown:markdown",
        "markdown:md",
        "markdown:typescript",
        "markdown:typescriptreact",
        "markdown:ts",
        "markdown:tsx",
        "markdown:rust",
        "markdown:rs",
        "diff:rs",
        "markdown:go",
        "markdown:golang",
        "diff:go",
        "markdown:ocaml",
        "markdown:ml",
        "markdown:mli",
        "diff:ml",
        "diff:mli",
        "markdown:json",
        "diff:json",
        "markdown:bash",
        "markdown:sh",
        "markdown:shell",
        "diff:sh",
      ].sort(),
    )
  })

  it("provides Markdown fixtures for every supported label plus extension-backed diff fixtures", () => {
    const fixturesFor = (filetype: string) =>
      syntaxParserManifest.capabilities.find((capability) => capability.filetype === filetype)?.fixtures

    expect(fixturesFor("rust")).toEqual([
      { label: "rust", token: "fn", source: "markdown" },
      { label: "rs", token: "fn", source: "markdown" },
      { label: "rs", token: "fn", source: "diff" },
    ])
    expect(fixturesFor("go")).toEqual([
      { label: "go", token: "func", source: "markdown" },
      { label: "golang", token: "func", source: "markdown" },
      { label: "go", token: "func", source: "diff" },
    ])
    expect(fixturesFor("ocaml")).toEqual([
      { label: "ocaml", token: "let", source: "markdown" },
      { label: "ml", token: "let", source: "markdown" },
      { label: "mli", token: "val", source: "markdown" },
      { label: "ml", token: "let", source: "diff" },
      { label: "mli", token: "val", source: "diff" },
    ])
    expect(fixturesFor("json")).toEqual([
      { label: "json", token: "424242", source: "markdown" },
      { label: "json", token: "424242", source: "diff" },
    ])
    expect(fixturesFor("bash")).toEqual([
      { label: "bash", token: "BASH_SENTINEL", source: "markdown" },
      { label: "sh", token: "SH_SENTINEL", source: "markdown" },
      { label: "shell", token: "SHELL_SENTINEL", source: "markdown" },
      { label: "sh", token: "SH_DIFF_SENTINEL", source: "diff" },
    ])
  })

  it("uses existing local WASM and query assets for every parser option", () => {
    expect(syntaxParserManifest.parsers.map(({ filetype }) => filetype)).toEqual([
      "markdown",
      "markdown_inline",
      "rust",
      "go",
      "ocaml",
      "json",
      "bash",
    ])

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
