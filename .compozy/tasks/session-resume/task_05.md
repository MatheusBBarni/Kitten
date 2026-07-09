---
status: pending
title: "Reload confirmation probe in selfcheck"
type: test
complexity: medium
dependencies:
  - task_04
---

# Task 05: Reload confirmation probe in selfcheck

## Overview
The live-resume promise depends on each pinned adapter reloading a prior session, which the research verified but Kitten has not exercised through its own client.
This adds a reload confirmation probe to the `selfcheck` command that creates a session, reloads it by id in a fresh connection, and reports whether history re-streamed; it is the PRD Phase-1 go/no-go gate.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a probe to the self-check flow that, per configured agent, connects, creates a session, reloads that session id in a fresh connection, and reports one of: reload confirmed, capability absent, or reload failed.
- MUST report each agent's advertised `loadSession` capability from `ReadyState.canLoadSession`.
- MUST surface the probe result in the `selfcheck` command output as clear pass/fail lines per agent.
- MUST treat a reload that streams no history as a failure, not a pass.
- MUST NOT run against real adapters in the default unit test suite; the real end-to-end run is a manual/nightly `selfcheck` invocation.

## Subtasks
- [ ] 5.1 Add a probe routine that reloads a just-created session id in a fresh connection
- [ ] 5.2 Classify the outcome (confirmed / capability-absent / failed) per agent
- [ ] 5.3 Surface the result in the `selfcheck` output
- [ ] 5.4 Cover the outcome classification with fake connections in unit tests
- [ ] 5.5 Document the manual/nightly real-adapter run

## Implementation Details
Modify `src/app/selfCheck.ts` to add the probe and its report lines, using the `loadSession` method and `ReadyState.canLoadSession` from task_04.
See the TechSpec "Testing Approach" (Integration Tests) and "Development Sequencing" step 3, plus ADR-004 and ADR-002 (a negative result reopens the read-only fallback).

### Relevant Files
- `src/app/selfCheck.ts` — the self-check harness to extend
- `src/agent/agentConnection.ts` — `loadSession` and `canLoadSession` (task_04)
- `src/config/configLoader.ts` — the configured agents to probe

### Dependent Files
- `package.json` — the `selfcheck` script runs this
- `test/` — an opt-in/nightly integration run may live here

### Related ADRs
- [ADR-004: Live Restore via loadSession Replay](../adrs/adr-004.md) — the probe verifies the reload contract
- [ADR-002: V1 Rollout Shape](../adrs/adr-002.md) — a failing probe reopens the read-only-floor fallback

## Deliverables
- A reload confirmation probe in the self-check flow with per-agent pass/fail output
- Documentation of the manual/nightly real-adapter run
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test (opt-in) exercising the probe against a fake reload-capable agent **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] a fake connection that reloads and re-streams history yields "reload confirmed"
  - [ ] a fake advertising `loadSession: false` yields "capability absent"
  - [ ] a fake whose reload streams zero history yields "reload failed"
  - [ ] the probe reports a result line for every configured agent
- Integration tests:
  - [ ] (opt-in) the probe run against a reload-capable fake agent end-to-end reports confirmed for both agents
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `selfcheck` reports per-agent reload confirmation
- The default suite does not spawn real adapters; the real run is documented as manual/nightly
