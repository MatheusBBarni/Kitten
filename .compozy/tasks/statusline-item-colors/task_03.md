---
status: pending
title: Define Strict Colored Statusline Proposal Grammar
type: refactor
complexity: medium
---

# Task 03: Define Strict Colored Statusline Proposal Grammar

## Overview

Update the product-owned `/statusline` agent proposal contract so it can
describe the supported colored item forms without broadening the input surface.
The existing fenced-JSON discipline, invalid-response recovery, and privacy
boundary must continue to apply to every color proposal.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Describe only the canonical colored statusline item forms accepted by the core contract, including legacy-compatible uncolored forms.
- Retain the one fenced JSON response rule and the current invalid-response path for malformed, extra, or unfenced content.
- Route all proposal output through the pure core normalizer; the proposal flow must not parse, resolve, or silently repair colors itself.
- Keep runtime session values, executable content, terminal controls, and unrelated prompt data out of the agent input.
</requirements>

## Subtasks

- [ ] 3.1 Revise the product-owned proposal instructions to state the supported colored and uncolored layout grammar.
- [ ] 3.2 Preserve the current response-envelope and privacy constraints for color-bearing proposals.
- [ ] 3.3 Verify accepted proposals become canonical layouts and invalid proposals take the existing recovery path.

## Implementation Details

Reference the TechSpec's proposal integration point and the core contract rather
than introducing a parallel schema. Keep this app-layer instruction precise and
limited to declarative field identifiers, separators, and allowed color forms.

### Relevant Files

- `src/app/statuslineFlow.ts` — product-owned proposal instruction and normalized proposal parsing path.
- `src/app/statuslineFlow.test.ts` — exact grammar, response-envelope, validation, and privacy regression coverage.

### Dependent Files

- `src/core/statusline.ts` — authoritative validation and canonicalization boundary for proposal content.
- `src/ui/StatuslineOverlay.tsx` — presents accepted proposals for explicit user review.

### Related ADRs

- [ADR-001: Keep statusline colors item-local and declarative](adrs/adr-001.md) — constrains proposals to non-executable field preferences.
- [ADR-003: Carry canonical colors through the pure statusline model](adrs/adr-003.md) — requires proposal output to reuse the sole core normalizer.

## Deliverables

- A precise colored `/statusline` proposal grammar with legacy-compatible forms.
- Preserved one-block parsing and no-session-value prompt boundary.
- Focused app-flow tests covering accepted and rejected color proposals.
- Public proposal-to-normalized-layout flow coverage.

## Tests

- Unit tests:
  - [ ] The instruction names the supported structured colored simple and ellipsis forms alongside uncolored forms.
  - [ ] Valid named and hex color proposals return the canonical core-normalized layout.
  - [ ] Invalid color forms, extra keys, multiple blocks, unfenced responses, and trailing content retain the invalid-response path.
  - [ ] Agent input excludes resolved branch, provider, model, context, and other runtime session values.
- Integration tests:
  - [ ] The proposal parsing flow accepts only a complete fenced declarative layout and hands its canonical result to the existing confirmation journey.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- The instruction and parser expose no color syntax beyond the TechSpec boundary.
- Every accepted proposal is canonicalized by the core; every unsupported proposal is rejected without fallback.
- Existing proposal privacy and recovery behavior remains intact.
- All focused tests pass with >=80% targeted coverage.
