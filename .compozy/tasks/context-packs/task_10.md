---
status: pending
title: Confirmed Context Pack Markdown export
type: backend
complexity: high
---

# Task 10: Confirmed Context Pack Markdown export

## Overview

Provide an operator-confirmed export of the exact sealed Context Pack payload with compact provenance. Export is deliberately recipient-neutral and must never auto-write or silently overwrite a file.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Export MUST accept only a current sealed exact payload and add only compact permitted provenance around it.
- The controller MUST require an explicit operator-selected destination and an overwrite confirmation before writing.
- Export MUST not re-redact, re-materialize, trim, substitute, infer a destination, or claim Recipient Fit.
- Filesystem errors MUST be returned as bounded typed operational results without raw error text in telemetry or state.
- No export action MAY start automatically after review, seal, handoff, or delivery.
</requirements>

## Subtasks

- [ ] 10.1 Define a sealed-payload-only export request and bounded result contract.
- [ ] 10.2 Add exact Markdown rendering with compact provenance.
- [ ] 10.3 Add controller/action explicit-path and overwrite-confirmation flow.
- [ ] 10.4 Preserve sealed bytes and surface typed operational failures.
- [ ] 10.5 Add exact-output, confirmation, and error-boundary coverage.

## Implementation Details

Follow the TechSpec export rules. The later Context Pack panel invokes this controller action; it does not get direct filesystem authority or an automatic export shortcut.

### Relevant Files

- src/app/contextPackExport.ts — new exact sealed-payload export boundary.
- src/app/contextPackExport.test.ts — rendering/write result coverage.
- src/app/actions.ts — typed export action facade.
- src/app/actions.test.ts — confirmation/dispatch coverage.
- src/app/controller.ts — selected-path and overwrite orchestration.
- src/app/controller.test.ts — end-to-end export behavior.
- test/fakeController.ts — UI-test export seam.

### Dependent Files

- src/core/contextPack.ts — sealed exact payload contract.
- src/store/appStore.ts — current sealed selection.
- src/ui/ContextPackPanel.tsx — later operator-controlled export entry point.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)

## Deliverables

- Exact sealed Markdown export with compact provenance.
- Explicit destination and overwrite confirmation route.
- Typed bounded export errors with no recipient-fit implication.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for confirmed file output with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Export output contains the exact sealed payload and only compact permitted provenance.
  - [ ] The sealed payload is not re-redacted, normalized, or mutated during rendering.
  - [ ] Missing sealed state, missing destination, and denied overwrite produce typed failures and no write.
  - [ ] Raw filesystem errors are not retained in state or exporter results.
- Integration tests:
  - [ ] A selected destination is written only after explicit confirmation; an existing file needs an independent overwrite confirmation.
  - [ ] Review, sealing, handoff, and Send Here sequences never cause an export unless the operator invokes it.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Export is an exact, confirmed, recipient-neutral copy of the sealed package.
- No automatic or unconfirmed filesystem write is possible.
