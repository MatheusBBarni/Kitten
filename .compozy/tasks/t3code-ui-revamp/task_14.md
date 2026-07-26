---
status: pending
title: Add opt-in content-free workflow measurement and diagnostics
type: backend
complexity: high
---

# Task 14: Add opt-in content-free workflow measurement and diagnostics

## Overview

Add the local, default-off measurement boundary needed to evaluate the new
supervision loop without collecting workflow content. Closed event schemas,
bounded buckets, and revision-fenced Settings keep measurement optional and
incapable of affecting authoritative execution.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Product measurement MUST default to disabled and MUST record nothing before explicit local opt-in.
2. The event schema MUST be closed and versioned with only fixed names, enums, booleans, bounded numbers/buckets, and necessary opaque IDs.
3. Prompts, responses, titles, code, diffs, filenames, paths, repositories, branches, model output, tool arguments, secrets, and raw errors MUST be rejected.
4. Durations and counts MUST be normalized into bounded buckets before persistence.
5. Recorder/storage failures MUST NOT change workflow execution, persistence, recovery, or RPC results.
6. The Settings control MUST be revision-fenced, accessible, default-off, and explicit about local-only behavior.
7. No measurement path MAY perform a network request.
</requirements>

## Subtasks

- [ ] 14.1 Define the closed versioned supervision/review/submission diagnostic schema.
- [ ] 14.2 Add a local opt-in recorder and bounded aggregate service.
- [ ] 14.3 Connect host diagnostic hooks without coupling measurement to workflow success.
- [ ] 14.4 Add the default-off revision-fenced Settings preference.
- [ ] 14.5 Expose clear local-only opt-in disclosure and control.
- [ ] 14.6 Produce deterministic local duration/count summaries.
- [ ] 14.7 Add privacy rejection, opt-in/out, failure-isolation, and aggregation coverage.

## Implementation Details

Follow the PRD **Content-free Workflow Measurement** feature and TechSpec
**Monitoring and Observability** section. Keep required operational recovery
diagnostics separate from optional product measurement so opting out never
suppresses safe recovery.

### Relevant Files

- `packages/desktop/src/host/lifecycleDiagnostics.ts` — closed event union and validation boundary.
- `packages/desktop/src/host/lifecycleDiagnostics.test.ts` — schema, privacy, opt-in, and aggregate coverage.
- `packages/desktop/src/host/workflowMeasurement.ts` — local recorder and bounded aggregates.
- `packages/desktop/src/shared/desktopRpc.ts` — measurement preference in typed Settings.
- `packages/desktop/src/host/settingsRpc.ts` — default-off revision-fenced ownership.
- `packages/desktop/src/renderer/settings/SettingsView.tsx` — accessible opt-in and local-only disclosure.

### Dependent Files

- `packages/desktop/src/host/desktopCoordinator.ts` — injects one shared diagnostic sink.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — content-free KPI boundary.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — bounded review and supervision outcomes.
- [ADR-003: Derive Supervision on Read and Keep Navigation Renderer-Local](adrs/adr-003.md) — excludes workflow content and paths.
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](adrs/adr-005.md) — stable admission/dispatch outcomes.
- [ADR-006: Require Packaged Native Lifecycle-Matrix Verification](adrs/adr-006.md) — packaged verification result enums.

## Deliverables

- Default-off local measurement service and closed content-free event schema.
- Revision-fenced Settings control and deterministic local aggregates.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for opt-in/out across supervision and review flows **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Record zero events with the default preference.
  - [ ] Enable and disable measurement through Settings revision fencing immediately.
  - [ ] Accept only fixed schema fields and reject every forbidden content category.
  - [ ] Clamp/bucket durations, counts, and sizes before storage.
  - [ ] Compute deterministic p50/p95 and outcome counts from fixed samples.
  - [ ] Swallow recorder/storage failure without changing the caller's result.
  - [ ] Render an accessible default-off, local-only Settings disclosure.
- Integration tests:
  - [ ] Produce no measurements for full supervision/review flows while disabled.
  - [ ] Record only expected fixed outcomes for the same flows while enabled.
  - [ ] Stop subsequent recording immediately when disabled mid-session.
  - [ ] Record packaged fixture results without paths or machine content.
  - [ ] Verify no measurement code performs a network request.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Product metrics can be evaluated locally without collecting workflow content.
- Measurement failure and opt-out never alter authoritative behavior.
