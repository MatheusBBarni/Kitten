---
status: completed
title: "Implement safe per-tab close and permission teardown"
type: refactor
complexity: high
---

# Task 05: Implement safe per-tab close and permission teardown

## Overview

Implement the safety-critical close path for a single conversation without affecting sibling work. A close operation must be idempotent, preserve state until teardown succeeds, and settle only the permissions and ACP work owned by the selected conversation.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST distinguish direct idle close from explicit active-work outcomes: background, cancel deliberately, and keep open.
2. MUST perform targeted teardown exactly once per conversation and retain its Visible or Background state when cancellation or disposal fails.
3. MUST settle only queued permission requests owned by the closing SessionId and advance the approval queue safely.
4. MUST ignore late adapter events after closing begins or after a runtime is removed.
5. MUST select the deterministic next Visible conversation or an empty workspace only after a successful close.
</requirements>

## Subtasks
- [x] 5.1 Define the per-conversation close lifecycle and idempotent outcome contract.
- [x] 5.2 Preserve active-work choices without silent cancellation.
- [x] 5.3 Settle only owned permission requests and retain approval attribution.
- [x] 5.4 Prevent late events and repeated close requests from changing removed state.
- [x] 5.5 Surface retryable unavailable state when teardown cannot complete.

## Implementation Details

Follow the TechSpec’s **Close Policy** and **Idempotent Teardown State Machine** sections. Keep all connection, cancellation, permission-promise, unsubscribe, and disposal work controller-owned; UI invokes the action boundary only.

### Relevant Files
- `src/app/controller.ts` — runtime ownership, permission queue, cancellation, and disposal flows.
- `src/app/controller.test.ts` — permission attribution, teardown, and concurrency fixtures.
- `src/agent/agentConnection.ts` — permission handler lifecycle and intentional-close safeguards.
- `src/agent/agentConnection.test.ts` — subscription, dispose, and callback behavior.
- `src/ui/ApprovalPrompt.tsx` — topmost approval identity and queue-advance behavior.
- `src/ui/ApprovalPrompt.test.tsx` — stale response, Escape, and modal ownership tests.

### Dependent Files
- `src/store/appStore.ts` — teardown state, lifecycle commit, execution-slice removal, and focus fallback.
- `src/store/selectors.ts` — approval visibility and conversation attention state.
- `src/app/actions.ts` — UI-safe close outcome action.
- `src/ui/CockpitApp.tsx` — approval precedence over tab UI.
- `src/ui/TabDialog.tsx` — active-work choices presented to the user.
- `src/core/workspace.ts` — lifecycle and closing invariants.

### Related ADRs
- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — prohibits silent active-work cancellation.
- [ADR-003: Use a Mutable Registry with One Dedicated Runtime per Conversation](adrs/adr-003.md) — requires isolated teardown and permission ownership.

## Deliverables
- Per-conversation close state machine with explicit active-work outcomes.
- Targeted permission settlement, late-event guards, retryable teardown failures, and deterministic focus fallback.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering active close, queued permissions, and teardown isolation **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Idle close disposes only the targeted runtime, removes execution/workspace state after success, and chooses the correct next focus.
  - [x] Working/awaiting-approval close sends targeted cancellation only for that conversation; error/finished close never sends a spurious turn cancel.
  - [x] Background and keep-open outcomes leave ACP, subscriptions, and lifecycle untouched as specified.
  - [x] Double-close calls share a result and issue cancellation/disposal at most once.
  - [x] Teardown failure retains lifecycle, marks finite unavailable state, and leaves siblings usable.
- Integration tests:
  - [x] Closing a tab with a visible or queued permission resolves only its own request and preserves FIFO handling for other sessions.
  - [x] Late stream/permission events after close cannot mutate the removed conversation or target the selected sibling.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- A tab close never silently cancels unrelated or active work.
- Permission prompts and runtime teardown remain correctly attributed by SessionId.
