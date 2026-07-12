---
status: completed
title: "Extended session states and attention derivation"
type: backend
complexity: high
dependencies:
  - task_01
---

# Task 04: Extended session states and attention derivation

## Overview
Extend the session state model with `finished` and `error` by mapping ACP stop reasons and failures at the adapter, then derive the needs-you signal and the selectors that route attention.
This gives the status strip, the overview, and the notifier one truthful, shared state per session and the ordering behind jump-to-next.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST extend `SessionStatus` to `idle | working | awaiting_approval | finished | error`, per the TechSpec "Core Interfaces" section and ADR-006.
- MUST map `PromptStopReason` at the adapter: `end_turn`/`max_tokens`/`max_turn_requests`/`refusal` become `finished`, `cancelled` becomes `idle`, and a thrown prompt, a failed or lost transport, or a subprocess exit becomes `error`.
- MUST add `needsAttention(status)` (true for `awaiting_approval`, `error`, `finished`) and the selectors `selectSessionList` and `selectNextNeedy`, ordering `awaiting_approval` before `error` before `finished`, then by `order`, wrapping around.
- MUST update the status labels and tones so the strip renders the new states.
- SHOULD determine whether the ACP transport surfaces a close or exit signal for `error` detection; if it does not, document the fallback of holding the last known state rather than showing a false `finished`.
</requirements>

## Subtasks
- [x] 4.1 Extend `SessionStatus` and the `status` domain event with `finished` and `error`.
- [x] 4.2 Map the stop reason and connection failures to the new states in the adapter, replacing the unconditional `idle` emit.
- [x] 4.3 Add `needsAttention`, `selectSessionList`, and `selectNextNeedy` with the defined priority and wrap-around.
- [x] 4.4 Add status labels and theme tones for `finished` and `error`.
- [x] 4.5 Investigate the transport close signal for `error` detection and record the fallback if it is absent.

## Findings (subtask 4.5): transport-close detection
The ACP transport already surfaces a close/exit signal, so `error` detection needs no fallback.
`AgentTransport.onClose(cb)` is backed by the subprocess `exited` promise (`src/agent/transport.ts`) and is already covered by `transport.test.ts`.
It was defined but never consumed by `AgentConnection`; task_04 wires it to emit a `status: "error"` domain event on close, guarded by a `closing` flag set at the start of `dispose()` so an intentional teardown's close is not reported as a crash.
Because the signal is real, the ADR-006 fallback (hold the last known state rather than show a false `finished`) is not needed; it would only apply if a future transport could not report exit.

## Implementation Details
Follow the TechSpec "Core Interfaces" section for the status mapping and ADR-006 for the needs-you derivation and priority.
The reducer already applies `status` events, so the work is the enum, the adapter mapping, the derived selectors, and the display labels.
Keep the mapping driven only by terminal stop reasons so `finished` never flickers from a streaming update.

### Relevant Files
- `src/agent/agentConnection.ts` - maps `PromptStopReason` and failures to status events.
- `src/core/types.ts` - `SessionStatus` and the `status` domain event.
- `src/store/selectors.ts` - `needsAttention`, `selectSessionList`, `selectNextNeedy`.
- `src/ui/StatusStrip.tsx` and `src/ui/theme.ts` - labels and tones for the new states.

### Dependent Files
- `src/app/actions.ts` - the jump-to-next action (task_05) consumes `selectNextNeedy`.
- `src/notify/*` - the notifier (task_08) keys off `needsAttention` transitions.

### Related ADRs
- [ADR-006: Attention State Model and Jump-to-Next](../adrs/adr-006.md) - defines the states, the stop-reason mapping, and the needs-you derivation.

## Deliverables
- An extended `SessionStatus` with adapter mapping for every stop reason and failure.
- `needsAttention`, `selectSessionList`, and `selectNextNeedy` with the defined ordering.
- Status labels and tones for `finished` and `error`.
- A documented finding on transport-close detection and its fallback.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests driving a session to `finished` **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] `end_turn`, `max_tokens`, `max_turn_requests`, and `refusal` each map to `finished`; `cancelled` maps to `idle`.
  - [x] A prompt call that throws and a transport that closes each map to `error`.
  - [x] `needsAttention` is true for `awaiting_approval`, `error`, and `finished`, and false for `working` and `idle`.
  - [x] `selectNextNeedy` returns an `awaiting_approval` session ahead of a `finished` one, and wraps past the focused session to an earlier needy one.
  - [x] `selectNextNeedy` returns null when no session needs attention.
- Integration tests:
  - [x] Drive a mock session to an `end_turn` stop and assert the store shows `finished` and the status strip renders the `finished` label.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every stop reason and failure maps to the correct state
- `selectNextNeedy` ordering and wrap-around match the ADR-006 priority
