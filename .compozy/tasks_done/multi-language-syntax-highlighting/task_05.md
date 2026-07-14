---
status: completed
title: "Add Python grammar capability"
type: frontend
complexity: medium
---

# Task 5: Add Python grammar capability

## Overview

Add Python to the completed shared grammar manifest with the `python` and `py` labels, local assets, and stable rendering fixtures. This is a bounded capability increment that must preserve the same Markdown, diff, selection, and fallback contracts as the prior language groups.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST add canonical `python` with `python` and `py` aliases to the shared manifest.
- 2. MUST add reviewed local Python WASM and `highlights.scm` assets through static imports.
- 3. MUST add Python labels to the Markdown injection map and stable Markdown/diff fixtures.
- 4. MUST prove `python` and `py` fences plus a `.py` diff token render distinctly from prose.
- 5. MUST preserve the current extensionless and dotfile no-guess behavior.
</requirements>

## Subtasks

- [x] 5.1 Add Python asset provenance and manifest metadata.
- [x] 5.2 Add Python labels and fixtures to the shared capability contract.
- [x] 5.3 Add fenced-code, diff, copy, and fallback regression evidence.
- [x] 5.4 Run focused manifest and renderer verification.

## Implementation Details

Apply the TechSpec **Core Interfaces**, **Data Models**, and **Testing Approach** sections to the existing manifest. The later self-check task owns compiled-artifact evidence; this task contributes stable Python fixtures only.

### Relevant Files

- `src/ui/syntaxParsers.ts` — shared Python canonical entry, aliases, injection mapping, and fixtures.
- `src/ui/Markdown.test.tsx` — fence rendering, foreground capture, selection, and teardown helpers.
- `src/ui/ConversationView.test.tsx` — existing `filetypeFor("main.py")` contract and diff regression location.
- `src/ui/ToolCallRow.tsx` — shared `.py` diff surface.

### Dependent Files

- `src/ui/syntax-assets/python/` — new Python WASM and highlight query assets.
- `src/ui/syntaxParsers.test.ts` — Python capability and duplicate-prevention tests.
- `src/ui/Markdown.test.tsx` — `python` and `py` fence rendering cases.
- `src/ui/ConversationView.test.tsx` — `.py` diff behavior evidence.

### Related ADRs

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — per-language release contract.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — static local parser assets.

## Deliverables

- Complete Python capability record with reviewed local assets and stable fixtures.
- Python Markdown and diff regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for `python`, `py`, and `.py` behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] `python` and `py` resolve to one complete local capability.
  - [x] Python injection labels and fixture tokens are unique in the manifest.
  - [x] The capability remains absent when its static assets are unavailable.
- Integration tests:
  - [x] `python` and `py` fenced sentinels receive non-prose foregrounds after highlighting settles.
  - [x] A `.py` diff token receives a non-prose foreground through the shared diff renderer.
  - [x] Extensionless and dotfile diffs remain unhighlighted and copy-safe.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Python behaves like every previously declared capability across Markdown and diffs.
- The task provides stable fixture data for later compiled-artifact verification.
