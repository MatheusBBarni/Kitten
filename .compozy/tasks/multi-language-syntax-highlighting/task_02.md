---
status: pending
title: "Add Rust and Go grammar capabilities"
type: frontend
complexity: high
---

# Task 2: Add Rust and Go grammar capabilities

## Overview

Add the Rust and Go capabilities to the shared manifest using reviewed local grammar assets, explicit aliases, and deterministic fixtures. These languages exercise both Markdown fences and extension-derived diffs without changing boot sequencing or compiled-artifact coverage.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST add canonical `rust` with `rust` and `rs` labels, and canonical `go` with `go` and `golang` labels.
- 2. MUST add local WASM and `highlights.scm` assets for both capabilities through the shared manifest.
- 3. MUST extend the Markdown injection map and fixtures for every declared Rust and Go label.
- 4. MUST prove representative `.rs` and `.go` diffs highlight while extensionless and dotfile diffs keep the current no-guess behavior.
- 5. MUST NOT wire boot, self-check, or standalone-build behavior in this task.
</requirements>

## Subtasks

- [ ] 2.1 Add reviewed Rust assets and manifest capability metadata.
- [ ] 2.2 Add reviewed Go assets and manifest capability metadata.
- [ ] 2.3 Extend Markdown and diff fixtures for canonical labels and aliases.
- [ ] 2.4 Verify manifest, renderer, and copy behavior.

## Implementation Details

Follow the TechSpec **Data Models**, **Integration Points**, and **Testing Approach** sections. Extend the manifest introduced by Task 1; do not create a second language registry or change `filetypeFor()`.

### Relevant Files

- `src/ui/syntaxParsers.ts` — central capability, alias, asset, and fixture manifest.
- `src/ui/Markdown.tsx` — shared fenced-code surface that must preserve source.
- `src/ui/ToolCallRow.tsx` — diff surface; `.rs` and `.go` flow through its existing extension hint.
- `src/ui/Markdown.test.tsx` — real renderer and `captureSpans()` proof seam.
- `src/ui/ConversationView.test.tsx` — current extension/no-guess contract coverage.

### Dependent Files

- `src/ui/syntax-assets/rust/` — new Rust WASM and highlight query assets.
- `src/ui/syntax-assets/go/` — new Go WASM and highlight query assets.
- `src/ui/syntaxParsers.test.ts` — manifest alias, asset, and fixture coverage.
- `src/ui/Markdown.test.tsx` — Rust and Go Markdown rendering coverage.
- `src/ui/ConversationView.test.tsx` — Rust and Go diff-extension coverage.

### Related ADRs

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — support gate and fallback contract.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — static assets and shared aliases.

## Deliverables

- Rust and Go capability records with local assets, aliases, injection labels, and stable fixtures.
- Markdown and diff rendering coverage for both language families.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for Rust and Go fenced and diff content **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] `rust` and `rs` resolve to one Rust capability with local assets and fixtures.
  - [ ] `go` and `golang` resolve to one Go capability with local assets and fixtures.
  - [ ] Neither capability duplicates an existing manifest filetype or alias.
- Integration tests:
  - [ ] Rust canonical and `rs` fences render a sentinel with a non-prose foreground after highlighting settles.
  - [ ] Go canonical and `golang` fences render a sentinel with a non-prose foreground after highlighting settles.
  - [ ] `.rs` and `.go` diff tokens render highlighted while extensionless and dotfile paths remain unguessed.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Rust and Go aliases behave identically in the shared Markdown and diff paths.
- Source remains selectable and copy-safe.
