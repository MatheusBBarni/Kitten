---
status: completed
title: "Add Reactive Statusline Preference and Modal State"
type: backend
complexity: medium
---

# Task 03: Add Reactive Statusline Preference and Modal State

## Overview

Add the app-store state needed to show a saved statusline preference and drive the transient `/statusline` modal without putting UI state in React. Narrow selectors and immutable updates keep streamed agent activity from repainting unrelated statusline consumers.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add resolved statusline preference state and transient overlay payload to the external app store, using the phases defined in the TechSpec "Data Models" section.
- MUST keep request text, raw responses, failure reasons, preset selection, and preview data transient; no modal edit may write config or telemetry.
- MUST expose narrow selectors for the footer preference and the modal slot, preserving `Object.is`-based subscription behavior for unrelated state changes.
- MUST use immutable state transitions, treat identical preference writes as no-ops, and support closing or cancelling the modal without changing the saved preference.
- MUST retain existing overlay slots and session reducer ownership unchanged.
</requirements>

## Subtasks

- [x] 3.1 Add legacy-compatible statusline preference state during app-store initialization.
- [x] 3.2 Define the transient modal payload and its valid disclosure, request, waiting, preview, failure, and preset states.
- [x] 3.3 Add immutable store methods for setting a resolved preference and opening, updating, or closing the modal.
- [x] 3.4 Export narrow preference and overlay selectors for footer and modal consumers.
- [x] 3.5 Add store and selector coverage for identity, cancellation, and unrelated-update behavior.

## Implementation Details

Follow TechSpec "Component Overview" and "Data Models" plus the repository layering rule: the store owns mutable application state while the view consumes selectors and never stores statusline state locally. Use the established theme-preference and overlay patterns as structural references without coupling statusline persistence to theme debounce behavior.

### Relevant Files

- `src/store/appStore.ts` — add preference fields, modal payload, immutable actions, and initialization defaults.
- `src/store/appStore.test.ts` — verify state transitions, no-op writes, cancellation, and preservation of unrelated state.
- `src/store/selectors.ts` — add narrow selectors for statusline preference and modal state.
- `src/store/selectors.test.ts` — verify selector output and subscription isolation.

### Dependent Files

- `src/index.ts` — seeds saved preferences and applies external config reloads through the new store action.
- `src/app/statuslineFlow.ts` — moves the modal through request, preview, failure, and preset states.
- `src/ui/StatuslineOverlay.tsx` — renders the modal through its narrow selector.
- `src/ui/StatusStrip.tsx` — reads only the saved preference selector.

### Related ADRs

- [ADR-002: Make the statusline flow immediate, disclosed, and conversational-first](adrs/adr-002.md) — requires clear disclosure and recovery states.
- [ADR-003: Persist a structured statusline preference and share one pure renderer](adrs/adr-003.md) — separates persisted preference from transient preview edits.

## Deliverables

- Reactive saved preference state with a legacy-compatible initial value.
- Store-owned transient modal payload and narrow selectors for UI consumers.
- Colocated store and selector regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for reactive statusline state composition **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] A fresh store exposes a null layout and false acknowledgement without changing existing theme or overlay defaults.
  - [x] Setting a new preference changes only the preference slice, while setting the same value preserves subscriber identity.
  - [x] Opening each valid modal phase retains its selected session and transient payload without mutating the persisted preference.
  - [x] Closing or cancelling a preview clears transient state and leaves the saved layout unchanged.
  - [x] Updating a session, shell state, or unrelated overlay does not notify a statusline-preference selector subscriber.
- Integration tests:
  - [x] A mounted narrow selector consumer observes acknowledgement, preview, and close transitions while a streamed update in another session leaves its render count unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Statusline UI state is externally owned, immutable, and non-persistent until a controller confirmation succeeds.
- Footer and modal consumers subscribe only to the smallest state slice they need.
