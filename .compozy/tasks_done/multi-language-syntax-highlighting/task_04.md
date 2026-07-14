---
status: completed
title: "Add JSON and Bash grammar capabilities"
type: frontend
complexity: high
---

# Task 4: Add JSON and Bash grammar capabilities

## Overview

Add JSON and Bash to the shared capability manifest with local assets, explicit aliases, and fixtures that cover Markdown and real diff extensions. This work broadens common configuration and shell readability without introducing another renderer or altering boot behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST add canonical `json` and canonical `bash` with `bash`, `sh`, and `shell` aliases.
- 2. MUST vendor static local WASM and highlight-query assets for JSON and Bash with reviewed provenance.
- 3. MUST map each declared fence label in the shared Markdown injection map and provide stable fixtures.
- 4. MUST prove `.json` and `.sh` diffs use the same capability contract while extensionless and dotfile diffs remain unhighlighted.
- 5. MUST NOT add a second renderer, change `filetypeFor()`, or rewire boot in this task.
</requirements>

## Subtasks

- [x] 4.1 Add reviewed JSON assets and manifest metadata.
- [x] 4.2 Add reviewed Bash assets and alias metadata.
- [x] 4.3 Extend Markdown and diff fixture coverage.
- [x] 4.4 Verify label, copy, and no-guess contracts.

## Implementation Details

Follow the TechSpec **Data Models**, **Integration Points**, and **Testing Approach** sections. Reuse the existing palette, Markdown leaf, and diff extension helper; all language data remains in the manifest.

### Relevant Files

- `src/ui/syntaxParsers.ts` — central capability and injection-map manifest.
- `src/ui/Markdown.tsx` — shared fenced-code render surface.
- `src/ui/ToolCallRow.tsx` — existing `.json` and `.sh` extension handoff to `<diff>`.
- `src/ui/theme.ts` — semantic syntax capture styling.
- `src/ui/Markdown.test.tsx` — renderer, span, copy, and teardown helpers.

### Dependent Files

- `src/ui/syntax-assets/json/` — new JSON WASM and highlight query assets.
- `src/ui/syntax-assets/bash/` — new Bash WASM and highlight query assets.
- `src/ui/syntaxParsers.test.ts` — manifest and alias regression coverage.
- `src/ui/Markdown.test.tsx` — JSON/Bash fence and alias evidence.
- `src/ui/ToolCallRow.test.tsx` — new or extended diff rendering coverage when the shared seam needs direct evidence.

### Related ADRs

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — declared labels and safe fallback.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — static assets and aliases.

## Deliverables

- JSON and Bash manifest capabilities with asset provenance, labels, and fixtures.
- Markdown and diff evidence for JSON, Bash, `sh`, and `shell`.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for fenced and diff content **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] `json` resolves to a complete local capability.
  - [x] `bash`, `sh`, and `shell` resolve to one Bash capability.
  - [x] Injection labels, assets, and fixtures remain unique across the full manifest.
- Integration tests:
  - [x] JSON and Bash canonical/alias fences render sentinel foregrounds distinct from prose after highlighting settles.
  - [x] `.json` and `.sh` diff tokens render highlighted through the shared diff body.
  - [x] Extensionless and dotfile diffs retain the existing unguessed plain behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- JSON and Bash labels behave consistently in Markdown and diffs.
- No fallback or extension heuristic changes source or guesses a language.
