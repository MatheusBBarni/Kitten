---
status: pending
title: Present and recover continuation drafts in the composer
type: frontend
complexity: high
---

# Task 05: Present and recover continuation drafts in the composer

## Overview

Update the PromptEditor to make the post-interrupt continuation path understandable and lossless: accept one follow-up while settlement is pending, keep later drafts editable, and restore the queued text locally when the user presses Escape again or a safe fallback occurs.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The composer MUST show an explicit, content-free waiting or recovery state for an accepted post-interrupt continuation.
- 2. The first valid continuation submission during the hard-stop settlement window MUST be accepted once, while later text remains editable locally.
- 3. Escape during a queued continuation MUST restore that queued draft locally and MUST NOT invoke another provider cancellation.
- 4. Any controller-reported unsafe outcome MUST surface the retained draft and `/new` recovery guidance without attempting a send.
- 5. The continuation branch MUST run before generic active-turn steering or cancellation only when its dedicated selector reports an eligible post-interrupt state; it MUST NOT infer provider settlement from `status`.
- 6. Existing modal-overlay, slash-menu, file-completion, active-steering, approval, clarification, command, history, and idle-Escape precedence MUST remain intact.
</requirements>

## Subtasks

- [ ] 5.1 Subscribe to the dedicated continuation status and one-time recovery selectors alongside the existing steering selectors.
- [ ] 5.2 Render concise content-free queued, waiting, dispatching, and `/new` recovery copy without displaying request IDs, capability data, or provider errors.
- [ ] 5.3 Route exactly the first eligible hard-stop follow-up to `queuePostInterruptContinuation`, preserving the later native-editor draft and the normal send/steer paths outside that state.
- [ ] 5.4 After component-local overlay/completion precedence, route Escape for a queued continuation to `recoverPostInterruptContinuation` before the ordinary working-turn `cancel` branch.
- [ ] 5.5 Copy one-time recovery blocks into the native editor buffer only when it is empty; acknowledge only after that copy succeeds, and retain a changed draft with visible recovery guidance otherwise.
- [ ] 5.6 Extend the UI fake's typed controller surface and add rendered-state, submission, recovery, and keyboard-precedence coverage beside the existing steering tests.

## Implementation Details

Follow the TechSpec “UI Behavior,” “Accessibility and UX Copy,” and “Race Matrix” sections. The composer remains a presentation layer that calls controller actions; it must not infer provider settlement itself.

Use the established steering implementation as the local pattern: `PromptEditor` already derives `selectSessionSteeringStatus` and `selectSessionSteeringRecovery`, protects a one-time native-buffer restore with a ref, and handles Escape in `onKeyDown`. The continuation state must be a separate selector/action path because it is an ordinary next prompt rather than steering. Preserve the existing ordering where modal and completion handlers consume their own keys; once the editor handles bare Escape, a queued continuation takes precedence over its generic `status === "working"` cancellation branch.

### Relevant Files
- `src/ui/PromptEditor.tsx` — composer submission, Escape handling, status copy, and recovery buffer transfer.
- `src/ui/PromptEditor.test.tsx` — colocated renderer tests for status copy, ordinary-continuation acceptance, recovery, and key precedence.
- `test/fakeController.ts` — typed `ControllerActions` double and call recording for queue, recover, and acknowledgement assertions.

### Dependent Files
- `src/store/selectors.ts` — supplies content-free continuation status and one-time recovery projections.
- `src/app/actions.ts` — supplies continuation queue, recover, and acknowledge actions.
- `src/ui/cockpitContext.tsx` — continues to expose the controller as the UI's only action boundary.
- `src/ui/CockpitApp.tsx` — retains its existing composition role; no provider-state inference belongs in the shell.

### Related ADRs
- [ADR-001: Scope the feature to explicit hard stops in V1](adrs/adr-001.md) — limits the UI entry point.
- [ADR-002: Preserve one safe continuation with explicit recovery](adrs/adr-002.md) — defines visible lossless recovery.

## Deliverables

- Composer continuation status and recovery presentation.
- One-time acceptance, second-Escape recovery, and native-editor transfer behavior.
- PromptEditor and fake-controller test updates that exercise the real selector/action contract.

## Tests

- Unit tests:
  - [ ] Queued, waiting, dispatching, and recovery states render distinct content-free explanatory copy; recovery includes `/new` guidance without request IDs, capability details, or raw provider errors.
  - [ ] Exactly one eligible follow-up calls `queuePostInterruptContinuation`; the queued text clears only after local acceptance and a later editor draft remains editable.
  - [ ] Bare Escape for a queued continuation calls `recoverPostInterruptContinuation` and does not call `cancel`; when no continuation is queued, the existing working/idle Escape behavior is unchanged.
  - [ ] An empty editor receives the exact multiline recovered draft once and acknowledges once; a non-empty changed draft is retained with recovery guidance and receives no acknowledgement.
- Integration tests:
  - [ ] A restored continuation can subsequently use the ordinary composer path, never steering, and its recovery selector is cleared only after acknowledgement.
  - [ ] Slash-menu, file-completion, and modal overlay Escape handling retain precedence; after they yield to the editor, continuation recovery precedes generic hard cancel.
  - [ ] Active steering, approval, clarification, prompt history, and file-reference behavior retain their existing contracts while no continuation selector is eligible.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Users can distinguish waiting, recovery, and normal editing without exposing provider internals.
- No composer interaction discards a queued continuation draft or sends it without controller proof.
