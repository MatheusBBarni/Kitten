---
status: pending
title: Add closed ACP live-config contract evidence
type: backend
complexity: medium
---

# Task 02: Add closed ACP live-config contract evidence

## Overview

Extend Cursor's opt-in native evidence so it proves whether the active ACP session supports a safe live configuration update. The task retains the adapter as the sole protocol boundary and records only a closed, content-free result that later UI work can trust.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. `AgentConnection.setSessionConfigOption` MUST remain the sole live configuration path and MUST return only the complete agent-confirmed option snapshot.
2. The opt-in Cursor contract MUST record exactly one closed result: `not_advertised`, `accepted`, or `rejected`.
3. A native probe MUST submit only a visible allowlisted option's current advertised value and MUST not intentionally change the session's user-visible configuration.
4. Missing visible options, successful updates, and rejected updates MUST map to their closed results while the prompt and disposal lifecycle continues safely.
5. Evidence and console output MUST exclude option identifiers, values, labels, prompts, credentials, paths, raw errors, and direct-CLI model terms.
6. Deterministic mock coverage MUST remain runnable without a Cursor executable or credentials.
</requirements>

## Subtasks
- [ ] 2.1 Preserve confirmed-only live configuration behavior at the ACP adapter boundary.
- [ ] 2.2 Add the closed native contract evidence result and safe probe selection.
- [ ] 2.3 Cover accepted, rejected, and not-advertised contract outcomes without recording content.
- [ ] 2.4 Prove mock config failures do not fabricate state or route around ACP.

## Implementation Details

Follow the TechSpec sections **Core Interfaces**, **API Endpoints**, and **Testing Approach**. ACP requests stay inside the adapter; the core, store, and UI consume only confirmed protocol-free snapshots and must not gain a Cursor CLI fallback.

### Relevant Files
- `src/agent/agentConnection.ts` — existing ACP-only confirmed configuration update boundary.
- `src/agent/agentConnection.test.ts` — adapter success, rejection, and full-snapshot tests.
- `test/mockAgent.ts` — scripted option snapshots, recorded update requests, and injected rejection behavior.
- `test/cursorAcp.contract.test.ts` — opt-in contract interfaces, evidence object, native gate, and disposal flow.
- `src/agent/acpTranslate.ts` — converts ACP select options into protocol-free configuration options.
- `src/core/types.ts` — visible model and thought-level option allowlist.

### Dependent Files
- `src/app/actions.ts` — applies only the adapter's confirmed option snapshot.
- `src/core/sessionReducer.ts` — replaces confirmed configuration options atomically.
- `src/ui/ModelSelect.tsx` — renders only confirmed, allowlisted options.
- `src/telemetry/recorder.ts` — remains intentionally unchanged because contract evidence is not runtime telemetry.

### Related ADRs
- [ADR-003: Keep Cursor certification compiled and gate it on reviewed native evidence](adrs/adr-003.md) — Makes native proof a certification gate.
- [ADR-005: Record a closed live-config capability result in the native contract](adrs/adr-005.md) — Defines the three closed evidence outcomes.

## Deliverables

- Closed, content-free native config-capability evidence for one opt-in Cursor contract run.
- Mock adapter and contract-harness coverage for all three outcomes.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the opt-in config-capability flow **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] A complete refreshed ACP option snapshot is returned without an optimistic configuration event or local mutation.
  - [ ] A rejected ACP update preserves the prior confirmed snapshot and produces no fabricated config state.
  - [ ] A visible allowed option submits its exact current advertised value once.
- Integration tests:
  - [ ] No visible option emits only `not_advertised` and makes no update request.
  - [ ] A confirmed update emits only `accepted`; a rejected update emits only `rejected`; both still complete synthetic prompt disposal.
  - [ ] Serialized evidence excludes sentinel option data, prompt text, credentials, paths, raw provider errors, and direct-CLI terms.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Native evidence proves a closed live-config result without changing user-visible configuration intentionally.
- No Cursor model or reasoning fallback is derived from a direct CLI command.
