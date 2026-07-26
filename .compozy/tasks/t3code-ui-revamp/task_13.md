---
status: pending
title: Build the review panel and bounded per-file diff viewer
type: frontend
complexity: high
---

# Task 13: Build the review panel and bounded per-file diff viewer

## Overview

Build the card workbench's trustworthy review surface. It loads a small
manifest first, pages only the selected text file, makes non-reviewable states
explicit, and permits approval or draft preparation only from host-declared
current evidence.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The review panel MUST load a manifest before enabling any disposition action.
2. Changed-file summaries MUST remain bound to the exact card, attempt, generation, evidence, and opaque worktree-binding identity.
3. The diff viewer MUST request only the selected file's bounded chunks and MUST NOT concatenate an unbounded full evidence set in renderer state.
4. Binary, oversized, unsafe, missing, stale, loading, and unavailable states MUST have explicit text and recovery guidance.
5. Approve MUST submit the complete evidence precondition and remain disabled unless host availability is current and complete.
6. Selecting Request changes MUST seed and focus an isolated editable draft while performing zero RPC mutation.
7. File selection, chunk navigation, dispositions, draft focus, and status changes MUST be keyboard and screen-reader accessible.
</requirements>

## Subtasks

- [ ] 13.1 Present manifest identity, currentness, and ordered file summaries.
- [ ] 13.2 Load and navigate bounded chunks for only the selected text file.
- [ ] 13.3 Render binary, limit, safety, stale, missing, loading, and unavailable states.
- [ ] 13.4 Enable evidence-preconditioned approval only for current complete evidence.
- [ ] 13.5 Open and focus a mutation-free Request changes draft.
- [ ] 13.6 Preserve selected file/draft through stale refresh and reject late chunk races.
- [ ] 13.7 Add review-state, paging, mutation, keyboard, and privacy-boundary coverage.

## Implementation Details

Follow the TechSpec **Review Interaction Contracts**, **Review disposition**, and
**API Endpoints** sections. Host availability is authoritative; the renderer
must not infer currentness from local timestamps or revision equality.

### Relevant Files

- `packages/desktop/src/renderer/features/inspector/ReviewPanel.tsx` — manifest state, file selection, and disposition controls.
- `packages/desktop/src/renderer/features/inspector/ReviewPanel.test.tsx` — review-state and interaction coverage.
- `packages/desktop/src/renderer/features/inspector/DiffViewer.tsx` — bounded text chunks and non-text states.
- `packages/desktop/src/renderer/features/inspector/DiffViewer.test.tsx` — chunk-navigation and race coverage.
- `packages/desktop/src/renderer/features/inspector/CardInspector.tsx` — integrates review with the producing attempt.
- `packages/desktop/src/renderer/features/inspector/CardInspector.test.tsx` — inspector-level review integration.

### Dependent Files

- `packages/desktop/src/renderer/features/inspector/useInspectorCommands.ts` — approval and Request changes actions.

### Related ADRs

- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — fail-closed action availability.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — manifest-first review and bounded paging.

## Deliverables

- Manifest-first review panel and bounded per-file diff viewer.
- Evidence-preconditioned approval and mutation-free Request changes preparation.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for inspector review, stale refresh, and unified submission **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Keep dispositions disabled while the manifest is loading or unavailable.
  - [ ] Enable both actions only for a valid current manifest.
  - [ ] Show exact recovery guidance for stale, missing, oversized, and unsafe evidence.
  - [ ] Request the first chunk only after selecting a text file and follow exact `nextOffset`.
  - [ ] Ignore late chunks after switching files.
  - [ ] Render binary metadata without requesting text patch content.
  - [ ] Submit exact evidence preconditions for approval.
  - [ ] Seed Request changes without any RPC mutation.
- Integration tests:
  - [ ] Load manifest metadata before requesting any diff chunk.
  - [ ] Preserve draft/file selection and reload the manifest after host stale rejection.
  - [ ] Explicitly send a request-changes draft through unified submission exactly once.
  - [ ] Traverse files, chunks, actions, and draft in logical keyboard order.
  - [ ] Keep paths, patch content, and drafts out of telemetry.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Review mutations are impossible while evidence is stale, incomplete, or unsafe.
- Renderer memory and RPC use remain bounded while navigating large reviews.
