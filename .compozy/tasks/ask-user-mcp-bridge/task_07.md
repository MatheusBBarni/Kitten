---
status: completed
title: Extend the clarification dialog for form metadata, custom answers, skip, and timeout
type: frontend
complexity: high
---

# Task 07: Extend the clarification dialog for form metadata, custom answers, skip, and timeout

## Overview

Extend the existing top-priority clarification dialog to render form metadata, allow custom answers beside structured selections, and expose explicit Skip and timeout states separately from Escape cancellation. The result must preserve captured request/generation identity, keyboard-first behavior, focus isolation, and non-color clarity for both native ACP and bridge-originated forms.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The dialog MUST render optional form title/context and per-field metadata without exposing protocol or routing details.
- 2. Choice fields with custom-answer capability MUST support valid single- and multi-select outcomes plus custom text according to the shared core contract.
- 3. Skip MUST be an explicit form-level action and remain distinct from Escape cancellation.
- 4. Timeout and other terminal projections MUST preserve the captured request/generation guard and existing modal priority/focus isolation.
</requirements>

## Subtasks

- [ ] 7.1 Render form-level and field-level metadata from the normalized payload.
- [ ] 7.2 Add custom-answer affordances to supported choice fields.
- [ ] 7.3 Add an explicit Skip action and clear terminal feedback while retaining Escape cancellation.
- [ ] 7.4 Extend keyboard, focus, and stale-projection coverage for the richer form.

## Implementation Details

Reuse the existing protocol-free overlay and single keymap table. See the TechSpec “System Architecture,” “Data Models,” and “Impact Analysis” sections; do not add provider-specific UI paths.

### Relevant Files
- `src/ui/ClarificationPrompt.tsx` — owns active overlay rendering, form state, captured identity checks, and keyboard handling.
- `src/ui/ClarificationPrompt.test.tsx` — verifies rendered content, outcomes, focus isolation, and stale request protection.
- `src/ui/keymap.ts` — is the single source of truth for clarification bindings and help text.
- `src/ui/keymap.test.ts` — protects binding discovery and command matching.

### Dependent Files
- `src/core/types.ts` — supplies title/context, custom-answer, and terminal outcome semantics.
- `src/app/controller.ts` — projects the active clarification and resolves captured outcomes.
- `src/ui/CockpitApp.tsx` — mounts the clarification dialog at top modal priority.

### Related ADRs
- [ADR-002: Reserve MVP questions for consequential operator decisions](adrs/adr-002.md) — requires visible high-priority operator attention.
- [ADR-004: Define a bounded multi-field contract with a Kitten-owned five-minute timeout](adrs/adr-004.md) — defines multi-field, custom answer, skip, and timeout semantics.

## Deliverables

- Extended protocol-free clarification UI and keymap behavior.
- Explicit custom-answer, skip, timeout, and cancellation presentation.
- UI and keymap tests with 80%+ coverage of changed behavior.
- Mounted interaction coverage proving focus and identity isolation.

## Tests

- Unit tests:
  - [ ] A form renders title/context, per-field headers/context, and required indicators.
  - [ ] A single-select and multi-select field can include allowed custom text in the normalized submitted answer.
  - [ ] Explicit Skip produces skipped while Escape produces cancelled.
  - [ ] A timeout projection cannot be overwritten by later keys or a stale overlay callback.
- Integration tests:
  - [ ] The mounted cockpit consumes shell, help, and composer keys while a rich clarification form is active.
  - [ ] A clarification from one session remains visibly attributed and cannot be settled through another session’s projection.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Operators can complete, skip, or cancel a rich form without losing session attribution or keyboard control.
- Native and MCP-originated forms share one accessible dialog and one keymap.
