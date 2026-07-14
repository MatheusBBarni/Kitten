---
status: pending
title: "Authenticate certified Cursor profiles at the ACP boundary"
type: backend
complexity: medium
---

# Task 03: Authenticate certified Cursor profiles at the ACP boundary

## Overview

Authenticate only exact certified Cursor profiles through the existing ACP adapter lifecycle. The adapter must normalize unavailable or rejected login as a non-throwing, protocol-free outcome before any Cursor session is created.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. ACP authentication MUST remain entirely inside `src/agent/`; no ACP types or calls may reach config, core, store, controller, or UI.
- 2. The adapter MUST select the branch exclusively from `runtimeProfile.kind === "cursor-certified"`, never from a display name, provider label, or arbitrary Cursor override.
- 3. After `initialize`, the adapter MUST verify that the advertised authentication methods include `cursor_login` and then authenticate with exactly that method before any `session/new` call.
- 4. Missing method, unavailable method, `auth_required`, rejected authentication, and safe authentication errors MUST return a normalized non-throwing authentication-not-ready result and MUST NOT create a session.
- 5. The authentication discriminator MUST remain backward-compatible with generic `{ ready: false, error }` test fakes.
- 6. Standard profiles, including an overridden Cursor recipe, MUST never call authenticate even when a transport advertises `cursor_login`.
- 7. Normal tests MUST use in-process mocks only; credentialed local Cursor execution is reserved for the opt-in contract.
</requirements>

## Subtasks
- [ ] 3.1 Carry the resolved runtime profile into the adapter lifecycle.
- [ ] 3.2 Authenticate an advertised certified Cursor profile between initialization and session creation.
- [ ] 3.3 Normalize login failure without leaking ACP details across the boundary.
- [ ] 3.4 Extend the mock transport with deterministic authentication scripting and capture.
- [ ] 3.5 Cover ordering, failure, and no-auth standard-profile behavior.

## Implementation Details

Follow the TechSpec "Core Interfaces" and "Integration Points" sections. Preserve the adapter anti-corruption boundary and its existing generic initialization error behavior.

### Relevant Files
- `src/agent/agentConnection.ts` — ACP lifecycle, normalized ReadyState, and profile-directed authentication.
- `src/agent/agentConnection.test.ts` — adapter ordering, failure, and standard-profile tests.
- `test/mockAgent.ts` — configurable advertised methods, authentication scripting, and captured requests.

### Dependent Files
- `src/config/readiness.ts` — maps the normalized authentication result into recovery guidance.
- `src/app/controller.ts` — remains generic and creates a session only after the adapter is ready.
- `test/cursorAcp.contract.test.ts` — later validates the credentialed lifecycle against the real local CLI.

### Related ADRs
- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) — certified local session boundary.
- [ADR-003: Use a Certified Native Cursor ACP Profile with Adapter-Owned Login](adrs/adr-003.md) — adapter-owned `cursor_login` contract.

## Deliverables
- Profile-directed ACP authentication with a protocol-free authentication-not-ready result.
- Deterministic mock support for advertised authentication methods and authentication calls.
- Adapter tests that preserve existing generic initialization behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for authenticated-session lifecycle behavior **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Certified Cursor initializes before one captured `{ methodId: "cursor_login" }` authentication request.
  - [ ] Missing `cursor_login` leaves the adapter not-ready without authenticate or `session/new` requests.
  - [ ] Rejected or not-logged-in authentication returns a safe normalized result and creates no session.
  - [ ] Standard Claude Code, Codex, and overridden Cursor profiles never authenticate.
  - [ ] Certified-profile initialization failure remains a generic handshake failure rather than authentication-required.
- Integration tests:
  - [ ] A successful certified mock lifecycle authenticates before an ordinary `newSession` succeeds.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No Cursor authentication call escapes the adapter boundary.
- No failed or uncertified authentication path can create a Cursor session.
