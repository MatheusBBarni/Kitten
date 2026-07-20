---
status: completed
title: Model closed MCP failure state in the core
type: refactor
complexity: medium
---

# Task 03: Model closed MCP failure state in the core

## Overview

Add a small protocol-free failure state to the tool-call domain so the transcript
can distinguish temporary capacity from unavailability without carrying MCP text
or transport data. Preserve the reducer's current partial-update semantics so
later adapter and UI work can rely on a stable, privacy-safe record.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST define only the protocol-free `temporary_capacity` and `unavailable` tool-call failure kinds; no ACP, MCP, socket, endpoint, capability, user, or raw-error type may enter `src/core`.
- 2. MUST make the failure kind optional on the reduced tool-call record and partial update shape so ordinary and unrelated failed tools remain representable without a false classification.
- 3. MUST preserve an existing failure kind when an update omits it and clear it only when an update explicitly supplies `null`, matching the existing diff merge contract.
- 4. MUST preserve every existing tool-call default, ordering, status, location, and diff behavior.
- 5. MUST update type consumers and tests without creating a parallel transcript store or reducer path.
</requirements>

## Subtasks

- [x] 3.1 Define the closed domain failure vocabulary in the core type model.
- [x] 3.2 Extend tool-call record and partial-update merge semantics for omission and explicit clearing.
- [x] 3.3 Preserve generic tool-call behavior when no classification exists.
- [x] 3.4 Validate public store reduction with the new optional field.

## Implementation Details

See TechSpec sections “Core Interfaces”, “Data Models”, and “Testing Approach”.
The core remains pure and is the sole writer through `sessionReducer`; protocol
parsing belongs to the later ACP-boundary task.

### Relevant Files

- `src/core/types.ts` — defines `ToolCallRecord`, `ToolCallUpdate`, and the protocol-free domain event union.
- `src/core/sessionReducer.ts` — owns the sole tool-call upsert and partial-merge behavior.
- `src/core/sessionReducer.test.ts` — covers reducer defaults, update ordering, and diff clearing behavior.
- `src/store/appStore.test.ts` — verifies public store application of domain events through the reducer.

### Dependent Files

- `src/agent/acpTranslate.ts` — will supply the optional closed failure kind from ACP-boundary classification.
- `src/agent/agentConnection.ts` — will keep classifier state outside the core and emit normal domain events.
- `src/ui/ToolCallRow.tsx` — will render the optional field without importing protocol types.

### Related ADRs

- [ADR-002: Center the MVP on mixed supervised work and deliberate recovery](adrs/adr-002.md) — requires truthful, manual-only recovery semantics.
- [ADR-004: Project closed MCP failures without replaying ambiguous work](adrs/adr-004.md) — selects the closed protocol-free projection.

## Deliverables

- A closed protocol-free tool-call failure type and optional record/update fields.
- Reducer behavior for preserving omitted values and clearing explicit `null` values.
- Core and store regression coverage for classified and ordinary tool calls.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for store-reduced domain events **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] A new tool call with `temporary_capacity` stores that exact closed kind alongside its ordinary status and title.
  - [x] A later update omitting the failure kind preserves the prior value while still updating status, locations, or diff.
  - [x] A later update with `failureKind: null` clears only the failure kind and leaves other record fields intact.
  - [x] A generic failed tool call with no classification retains the current defaults and is not labeled capacity or unavailable.
  - [x] Core source and public types remain free of ACP, MCP, socket, endpoint, capability, and raw-error imports or fields.
- Integration tests:
  - [x] Applying `DomainSessionEvent` tool-call updates through `AppStore` preserves, then explicitly clears, the failure kind in the selected session transcript.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The transcript can carry only the two approved failure states without protocol or private data leakage.
- Existing reducer behavior remains unchanged for all unclassified tool calls.
