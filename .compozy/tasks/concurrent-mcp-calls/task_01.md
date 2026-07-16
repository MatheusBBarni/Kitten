---
status: pending
title: Add targeted clarification cancellation and bridge telemetry
type: backend
complexity: high
---

# Task 01: Add targeted clarification cancellation and bridge telemetry

## Overview

Give the controller the exact-request lifecycle control required when one
authenticated child socket fails, while preserving whole-route cancellation for
session replacement and disposal. Add the closed, opt-in bridge-outcome telemetry
path so maintainers can observe capacity and availability categories without
recording user or transport content.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST let a `ClarificationRequestHandle` cancel only its own active, queued, or suspended clarification with an explicit session-loss reason; repeated cancellation and late settlement MUST be inert.
- 2. MUST retain existing route-level cancellation for replacement, conversation close, and controller disposal; targeted cancellation MUST NOT cancel an unrelated same-route interaction.
- 3. MUST make controller-owned `agent_run` start rejection project a bounded busy or unavailable category without bridge-side string matching of arbitrary errors.
- 4. MUST map bridge failure reasons to only `capacity_limited`, `unavailable`, or `invalid_request` through the existing opt-in local recorder; the recorder API and serialized records MUST contain no prompt, task, route, capability, endpoint, call ID, session ID, or raw error.
- 5. MUST preserve disabled-recorder no-op behavior and the existing `agent_run_control` event contract.
</requirements>

## Subtasks

- [ ] 1.1 Expose idempotent exact-request clarification cancellation from the controller-owned interaction seam.
- [ ] 1.2 Keep whole-session clarification invalidation distinct from a single child connection loss.
- [ ] 1.3 Establish bounded controller outcomes for concurrent and unavailable agent-run starts.
- [ ] 1.4 Add the closed bridge-outcome recorder event and controller callback wiring.
- [ ] 1.5 Cover lifecycle isolation, outcome mapping, disabled telemetry, and privacy-negative cases.

## Implementation Details

See TechSpec sections “Core Interfaces”, “Controller and interaction coordinator”,
“Monitoring and Observability”, and “Testing Approach”. Keep the controller as
the owner of generation and interaction authority; `kittenMcpBridge` will consume
this targeted contract in the following bridge task.

### Relevant Files

- `src/app/controller.ts` — defines `ClarificationRequestHandle`, the interaction coordinator, bridge construction, and agent-run control.
- `src/app/controller.test.ts` — has injectable bridge factories and current clarification/delegation lifecycle coverage.
- `src/telemetry/recorder.ts` — owns the closed event union, recorder façade, opt-in gate, and JSONL serialization boundary.
- `src/telemetry/recorder.test.ts` — verifies disabled behavior, exact keys, and raw-content exclusion patterns.
- `src/app/kittenMcpBridge.ts` — supplies the closed failure-reason callback that the controller must project without leaking it.

### Dependent Files

- `src/app/kittenMcpBridge.ts` — will invoke the targeted cancellation and consume semantic controller outcomes for per-socket settlement.
- `src/app/kittenMcpBridge.test.ts` — will exercise the new controller contract through bridge lifecycle cases.
- `src/telemetry/recorder.ts` consumers — retain the existing `agent_run_control` vocabulary alongside the new bridge-outcome event.

### Related ADRs

- [ADR-001: Keep concurrent MCP admission controller-owned and bounded](adrs/adr-001.md) — keeps authority and capacity controller-owned.
- [ADR-003: Admit independently authenticated sockets within route capacity](adrs/adr-003.md) — requires exact interaction cancellation rather than route-wide disconnect teardown.
- [ADR-004: Project closed MCP failures without replaying ambiguous work](adrs/adr-004.md) — constrains the closed telemetry vocabulary and no-replay behavior.

## Deliverables

- An idempotent, controller-owned exact-request cancellation capability.
- Bounded busy/unavailable controller outcome projection for bridge-controlled starts.
- One closed, opt-in, content-free bridge-outcome recorder event and controller wiring.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for controller-to-recorder lifecycle boundaries **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Cancelling one active clarification by handle settles only that request and does not remove another same-session queued or suspended clarification.
  - [ ] Repeating handle cancellation, timing out after cancellation, or resolving after cancellation leaves the original terminal outcome unchanged.
  - [ ] A concurrent same-route `agent_run.start` projects busy, while a stale or unavailable route projects unavailable without relying on error-message text.
  - [ ] Enabled telemetry emits only an exact `capacity_limited`, `unavailable`, or `invalid_request` bridge category and retains the existing `agent_run_control` record shape.
  - [ ] Disabled telemetry creates no record or sink write, and serialized sentinel values for prompts, tasks, endpoints, capabilities, IDs, and raw errors are absent.
- Integration tests:
  - [ ] An injected bridge failure callback reaches the controller recorder once with the mapped closed category while no runtime/session identity is serialized.
  - [ ] Session replacement still cancels every clarification for that generation after targeted cancellation support is introduced.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A child connection can be cancelled precisely without weakening generation or route-wide teardown rules.
- Bridge observability is opt-in, local, bounded, and structurally content-free.
