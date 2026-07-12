---
status: pending
title: "Add fail-closed ACP capability classification and contract gate"
type: backend
complexity: high
---

# Task 1: Add fail-closed ACP capability classification and contract gate

## Overview
Classify resolved provider recipes as supported or unsupported for experimental ACP elicitation. This makes capability availability explicit without changing normal agent readiness and supplies the only gate that can enable the feature.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST classify the resolved command, arguments, environment, provider kind, and exact built-in adapter version rather than display metadata.
2. MUST fail closed for custom, overridden, unknown, or unverified recipes.
3. MUST keep unsupported clarification capability informational; normal provider readiness and boot behavior must remain unchanged.
4. MUST require a credentialed real-adapter contract result before adding any recipe to the allowlist.
</requirements>

## Subtasks
- [ ] 1.1 Define the protocol-free capability result and exact recipe identity.
- [ ] 1.2 Classify resolved built-in and overridden configurations.
- [ ] 1.3 Add hermetic unit and config regression coverage.
- [ ] 1.4 Add the opt-in actual-adapter contract gate.

## Implementation Details
Follow the TechSpec sections System Architecture, Implementation Design, Testing Approach, and Development Sequencing. Keep ACP at the adapter boundary, preserve the reducer as the only SessionState writer, and use existing fail-soft actions and immutable store patterns.

### Relevant Files
- src/config/clarificationCapability.ts — new protocol-free exact-recipe classifier.
- src/config/clarificationCapability.test.ts — classifier coverage.
- src/config/configLoader.ts — resolve capability after recipe merge.
- src/config/configLoader.test.ts — default and override regression coverage.
- src/config/readiness.ts — expose capability without changing readiness.
- test/clarificationAdapter.contract.test.ts — opt-in real adapter contract gate.
- package.json — exact adapter and SDK pins used by the gate.

### Dependent Files
- src/agent/agentConnection.ts — consumes the resolved capability in Task 04.
- src/config/configLoader.ts — owns resolved provider recipes.

### Related ADRs
- [ADR-003: Fail closed on a verified ACP elicitation allowlist](adrs/adr-003.md)

## Deliverables
- Completed add fail-closed acp capability classification and contract gate behavior.
- Updated or new focused tests covering the stated requirements.
- Unit tests with 80%+ coverage (REQUIRED).
- Integration tests for the relevant clarification lifecycle (REQUIRED).

## Tests
- Unit tests:
  - [ ] Exact verified recipe is supported while changed command, args, environment, package, or version is unsupported.
  - [ ] A cosmetic display-name change does not change capability classification.
  - [ ] Unsupported capability does not make a handshaking provider not-ready.
  - [ ] Opt-in real adapter contract proves advertise, request, accepted response, cancellation, and clean completion; a skipped contract never enables an entry.
- Integration tests:
  - [ ] Exercise this task through its declared boundary with its declared dependencies present.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Requirements are satisfied without ACP types escaping src/agent.
- Existing permission, prompt, and modal behavior remains unchanged outside active clarification.
