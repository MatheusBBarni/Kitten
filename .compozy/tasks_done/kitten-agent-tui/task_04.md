---
status: completed
title: "Config loading and agent readiness"
type: backend
complexity: medium
dependencies:
  - task_03
---

# Task 04: Config loading and agent readiness

## Overview
Load the application config that defines the two agents' spawn commands and telemetry opt-in, and validate each agent at startup by completing the ACP `initialize` handshake.
This produces the clear per-agent ready / not-ready state the cockpit needs so a misconfigured or unauthenticated agent fails legibly instead of silently.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST load an `AppConfig` (per TechSpec "Data Models") containing the two `AgentConfig` entries and the telemetry opt-in flag.
- MUST ship sensible default config for Claude Code (via its ACP wrapper) and Codex, per ADR-005.
- MUST validate each agent's readiness by spawning it and completing the `initialize` handshake, not merely by checking the binary exists.
- MUST return a distinct, legible not-ready reason per failure mode (missing binary, handshake failure, capability mismatch).
- MUST ensure one agent failing readiness does not block loading or the other agent.
</requirements>

## Subtasks
- [x] 4.1 Implement `AppConfig`/`AgentConfig` loading with defaults for the two agents
- [x] 4.2 Implement a readiness checker that runs the `initialize` handshake via `AgentConnection.connect`
- [x] 4.3 Map each failure mode to a distinct, human-readable not-ready reason
- [x] 4.4 Ensure independent per-agent readiness (one failure does not fail the other)
- [x] 4.5 Cover config parsing and each readiness outcome with tests

## Implementation Details
Create the config and readiness modules. See TechSpec "Integration Points" (readiness via handshake) and ADR-005 (config-driven spawn). Readiness uses `AgentConnection.connect` from task_03.

### Relevant Files
- `src/config/configLoader.ts` — new; `AppConfig` loading and defaults
- `src/config/readiness.ts` — new; per-agent readiness checker
- `src/config/configLoader.test.ts`, `src/config/readiness.test.ts` — new; tests

### Dependent Files
- `src/app/controller.ts` (task_07) — reads config to construct connections and reports readiness
- `src/config/firstRun.ts` (task_14) — uses readiness reasons to guide setup

### Related ADRs
- [ADR-005: BYO Agents via Config-Driven ACP Subprocess Spawn](adrs/adr-005.md) — config shape and readiness handshake

## Deliverables
- Config loader with defaults and a per-agent readiness checker
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test running readiness against the mock ACP agent **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Loading with no user overrides returns the two default `AgentConfig` entries
  - [x] A user override for an agent's `command`/`args` replaces the default for that agent only
  - [x] Telemetry opt-in defaults to off and is honored when set true
  - [x] A missing agent binary yields a not-ready result with a "binary not found" reason
- Integration tests:
  - [x] Against a mock agent that completes `initialize`, readiness returns ready
  - [x] Against a mock agent that rejects `initialize`, readiness returns not-ready with a handshake reason, and the other agent still reports independently
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Each agent reports an independent ready/not-ready state with a specific reason
- Default config launches the two V1 agents without user edits when their binaries are present
