---
status: completed
title: Emit content-free managed-worktree lifecycle telemetry
type: backend
complexity: medium
---

# Task 09: Emit content-free managed-worktree lifecycle telemetry

## Overview

Add opt-in local telemetry for accepted managed-worktree lifecycle outcomes. The recorder must reveal only allowlisted event categories and bounded reasons, preserving the existing true no-op behavior when telemetry is disabled.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add exactly the six managed-worktree lifecycle event categories defined by the TechSpec.
2. MUST allow only bounded managed-worktree reason metadata where the lifecycle outcome requires it.
3. MUST emit only after controller-accepted provisioning, reconciliation, and cleanup outcomes; invalid no-ops and failed cleanup must not invent events.
4. MUST keep attempt pairing private and omit ids, paths, roots, branches, SHAs, tasks, prompts, command content, raw errors, provider, and agent identity from records.
5. MUST keep disabled telemetry a true no-op that never constructs or accesses a sink.
</requirements>

## Subtasks
- [ ] Extend recorder taxonomy, bounded reason support, facade, and no-op recorder.
- [ ] Add private provision-attempt settlement bookkeeping without serialized identifiers.
- [ ] Emit accepted controller lifecycle outcomes at the designated boundaries.
- [ ] Assert strict record allowlists and disabled-recorder behavior.
- [ ] Add controller-to-local-JSONL privacy coverage.

## Implementation Details

Implement only the content-free observability section of the TechSpec. Do not add telemetry transport, UI, persistence, or Git lifecycle behavior.

### Relevant Files
- `src/telemetry/recorder.ts` — telemetry event union, active/no-op recorders, and allowlist.
- `src/telemetry/recorder.test.ts` — recorder shape, privacy, and no-op coverage.
- `src/app/controller.ts` — accepted lifecycle emission boundaries.
- `src/app/controller.test.ts` — controller event sequencing tests.
- `test/telemetry.integration.test.ts` — serialized local JSONL privacy verification.

### Dependent Files
- `src/index.ts` — existing telemetry construction and injection remains the feature gate.
- `src/core/types.ts` — supplies bounded reason types without duplication.

### Related ADRs
- [ADR-003: Persist managed bindings and reconcile on restore](adrs/adr-003.md) — bounded restored lifecycle categories.
- [ADR-005: Restrict cleanup and verify Git lifecycle in two layers](adrs/adr-005.md) — cleanup outcome telemetry boundary.

## Deliverables
- Allowlisted managed-worktree telemetry facade and controller emission points.
- Recorder/controller unit tests with >=80% coverage **(REQUIRED)**.
- Local JSONL privacy integration tests **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] The six event types serialize only common fields and permitted bounded reasons.
  - [ ] One private provision attempt settles as exactly one provisioned or provision-failed record.
  - [ ] Sensitive path, root, branch, SHA, binding, child, task, and raw-error sentinels never serialize.
  - [ ] Disabled recorder neither accesses a sink nor writes managed-worktree records.
- Integration tests:
  - [ ] Controller emits request/result, reconciliation, and cleanup records only after accepted outcomes.
  - [ ] Serialized JSONL excludes provider, agent, and all sensitive managed-worktree identity fields.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Telemetry remains local, opt-in, and content-free.
- Disabled telemetry is observably a no-op.
