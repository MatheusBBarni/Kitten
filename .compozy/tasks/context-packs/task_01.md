---
status: pending
title: Core Context Pack lifecycle and deterministic assembly
type: backend
complexity: high
---

# Task 01: Core Context Pack lifecycle and deterministic assembly

## Overview

Create the pure, protocol-free Context Pack domain model. It must be the single place that defines draft and sealed values, deterministic review candidates, revision fencing, and recipient-fit decisions without performing I/O.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The core MUST be pure TypeScript with no ACP, filesystem, React, store, controller, or telemetry imports.
- Drafts MUST default to an 80k Pack Budget and preserve exactly the five fixed Context Brief sections.
- Selections MUST be a closed union of whole file, file slice, and diff metadata; source content MUST not become draft state.
- Builder mutations MUST carry the read revision, and an operator mutation MUST win over a stale builder mutation.
- Candidates and sealed values MUST use deterministic ordering, redaction-aware exact bytes, source fences, and typed failure results.
</requirements>

## Subtasks

- [ ] 1.1 Define protocol-free Context Pack, selection, candidate, sealed, and Recipient Fit contracts.
- [ ] 1.2 Implement draft creation, sealed-pack refinement, validation, and revision-fenced mutations.
- [ ] 1.3 Assemble deterministic candidates from supplied bounded artifacts and source fences.
- [ ] 1.4 Implement immutable sealing, manifest restoration, and shared Recipient Fit evaluation.
- [ ] 1.5 Add exhaustive pure-domain coverage for success, stale, and blocked transitions.

## Implementation Details

Follow the TechSpec Core Interfaces, Data Models, and Testing Approach. Export the named core operations described there and keep materialization and redaction effects as supplied inputs rather than hidden side effects.

### Relevant Files

- src/core/contextPack.ts — new pure lifecycle, validation, assembly, sealing, and fit module.
- src/core/contextPack.test.ts — deterministic lifecycle and failure coverage.
- src/core/types.ts — protocol-free shared Context Pack vocabulary.
- src/core/types.test.ts — type/value fixture coverage.
- src/core/secretRedactor.ts — injected deterministic redaction contract.

### Dependent Files

- src/core/bundleAssembler.ts — later sealed attachment composition.
- src/store/appStore.ts — later AppStore owner of the values and transitions.
- src/app/contextPackMaterializer.ts — later bounded artifact supplier.

### Related ADRs

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md)
- [ADR-003: Keep Context Packs session-keyed and persist only manifests plus sealed bytes](adrs/adr-003.md)
- [ADR-005: Fail closed on Recipient Fit for every Context Pack consumption path](adrs/adr-005.md)

## Deliverables

- A pure Context Pack lifecycle module and protocol-free type contracts.
- Deterministic candidate and source-fence behavior with immutable sealed output.
- Revision-fenced operator and builder mutation results.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-style deterministic assembly tests with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A new draft has the 80k budget and all five required brief sections.
  - [ ] Full-file, slice, and diff selections reject malformed metadata and preserve only metadata in a draft.
  - [ ] An operator mutation invalidates a stale builder mutation without overwriting the operator result.
  - [ ] Candidate ordering, byte accounting, redaction count, source fence, and sealed bytes are deterministic.
  - [ ] A sealed pack is immutable, and refinement creates a distinct draft.
  - [ ] Missing, stale, and insufficient recipient evidence returns only the typed closed fit union.
- Integration tests:
  - [ ] Equivalent materialized artifact inputs create byte-identical reviewed and sealed payloads across runs.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The domain model is pure and owns all deterministic Context Pack custody invariants.
- No stale builder result, partial candidate, or mutable sealed payload can be produced.
