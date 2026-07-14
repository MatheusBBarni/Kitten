---
status: pending
title: "Add OCaml and ReScript grammar capabilities"
type: frontend
complexity: high
---

# Task 3: Add OCaml and ReScript grammar capabilities

## Overview

Add OCaml and ReScript capability records, aliases, assets, and fixtures to the shared syntax contract. ReScript is release-gated: it is only declared highlighted when a compatible, reviewed grammar and query pair passes the same evidence as every other language.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST add canonical `ocaml` with `ml` and `mli` aliases and local reviewed assets.
- 2. MUST add canonical `rescript` with `res` and `resi` aliases only when compatible asset, highlight-query, provenance, and license evidence are available.
- 3. MUST preserve labelled, copy-safe plaintext for ReScript when that release gate cannot be met; it MUST NOT be advertised as highlighted.
- 4. MUST extend the Markdown injection map and extension fixtures without changing no-guess behavior.
- 5. MUST leave compiled-binary proof to the later release-evidence task.
</requirements>

## Subtasks

- [ ] 3.1 Add the OCaml capability, asset provenance, and labels.
- [ ] 3.2 Evaluate and add the ReScript capability only when its release gate is satisfied.
- [ ] 3.3 Extend Markdown and diff fixtures for every supported label.
- [ ] 3.4 Record and verify the unsupported ReScript path if the gate remains unmet.

## Implementation Details

Use the TechSpec **Technical Dependencies**, **Known Risks**, and **Testing Approach** sections. Extend the single manifest and preserve all existing injection mappings; no package, boot, or build-script change belongs here.

### Relevant Files

- `src/ui/syntaxParsers.ts` — shared canonical filetypes, aliases, injection labels, and release fixtures.
- `src/ui/Markdown.test.tsx` — fenced-code renderer and foreground/copy proof.
- `src/ui/ConversationView.test.tsx` — `.ml`, `.mli`, `.res`, and `.resi` extension behavior.
- `src/ui/Markdown.tsx` — existing complete-fence preservation behavior.

### Dependent Files

- `src/ui/syntax-assets/ocaml/` — new OCaml WASM and highlight query assets.
- `src/ui/syntax-assets/rescript/` — new ReScript assets only if the release gate passes.
- `src/ui/syntaxParsers.test.ts` — capability, alias, injection-map, and duplicate-prevention tests.
- `src/ui/Markdown.test.tsx` — OCaml/ReScript rendering and fallback fixtures.
- `src/ui/ConversationView.test.tsx` — OCaml/ReScript diff-extension expectations.

### Related ADRs

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — no unsupported language may be represented as highlighted.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — asset provenance and parser contract.

## Deliverables

- OCaml capability with `ocaml`, `ml`, and `mli` coverage.
- ReScript capability only when it passes the documented asset and release gate, otherwise an explicit plaintext contingency.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for OCaml/ReScript labels, extensions, and fallback **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] OCaml canonical and `ml`/`mli` aliases resolve to one asset-backed capability.
  - [ ] ReScript canonical and `res`/`resi` aliases are present only with reviewed local assets and fixtures.
  - [ ] A blocked ReScript capability has no highlighted manifest entry and retains a documented fallback state.
- Integration tests:
  - [ ] OCaml canonical, `ml`, and `mli` fences render non-prose sentinel foregrounds.
  - [ ] Supported ReScript canonical, `res`, and `resi` fences render non-prose sentinel foregrounds.
  - [ ] `.ml`, `.mli`, `.res`, and `.resi` diffs follow the support gate and unhighlighted fallback remains copy-safe.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- OCaml support is complete and ReScript support is honest about its release status.
- No unsupported ReScript input is silently guessed or mislabeled as highlighted.
