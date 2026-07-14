---
status: completed
title: "Create parser manifest foundation and Markdown override assets"
type: frontend
complexity: high
---

# Task 1: Create parser manifest foundation and Markdown override assets

## Overview

Create the single Kitten-owned source of truth for syntax capabilities and the local Markdown assets needed to override OpenTUI's narrow fenced-code injection map. This establishes deterministic, statically embedded asset handling without changing application boot, renderer wiring, diagnostics, or compiled-artifact checks.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST create one typed `src/ui/syntaxParsers.ts` manifest that owns capability, alias, fixture, and parser-option metadata.
- 2. MUST vendor reviewed Markdown and Markdown-inline WASM/query assets under `src/ui/syntax-assets/` and import them statically with `with { type: "file" }`.
- 3. MUST define a replacement Markdown parser entry that preserves current JavaScript, TypeScript, Markdown, `inline`, and `pipe_table_cell` mappings.
- 4. MUST expose an idempotent registration seam without wiring it into boot or render components in this task.
- 5. MUST NOT use unexported OpenTUI asset paths, runtime downloads, or mutable user configuration.
</requirements>

## Subtasks

- [x] 1.1 Establish the typed capability and fixture contract.
- [x] 1.2 Add reviewed local Markdown override assets with provenance.
- [x] 1.3 Preserve the existing Markdown injection map in the manifest.
- [x] 1.4 Add manifest contract tests and focused verification.

## Implementation Details

Implement the foundation described in the TechSpec **System Architecture** and **Core Interfaces** sections. The manifest must be the only future location for parser assets and aliases; later tasks add capabilities to it rather than creating new renderer-specific maps.

### Relevant Files

- `src/ui/Markdown.tsx` — current shared Markdown leaf whose injection behavior must remain compatible.
- `src/ui/theme.ts` — existing semantic capture styling consumed by every parser.
- `node_modules/@opentui/core/lib/tree-sitter/types.d.ts` — public `FiletypeParserOptions` contract to satisfy.
- `node_modules/@opentui/core/index-d5xqskty.js` — evidence for the current Markdown injection map and override precedence.

### Dependent Files

- `src/ui/syntaxParsers.ts` — new central manifest and registration seam.
- `src/ui/syntax-assets/markdown/` — new Markdown parser/query assets.
- `src/ui/syntax-assets/markdown_inline/` — new inline Markdown parser/query assets.
- `src/ui/syntaxParsers.test.ts` — new pure manifest and registrar contract coverage.

### Related ADRs

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — shared, trustworthy capability boundary.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — manifest and static-asset decision.

## Deliverables

- Typed syntax capability manifest with baseline Markdown override metadata.
- Static local Markdown and Markdown-inline asset pack with provenance notes.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests that preserve existing Markdown behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Baseline JavaScript, TypeScript, and Markdown labels resolve to their existing canonical filetypes.
  - [x] `inline` and `pipe_table_cell` still resolve to `markdown_inline`.
  - [x] Manifest fixtures and aliases are unique and every parser option has local WASM and highlight-query paths.
  - [x] Injected registrar receives the Markdown override exactly once across repeated calls.
- Integration tests:
  - [x] Existing Markdown heading, streaming, selection, and malformed-fence tests remain green without renderer wiring changes.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- One manifest owns the baseline Markdown override without modifying `node_modules`.
- Existing Markdown injection behavior remains intact.
