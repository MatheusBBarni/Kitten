---
status: pending
title: "Task 05: Pure file-completion parsing, formatting, and edit tracking"
type: frontend
complexity: medium
---

# Task 05: Pure file-completion parsing, formatting, and edit tracking

## Overview

Extract the deterministic @ completion logic from the future PromptEditor integration into a pure, directly testable module. This task defines predictable token boundaries, local ranking, safe visible reference formatting, Escape suppression rules, and correction-range tracking without touching React, controller I/O, or telemetry storage.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST recognize unquoted @ queries only at a whitespace-delimited token boundary and MUST reject email addresses and embedded @ text.
2. MUST filter and rank safe relative paths case-insensitively while preserving original spelling, basename-prefix priority, lexical ties, and an eight-row display limit.
3. MUST format selected references as plain @ paths when unambiguous and JSON-style quoted/escaped @ paths for whitespace, quotes, or backslashes.
4. MUST define suppression so Escape prevents reopening the same active token until its trigger is removed, cursor leaves, a new token begins, or focus changes.
5. MUST define pure pending-reference range updates so only edits overlapping an accepted reference report one correction; submitted drafts clear pending references without correction.
</requirements>

## Subtasks
- [ ] 5.1 Create pure file-token and path-match helpers.
- [ ] 5.2 Define deterministic result ranking and visible-row limiting.
- [ ] 5.3 Define visible reference formatting for plain and quoted paths.
- [ ] 5.4 Define suppression transition helpers for dismissed tokens.
- [ ] 5.5 Define pending-reference edit-range and correction helpers with direct tests.

## Implementation Details

Create `src/ui/fileCompletion.ts` and colocated tests as the pure seam specified in TechSpec "Data Models" and "Testing Approach". Keep this module independent of OpenTUI renderables and controller contracts so task_06 only orchestrates its state transitions.

### Relevant Files
- `src/ui/PromptEditor.tsx` — existing slash-token parsing and local completion behavior to preserve.
- `src/ui/PromptEditor.test.tsx` — current cursor/input test harness and interaction expectations.
- `.compozy/tasks/file-selector-at/_techspec.md` — authoritative safe formatting, suppression, ranking, and correction lifecycle.
- `src/core/telemetryHeuristics.ts` — example of pure, content-free helper design and direct unit tests.

### Dependent Files
- `src/ui/FileSelector.tsx` — task_04 receives filtered rows from the future integration.
- `src/ui/PromptEditor.tsx` — task_06 imports the helpers and owns their lifecycle.
- `src/telemetry/recorder.ts` — task_06 emits only the boolean correction outcome derived from these helpers.

### Related ADRs
- [ADR-004: Keep @ Completion Local to the Prompt Token](adrs/adr-004.md) — defines trigger, suppression, visible-reference, and local-state behavior.
- [ADR-005: Use Conservative Attributes and Bounded Binary Detection](adrs/adr-005.md) — requires safe path assumptions and no extra filename heuristics in the UI.

## Deliverables
- New pure `src/ui/fileCompletion.ts` helper module.
- New colocated `src/ui/fileCompletion.test.ts` with parser, ranking, formatting, suppression, and correction cases.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for helper behavior exercised through a minimal prompt-composition fixture **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] @ at offset zero and after whitespace returns a token; `name@example.com`, `foo@bar`, and cursor-outside-token do not.
  - [ ] Basename-prefix matches rank before full-path substring matches; case-folded matching preserves original path spelling and lexical tie order.
  - [ ] The visible result subset stops at eight without mutating the complete match list.
  - [ ] Plain, whitespace, quote, and backslash paths produce the required plain or quoted visible reference.
  - [ ] Escape suppression persists for continued typing in the same token and clears only under each specified reset condition.
  - [ ] Insertions before shift a pending range, edits after retain it, overlap reports one correction, and submission clears without reporting.
- Integration tests:
  - [ ] A minimal composition fixture maps a token, candidate list, and selected path through helpers to the exact visible draft reference.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- All @ parsing, formatting, suppression, and correction decisions are deterministic outside React.
- No helper reads files, records telemetry, or retains source content.
