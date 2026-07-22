---
status: completed
title: Build settings for profiles, catalog roots, defaults, and execution limit
type: frontend
complexity: medium
---

# Task 17: Build settings for profiles, catalog roots, defaults, and execution limit

## Overview

Add the desktop Settings experience for theme preference, profile readiness and
future-card defaults, catalog roots and diagnostics, and global execution
capacity. It is a typed projection client that never rewrites recorded cards,
attempts, or immutable Run Contexts.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Settings MUST render typed settings/catalog/profile projections and issue mutations only through desktop RPC.
2. Theme and profile controls MUST expose readiness, unavailable diagnostics, and a clearly distinct default for future cards.
3. Catalog controls MUST show project/user roots, valid entries, canonicalization, collision, and invalid-root diagnostics without free-text Skill selection.
4. The automatic-execution limit MUST start at one, reject invalid values honestly, and never rewrite card, attempt, or Run Context evidence.
5. All controls MUST provide keyboard labels, focus order, conflict/error feedback, narrow subscriptions, and content-minimized host errors.
</requirements>

## Subtasks

- [ ] 17.1 Add settings route/shell with typed loading, conflict, and host-error states.
- [ ] 17.2 Build theme and profile readiness/default panels.
- [ ] 17.3 Build catalog roots and diagnostics panel.
- [ ] 17.4 Build global execution-limit control and committed-projection reconciliation.
- [ ] 17.5 Add keyboard, accessibility, and fake-host immutable-history coverage.

## Implementation Details

Follow the TechSpec Local Settings and Bounded Execution mapping. Consume typed
catalog and scheduler outputs; do not recreate their host ownership in renderer
state.

### Relevant Files

- packages/desktop/src/renderer/settings/SettingsView.tsx — settings route.
- packages/desktop/src/renderer/settings/settingsQueries.ts — narrow typed query state.
- packages/desktop/src/renderer/settings/ProfileDefaultsPanel.tsx — profile readiness/default controls.
- packages/desktop/src/renderer/settings/CatalogRootsPanel.tsx — root and diagnostic display.
- packages/desktop/src/renderer/settings/ExecutionLimitPanel.tsx — bounded capacity control.
- packages/desktop/src/shared/desktopRpc.ts — settings typed contract.
- packages/desktop/test/settingsRpc.integration.test.ts — fake-host mutation evidence.

### Dependent Files

- packages/desktop/src/catalog/skillCatalog.ts — catalog diagnostics projection.
- packages/desktop/src/attempts/scheduler.ts — global capacity projection.
- packages/desktop/src/attempts/attemptCoordinator.ts — immutable Run Context source.

### Related ADRs

- [ADR-006: Resolve Workflow Skills from deterministic project and user catalog roots](adrs/adr-006.md) — catalog identity and roots.
- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — preserved history authority.
- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — desktop boundary.

## Deliverables

- Typed settings route for preferences, profiles, roots, diagnostics, and capacity.
- Future-card-only defaults and immutable-history guard behavior.
- Fake-host renderer and accessibility regression suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for typed settings mutations **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Render loading, host-error, and stale-conflict states with keyboard-reachable feedback.
  - [ ] Render unavailable profiles and catalog collision/invalid-root diagnostics.
  - [ ] Render default capacity one and reject non-positive input without coercion.
- Integration tests:
  - [ ] Use fake RPC to apply preferences, profile defaults, catalog roots, and execution limit.
  - [ ] Assert stale settings return a typed conflict and committed projection refreshes narrowly.
  - [ ] Assert changing defaults/capacity leaves existing card and Run Context unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A fresh desktop projection displays an automatic-execution limit of one.
- No settings mutation rewrites historical card or attempt evidence.
