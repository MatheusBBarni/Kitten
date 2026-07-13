---
status: completed
title: "Map verified ACP elicitation into the adapter boundary"
type: backend
complexity: high
---

# Task 4: Map verified ACP elicitation into the adapter boundary

## Overview
Expose ACP elicitation only for a verified capability and translate it into the Task 02 protocol-free payload. The adapter must decline all unsupported shapes safely and never expose ACP types outside src/agent.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST advertise and register unstable_createElicitation only when capability is supported.
2. MUST accept only session-scoped form requests for the active ACP session.
3. MUST normalize string text, string single-select, and string-array multi-select shapes.
4. MUST terminally cancel missing handlers, URL/custom modes, malformed schemas, mismatched sessions, and invalid submitted values.
</requirements>

## Subtasks
- [x] 4.1 Add pure form normalization and reverse outcome mapping.
- [x] 4.2 Gate elicitation capability and callback registration.
- [x] 4.3 Expose a protocol-free clarification subscription.
- [x] 4.4 Extend the real SDK in-memory mock fixture and adapter tests.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/agent/acpTranslate.ts — pure form and outcome mapping.
- src/agent/acpTranslate.test.ts — supported and rejected schema coverage.
- src/agent/agentConnection.ts — capability-gated callback and subscription.
- src/agent/agentConnection.test.ts — wire callback coverage.
- test/mockAgent.ts — experimental elicitation fixture and captured outcomes.

### Dependent Files
- src/config/clarificationCapability.ts — capability result from Task 01.
- src/core/types.ts — protocol-free payload and outcome from Task 02.
- src/app/controller.ts — attributes callbacks in Task 05.

### Related ADRs
- [ADR-001: Scope the clarification picker around explicit structured requests](adrs/adr-001.md)
- [ADR-003: Fail closed on a verified ACP elicitation allowlist](adrs/adr-003.md)

## Deliverables
- Completed map verified acp elicitation into the adapter boundary behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [x] Supported capability advertises form elicitation and unsupported capability omits it.
  - [x] Valid form reaches the handler and accepted values map exactly once.
  - [x] Cancellation, missing handler, unsupported mode, invalid scope, and malformed fields return ACP cancellation.
  - [x] Existing prompt and permission behavior remain unchanged.
- Integration tests:
  - [x] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
