---
status: pending
title: "Controller ownership and event wiring for the shell"
type: backend
complexity: medium
dependencies:
  - task_02
  - task_03
---

# Task 05: Controller ownership and event wiring for the shell

## Overview
Give the `ShellRuntime` a lifecycle home inside the `SessionController`, alongside the agent connections.
The controller creates the runtime at boot, subscribes its `ShellEvent`s into the store via `applyShellEvent`, exposes it to the UI and hand-off, and disposes it on teardown so the PTY never orphans.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create the `ShellRuntime` in `createSessionController` via an injectable factory defaulting to the real one, mirroring `createConnection`.
- MUST subscribe the runtime's `onEvent` to `store.applyShellEvent` and unsubscribe on dispose.
- MUST expose the runtime (or its `view`/`write`/`interrupt`/`snapshot`) to the UI through the controller surface, without leaking the emulator into the store.
- MUST dispose the runtime in `SessionController.dispose` using the same `disposeQuietly` swallow-on-teardown discipline as connections.
- MUST open the shell against the same working directory the agent sessions use (`cwd`).
- SHOULD leave the cockpit fully usable if the shell fails to start, marking the shell unavailable rather than crashing boot.

## Subtasks
- [ ] 5.1 Add a `ShellRuntimeFactory` seam to `SessionControllerOptions` with a real default
- [ ] 5.2 Create the runtime at boot and wire `onEvent` into `applyShellEvent`
- [ ] 5.3 Expose the runtime to the UI/hand-off through the controller
- [ ] 5.4 Dispose the runtime in `dispose` and unsubscribe its listener
- [ ] 5.5 Degrade gracefully when the shell cannot start

## Implementation Details
Modify `src/app/controller.ts`. Follow the existing per-agent ownership: build at boot, subscribe into the store, and tear down through `disposeQuietly`. See TechSpec "System Architecture" and "Impact Analysis" for the controller's role. The store additions and factory come from task_02 and task_03.

### Relevant Files
- `src/app/controller.ts` — runtime ownership, subscription, and disposal patterns
- `src/agent/agentConnection.ts` — the `onUpdate` subscription shape to mirror
- `src/index.ts` — boots the controller; the teardown path that must reach the shell

### Dependent Files
- `src/ui/cockpitContext.tsx` — exposes the controller/runtime to views (task_08)
- `src/app/handoff.ts` — reads the shell snapshot through the controller/store (task_12)

### Related ADRs
- [ADR-003: Shell Runtime and Rendering Architecture](adrs/adr-003.md) — controller-owned imperative runtime

## Deliverables
- Controller creates, wires, exposes, and disposes the `ShellRuntime`
- Injectable `ShellRuntimeFactory` seam with a real default
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the boot-to-store wiring **(REQUIRED)**

## Tests
- Unit tests (mock runtime):
  - [ ] a scripted `cwd_changed` from the runtime lands in the store's shell slice via `applyShellEvent`
  - [ ] `controller.dispose()` calls the runtime's `dispose` and unsubscribes its listener
  - [ ] a runtime that throws on creation leaves the agents usable and marks the shell unavailable
- Integration tests:
  - [ ] booting the controller with the real factory opens a shell against `cwd` and reflects an `echo` in the store
  - [ ] disposing the booted controller terminates the shell process
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Shell events flow into the store and the runtime is disposed with the controller
- No orphaned PTY process after teardown
