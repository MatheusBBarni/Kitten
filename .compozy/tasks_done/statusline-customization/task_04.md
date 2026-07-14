---
status: completed
title: "Wire Statusline Confirmation and External Reload Lifecycle"
type: backend
complexity: high
---

# Task 04: Wire Statusline Confirmation and External Reload Lifecycle

## Overview

Expose controller-owned acknowledgement and confirmation operations that persist first, then update the active statusline preference. Integrate boot seeding and external config reloads so changes become visible immediately without turning preview edits, failed writes, or watcher events into extra writes.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST expose acknowledgement and complete-layout confirmation through the UI-safe controller action surface; the UI MUST NOT call the config writer directly.
- MUST persist an acknowledgement or complete layout atomically before updating reactive state, and MUST leave the visible preference unchanged when the write fails.
- MUST seed the store from loaded config, apply external watcher reloads through the store, and prevent application-originated writes from producing write-back loops.
- MUST keep statusline preview edits out of config persistence and statusline-specific telemetry.
- MUST extend injected fakes and test seams so no test starts a real agent, touches a real user config, or relies on a real terminal.
</requirements>

## Subtasks

- [x] 4.1 Extend the controller-facing action contract with acknowledgement and complete-layout confirmation outcomes.
- [x] 4.2 Connect config-writer calls to persist-before-apply behavior and legible non-throwing write failures.
- [x] 4.3 Seed the resolved preference at cockpit creation and apply watcher-originated external changes without re-persisting them.
- [x] 4.4 Update controller doubles and injectable boot seams for deterministic statusline action tests.
- [x] 4.5 Add focused lifecycle, write-failure, watcher, and no-loop regression coverage.

## Implementation Details

Implement the orchestration boundary described in TechSpec "API Endpoints" and "User config and watcher". Follow the existing preference lifecycle in `createCockpitSession`, but use explicit statusline actions instead of a debounced subscription because only acknowledgement and Confirm are allowed to write configuration.

### Relevant Files

- `src/app/actions.ts` — extend the UI-safe action contract with statusline acknowledgement and confirmation operations.
- `src/app/controller.ts` — thread the action seam while preserving fail-soft controller behavior.
- `src/index.ts` — seed, persist, reload, dispose, and inject statusline lifecycle seams in `createCockpitSession`.
- `test/index.integration.test.tsx` — verify boot, active application, write failure, and watcher behavior through injected dependencies.
- `test/configPersistence.integration.test.ts` — verify persisted configuration state across a fresh session setup.
- `test/fakeController.ts` and `test/fakeController.test.ts` — expose deterministic recorded statusline actions for UI tests.

### Dependent Files

- `src/config/configWriter.ts` — receives acknowledgement and full-layout patches at the controller boundary.
- `src/config/configWatcher.ts` — supplies fresh resolved config values after an external change.
- `src/store/appStore.ts` — accepts only successful writes and external reload values.
- `src/ui/StatuslineOverlay.tsx` — invokes the controller action surface and renders failure outcomes.

### Related ADRs

- [ADR-002: Make the statusline flow immediate, disclosed, and conversational-first](adrs/adr-002.md) — requires visible, immediate post-confirmation application.
- [ADR-003: Persist a structured statusline preference and share one pure renderer](adrs/adr-003.md) — requires persist-before-apply and external reload without write-back.

## Deliverables

- UI-safe controller actions for acknowledged disclosure and explicit layout confirmation.
- Boot and watcher lifecycle wiring with no preview persistence or self-write loop.
- Expanded fake-controller and injected-dependency support for deterministic tests.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for config-backed statusline lifecycle **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Acknowledgement writes only the acknowledgement patch, then updates the preference after the write resolves.
  - [x] Confirming a layout writes the complete statusline block once and makes it visible immediately after success.
  - [x] A rejected writer returns a legible failure outcome and leaves acknowledgement and layout state unchanged.
  - [x] A preview-store transition produces no persistence call.
  - [x] Fake-controller calls record acknowledgement and confirmation without an ACP connection.
- Integration tests:
  - [x] A booted cockpit receives a saved layout, an external config reload changes it once, and the reload produces no second persistence write.
  - [x] A config persistence round-trip preserves unrelated settings and makes a confirmed layout available to a newly created cockpit session.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Only explicit acknowledgement and confirmation can write statusline configuration.
- A successful save is immediately reactive; a failed save and an external reload never corrupt or loop the active preference.
