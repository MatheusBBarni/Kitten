---
status: completed
title: "First-run persistence disclosure"
type: backend
complexity: low
dependencies:
    - task_01
---

# Task 11: First-run persistence disclosure

## Overview
Resume is the first time Kitten writes conversation-derived content to disk, so the trust story requires telling the user once.
This adds a single first-run line stating that sessions are remembered for this project, where they are stored, and how to delete them, shown only when persistence is enabled.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add one concise disclosure line to the first-run guidance stating that sessions are stored, where, and how to delete them.
- MUST show the disclosure only when `persistenceEnabled` is `true`.
- MUST NOT mark the run blocked or otherwise gate startup; it is informational.
- MUST stay within the existing onboarding budget (a single short line, non-blocking).

## Subtasks
- [ ] 11.1 Add a disclosure line to the first-run report/guidance
- [ ] 11.2 Gate the line on `persistenceEnabled`
- [ ] 11.3 Keep it informational (never blocking)
- [ ] 11.4 Cover enabled, disabled, and non-blocking behavior in tests

## Implementation Details
Modify `src/config/firstRun.ts` (the report/format functions) and its call site in `src/index.ts`, reading `persistenceEnabled` from config (task_01).
See the TechSpec "User Experience" (First contact) and ADR-002/ADR-003.

### Relevant Files
- `src/config/firstRun.ts` — `FirstRunReport`, `formatFirstRunReport`
- `src/index.ts` — where first-run guidance is displayed at boot
- `src/config/configLoader.ts` — `persistenceEnabled` (task_01)

### Dependent Files
- `src/config/firstRun.test.ts`, `test/firstRunBoot.test.ts` — extend for the disclosure

### Related ADRs
- [ADR-003: Cockpit-Run Persistence](../adrs/adr-003.md) — disclose what is stored, where, and how to purge
- [ADR-002: V1 Rollout Shape](../adrs/adr-002.md) — on-by-default persistence with disclosure

## Deliverables
- A single, gated first-run disclosure line
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that boot guidance includes the disclosure when persistence is on **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] with `persistenceEnabled: true` the guidance includes a disclosure line naming the storage location and how to delete
  - [ ] with `persistenceEnabled: false` the guidance omits the disclosure
  - [ ] the disclosure does not set `blocked` and does not stop startup
- Integration tests:
  - [ ] first-run boot with persistence on surfaces the disclosure line
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The disclosure appears once when persistence is on, is absent when off, and never blocks startup
