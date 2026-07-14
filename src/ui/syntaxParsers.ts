import { addDefaultParsers, type FiletypeParserOptions } from "@opentui/core"
import { existsSync } from "node:fs"

import bashHighlights from "./syntax-assets/bash/highlights.scm" with { type: "file" }
import bashWasm from "./syntax-assets/bash/tree-sitter-bash.wasm" with { type: "file" }
import goHighlights from "./syntax-assets/go/highlights.scm" with { type: "file" }
import goWasm from "./syntax-assets/go/tree-sitter-go.wasm" with { type: "file" }
import jsonHighlights from "./syntax-assets/json/highlights.scm" with { type: "file" }
import jsonWasm from "./syntax-assets/json/tree-sitter-json.wasm" with { type: "file" }
import markdownHighlights from "./syntax-assets/markdown/highlights.scm" with { type: "file" }
import markdownInjections from "./syntax-assets/markdown/injections.scm" with { type: "file" }
import markdownWasm from "./syntax-assets/markdown/tree-sitter-markdown.wasm" with { type: "file" }
import markdownInlineHighlights from "./syntax-assets/markdown_inline/highlights.scm" with { type: "file" }
import markdownInlineWasm from "./syntax-assets/markdown_inline/tree-sitter-markdown_inline.wasm" with { type: "file" }
import ocamlHighlights from "./syntax-assets/ocaml/highlights.scm" with { type: "file" }
import ocamlWasm from "./syntax-assets/ocaml/tree-sitter-ocaml.wasm" with { type: "file" }
import pythonHighlights from "./syntax-assets/python/highlights.scm" with { type: "file" }
import pythonWasm from "./syntax-assets/python/tree-sitter-python.wasm" with { type: "file" }
import rustHighlights from "./syntax-assets/rust/highlights.scm" with { type: "file" }
import rustWasm from "./syntax-assets/rust/tree-sitter-rust.wasm" with { type: "file" }

export interface SyntaxFixture {
  readonly label: string
  readonly token: string
  readonly content: string
  readonly source: "markdown" | "diff"
}

export interface SyntaxCapability {
  readonly filetype: string
  readonly aliases: readonly string[]
  readonly parser: FiletypeParserOptions
  readonly fixtures: readonly SyntaxFixture[]
}

export interface SyntaxParserManifest {
  readonly capabilities: readonly SyntaxCapability[]
  readonly plaintextFallbacks: readonly SyntaxPlaintextFallback[]
  readonly parsers: readonly FiletypeParserOptions[]
}

export interface SyntaxPlaintextFallback {
  readonly filetype: string
  readonly aliases: readonly string[]
  readonly reason: "release_gate_unmet"
}

export type SyntaxDiagnosticKind = "unknown_label" | "parser_unavailable" | "parser_warning" | "parser_error"
export type SyntaxSurface = "markdown" | "diff"

export interface SyntaxDiagnostic {
  readonly kind: SyntaxDiagnosticKind
  readonly filetype?: string
  readonly surface: SyntaxSurface
}

export type SyntaxDiagnosticReporter = (event: SyntaxDiagnostic) => void
export type SyntaxParserStatus = "available" | "unavailable" | "warning" | "error"
export type SyntaxParserStatusResolver = (filetype: string, surface: SyntaxSurface) => SyntaxParserStatus

export interface SyntaxPresentation {
  readonly filetype: string | undefined
  readonly fallback: boolean
}

export type SyntaxAssetAvailability = (path: string) => boolean

/** Keep Python outside the advertised manifest when either reviewed local asset is unavailable. */
export function createPythonCapability(
  assetAvailable: SyntaxAssetAvailability = existsSync,
): SyntaxCapability | undefined {
  if (!assetAvailable(pythonWasm) || !assetAvailable(pythonHighlights)) return undefined

  const parser: FiletypeParserOptions = {
    filetype: "python",
    aliases: ["py"],
    queries: {
      highlights: [pythonHighlights],
    },
    wasm: pythonWasm,
  }

  return {
    filetype: "python",
    aliases: ["py"],
    parser,
    fixtures: [
      {
        label: "python",
        token: "PythonSelfCheck",
        content: "class PythonSelfCheck: pass",
        source: "markdown",
      },
      { label: "py", token: "PySelfCheck", content: "class PySelfCheck: pass", source: "markdown" },
      { label: "py", token: "PythonDiffSelfCheck", content: "class PythonDiffSelfCheck: pass", source: "diff" },
    ],
  }
}

const pythonCapability = createPythonCapability()

const MARKDOWN_NODE_TYPE_MAP: Readonly<Record<string, string>> = {
  inline: "markdown_inline",
  pipe_table_cell: "markdown_inline",
}

const MARKDOWN_INFO_STRING_MAP: Readonly<Record<string, string>> = {
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
  ...(pythonCapability === undefined ? {} : { python: "python", py: "python" }),
}

const markdownParser: FiletypeParserOptions = {
  filetype: "markdown",
  queries: {
    highlights: [markdownHighlights],
    injections: [markdownInjections],
  },
  wasm: markdownWasm,
  injectionMapping: {
    nodeTypes: MARKDOWN_NODE_TYPE_MAP,
    infoStringMap: MARKDOWN_INFO_STRING_MAP,
  },
}

const markdownInlineParser: FiletypeParserOptions = {
  filetype: "markdown_inline",
  queries: {
    highlights: [markdownInlineHighlights],
  },
  wasm: markdownInlineWasm,
}

const rustParser: FiletypeParserOptions = {
  filetype: "rust",
  aliases: ["rs"],
  queries: {
    highlights: [rustHighlights],
  },
  wasm: rustWasm,
}

const goParser: FiletypeParserOptions = {
  filetype: "go",
  aliases: ["golang"],
  queries: {
    highlights: [goHighlights],
  },
  wasm: goWasm,
}

const ocamlParser: FiletypeParserOptions = {
  filetype: "ocaml",
  aliases: ["ml", "mli"],
  queries: {
    highlights: [ocamlHighlights],
  },
  wasm: ocamlWasm,
}

const jsonParser: FiletypeParserOptions = {
  filetype: "json",
  queries: {
    highlights: [jsonHighlights],
  },
  wasm: jsonWasm,
}

const bashParser: FiletypeParserOptions = {
  filetype: "bash",
  aliases: ["sh", "shell"],
  queries: {
    highlights: [bashHighlights],
  },
  wasm: bashWasm,
}

const markdownCapability: SyntaxCapability = {
  filetype: "markdown",
  aliases: ["md"],
  parser: markdownParser,
  fixtures: [
    { label: "javascript", token: "JavaScriptSelfCheck", content: "const JavaScriptSelfCheck = true", source: "markdown" },
    { label: "js", token: "JsSelfCheck", content: "const JsSelfCheck = true", source: "markdown" },
    { label: "jsx", token: "JsxSelfCheck", content: "const JsxSelfCheck = true", source: "markdown" },
    {
      label: "javascriptreact",
      token: "JavaScriptReactSelfCheck",
      content: "const JavaScriptReactSelfCheck = true",
      source: "markdown",
    },
    {
      label: "typescript",
      token: "TypeScriptSelfCheck",
      content: "interface TypeScriptSelfCheck { ready: boolean }",
      source: "markdown",
    },
    { label: "ts", token: "TsSelfCheck", content: "interface TsSelfCheck { ready: boolean }", source: "markdown" },
    { label: "tsx", token: "TsxSelfCheck", content: "interface TsxSelfCheck { ready: boolean }", source: "markdown" },
    {
      label: "typescriptreact",
      token: "TypeScriptReactSelfCheck",
      content: "interface TypeScriptReactSelfCheck { ready: boolean }",
      source: "markdown",
    },
    { label: "markdown", token: "MarkdownSelfCheck", content: "# MarkdownSelfCheck", source: "markdown" },
    { label: "md", token: "MdSelfCheck", content: "# MdSelfCheck", source: "markdown" },
  ],
}

const rustCapability: SyntaxCapability = {
  filetype: "rust",
  aliases: ["rs"],
  parser: rustParser,
  fixtures: [
    { label: "rust", token: "RustSelfCheck", content: "fn RustSelfCheck() {}", source: "markdown" },
    { label: "rs", token: "RsSelfCheck", content: "fn RsSelfCheck() {}", source: "markdown" },
    { label: "rs", token: "RustDiffSelfCheck", content: "fn RustDiffSelfCheck() {}", source: "diff" },
  ],
}

const goCapability: SyntaxCapability = {
  filetype: "go",
  aliases: ["golang"],
  parser: goParser,
  fixtures: [
    { label: "go", token: "GoSelfCheck", content: "func GoSelfCheck() {}", source: "markdown" },
    { label: "golang", token: "GolangSelfCheck", content: "func GolangSelfCheck() {}", source: "markdown" },
    { label: "go", token: "GoDiffSelfCheck", content: "func GoDiffSelfCheck() {}", source: "diff" },
  ],
}

const ocamlCapability: SyntaxCapability = {
  filetype: "ocaml",
  aliases: ["ml", "mli"],
  parser: ocamlParser,
  fixtures: [
    { label: "ocaml", token: "ocamlSelfCheck", content: "let ocamlSelfCheck = 1", source: "markdown" },
    { label: "ml", token: "mlSelfCheck", content: "let mlSelfCheck = 1", source: "markdown" },
    { label: "mli", token: "mliSelfCheck", content: "val mliSelfCheck : int", source: "markdown" },
    { label: "ml", token: "ocamlDiffSelfCheck", content: "let ocamlDiffSelfCheck = 1", source: "diff" },
    { label: "mli", token: "mliDiffSelfCheck", content: "val mliDiffSelfCheck : int", source: "diff" },
  ],
}

const jsonCapability: SyntaxCapability = {
  filetype: "json",
  aliases: [],
  parser: jsonParser,
  fixtures: [
    { label: "json", token: "JsonSelfCheck", content: "{\"JsonSelfCheck\": 424242}", source: "markdown" },
    { label: "json", token: "JsonDiffSelfCheck", content: "{\"JsonDiffSelfCheck\": 424243}", source: "diff" },
  ],
}

const bashCapability: SyntaxCapability = {
  filetype: "bash",
  aliases: ["sh", "shell"],
  parser: bashParser,
  fixtures: [
    { label: "bash", token: "BashSelfCheck", content: "BashSelfCheck=value", source: "markdown" },
    { label: "sh", token: "ShSelfCheck", content: "ShSelfCheck=value", source: "markdown" },
    { label: "shell", token: "ShellSelfCheck", content: "ShellSelfCheck=value", source: "markdown" },
    { label: "sh", token: "BashDiffSelfCheck", content: "BashDiffSelfCheck=value", source: "diff" },
  ],
}

const rescriptPlaintextFallback: SyntaxPlaintextFallback = {
  filetype: "rescript",
  aliases: ["res", "resi"],
  reason: "release_gate_unmet",
}

/** The sole source of parser assets, aliases, injection labels, and release fixtures. */
export const syntaxParserManifest: SyntaxParserManifest = {
  capabilities: [
    markdownCapability,
    rustCapability,
    goCapability,
    ocamlCapability,
    jsonCapability,
    bashCapability,
    ...(pythonCapability === undefined ? [] : [pythonCapability]),
  ],
  plaintextFallbacks: [rescriptPlaintextFallback],
  parsers: [
    markdownParser,
    markdownInlineParser,
    rustParser,
    goParser,
    ocamlParser,
    jsonParser,
    bashParser,
    ...(pythonCapability === undefined ? [] : [pythonCapability.parser]),
  ],
}

const SYNTAX_DIAGNOSTIC_KINDS: ReadonlySet<string> = new Set<SyntaxDiagnosticKind>([
  "unknown_label",
  "parser_unavailable",
  "parser_warning",
  "parser_error",
])
const SYNTAX_DIAGNOSTIC_SURFACES: ReadonlySet<string> = new Set<SyntaxSurface>(["markdown", "diff"])
const CANONICAL_DIAGNOSTIC_FILETYPES: ReadonlySet<string> = new Set([
  ...Object.values(MARKDOWN_NODE_TYPE_MAP),
  ...Object.values(MARKDOWN_INFO_STRING_MAP),
  ...syntaxParserManifest.plaintextFallbacks.map(({ filetype }) => filetype),
])

/** Resolve only an explicitly declared Markdown fence label; never guess a language. */
export function resolveSyntaxFiletype(label: string): string | undefined {
  return MARKDOWN_INFO_STRING_MAP[label]
}

/** Resolve an injected Markdown node to the parser that owns it. */
export function resolveInjectedNodeFiletype(nodeType: string): string | undefined {
  return MARKDOWN_NODE_TYPE_MAP[nodeType]
}

function resolvePlaintextFallbackFiletype(label: string): string | undefined {
  return syntaxParserManifest.plaintextFallbacks.find(
    ({ filetype, aliases }) => filetype === label || aliases.includes(label),
  )?.filetype
}

/** Invoke an injected reporter with a newly constructed, allowlisted event only. */
export function reportSyntaxDiagnostic(
  reporter: SyntaxDiagnosticReporter | undefined,
  event: SyntaxDiagnostic,
): void {
  if (reporter === undefined) return
  if (!SYNTAX_DIAGNOSTIC_KINDS.has(event.kind) || !SYNTAX_DIAGNOSTIC_SURFACES.has(event.surface)) return
  const filetype =
    event.filetype !== undefined && CANONICAL_DIAGNOSTIC_FILETYPES.has(event.filetype)
      ? event.filetype
      : undefined
  const safeEvent: SyntaxDiagnostic =
    filetype === undefined
      ? { kind: event.kind, surface: event.surface }
      : { kind: event.kind, filetype, surface: event.surface }
  try {
    reporter(safeEvent)
  } catch {
    // Diagnostics must never break the reading surface or become an implicit logger.
  }
}

/** Resolve an explicit label to highlighting or a content-preserving plaintext fallback. */
export function resolveSyntaxPresentation(
  label: string,
  surface: SyntaxSurface,
  reporter?: SyntaxDiagnosticReporter,
  parserStatus: SyntaxParserStatusResolver = () => "available",
): SyntaxPresentation {
  const unavailableFiletype = resolvePlaintextFallbackFiletype(label)
  if (unavailableFiletype !== undefined) {
    reportSyntaxDiagnostic(reporter, {
      kind: "parser_unavailable",
      filetype: unavailableFiletype,
      surface,
    })
    return { filetype: undefined, fallback: true }
  }

  const filetype = resolveSyntaxFiletype(label)
  if (filetype === undefined) {
    reportSyntaxDiagnostic(reporter, { kind: "unknown_label", surface })
    return { filetype: undefined, fallback: true }
  }

  let status: SyntaxParserStatus
  try {
    status = parserStatus(filetype, surface)
  } catch {
    status = "error"
  }
  if (status === "available") return { filetype, fallback: false }

  const kind: SyntaxDiagnosticKind =
    status === "unavailable"
      ? "parser_unavailable"
      : status === "warning"
        ? "parser_warning"
        : "parser_error"
  reportSyntaxDiagnostic(reporter, { kind, filetype, surface })
  return { filetype: undefined, fallback: true }
}

export type SyntaxParserRegistrar = (parsers: FiletypeParserOptions[]) => void

const registeredRegistrars = new WeakSet<SyntaxParserRegistrar>()

/** Register the local parser overrides once, before OpenTUI initializes its shared client. */
export function registerSyntaxParsers(registrar: SyntaxParserRegistrar = addDefaultParsers): void {
  if (registeredRegistrars.has(registrar)) return

  registrar([...syntaxParserManifest.parsers])
  registeredRegistrars.add(registrar)
}
