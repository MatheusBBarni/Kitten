---
status: completed
title: Bind scoped ask_user, Attention Blockers, stage lock, and notifications
type: backend
complexity: high
---

# Task 14: Bind scoped ask_user, Attention Blockers, stage lock, and notifications

## Overview

Bind the existing strict question/outcome and authenticated-capability patterns
to desktop attempt generations, then make Attention Blockers durable, visible,
and answer-first. A blocker preserves workflow stage, locks movement, and emits
one content-minimized card-scoped notification.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Authenticated bounded ask_user routes MUST bind to attempt ID and generation and reject invalid, duplicate, stale, terminal, and revoked routes fail-closed.
2. Each attempt MUST allow at most one active blocker and persist its form, active state, terminal outcome, and notification result transactionally.
3. Raising a blocker MUST set needs_attention, preserve Workflow Stage, and stage-lock every movement.
4. Submitted, skipped, timed-out, and cancelled outcomes MUST persist before the same attempt resumes; ordinary composer/queue dispatch MUST wait for that terminal record.
5. One notification per active blocker MUST use card/action-only copy and MUST exclude prompt, answer, code, provider, path, and credential content.
6. Notification failure MUST remain observable without resolving, losing, or duplicating a blocker.
</requirements>

## Subtasks

- [x] 14.1 Register, forward, revoke, and reject stale attempt-generation routes.
- [x] 14.2 Persist Attention Blocker creation, outcome, and one-active-blocker enforcement.
- [x] 14.3 Apply needs_attention status and Stage Lock through card authority.
- [x] 14.4 Persist outcome before same-attempt resume and queue release.
- [x] 14.5 Add idempotent card-safe notification diagnostics.
- [x] 14.6 Prove bridge, persistence, lock, and notification behavior.

## Implementation Details

Follow the TechSpec Scoped ask_user bridge and Attention Blockers integration
points. Reuse only the existing protocol mechanics; desktop owns mapping,
lifecycle, durable audit state, and notification policy.

### Relevant Files

- packages/desktop/src/attention/attemptAskUserBridge.ts — attempt-generation capability routes.
- packages/desktop/src/attention/attemptAskUserBridge.test.ts — auth and stale-route coverage.
- packages/desktop/src/attention/attentionCoordinator.ts — blocker lifecycle.
- packages/desktop/src/attention/attentionCoordinator.test.ts — transaction and outcome coverage.
- packages/desktop/src/board/cardTransitionCoordinator.ts — needs-attention lock transitions.
- packages/desktop/src/notifications/cardNotificationService.ts — content-minimized notification service.
- packages/desktop/src/notifications/cardNotificationService.test.ts — idempotency and payload coverage.

### Dependent Files

- packages/tui/src/agent/askUserMcp.ts — strict form/outcome protocol reference.
- packages/tui/src/app/kittenMcpBridge.ts — authenticated route protocol reference.
- packages/tui/src/notify/notifier.ts — best-effort notification injection reference.

### Related ADRs

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — stage lock and input policy.
- [ADR-002: Make Attention Blockers the V1 supervision priority](adrs/adr-002.md) — answer-first supervision.
- [ADR-005: Own queued follow-ups and Attention Blockers in the desktop attempt coordinator](adrs/adr-005.md) — desktop lifecycle authority.

## Deliverables

- Attempt-scoped authenticated ask_user bridge and durable blocker lifecycle.
- Stage-lock transitions and idempotent card-safe notifications.
- Authenticated fake-ACP and notification regression suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for blocker outcome and same-attempt continuation **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Persist submitted, skipped, timed-out, and cancelled outcomes exactly once.
  - [x] Reject stale generation, duplicate call ID, invalid capability, closed attempt, and second active blocker.
  - [x] Verify blocker changes Execution Status only and rejects every stage movement.
  - [x] Verify notification fires once with only card/action metadata and failure leaves blocker unchanged.
- Integration tests:
  - [x] Run a fake ACP scoped route through blocker form, needs_attention, committed outcome, and same-attempt resume.
  - [x] Assert ordinary queue confirmation/submission is unavailable until blocker outcome commits.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every accepted question has one durable terminal outcome before resumption.
- No blocker is missed through a stale route, stage move, or notification failure.
