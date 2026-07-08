---
status: completed
title: "Deterministic hand-off bundle assembler and secret redactor"
type: backend
complexity: medium
dependencies:
  - task_02
---

# Task 06: Deterministic hand-off bundle assembler and secret redactor

## Overview
Implement the pure, deterministic assembly of a hand-off bundle from a `SessionState` (transcript excerpt, referenced file set, pending diffs) and a secret redactor that strips credentials before the bundle is ever shown.
This is the wedge's core logic and a flagged prototype risk: bundle quality decides whether the hand-off sells, so it must be accurate and heavily tested.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST implement the `BundleAssembler` interface (TechSpec "Core Interfaces") with a `DeterministicAssembler` that produces a `HandoffBundle` from a `SessionState` for a target agent.
- MUST derive the referenced file set from tool-call `locations` and the pending diffs from `edit`-kind tool calls, per the TechSpec data model.
- MUST produce a bounded transcript excerpt (no unbounded full-transcript dump) suitable for a preview.
- MUST implement a `SecretRedactor` that removes common secret patterns from bundle text and diffs and reports a redaction count.
- MUST be pure (no I/O, no ACP or UI imports) so it is unit-testable and swappable for the Phase 2 LLM assembler behind the same interface (ADR-002).
</requirements>

## Subtasks
- [x] 6.1 Implement `DeterministicAssembler` building the referenced file set and pending diffs
- [x] 6.2 Produce a bounded transcript excerpt for the `continue` intent
- [x] 6.3 Implement the `SecretRedactor` pattern scan over text and diff content
- [x] 6.4 Return a `redactionCount` and apply redaction before the bundle is emitted
- [x] 6.5 Cover assembly and redaction with fixtures including embedded-secret and empty cases

## Implementation Details
Create the pure assembler and redactor. See TechSpec "Core Interfaces" (`BundleAssembler`, `HandoffBundle`) and ADR-002 (deterministic-now, LLM-later behind the same interface). Keep the interface tiny so the Phase 2 implementation is a drop-in.

### Relevant Files
- `src/core/bundleAssembler.ts` — new; `BundleAssembler` + `DeterministicAssembler`
- `src/core/secretRedactor.ts` — new; pattern-based redaction
- `src/core/bundleAssembler.test.ts`, `src/core/secretRedactor.test.ts` — new; tests

### Dependent Files
- `src/app/handoff.ts` (task_12) — invokes the assembler and redactor during a hand-off

### Related ADRs
- [ADR-002: Validation-First Thin Slice for V1](adrs/adr-002.md) — deterministic bundle; strategy seam for later LLM curation
- [ADR-003: Layered Architecture with an ACP Anti-Corruption Layer](adrs/adr-003.md) — pure core, no I/O

## Deliverables
- Deterministic bundle assembler and secret redactor behind the `BundleAssembler` interface
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test assembling a bundle from a fixture `SessionState` end to end **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A session with one `read` and one `edit` tool call yields two referenced files with correct `reason` and one pending diff
  - [x] A session with no `edit` tool calls yields an empty `pendingDiffs` array
  - [x] The transcript excerpt is bounded (does not exceed the configured size for a long transcript)
  - [x] An API-key-shaped token in message text is redacted and counted
  - [x] A secret embedded inside a diff hunk is redacted without corrupting the surrounding diff
  - [x] An empty session produces a well-formed, empty `HandoffBundle` rather than throwing
- Integration tests:
  - [x] Assembling from a realistic fixture `SessionState` produces a `HandoffBundle` whose files, diffs, and redaction count match expectations
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Bundle assembly is deterministic and bounded, with an accurate referenced-file set and pending diffs
- No secrets survive redaction in the covered patterns; redaction count is reported
