---
status: completed
title: Preserve exact Cursor profile and readiness taxonomy
type: backend
complexity: medium
---

# Task 01: Preserve exact Cursor profile and readiness taxonomy

## Overview

Protect the exact built-in Cursor trust boundary while making every preflight outcome deterministic and truthful. This task prepares the fail-closed base for later Cursor work without adding a production profile before reviewed native evidence exists.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. The production `CERTIFIED_CURSOR_RUNTIME_PROFILES` registry MUST remain empty until reviewed native evidence supplies an exact literal profile.
2. Profile matching MUST accept only `agent`, ordered `acp` arguments, the complete expected environment, and an exact reviewed semantic version; no range, manifest, user override, or discovery fallback is permitted.
3. Cursor preflight MUST fail with only the bounded preflight causes before any connection construction, and connection failures MUST retain only the bounded authentication or handshake causes.
4. Emitted readiness outcomes MUST distinguish unsupported certification from user-remediable binary, version, and authentication conditions without exposing raw runtime details; user-facing recovery presentation is owned by the later bounded-state task.
5. A failed Cursor preflight MUST leave Claude Code and Codex usable and MUST NOT create a Cursor connection.
</requirements>

## Subtasks
- [x] 1.1 Preserve the compiled exact-profile boundary and prove the empty production registry remains fail-closed.
- [x] 1.2 Cover exact recipe, environment, and semantic-version acceptance and rejection behavior.
- [x] 1.3 Cover every bounded preflight and connection readiness outcome with truthful recovery language.
- [x] 1.4 Prove failed Cursor preflight does not construct a connection or affect ready sibling sessions.

## Implementation Details

Constrain this work to the TechSpec sections **System Architecture**, **Data Models**, and **Testing Approach**. The configuration/readiness boundary owns support identity and normalized outcomes; do not introduce ACP types, user-configurable certification, or a production profile literal.

### Relevant Files
- `src/config/configLoader.ts` — built-in Cursor recipe, compiled registry, and exact profile matcher.
- `src/config/configLoader.test.ts` — recipe mutation, strict environment, and exact-version coverage.
- `src/config/readiness.ts` — preflight order, version probing, and normalized recovery messages.
- `src/config/readiness.test.ts` — injected preflight seams and no-connection assertions.
- `src/core/types.ts` — sealed Cursor runtime-profile shape and bounded readiness types.

### Dependent Files
- `src/app/controller.ts` — consumes normalized readiness outcomes while keeping siblings available.
- `src/app/controller.test.ts` — verifies per-session failure isolation.
- `src/telemetry/recorder.ts` — maps only closed content-free readiness outcomes.
- `test/cursorAcp.contract.test.ts` — later consumes the same exact-profile gate without becoming a normal-suite prerequisite.

### Related ADRs
- [ADR-001: Keep Cursor support evidence-gated and fail closed](adrs/adr-001.md) — Defines the narrow support boundary.
- [ADR-003: Keep Cursor certification compiled and gate it on reviewed native evidence](adrs/adr-003.md) — Requires the registry to remain compiled and evidence-gated.

## Deliverables

- Exact compiled-profile and readiness-taxonomy behavior with no guessed production profile.
- Focused configuration, readiness, and sibling-isolation coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for bounded Cursor preflight behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Default Cursor remains `agent acp` with an empty environment and resolves to standard runtime behavior while the production registry is empty.
  - [x] An injected reviewed profile accepts only exact command, ordered arguments, complete environment, and matching semantic version.
  - [x] Absolute command paths, added or reordered arguments, added environment keys, malformed versions, and mismatched versions fail closed.
  - [x] Missing binary, nonzero probe, thrown probe, and malformed version return their bounded outcomes without connection creation.
- Integration tests:
  - [x] An uncertified Cursor recipe returns `uncertified_recipe` before binary probing, version probing, or connection construction.
  - [x] Each Cursor failure leaves ready Claude Code and Codex sessions usable and emits only the matching closed readiness outcome.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No production Cursor profile is added without reviewed native evidence.
- Every Cursor readiness state is bounded, actionable, and isolated to its own session.
