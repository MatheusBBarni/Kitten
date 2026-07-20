---
status: completed
title: Render readiness-first Cursor model controls
type: frontend
complexity: medium
---

# Task 04: Render readiness-first Cursor model controls

## Overview

Render Cursor's model-control area from the bounded readiness state established upstream, so an unavailable local session tells the user what safe recovery action is appropriate. The view must remain truthful: an unavailable Cursor session does not have usable live model or effort controls, while a ready Cursor session with no advertised options is a separate state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. `ModelSelect` MUST read the selected conversation's bounded availability and recovery projection, and MUST apply Cursor-specific recovery precedence only when `providerKind` is `cursor`.
2. An unready Cursor session MUST render only its safe recovery message and, when the upstream state permits it, one recheck affordance; it MUST NOT render model rows, effort rows, change controls, or the generic no-options notice.
3. Recovery copy MUST be derived solely from bounded user-safe state and MUST exclude command, version, path, credential, raw error, ACP, and CLI details.
4. The recheck affordance MUST be visible only for remediable upstream states and MUST invoke only `controller.actions.recheckCursor(sessionId)` without configuration mutation or direct connection access.
5. A ready Cursor session with no eligible options MUST use distinct Cursor-specific no-options wording, while ready advertised Cursor options retain the existing confirmed-option behavior.
6. Claude Code, Codex, and every non-Cursor availability/no-options path MUST retain their current behavior.
</requirements>

## Subtasks
- [ ] 4.1 Select and consume the upstream bounded Cursor readiness projection in the model-control surface.
- [ ] 4.2 Render mutually exclusive unavailable-recovery, ready-empty, and ready-configurable Cursor states.
- [ ] 4.3 Connect the remediable recovery affordance to the public no-throw recheck action.
- [ ] 4.4 Add regression coverage for opaque copy, action wiring, and unchanged non-Cursor controls.

## Implementation Details

Follow the TechSpec sections **User Experience**, **Core Interfaces**, and **Testing Approach**. This is a presentation-and-action-wiring task: it consumes protocol-free state and the public controller façade, and it must not add a Cursor CLI path, read runtime errors, or infer config capability from option shape.

### Relevant Files
- `src/ui/ModelSelect.tsx` — model/effort control state selection, recovery surface, and public action wiring.
- `src/ui/ModelSelect.test.tsx` — focused rendered-state, keyboard, and callback coverage.
- `src/store/selectors.ts` — existing conversation availability selector consumed by the view.
- `src/core/types.ts` — upstream bounded availability/recovery projection contract.

### Dependent Files
- `src/app/actions.ts` — exposes the UI-safe targeted `recheckCursor` action.
- `src/app/controller.ts` — owns lifecycle and updates the bounded availability projection.
- `test/fakeController.ts` — controller façade test double for callback assertions.
- `src/agent/agentConnection.ts` — remains ACP-only and must not be reached from the UI.

### Related ADRs
- [ADR-001: Keep Cursor support evidence-gated and fail closed](adrs/adr-001.md) — Requires truthful, safe unavailable behavior.
- [ADR-004: Recheck only the selected unavailable Cursor session](adrs/adr-004.md) — Limits recovery to one deliberate target-session action.

## Deliverables

- Readiness-first Cursor model-control rendering with bounded recovery copy and eligible recheck wiring.
- Distinct ready-empty Cursor presentation with unchanged confirmed-option rendering.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for recovery-to-recheck presentation behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] An unavailable remediable Cursor session renders recovery and recheck, but no model/effort rows or generic no-options text.
  - [ ] Keyboard activation invokes `recheckCursor` exactly once and does not submit a configuration update.
  - [ ] An uncertified or otherwise non-remediable Cursor state has safe opaque copy and no recheck affordance.
  - [ ] A ready Cursor session with an empty option set renders distinct Cursor no-options wording; opaque advertised options retain the current configuration path.
- Integration tests:
  - [ ] Changing the upstream bounded state from unavailable to ready updates the same Cursor view from recovery to confirmed options without exposing runtime error data.
  - [ ] Claude Code and Codex retain their generic no-options and current model-control behavior under the same availability combinations.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Cursor recovery controls are truthful, bounded, and action-safe.
- No unavailable Cursor session exposes live configuration controls or raw provider details.
