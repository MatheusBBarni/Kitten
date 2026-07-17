---
status: completed
title: Align local-only Cursor docs and telemetry guardrails
type: docs
complexity: low
---

# Task 05: Align local-only Cursor docs and telemetry guardrails

## Overview

Align the written support boundary and local telemetry boundary with the certified-local, fail-closed Cursor experience. Documentation must set accurate expectations without promising a version that has not passed review, and telemetry must remain content-free and disabled by default.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. README onboarding MUST describe Cursor only as a local `agent acp` session supported for a reviewed, certified local profile, and MUST exclude Cursor cloud, background, and remote products.
2. Documentation MUST state that authentication remains in Cursor's native flow and Kitten neither collects nor manages credentials; it MUST NOT imply direct CLI model or configuration control of an active ACP session.
3. Documentation MUST distinguish missing, unauthenticated, incompatible, and uncertified-profile recovery states while preserving that ready Claude Code and Codex sessions remain usable.
4. Documentation MUST not name a certified Cursor version or claim broad compatibility until reviewed native evidence authorizes an exact profile.
5. Application telemetry MUST remain opt-in, default-off, local JSONL, and limited to the closed `provider_readiness` outcomes `ready`, `binary_missing`, `version_mismatch`, `uncertified_recipe`, `authentication_required`, and `handshake_failed`.
6. Telemetry MUST serialize no command, profile, version, path, raw error, credential, prompt, code, option identifier/value, or first-task aggregate; the native config result remains only in the separate reviewed contract artifact.
</requirements>

## Subtasks
- [x] 5.1 Update the local-only Cursor onboarding and recovery boundary without adding an unreviewed compatibility promise.
- [x] 5.2 Prove documentation excludes credential ownership and direct-CLI active-session control.
- [x] 5.3 Preserve the exact closed readiness telemetry schema and disabled-recorder behavior.
- [x] 5.4 Add regression tests that reject sentinel content at the recorder boundary.

## Implementation Details

Use the TechSpec sections **Privacy and Telemetry**, **User Experience**, and **Testing Approach**. Keep reviewed native contract artifacts separate from application telemetry, and do not modify controller recovery flow or model-control behavior in this task.

### Relevant Files
- `README.md` — local Cursor boundary, native authentication ownership, recovery guidance, and sibling availability wording.
- `test/cursorDocumentation.test.ts` — README support-contract regression coverage.
- `src/telemetry/recorder.ts` — opt-in local recorder and sealed readiness outcome boundary.
- `src/telemetry/recorder.test.ts` — disabled-recorder, exact-schema, and content-elision coverage.

### Dependent Files
- `src/config/readiness.ts` — produces normalized categories; this task does not change recovery flow.
- `src/app/controller.ts` — projects target-session availability without becoming a documentation concern.
- `test/cursorAcp.contract.test.ts` — owns reviewed native config-capability evidence, not application telemetry.
- `src/ui/ModelSelect.tsx` — owns rendered recovery and no-options behavior, not README or recorder policy.

### Related ADRs
- [ADR-001: Keep Cursor support evidence-gated and fail closed](adrs/adr-001.md) — Grounds truthful local-only support claims.
- [ADR-005: Record a closed live-config capability result in the native contract](adrs/adr-005.md) — Keeps native evidence distinct from telemetry.

## Deliverables

- Truthful local-only Cursor support and recovery documentation with no unreviewed version claim.
- Closed, content-free local readiness telemetry regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for documented and recorded readiness boundaries **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Documentation assertions cover local `agent acp`, certified-local-only support, and exclusion of cloud, background, and remote Cursor products.
  - [x] Documentation assertions cover native authentication ownership, no Kitten credential handling, no direct-CLI active-session claim, four recovery boundaries, and sibling availability.
  - [x] Documentation assertions reject a literal certified semantic version before native review.
  - [x] Recorder assertions accept exactly the six readiness outcomes and serialize only `type`, `provider`, `readinessOutcome`, `at`, and `sessionRef`.
- Integration tests:
  - [x] Casted raw sentinel values reaching the recorder boundary are discarded rather than serialized.
  - [x] The disabled recorder performs no sink access and creates no records even when Cursor readiness is reported.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Users receive no broader Cursor support promise than reviewed local evidence permits.
- Runtime telemetry remains local, disabled by default, closed, and content-free.
