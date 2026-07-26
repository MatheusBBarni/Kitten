---
status: completed
title: Add commands, Settings restoration, and critical-path accessibility
type: frontend
complexity: high
---

# Task 15: Add commands, Settings restoration, and critical-path accessibility

## Overview

Add one renderer-owned command registry for the supervision loop and integrate
Settings into restorative app navigation. Visible shortcut labels, focus
targets, live announcements, and deterministic fallbacks make the critical path
keyboard-operable without recreating lifecycle logic.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. One command registry MUST own IDs, labels, bindings, availability, dispatch, and shortcut-help presentation.
2. Required commands MUST cover search/scope, next actionable, next/previous card, focus composer, open review, close/back, Settings, and shortcut help.
3. Editable targets, IME composition, repeated keydown, and modal context MUST take precedence over conflicting global shortcuts.
4. Settings entry/return MUST preserve valid repository, board, card, attempt, workbench, review file, anchor, draft namespace, and responsive surface.
5. Focus MUST move predictably to Settings, composer, review, workbench, or restored board targets.
6. Unavailable commands and missing-entity fallback MUST announce content-free guidance without mutation.
7. Next-action commands MUST consume host supervision order and MUST NOT rank workflow state locally.
</requirements>

## Subtasks

- [ ] 15.1 Define the shared command registry and shortcut reference.
- [ ] 15.2 Route commands with editable-target, IME, repeat, and modal precedence.
- [ ] 15.3 Add restorative Settings entry and return state.
- [ ] 15.4 Register explicit search, composer, review, workbench, and board focus targets.
- [ ] 15.5 Restore focus and choose accessible fallbacks after navigation/entity removal.
- [ ] 15.6 Add polite content-free live announcements and semantic landmarks.
- [ ] 15.7 Add keyboard routing, Settings round-trip, focus, fallback, and accessibility coverage.

## Implementation Details

Follow the PRD **Critical-path Commands and Accessibility** and TechSpec
**Accessibility** sections. Route current application buttons through
restorative actions instead of direct `setRoute` calls. Keep command
availability derived from current projections and mounted context.

### Relevant Files

- `packages/desktop/src/renderer/commands/desktopCommands.ts` — command registry, availability, and dispatch.
- `packages/desktop/src/renderer/commands/desktopCommands.test.ts` — pure routing and shortcut coverage.
- `packages/desktop/src/renderer/state/desktopViewStore.ts` — Settings return context, focus requests, and announcements.
- `packages/desktop/src/renderer/state/desktopViewStore.test.ts` — restoration and fallback tests.
- `packages/desktop/src/renderer/main.tsx` — installs commands, help, live status, and restorative Settings navigation.
- `packages/desktop/src/renderer/main.test.tsx` — keyboard, focus, landmark, and Settings round-trip coverage.

### Dependent Files

- `packages/desktop/src/renderer/features/inspector/CardInspector.tsx` — registers composer, review, and back focus targets.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — centralized commands and responsive workbench.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — next-action priority and accessible review.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — review availability.
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](adrs/adr-005.md) — text-entry precedence.
- [ADR-006: Require Packaged Native Lifecycle-Matrix Verification](adrs/adr-006.md) — native accessibility evidence remains required.

## Deliverables

- Central command registry, shortcut help, and context-aware routing.
- Restorative Settings navigation, focus management, and live announcements.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for keyboard-only navigation and Settings round-trip **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Give every required command a unique ID/binding and non-empty visible label.
  - [ ] Render shortcut help from the same definitions used by dispatch.
  - [ ] Suppress conflicts inside input, textarea, contenteditable, IME, and repeated keydown.
  - [ ] Dispatch available commands once and announce unavailable commands without mutation.
  - [ ] Follow host order for next actionable and deterministic projected order for adjacent cards.
  - [ ] Restore exact valid Settings origin context and choose/announce fallback when identities disappear.
- Integration tests:
  - [ ] Focus composer and review through commands from every supported workbench mode.
  - [ ] Close/back to the saved board in wide and narrow layouts.
  - [ ] Complete board → Settings → return without losing card, attempt, review, draft, or anchor context.
  - [ ] Keep Settings reachable from board, workbench, review, and narrow modes.
  - [ ] Preserve landmarks, headings, `aria-current`, visible focus, live status, and reduced motion.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- At least 95% of the defined critical path is keyboard-completable in acceptance scenarios.
- Shortcut labels, dispatch behavior, focus, and help remain one coherent contract.
