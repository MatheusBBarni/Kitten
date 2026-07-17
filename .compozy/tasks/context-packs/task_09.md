---
status: completed
title: Immutable sealed-pack handoff composition
type: backend
complexity: high
---

# Task 09: Immutable sealed-pack handoff composition

## Overview

Extend the existing handoff workflow with one optional whole sealed Context Pack attachment, source-identity deduplication, fresh fit evidence, and one combined operator preview/confirmation.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- A handoff MUST attach at most one immutable sealed pack as a whole, never editable blocks or a second current pack.
- Deduplication MUST use matching source identities only and MUST NOT deduplicate by path or index alone.
- The sealed payload MUST never be re-redacted, trimmed, or rewritten for handoff composition.
- A fresh Recipient Fit result MUST be required before attachment/consumption and preserve the combined preview when unavailable.
- Existing target selection and explicit combined confirmation MUST remain authoritative.
</requirements>

## Subtasks

- [x] 9.1 Add an optional whole sealed-pack attachment contract to handoff values.
- [x] 9.2 Compose one combined preview with source-identity deduplication.
- [x] 9.3 Preserve sealed payload bytes and prohibit per-block editing/removal.
- [x] 9.4 Recheck fit before attachment and final handoff confirmation.
- [x] 9.5 Add composition, deduplication, and blocked-path coverage.

## Implementation Details

Follow the TechSpec Handoff integration and existing preview/confirm behavior. Keep all selection and sealing decisions in their existing Context Pack actions; handoff only composes a previously sealed value.

### Relevant Files

- src/core/types.ts — attachment and source-identity vocabulary.
- src/core/bundleAssembler.ts — combined payload and deduplication behavior.
- src/core/bundleAssembler.test.ts — identity/determinism coverage.
- src/app/handoff.ts — attachment and final fit/confirmation path.
- src/app/handoff.test.ts — handoff lifecycle coverage.
- src/ui/HandoffPreview.tsx — whole-pack combined preview rendering.
- src/ui/HandoffPreview.test.tsx — immutable attachment presentation coverage.

### Dependent Files

- src/app/controller.ts — sealed pack and Recipient Fit supplier.
- src/core/contextPack.ts — sealed exact bytes and fit union.
- src/store/appStore.ts — session-owned current sealed value.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)
- [ADR-005: Fail closed on Recipient Fit for every Context Pack consumption path](adrs/adr-005.md)

## Deliverables

- One immutable optional sealed-pack handoff attachment.
- Source-identity-only deduplication and combined preview.
- Fresh fit and existing explicit confirmation enforcement.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for end-to-end handoff composition with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] A handoff accepts one whole sealed pack and rejects a second attachment.
  - [x] Only identical source identities deduplicate; same path with a different identity remains present.
  - [x] Removing the attachment removes the whole pack and cannot edit or trim an individual sealed block.
  - [x] Composition retains sealed bytes exactly and never calls a second redaction path.
- Integration tests:
  - [x] Fresh fit is rechecked before final handoff confirmation; unavailable evidence keeps the preview and blocks consumption.
  - [x] A permitted combined confirmation sends the reviewed attachment through the existing handoff flow only once.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Handoffs retain whole immutable sealed packs with one explicit combined review.
- Identity-safe deduplication cannot hide different source material.
