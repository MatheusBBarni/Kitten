import { addDefaultParsers, type FiletypeParserOptions } from "@opentui/core"

import goHighlights from "./syntax-assets/go/highlights.scm" with { type: "file" }
import goWasm from "./syntax-assets/go/tree-sitter-go.wasm" with { type: "file" }
import markdownHighlights from "./syntax-assets/markdown/highlights.scm" with { type: "file" }
import markdownInjections from "./syntax-assets/markdown/injections.scm" with { type: "file" }
import markdownWasm from "./syntax-assets/markdown/tree-sitter-markdown.wasm" with { type: "file" }
import markdownInlineHighlights from "./syntax-assets/markdown_inline/highlights.scm" with { type: "file" }
import markdownInlineWasm from "./syntax-assets/markdown_inline/tree-sitter-markdown_inline.wasm" with { type: "file" }
import ocamlHighlights from "./syntax-assets/ocaml/highlights.scm" with { type: "file" }
import ocamlWasm from "./syntax-assets/ocaml/tree-sitter-ocaml.wasm" with { type: "file" }
import rustHighlights from "./syntax-assets/rust/highlights.scm" with { type: "file" }
import rustWasm from "./syntax-assets/rust/tree-sitter-rust.wasm" with { type: "file" }

export interface SyntaxFixture {
  readonly label: string
  readonly token: string
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

const markdownCapability: SyntaxCapability = {
  filetype: "markdown",
  aliases: ["md"],
  parser: markdownParser,
  fixtures: [
    { label: "javascript", token: "const", source: "markdown" },
    { label: "js", token: "const", source: "markdown" },
    { label: "jsx", token: "const", source: "markdown" },
    { label: "javascriptreact", token: "const", source: "markdown" },
    { label: "typescript", token: "interface", source: "markdown" },
    { label: "ts", token: "interface", source: "markdown" },
    { label: "tsx", token: "interface", source: "markdown" },
    { label: "typescriptreact", token: "interface", source: "markdown" },
    { label: "markdown", token: "heading", source: "markdown" },
    { label: "md", token: "heading", source: "markdown" },
  ],
}

const rustCapability: SyntaxCapability = {
  filetype: "rust",
  aliases: ["rs"],
  parser: rustParser,
  fixtures: [
    { label: "rust", token: "fn", source: "markdown" },
    { label: "rs", token: "fn", source: "markdown" },
    { label: "rs", token: "fn", source: "diff" },
  ],
}

const goCapability: SyntaxCapability = {
  filetype: "go",
  aliases: ["golang"],
  parser: goParser,
  fixtures: [
    { label: "go", token: "func", source: "markdown" },
    { label: "golang", token: "func", source: "markdown" },
    { label: "go", token: "func", source: "diff" },
  ],
}

const ocamlCapability: SyntaxCapability = {
  filetype: "ocaml",
  aliases: ["ml", "mli"],
  parser: ocamlParser,
  fixtures: [
    { label: "ocaml", token: "let", source: "markdown" },
    { label: "ml", token: "let", source: "markdown" },
    { label: "mli", token: "val", source: "markdown" },
    { label: "ml", token: "let", source: "diff" },
    { label: "mli", token: "val", source: "diff" },
  ],
}

const rescriptPlaintextFallback: SyntaxPlaintextFallback = {
  filetype: "rescript",
  aliases: ["res", "resi"],
  reason: "release_gate_unmet",
}

/** The sole source of parser assets, aliases, injection labels, and release fixtures. */
export const syntaxParserManifest: SyntaxParserManifest = {
  capabilities: [markdownCapability, rustCapability, goCapability, ocamlCapability],
  plaintextFallbacks: [rescriptPlaintextFallback],
  parsers: [markdownParser, markdownInlineParser, rustParser, goParser, ocamlParser],
}

/** Resolve only an explicitly declared Markdown fence label; never guess a language. */
export function resolveSyntaxFiletype(label: string): string | undefined {
  return MARKDOWN_INFO_STRING_MAP[label]
}

/** Resolve an injected Markdown node to the parser that owns it. */
export function resolveInjectedNodeFiletype(nodeType: string): string | undefined {
  return MARKDOWN_NODE_TYPE_MAP[nodeType]
}

export type SyntaxParserRegistrar = (parsers: FiletypeParserOptions[]) => void

const registeredRegistrars = new WeakSet<SyntaxParserRegistrar>()

/** Register the local parser overrides once, before OpenTUI initializes its shared client. */
export function registerSyntaxParsers(registrar: SyntaxParserRegistrar = addDefaultParsers): void {
  if (registeredRegistrars.has(registrar)) return

  registrar([...syntaxParserManifest.parsers])
  registeredRegistrars.add(registrar)
}
