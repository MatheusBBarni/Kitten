---
status: completed
title: "Expose tab actions and protect nullable-session consumers"
type: refactor
complexity: high
---

# Task 06: Expose tab actions and protect nullable-session consumers

## Overview

Expand the controller action boundary so UI code can create, rename, select, background, reopen, close, and route attention without touching runtime objects. Make application consumers fail safely when no Visible conversation is selected while retaining background attention and preview-first handoff safety.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST expose fail-soft conversation actions through `ControllerActions` and avoid direct ACP, connection, or store writes from UI components.
2. MUST create fresh conversations from the selected provider/CWD or a configured default, returning `null` with a workspace notice when no provider exists.
3. MUST normalize valid tab names, treat unknown/Closed IDs as no-ops, and leave backgrounding free of ACP effects.
4. MUST make prompt, cancel, model, handoff, focus, and attention actions safe when `selectedVisibleId` is null.
5. MUST retain notifier edge detection for background conversations independently of current selection and preserve content-free behavior.
</requirements>

## Subtasks
- [x] 6.1 Define the complete UI-safe conversation action surface.
- [x] 6.2 Support create, rename, select, background, reopen, close, and attention routing outcomes.
- [x] 6.3 Make focused-session actions and handoff fail safely with no visible selection.
- [x] 6.4 Preserve background attention notification and closed-conversation exclusion.
- [x] 6.5 Update fakes and action-facing tests for the expanded contract.

## Implementation Details

Use the TechSpec’s **Core Interfaces**, **Local Action Surface**, **Focus Authority and Empty Workspace**, and **Availability and Retry** sections. Action failures should resolve safely through the existing controller error path rather than reject into React.

### Relevant Files
- `src/app/actions.ts` — ActionDeps, ControllerActions, focused defaults, and UI effect boundary.
- `src/app/controller.test.ts` — action default, focus, attention, creation, and failure coverage.
- `src/app/handoff.ts` — preview-first handoff behavior with a nullable source.
- `src/app/handoff.test.ts` — source/target safety and overlay-opening tests.
- `src/notify/notifier.ts` — focus-gated notification latch and background attention behavior.
- `src/notify/notifier.test.ts` — transition, deduplication, and focus-gate coverage.

### Dependent Files
- `src/app/controller.ts` — creates, restores, cancels, and disposes runtimes behind actions.
- `src/store/selectors.ts` — nullable focus and attention selectors used by action consumers.
- `src/ui/CockpitApp.tsx` — invokes actions for prompts, focus, recovery, and overlays.
- `src/ui/PromptEditor.tsx` — must use action behavior without fabricating a session ID.
- `src/ui/TabWorkspace.tsx` — invokes create and select actions only.
- `src/telemetry/recorder.ts` — observes action-related focus and attention transitions safely.

### Related ADRs
- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — defines lifecycle safety and background attention.
- [ADR-003: Use a Mutable Registry with One Dedicated Runtime per Conversation](adrs/adr-003.md) — keeps runtime effects controller-owned.
- [ADR-004: Separate Workspace Metadata from Session State and Persist a Versioned Workspace](adrs/adr-004.md) — makes null selection a valid workspace condition.

## Deliverables
- Expanded ControllerActions contract with fail-soft tab lifecycle and navigation operations.
- Nullable-safe handoff and notifier behavior without direct UI-to-runtime coupling.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering no-selection and background-attention flows **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Fresh creation inherits selected provider/CWD, uses a configured default from an empty workspace, and returns null without throwing when none exists.
  - [x] Rename rejects whitespace-only values; select/background/reopen/close handle unknown and Closed IDs safely.
  - [x] Empty selection makes prompt, cancel, model, and handoff operations inert without opening an overlay or assembling a bundle.
  - [x] Attention routing reopens/selects an eligible background conversation and no-ops when none exists.
  - [x] A background attention transition notifies once even when no tab is selected; Closed entries never notify.
- Integration tests:
  - [x] UI-facing action calls stay within ControllerActions and isolate failed creation/cancellation from sibling conversations.
  - [x] Handoff remains preview-first and safely declines unavailable, removed, or null source targets.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Every tab lifecycle operation is accessible through a fail-soft action boundary.
- No application consumer assumes a focused SessionId exists.
