---
status: completed
title: "Add content-free diagnostics and safe fallback contracts"
type: frontend
complexity: medium
---

# Task 7: Add content-free diagnostics and safe fallback contracts

## Overview

Add a structured, content-free diagnostic seam for unknown labels and parser availability, warning, and error outcomes. Make the fallback contract explicit across complete Markdown fences and diffs: users retain labelled, bounded, selectable source rather than a blank block, guessed language, or leaked content in diagnostics.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST expose diagnostics containing only kind, optional canonical filetype, and `markdown` or `diff` surface.
- 2. MUST NOT emit code, raw unknown labels, prompt content, paths, user identifiers, session identifiers, or raw parser error text.
- 3. MUST render unknown, unavailable, warning, and error cases as readable plaintext without source rewriting or language guessing.
- 4. MUST preserve the original label and verbatim source for complete unknown or unavailable fences; reconcile any malformed-fence normalization that conflicts with this contract.
- 5. MUST NOT enable telemetry or change the existing opt-in telemetry policy.
</requirements>

## Subtasks

- [ ] 7.1 Define content-free diagnostic events and reporter injection.
- [ ] 7.2 Establish Markdown unknown/unavailable fallback behavior.
- [ ] 7.3 Establish diff unknown/unavailable fallback behavior.
- [ ] 7.4 Add pure and rendered fallback/copy regression coverage.

## Implementation Details

Apply the TechSpec **Data Models**, **Monitoring and Observability**, and **Known Risks** sections. Use the manifest as the diagnostic metadata owner; do not create persistence, telemetry, or a second highlighter. Treat the existing unmatched-fence opener removal as a known compatibility edge case that needs explicit user-contract evidence.

### Relevant Files

- `src/ui/syntaxParsers.ts` — capability-state and diagnostic metadata seam.
- `src/ui/Markdown.tsx` — complete-fence preservation and plaintext fallback surface.
- `src/ui/ToolCallRow.tsx` — diff fallback and no-guess surface.
- `src/ui/Markdown.test.tsx` — real renderer, selection, and copy test helpers.
- `test/reactTui.ts` — highlight-settling and safe renderer teardown helpers.

### Dependent Files

- `src/ui/syntaxParsers.ts` — diagnostic kinds, reporter, and safe report helpers.
- `src/ui/syntaxParsers.test.ts` — pure metadata and content-exclusion tests.
- `src/ui/Markdown.test.tsx` — complete-fence fallback and copied-source tests.
- `src/ui/ToolCallRow.test.tsx` — diff fallback and diagnostic surface tests.

### Related ADRs

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — fail closed to safe plaintext.
- [ADR-002: Default-on trustworthy code recognition](adrs/adr-002.md) — users must retain readable labels and source.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — content-free diagnostics and no runtime downloads.

## Deliverables

- Content-free diagnostic event contract and injected reporter seam.
- Explicit Markdown and diff fallback behavior for unknown and failed capabilities.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for rendered source preservation and safe copy **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] An unknown fence emits `unknown_label` with Markdown surface and no filetype or source text.
  - [ ] An unavailable known capability emits `parser_unavailable` with only its canonical filetype and surface.
  - [ ] Synthetic warning and error events expose their kind without serializing code, labels, paths, or raw error text.
- Integration tests:
  - [ ] Complete unknown and unavailable fences remain bounded, labelled, visible, and byte-for-byte copy-safe.
  - [ ] Unknown diff extensions, extensionless paths, and `.gitignore` remain plaintext without a guessed filetype.
  - [ ] An injected known diff failure leaves original diff source visible and reports only safe diagnostic metadata.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Fallback never blanks, guesses, or mutates complete source.
- Diagnostics are useful for development without exposing content or enabling telemetry.
