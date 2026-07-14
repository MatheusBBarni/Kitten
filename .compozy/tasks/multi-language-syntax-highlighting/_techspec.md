# Technical Specification: Multi-Language Syntax Highlighting

## Executive Summary

This specification implements the PRD's **Default-On Code Recognition**, **Documented Language and Label Coverage**, and **Trustworthy Plaintext Fallback** through a Kitten-owned static Tree-sitter parser manifest. The manifest extends OpenTUI's public global parser-registration API before its process-wide client initializes, overrides Markdown's fence-label injection map, and supplies the same statically embedded assets to source runs and Bun standalone binaries.

The primary trade-off is asset ownership versus runtime flexibility. Vendored, version-pinned WASM and highlight-query files increase release maintenance, but produce deterministic offline behavior, a single alias contract, and binary parity. Runtime downloads, separate tokenizers, and per-surface maps are intentionally excluded.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/ui/syntaxParsers.ts` | Declare capabilities, aliases, static asset imports, Markdown injection mapping, fixtures, and idempotent global registration. | The sole owner of language-support metadata. |
| `src/ui/syntax-assets/` | Store reviewed, version-pinned WASM parsers and `.scm` highlight queries, including the Markdown override assets. | Static data only; no runtime downloading. |
| `src/index.ts` | Register syntax parsers after worker configuration and before any cockpit render. | Boot-order guarantee for normal application runs. |
| `src/ui/Markdown.tsx` | Call the idempotent registration guard before constructing `<markdown>`. | Direct-render and test-mount safety; preserves current streaming and normalization behavior. |
| `src/ui/ToolCallRow.tsx` | Call the same guard before constructing `<diff>`. | Keeps extension-derived diff highlighting inside the shared capability contract. |
| `src/app/selfCheck.ts` | Render canonical fixtures and assert non-default foregrounds in the real cockpit. | Proves packaged-artifact parity without user agents or network access. |

### Data Flow

1. Boot configures the embedded OpenTUI worker, then calls `registerSyntaxParsers()` before mounting UI.
2. The static manifest provides OpenTUI parser entries for each canonical filetype and a replacement Markdown entry whose injection map resolves every approved fence label.
3. Markdown and diff leaves invoke the same idempotent guard, covering direct UI tests and any future mount path that bypasses boot.
4. OpenTUI resolves a known label or extension to a parser and returns styled spans through the existing `SyntaxStyle` palette.
5. An unknown label or parser failure leaves the original source renderable as plaintext; a diagnostic contains only safe capability metadata, never prompt or code content.

## Implementation Design

### Core Interfaces

```ts
import type { FiletypeParserOptions } from "@opentui/core"

export interface SyntaxCapability {
  readonly filetype: string
  readonly aliases: readonly string[]
  readonly parser: FiletypeParserOptions
  readonly fixtures: readonly SyntaxFixture[]
}

export interface SyntaxFixture {
  readonly label: string
  readonly token: string
  readonly source: "markdown" | "diff"
}
```

```ts
export type SyntaxDiagnosticKind = "unknown_label" | "parser_unavailable" | "parser_warning" | "parser_error"

export interface SyntaxDiagnostic {
  readonly kind: SyntaxDiagnosticKind
  readonly filetype?: string
  readonly surface: "markdown" | "diff"
}

export type SyntaxDiagnosticReporter = (event: SyntaxDiagnostic) => void
```

Portable contract form for tooling that consumes the same manifest semantics:

```go
type SyntaxCapability struct {
	Filetype   string
	Aliases    []string
	AssetPaths []string
}
```

`registerSyntaxParsers()` is synchronous and idempotent. It passes the manifest's parser entries to `addDefaultParsers()` exactly once per process. The Markdown entry preserves current `inline` and `pipe_table_cell` mapping to `markdown_inline`, retains existing JavaScript/TypeScript/Markdown labels, and adds `rust`/`rs`, `go`/`golang`, `ocaml`/`ml`/`mli`, `rescript`/`res`/`resi`, `json`, `bash`/`sh`/`shell`, and `python`/`py`. Diff uses its existing bare extension hint, so the same aliases cover `rs`, `go`, `ml`, `mli`, `res`, `resi`, `json`, `sh`, and `py` paths without guessing extensionless files.

### Data Models

`SyntaxCapability` is compile-time static data, not user configuration or persisted state. Every entry contains a canonical filetype, aliases, fully local parser assets, and at least one Markdown fixture; language entries also provide a diff fixture when a meaningful file extension exists. A single Markdown override is included in the manifest because OpenTUI uses its injection map—not only parser aliases—to resolve fenced-code labels.

The diagnostic model intentionally excludes source text, line content, paths, prompts, and user identifiers. The default reporter is inert except for development-safe structured logging. It must not enable or alter Kitten's opt-in telemetry setting.

### API Endpoints

None. Kitten is a local terminal application; this feature exposes no HTTP, ACP, configuration, or persistence API.

## Integration Points

| Integration | Design |
| --- | --- |
| OpenTUI Tree-sitter | Use public `addDefaultParsers()` before the shared client initializes. Use `FiletypeParserOptions` with local WASM and highlight-query paths. |
| OpenTUI Markdown | Replace the default Markdown parser entry only to extend its fence-label injection map; preserve existing inline behavior. |
| OpenTUI diff | Continue using `filetypeFor()`; parser aliases resolve legitimate extensions and extensionless/dotfile diffs remain unhighlighted. |
| Bun compilation | Import every asset with `with { type: "file" }`; Bun embeds static imports in standalone executables. Keep the existing explicit worker entry because it is runtime-discovered. |
| Palette and selection | Reuse `useSyntaxStyle()`, current semantic capture scopes, `MARKDOWN_STREAMING`, and selection behavior. No custom colors or code rewriting. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- |
| `src/ui/syntaxParsers.ts` | new | Central capability contract; wrong mappings affect all code surfaces. | Add manifest, static imports, registration guard, and diagnostics seam. |
| `src/ui/syntax-assets/` | new | Reviewed grammar and query artifacts are required for deterministic coverage. | Vendor pinned assets with source and license provenance. |
| `src/index.ts` | modified | Boot order must precede any Tree-sitter client creation. | Call registration after worker configuration and before render. |
| `src/ui/Markdown.tsx` | modified | Direct mounts need the same registration safety. | Invoke guard without changing streaming or normalization. |
| `src/ui/ToolCallRow.tsx` | modified | Diff must use the shared capability contract. | Invoke guard; retain `filetypeFor()` behavior. |
| `src/app/selfCheck.ts` | modified | Current proof covers TypeScript only. | Add canonical language fixtures and fallback assertion hooks. |
| `scripts/build.ts` | reviewed | Worker remains an explicit compile entry; parser files are static imports. | Keep worker entry and prove parser assets are embedded through compiled self-check. |

## Testing Approach

### Unit Tests

- Add `src/ui/syntaxParsers.test.ts` for canonical filetypes, aliases, duplicate prevention, Markdown injection mapping, static fixture completeness, and idempotent registration through an injected registrar.
- Extend `Markdown.test.tsx` with one short fenced fixture per canonical language and alias. Await `CodeRenderable.highlightingDone` and assert a keyword or token foreground differs from prose through `captureSpans()`.
- Keep plaintext cases for unknown labels, missing capability entries, malformed fences, and selection. Assert the original source and declared label remain available and copied text contains no renderer chrome.
- Extend diff coverage with representative file extensions for every capability that has one; retain explicit assertions that extensionless and dotfile paths do not guess a filetype.
- Add diagnostic tests that assert event kind, declared filetype, and surface only; source text must never enter a diagnostic.

### Integration Tests

- Extend the self-check fixture set with one canonical Markdown token for each supported capability and representative diff tokens for extension-backed languages.
- Make `assertSelfCheckHighlights()` report the capability name that rendered with the default foreground, so release failures are actionable without exposing code content.
- Extend `test/build.integration.test.ts` to compile the host artifact and require every self-check fixture token to be present and non-default. This proves static grammar assets and the worker work together in the shipped binary.
- Retain focused renderer teardown helpers and reset the Tree-sitter singleton where needed; the existing suite has known global-client teardown instability, so failure evidence must distinguish feature regressions from inherited harness warnings.

## Development Sequencing

### Build Order

1. Add reviewed parser/query assets and the typed static manifest in `src/ui/syntaxParsers.ts` — no dependencies.
2. Implement the custom Markdown injection map and idempotent `registerSyntaxParsers()` — depends on step 1.
3. Wire the registration guard into boot, Markdown, and diff entry points — depends on step 2.
4. Add content-free diagnostic reporting and fallback contracts — depends on steps 2 and 3.
5. Add manifest, alias, Markdown, diff, fallback, selection, and diagnostic unit coverage — depends on steps 1 through 4.
6. Expand self-check fixtures and compiled-artifact coverage — depends on steps 3 and 5.
7. Document the supported language-label contract and ReScript contingency — depends on step 6.

### Technical Dependencies

- A compatible, license-reviewed WASM parser and highlight query for every declared V1 capability; ReScript remains blocked until this evidence exists.
- The existing exact-pinned `@opentui/core` 0.4.3 public parser-registration contract.
- Bun static asset imports and the existing embedded-worker extraction path.
- No network access, runtime download, or mutable user parser configuration.

## Monitoring and Observability

- Emit content-free `SyntaxDiagnostic` events for unknown labels and parser availability, warning, or error outcomes.
- Development logging may include event kind, canonical filetype, and surface only. It must not include source text, prompt content, or filesystem paths.
- Track test-only release evidence: each capability's alias, Markdown foreground, diff foreground where applicable, fallback copy fidelity, and compiled self-check result.
- Do not add telemetry collection in this feature. Any future usage measurement remains separately opt-in and content-free under Kitten's existing telemetry policy.

## Technical Considerations

### Key Decisions

- **Static manifest over per-surface maps:** one typed source controls aliases, assets, Markdown injection, diffs, tests, and packaging.
- **Global pre-initialization registration:** OpenTUI's client snapshots default parsers during initialization, so registration is boot-ordered and entry-point guarded.
- **Markdown parser override:** aliases alone do not affect Markdown fences; the override extends the injection map while preserving existing mappings.
- **Static asset embedding:** local `with { type: "file" }` imports produce reproducible source and compiled-binary asset resolution.
- **Safe fallback with content-free diagnostics:** rendering continues with original plaintext; diagnostics support debugging without leaking code.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Registration occurs after the singleton starts | Medium | Register during boot before UI mount and guard both code-render entry points. |
| Markdown override regresses existing inline or TypeScript fences | Medium | Preserve all existing injection mappings and include regression fixtures. |
| A static grammar asset is absent from the compiled binary | Medium | Require per-capability compiled self-check evidence. |
| ReScript lacks a compatible, maintainable grammar asset | Medium | Keep its unsupported path plaintext and do not advertise full support until the release gate passes. |
| OpenTUI global-client teardown creates flaky tests | High | Use existing teardown helpers, targeted reruns, and explicit singleton resets. |

## Architecture Decision Records

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — Defines trustworthy shared coverage and no-guess fallback.
- [ADR-002: Default-on trustworthy code recognition](adrs/adr-002.md) — Makes verified code recognition default-on and accessible beyond color.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — Uses a Kitten-owned static manifest, local assets, and OpenTUI global registration before client initialization.
