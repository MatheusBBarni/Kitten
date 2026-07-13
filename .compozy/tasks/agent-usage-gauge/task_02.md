---
status: completed
title: "Surface usage_update in ACP translation"
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 02: Surface usage_update in ACP translation

## Overview
Stop dropping the ACP `usage_update` notification and translate it into the domain `usage` event, copying only `used`/`size` and dropping `cost`/`_meta`.
This is what feeds real per-agent context data from the agents into the store.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST change `translateSessionUpdate` so `usage_update` returns `{ kind: "usage", used, size }` instead of `null`.
- MUST add a content-free `translateUsage` that copies only `used` and `size`, never spreading the raw ACP object, so `cost` and `_meta` cannot leak (per ADR-003 and the existing translation-completeness test).
- MUST import `UsageUpdate` from the ACP SDK only in the adapter layer (`src/agent`).
- MUST keep every other currently-unsurfaced `sessionUpdate` variant returning `null`.
- MUST update the existing translation test that asserts `usage_update` maps to `null`.
</requirements>

## Subtasks
- [x] 2.1 Lift `usage_update` out of the dropped-variant group and build the domain usage event.
- [x] 2.2 Add a content-free `translateUsage` helper that copies only `used`/`size`.
- [x] 2.3 Update the "returns null for the unsurfaced variant" test so it no longer includes `usage_update`, and assert the new mapping.
- [x] 2.4 Extend the translation-completeness test so `cost` and `_meta` do not survive translation.

## Implementation Details
Modify `src/agent/acpTranslate.ts`: add `UsageUpdate` to the SDK import, move the `usage_update` case out of the shared `return null` block, and add a `translateUsage` helper alongside `translatePlanEntry` that copies scalars field-by-field (the same discipline that keeps `_meta` from leaking in `translateToolCall`).
No change is expected in `agentConnection` routing — non-message events already dispatch through `emit`. See TechSpec "System Architecture" (ACP translation) and "Integration Points".

### Relevant Files
- `src/agent/acpTranslate.ts` — the translate `switch` where `usage_update` is dropped; add the case and the helper.
- `node_modules/@agentclientprotocol/sdk` — the `UsageUpdate` shape (`used`/`size`/optional `cost`).

### Dependent Files
- `src/agent/acpTranslate.test.ts` — update the null-variant `it.each` and the `_meta`/`rawInput` completeness test.
- `src/agent/agentConnection.ts` — `onSessionUpdate` routes the event unchanged; verify, no edit expected.

### Related ADRs
- [ADR-001: Ambient per-agent headroom gauge](../adrs/adr-001.md) — surface the previously dropped signal.
- [ADR-003: Headroom derivation](../adrs/adr-003.md) — content-free translation; `cost` dropped.

## Deliverables
- `usage_update` translated to a domain usage event, plus a content-free `translateUsage`.
- Updated translation tests.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting the event is dispatched (not dropped) through the connection **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A `usage_update` with `{ used: 36000, size: 200000 }` translates to `{ kind: "usage", used: 36000, size: 200000 }`.
  - [x] A `usage_update` carrying `cost` and `_meta` translates to an event with only `used`/`size` (neither `cost` nor `_meta` present).
  - [x] Other unsurfaced variants (e.g., `session_info_update`, `current_mode_update`) still translate to `null`.
- Integration tests:
  - [x] Feeding a `usage_update` notification through `agentConnection.onSessionUpdate` results in a `usage` domain event delivered to `onUpdate` subscribers.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No ACP `cost`/`_meta` leaks through translation
- All other `sessionUpdate` variants are unaffected
