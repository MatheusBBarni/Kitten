---
status: pending
title: Session-Addressed Explorer Orchestration and Production Injection
type: backend
complexity: high
---

# Task 5: Session-Addressed Explorer Orchestration and Production Injection

## Overview

Wire safe explorer source and editor-launcher capabilities into controller-owned actions. The orchestration must capture the target session before awaiting, use store-only commits, and turn every expected failure into a stable, non-throwing user-facing result.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Actions MUST address an explicit session or capture the focused session before any await.
- List, expand, refresh, and open MUST commit only when session identity, immutable workspace root, and generation still match.
- Open MUST revalidate through the source before reaching the launcher; directories and unsafe paths MUST never reach the launcher.
- All recoverable I/O failures MUST surface a fixed notice or closed result and MUST NOT reject the event path.
- The controller MUST own default capability construction while preserving injected test seams.
</requirements>

## Subtasks

- [ ] 5.1 Add UI-facing explorer actions to the controller action surface.
- [ ] 5.2 Capture session identity, workspace root, and generation before asynchronous source work.
- [ ] 5.3 Commit only current source results through AppStore explorer transitions.
- [ ] 5.4 Revalidate open candidates and map launcher outcomes to fixed notices.
- [ ] 5.5 Construct default source and launcher capabilities through the controller injection seam.
- [ ] 5.6 Cover removed sessions, stale work, session switches, unsafe candidates, and fallback notices.

## Implementation Details

Follow the TechSpec “Controller Actions and State Transitions,” “Race Handling,” “File Open Algorithm,” and “Failure Semantics” sections. Follow the existing `SessionControllerOptions` capability-injection pattern; React must receive actions only, never filesystem or process capabilities.

### Relevant Files

- `src/app/actions.ts` — UI action facade and asynchronous session orchestration.
- `src/app/actions.test.ts` — existing action-level stale-session and failure test conventions.
- `src/app/controller.ts` — capability construction, injection, and public controller action surface.
- `src/app/controller.test.ts` — production-wiring and injected-capability tests.
- `src/store/appStore.ts` — target for all explorer state commits.
- `src/app/workspaceExplorer.ts` — safe source capability consumed by actions.
- `src/app/externalEditor.ts` — safe launcher capability consumed only after revalidation.

### Dependent Files

- `src/index.ts` — will provide the mutable, validated editor preference to the controller lifecycle.
- `src/ui/CockpitApp.tsx` — will dispatch only these actions.
- `src/telemetry/recorder.ts` — will receive content-free outcome calls at this action boundary.

### Related ADRs

- [ADR-001: Keep a safety-complete session explorer as the V1 boundary](adrs/adr-001.md) — constrains V1 behavior to inspect and open.
- [ADR-003: Keep explorer I/O behind separate controller-owned capabilities](adrs/adr-003.md) — defines I/O ownership and injection.
- [ADR-004: Persist editor preferences as validated direct argument vectors](adrs/adr-004.md) — constrains launch preference use.

## Deliverables

- Explorer action facade with safe asynchronous session orchestration.
- Controller-owned default source and launcher injection seams.
- Fixed failure notices and closed action outcomes.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for source-to-launcher orchestration **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Unknown, removed, and switched-away sessions do not mutate explorer state after an awaited operation settles.
  - [ ] A stale list or refresh result cannot overwrite a newer generation.
  - [ ] A directory, symlink, or unsafe path never reaches the editor launcher.
  - [ ] Source failure, launch failure, and custom-editor fallback each produce a fixed non-throwing notice or result.
  - [ ] Controller construction uses real capabilities by default and substitutes injected test seams when supplied.
- Integration tests:
  - [ ] Opening a valid focused-session file revalidates it, invokes one launch flow, and updates only that session’s state.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No UI path can perform filesystem or process I/O directly.
- Delayed work cannot affect a newer session, workspace, or refresh generation.
