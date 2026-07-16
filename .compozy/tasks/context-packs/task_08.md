---
status: pending
title: Review, sealing, and fail-closed Send Here
type: backend
complexity: critical
---

# Task 08: Review, sealing, and fail-closed Send Here

## Overview

Implement controller-owned review, exact sealing, shared Recipient Fit, and the explicit Send Here route. Each consequential step must recheck the reviewed artifact and current evidence before using existing confirmation behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Review MUST rematerialize all selections, validate fences and budget, redact deterministically, and publish only the exact candidate bytes with typed blocking reasons.
- Seal MUST recheck candidate revision, source fences, freshness, budget, and redaction result before atomically replacing the current sealed value.
- Recipient Fit MUST use live SessionUsage plus current closed Recipient Profile evidence and MUST return unavailable or insufficient rather than estimate-only authorization.
- Send Here MUST recheck sealed bytes and fit immediately before calling existing explicit confirmation/send behavior.
- Blocked, stale, or denied paths MUST preserve the reviewed/sealed pack, never trim/substitute payload, move focus, or offer an override.
</requirements>

## Subtasks

- [ ] 8.1 Add controller review materialization, validation, redaction, and candidate publication.
- [ ] 8.2 Add exact sealing with source/revision/freshness rechecks.
- [ ] 8.3 Route all recipient decisions through shared current Recipient Fit.
- [ ] 8.4 Add explicit Send Here dispatch through the existing confirmation boundary.
- [ ] 8.5 Prove stale, blocked, and changed-evidence behavior leaves bytes and focus intact.

## Implementation Details

Follow the TechSpec review/seal/fit flow and ADR-005. Do not implement handoff attachment or export here; this task establishes the sealed payload and Send Here custody gate they consume.

### Relevant Files

- src/app/controller.ts — review, seal, fit, and Send Here orchestration.
- src/app/controller.test.ts — route, recheck, and denial coverage.
- src/app/actions.ts — typed review/seal/send action facade.
- src/app/actions.test.ts — action dispatch coverage.
- src/store/appStore.ts — candidate/sealed atomic state commit.
- src/store/appStore.test.ts — review invalidation and sealing transitions.

### Dependent Files

- src/core/contextPack.ts — candidate, seal, and Recipient Fit decisions.
- src/app/contextPackMaterializer.ts — review artifact supplier.
- src/config/contextPackCapability.ts — Recipient Profile evidence.
- src/persistence/runStore.ts — later exact sealed durability.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)
- [ADR-005: Fail closed on Recipient Fit for every Context Pack consumption path](adrs/adr-005.md)

## Deliverables

- Exact review candidate, sealing, fit, and Send Here lifecycle.
- Shared fail-closed Recipient Fit service at the final decision point.
- Existing confirmation path retained without automatic delivery.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for fresh final rechecks with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Review publishes only redacted exact candidate bytes after all materialization/fence/budget checks pass.
  - [ ] Source drift, stale candidate revision, redaction failure, and over-budget material block review or seal with typed reasons.
  - [ ] Seal never mutates an older sealed value when candidate revision or source fence changes.
  - [ ] Fit reports available, unavailable, and insufficient from current evidence rather than Pack Estimate alone.
  - [ ] Send Here invokes existing send confirmation only after a new successful fit and exact-byte recheck.
- Integration tests:
  - [ ] Evidence changing between review and send blocks delivery without focus movement, byte modification, or an override path.
  - [ ] A confirmed permitted Send Here flow preserves the exact sealed payload at the final confirmation boundary.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Review, sealing, and delivery preserve exact reviewed custody and recheck live evidence.
- No unavailable or stale recipient can receive a silent substitute or partial pack.
