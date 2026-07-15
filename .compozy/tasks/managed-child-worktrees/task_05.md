---
status: pending
title: Make delegated child launch transactional
type: backend
complexity: high
---

# Task 05: Make delegated child launch transactional

## Overview

Integrate verified provisioning into the controller before child registration and ACP startup, then expose terminal-only cleanup through the existing fail-soft action boundary. The controller must retain a verified binding for post-start failure review while making pre-registration failure leave no child artifacts in Kitten state.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST provision after parent validation but before child store insertion, runtime registration, ACP startup, prompt dispatch, or launch-success telemetry.
2. MUST seed the child with the verified worktree path and immutable binding, never the parent cwd fallback.
3. MUST revalidate parent/runtime ownership after provisioning and invoke only owned pre-registration rollback if registration cannot continue.
4. MUST retain a registered child binding when ACP setup or initial prompting fails.
5. MUST expose a fail-soft `cleanupManagedWorktree` action gated to managed terminal non-live children and publish bounded result state.
6. MUST keep `closeConversation` session-only and never make it a cleanup path.
</requirements>

## Subtasks
- [ ] Inject the managed-worktree service into controller construction and test helpers.
- [ ] Add provision, revalidation, and owned rollback to delegated launch.
- [ ] Start ACP with verified child cwd while preserving current failed-child lifecycle behavior.
- [ ] Add guarded terminal cleanup action and result publication.
- [ ] Add controller/action ordering and refusal coverage.

## Implementation Details

Modify only controller and action orchestration described in the TechSpec launch flow. Consume service and binding contracts without implementing Git commands or persistence.

### Relevant Files
- `src/app/controller.ts` — owns launch ordering, runtimes, lifecycle, and cleanup gate.
- `src/app/actions.ts` — owns the fail-soft UI action facade.
- `src/app/controller.test.ts` — provides stub connections, cwd assertions, and delegated lifecycle tests.
- `src/app/actions.test.ts` — action forwarding coverage when present.

### Dependent Files
- `src/persistence/runRecord.ts` — later persists controller-produced binding identity.
- `src/ui/DelegationDialog.tsx` — later presents launch disclosure and failure behavior.
- `src/ui/SessionsOverlay.tsx` — later invokes the terminal cleanup action.
- `src/telemetry/recorder.ts` — later records accepted lifecycle outcomes.

### Related ADRs
- [ADR-001: Create managed worktrees only for spawned child sessions](adrs/adr-001.md) — verified workspace precedes execution.
- [ADR-004: Allocate verified worktrees before child registration](adrs/adr-004.md) — transaction and rollback policy.
- [ADR-005: Restrict cleanup to terminal child review](adrs/adr-005.md) — cleanup action boundary.

## Deliverables
- Transactional delegated launch and terminal-only cleanup action.
- Controller/action tests with >=80% coverage **(REQUIRED)**.
- Integration coverage for ordering, distinct cwd siblings, and retained failure review **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Deferred provisioning creates no child, runtime, ACP call, prompt, or launch telemetry before success.
  - [ ] Provision failure returns `null` and leaves parent/siblings unchanged.
  - [ ] Unknown, ordinary, active, mismatched, and non-terminal cleanup targets make zero service calls.
  - [ ] Thrown cleanup service errors resolve a bounded failed result through `onError`.
- Integration tests:
  - [ ] Successful siblings pass distinct verified cwd values to ACP startup.
  - [ ] ACP startup failure retains a terminal failed child with its binding and no cleanup rollback.
  - [ ] `closeConversation` never invokes cleanup.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No child can observe the parent checkout after managed provisioning is selected.
- Pre-registration failure leaves no child session or runtime in store/controller state.
