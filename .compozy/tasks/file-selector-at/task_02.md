---
status: completed
title: "Explicit-session discovery action and controller wiring"
type: backend
complexity: medium
---

# Task 02: Explicit-session discovery action and controller wiring

## Overview

Expose repository discovery through the existing controller/action boundary using an explicit session identity. This task binds the source from task_01 to the configured session cwd without consulting live ACP session state, preserving correct behavior across focus changes and not-ready sessions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add an explicit `listRepositoryFiles(sessionId: SessionId)` controller action returning the task_01 result contract.
2. MUST capture the addressed session cwd before awaiting discovery and MUST NOT resolve it from the focused session after asynchronous work begins.
3. MUST return `unknown_session` for an absent configured session and `discovery_failed` when the source throws or rejects.
4. MUST allow a configured not-ready session to discover its files while preserving the existing readiness-based prompt-send gate.
5. MUST inject the production source through controller options without adding ACP, core, or store state.
</requirements>

## Subtasks
- [ ] 2.1 Extend the controller action surface with explicit-session repository discovery.
- [ ] 2.2 Wire the injected source through controller construction and production defaults.
- [ ] 2.3 Preserve fail-soft results for unknown sessions and source failures.
- [ ] 2.4 Verify session cwd capture and not-ready behavior.
- [ ] 2.5 Preserve existing controller and action contracts outside this capability.

## Implementation Details

Follow TechSpec "System Architecture > Controller and action boundary" and "Core Interfaces". The action must use configured session data, not `getSession()`, because that lookup represents a live ACP session only.

### Relevant Files
- `src/app/actions.ts` — owns the UI-facing `ControllerActions` contract and fail-soft action pattern.
- `src/app/controller.ts` — owns session configuration, controller options, and action construction.
- `src/app/controller.test.ts` — existing controller/action integration coverage and injected-seam pattern.
- `src/core/types.ts` — defines `SessionId` and session cwd data.

### Dependent Files
- `src/telemetry/recorder.ts` — task_03 extends the action/controller surface with telemetry.
- `test/fakeController.ts` — task_06 updates the UI double to implement the expanded action contract.
- `src/ui/PromptEditor.tsx` — task_06 calls this capability with a captured focused session id.

### Related ADRs
- [ADR-003: Discover Repository Files Through an Injected Controller-Owned Git Source](adrs/adr-003.md) — requires an explicit-session, controller-owned, fail-soft integration.

## Deliverables
- Updated `ControllerActions`, action dependencies, and controller options for repository-file discovery.
- Controller/action tests proving explicit session scope and total failure handling.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for controller-to-source wiring with injected source doubles **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Requesting a known session calls the source with that session’s configured cwd.
  - [ ] An unknown session returns `unknown_session` and does not call the source.
  - [ ] A thrown or rejected source resolves as `discovery_failed` without an unhandled rejection.
  - [ ] A not-ready configured runtime still calls the source with its cwd.
- Integration tests:
  - [ ] Start discovery for one session, switch focus before its deferred source resolves, and verify the captured source cwd remains the original session’s cwd.
  - [ ] Controller construction uses an injected source double and retains existing agent startup behavior.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Repository discovery is explicit-session scoped and never depends on current focus after invocation.
- No new ACP, core reducer, or store state is introduced.
