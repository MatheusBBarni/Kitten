---
status: completed
title: "Bridge valid config reloads without live-session mutation"
type: backend
complexity: medium
---

# Task 6: Bridge valid config reloads without live-session mutation

## Overview

Make a valid external configuration edit replace the controller defaults snapshot without applying it to a live session. A later explicit /model selection, not file reload, determines when new defaults take effect.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. A valid watcher delivery MUST replace only the controller defaults snapshot while retaining theme reload behavior.
- 2. Reload MUST NOT call default application, raw option actions, or mutate config options or default-result state.
- 3. Invalid intermediate edits MUST retain the prior valid snapshot and leave live sessions untouched.
- 4. Unchanged resolved config MUST not cause duplicate replacement or agent activity.
- 5. Disposed watcher callbacks MUST not update defaults or request options.
</requirements>

## Subtasks

- [x] 6.1 Forward valid reloaded defaults to the controller snapshot.
- [x] 6.2 Preserve current theme reload behavior.
- [x] 6.3 Keep invalid and unchanged delivery side-effect-free.
- [x] 6.4 Prove later explicit application uses the latest valid snapshot.
- [x] 6.5 Cover disposal behavior.

## Implementation Details

Implement TechSpec Integration Points using the existing watcher lifecycle. The update seam remains outside ControllerActions and inaccessible to UI.

### Relevant Files

- src/index.ts — boot watcher callback.
- src/app/controller.ts — completed snapshot update seam.
- src/app/controller.test.ts — replacement and later explicit apply.
- test/cockpitSession.test.ts — injected boot/watcher integration.
- src/config/configWatcher.ts — valid-delivery and dedupe behavior.
- src/config/configWatcher.test.ts — valid, invalid, and unchanged coverage.

### Dependent Files

- src/config/configLoader.ts — strict resolved input.
- src/app/actions.ts — later explicit consumer.
- src/ui/ModelSelect.tsx — sole intentional trigger.

### Related ADRs

- [ADR-003: Keep provider defaults declarative and controller-owned](adrs/adr-003.md) — rejects reload-time mutation.

## Deliverables

- Valid watcher-to-controller defaults propagation.
- No live agent/configuration mutation on reload.
- Valid, invalid, unchanged, explicit-use-after-reload, and disposal coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for boot watcher behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Replace snapshot A with valid B and assert no option request, config-options mutation, or result mutation.
  - [x] Deliver an invalid edit and prove prior valid defaults remain usable.
  - [x] Deliver unchanged resolved config twice and assert no duplicate update.
- Integration tests:
  - [x] Explicitly apply after valid reload and assert B rather than A is requested.
  - [x] Dispose, invoke captured watcher callback, and assert no snapshot update or request.
  - [x] Preserve existing theme reload assertions.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Reloaded preferences affect only a later explicit selection.
- Reload performs no configuration write or live-session mutation.
