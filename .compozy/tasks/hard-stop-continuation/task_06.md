---
status: pending
title: Record content-free hard-stop outcomes and prove privacy boundaries
type: refactor
complexity: high
---

# Task 06: Record content-free hard-stop outcomes and prove privacy boundaries

## Overview

Add the minimal, opt-in observability for confirmed interrupted first delivery and prove that continuation content cannot cross telemetry, diagnostics, bundle assembly, or handoff boundaries.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Telemetry MUST record `settled_interrupted` only after the controller has confirmed cancellation and terminal settlement.
- 2. Event payloads MUST contain only approved coarse, content-free taxonomy fields and MUST remain subject to existing opt-in telemetry policy.
- 3. Queued continuation text, block contents, request/lifecycle identifiers, raw provider errors, and recovery payloads MUST NOT appear in telemetry, any newly introduced diagnostics, bundle assembly, or handoff output.
- 4. Existing steering observability semantics and unrelated event taxonomy MUST remain unchanged.
- 5. Sentinel-based tests MUST demonstrate the privacy boundary across all affected output paths.
</requirements>

## Subtasks

- [ ] 6.1 Add the closed hard-stop outcome taxonomy, `HardStopOutcomeRecord`, and opt-in recorder method beside the existing steering outcome contract.
- [ ] 6.2 Deduplicate outcome emission with a private lifecycle key while serializing only the fixed outcome, provider kind, and coarse duration bucket.
- [ ] 6.3 Preserve the recorder's disabled no-op behavior and runtime allow-list validation; do not introduce a raw-error or continuation-diagnostic payload.
- [ ] 6.4 Extend the existing writer-plus-JSONL sentinel integration seam, then prove a reducer-held continuation is excluded from the pure bundle and the app handoff preview/dispatch path.
- [ ] 6.5 Confirm existing steering outcome records and their deduplication semantics remain unchanged.

## Implementation Details

Follow the TechSpec “Telemetry and Privacy,” “Handoff and Diagnostics,” and “Verification Strategy” sections. Treat all continuation blocks as secret live state unless and until the normal prompt path records an ordinary user turn.

### Relevant Files
- `src/telemetry/recorder.ts` — closed `TelemetryEventType`/record union, disabled recorder, private-key deduplication, and local JSONL sink; add only the allowlisted hard-stop record and method.
- `src/telemetry/recorder.test.ts` — existing steering outcome allow-list, duration bucketing, disabled-recorder, and private-key non-serialization patterns to mirror.
- `test/steeringObservability.integration.test.ts` — existing end-to-end JSONL plus `RunWriter` snapshot sentinel seam; extend it with the post-interrupt continuation lifecycle.
- `src/core/bundleAssembler.ts` and `src/core/bundleAssembler.test.ts` — transcript-only assembler contract and reducer-backed fixture pattern for proving queued/recovered continuation blocks never become bundle input.
- `src/app/handoff.ts` and `src/app/handoff.test.ts` — preview and final composed-block boundary to prove a live continuation does not reach either handoff surface.

### Dependent Files
- `src/app/controller.ts` — supplies only confirmed closed outcome facts.
- `src/app/harnessDelivery.ts` — provides the settled-interrupted state.
- `src/persistence/runWriter.ts` — separately enforces the persisted-data boundary.
- `src/app/actions.ts` — existing memory-only rejected-prompt contract is the precedent: live recovery content must not enter notices, persistence, telemetry, or diagnostics.

### Related ADRs
- [ADR-003: Keep continuation lifecycle reducer-owned and effect coordination in the controller](adrs/adr-003.md) — confines controller output to fixed facts.
- [ADR-004: Require attested settlement and metadata-only persistence](adrs/adr-004.md) — defines the no-content boundary.

## Deliverables

- Content-free hard-stop telemetry taxonomy, no-op wiring, and recorder validation.
- Terminal-emission deduplication coverage that proves private lifecycle keys never serialize.
- Sentinel privacy regressions for local telemetry JSONL, run snapshots, reducer-held bundle assembly, and handoff preview/final composition; no content-bearing diagnostic channel is added.

## Tests

- Unit tests:
  - [ ] A controller-confirmed settled interruption produces one opt-in hard-stop event with an exact fixed-field shape: outcome, provider kind, coarse duration bucket, timestamp, and anonymous run reference only.
  - [ ] Repeated terminal callbacks for the same private lifecycle key deduplicate; stale generation, unconfirmed settlement, and invalid taxonomy values emit nothing.
  - [ ] Disabled telemetry neither writes nor constructs a sink record, and the serialized enabled records exclude sentinel continuation text, request/lifecycle IDs, raw errors, route values, and capability values.
- Integration tests:
  - [ ] The JSONL-and-`RunWriter` observability integration fixture serializes neither a sentinel queued/recovered continuation nor its request/ACP identifiers while retaining the closed `settled_interrupted` checkpoint.
  - [ ] A reducer-held queued or recovery continuation is absent from `createDeterministicAssembler()` output, and a handoff preview/final composition built from that session excludes the sentinel.
  - [ ] No Hard Stop code adds a content-bearing diagnostic record; all new telemetry/diagnostic-shaped output is tested through the closed recorder contract.
  - [ ] Existing steering outcome telemetry remains unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Observability reports only confirmed, content-free hard-stop facts.
- Continuation content cannot escape through telemetry, diagnostics, bundle, or handoff paths.
