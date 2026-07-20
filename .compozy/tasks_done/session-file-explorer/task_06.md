---
status: completed
title: Apply Saved and Watched Editor Preference at Runtime
type: backend
complexity: medium
---

# Task 6: Apply Saved and Watched Editor Preference at Runtime

## Overview

Connect explicit editor saves and valid config-watch updates to the running controller so future file opens use the current preference. Preserve active UI drafts and the last valid runtime preference when persistence or external reloads fail.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- An explicit Save MUST persist first and update the runtime preference only after success.
- A valid watcher reload MUST update the preference used by the next user-initiated open, never reinterpret an in-flight action.
- Invalid or unreadable external config MUST retain the last valid runtime preference.
- Disposal MUST stop watcher-driven updates and preserve the existing cleanup guarantees.
</requirements>

## Subtasks

- [ ] 6.1 Extend the cockpit-session persistence seam for explicit editor saves.
- [ ] 6.2 Expose a controller action that reports saved or fixed error results.
- [ ] 6.3 Apply valid watcher editor changes to the runtime launch preference.
- [ ] 6.4 Preserve local UI draft authority across watcher events.
- [ ] 6.5 Add lifecycle, persistence-failure, and next-open integration coverage.

## Implementation Details

Follow the TechSpec “Runtime Configuration Reload,” “Failure Semantics,” and “Settings UX State Machine” sections. Extend the existing config watcher application in `createCockpitSession`; its generic watcher already supplies a fully loaded `AppConfig`.

### Relevant Files

- `src/index.ts` — owns cockpit-session persistence queues, config-watch handling, and disposal.
- `test/index.integration.test.tsx` — existing cockpit-session lifecycle integration coverage.
- `src/config/configWatcher.ts` — existing valid-config-only watcher contract used by the session lifecycle.
- `src/config/configWriter.ts` — atomic persistence contract used by explicit Save.

### Dependent Files

- `src/ui/SettingsView.tsx` — invokes the save action while retaining its local draft.
- `src/app/controller.ts` — exposes the mutable runtime editor preference seam.
- `test/configPersistence.integration.test.ts` — new end-to-end persistence and reload coverage.

### Related ADRs

- [ADR-004: Persist editor preferences as validated direct argument vectors](adrs/adr-004.md) — defines save, watcher, and fallback safety expectations.

## Deliverables

- Explicit editor persistence action and runtime update path.
- Config-watch behavior that applies valid changes only to future opens.
- Lifecycle integration tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for persistence and reload behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A successful Save persists the validated preference before runtime state changes.
  - [ ] A persistence error reports an error and leaves the runtime preference unchanged.
  - [ ] A valid watcher reload changes only a later launch decision.
  - [ ] An invalid external reload retains the last valid runtime preference.
  - [ ] Disposal prevents later watcher callbacks from changing runtime state.
- Integration tests:
  - [ ] An active settings draft remains unchanged while a valid external config reload arrives.
  - [ ] A file opened after a valid reload uses the new preference while an already-started open keeps its captured preference.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Editor preferences change runtime behavior only through explicit save or valid reload.
- External config changes never overwrite an active local draft.
