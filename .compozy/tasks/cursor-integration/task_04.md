---
status: completed
title: "Extend runtime orchestration and content-free telemetry for Cursor"
type: backend
complexity: high
---

# Task 04: Extend runtime orchestration and content-free telemetry for Cursor

## Overview

Integrate Cursor's resolved profile and lightweight preflight into every long-lived controller path, while keeping its failure isolated from ready siblings. Extend local opt-in telemetry with bounded provider/outcome values so Cursor availability is observable without recording content or environment details.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Controller runtime registration, fresh-run, dynamic-conversation, and restore paths MUST retain the resolved runtime profile without inspecting ACP types or calling authenticate.
- 2. The lightweight Cursor preflight MUST occur before `createConnection()` or `connect()` for every long-lived Cursor path, and a failed preflight MUST not construct a connection.
- 3. The controller MUST NOT call a disposable full readiness handshake and then create a second Cursor process; successful preflight continues through one unchanged generic long-lived adapter lifecycle.
- 4. Preflight or normalized authentication failure MUST mark only Cursor unavailable with its recovery text while ready Claude Code and Codex runtimes remain promptable and intact.
- 5. `TabTelemetry` MUST accept `ProviderKind` so a Cursor-created tab flows through the same generic action facade as every other provider.
- 6. Local telemetry MUST be opt-in and content-free, recording only provider and fixed readiness outcome enums: `ready`, `binary_missing`, `version_mismatch`, `uncertified_recipe`, `authentication_required`, or `handshake_failed`.
- 7. Telemetry MUST NOT serialize prompts, source, credentials, cwd, paths, commands, arguments, exact versions, runtime profiles, or raw error text.
</requirements>

## Subtasks
- [x] 4.1 Retain resolved profile metadata through all controller connection paths.
- [x] 4.2 Apply lightweight Cursor preflight before long-lived connection construction.
- [x] 4.3 Preserve independent runtime failure and sibling continuity.
- [x] 4.4 Generalize tab telemetry and record bounded Cursor readiness outcomes.
- [x] 4.5 Cover initial, dynamic, fresh-run, restore, and disabled-telemetry behavior.

## Implementation Details

Follow the TechSpec sections "Integration Points" and "Monitoring and Observability." Keep the controller generic, preserve the Codex-only stale-rollout recovery, and do not add Cursor clarification or persistence behavior here.

### Relevant Files
- `src/app/controller.ts` — long-lived connection paths, runtime degradation, and preflight integration.
- `src/app/controller.test.ts` — three-provider ordering, isolation, reconnect/restore, and tab behavior.
- `src/app/actions.ts` — generic `ProviderKind` tab-telemetry surface.
- `src/telemetry/recorder.ts` — local fixed readiness outcome event/facade.
- `src/telemetry/recorder.test.ts` — enabled-record shape and disabled-recorder silence.

### Dependent Files
- `src/config/readiness.ts` — supplies the reusable preflight and recovery taxonomy.
- `src/agent/agentConnection.ts` — owns the one long-lived initialize/login/session lifecycle.
- `src/config/firstRun.ts` — consumes controller runtime standings without needing Cursor-specific branches.
- `src/app/handoff.ts` — admits Cursor only after the generic controller marks its session ready.

### Related ADRs
- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) — persistent local third session scope.
- [ADR-002: Launch Cursor by Default as an Independently Available Third Session](adrs/adr-002.md) — independent availability and sibling continuity.
- [ADR-003: Use a Certified Native Cursor ACP Profile with Adapter-Owned Login](adrs/adr-003.md) — preflight before long-lived startup and adapter-owned login.

## Deliverables
- Controller preflight integration for every Cursor connection path.
- Generic Cursor tab telemetry and bounded local readiness outcomes.
- Sibling-isolation coverage for Cursor preflight and authentication failures.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for controller lifecycle and telemetry behavior **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Certified Cursor preflight completes before exactly one Cursor connection is constructed.
  - [x] `binary_missing`, `version_mismatch`, and `uncertified_recipe` skip connection construction and leave a ready sibling promptable.
  - [x] Adapter authentication-required output makes only Cursor unavailable and records its fixed outcome.
  - [x] Enabled telemetry serializes only allowlisted fixed fields; disabled telemetry emits no records.
- Integration tests:
  - [x] Initial three-provider startup reaches a live Cursor session while ready Claude Code and Codex remain live.
  - [x] Dynamic Cursor creation, fresh-run, and persisted restore preflight before their replacement long-lived connection.
  - [x] Selecting Cursor and creating a conversation emits `tab_created` with `provider: "cursor"` and the inherited source.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A failed Cursor preflight never starts a Cursor ACP process or tears down a ready sibling.
- Cursor telemetry is local, opt-in, and limited to fixed provider/outcome data.
