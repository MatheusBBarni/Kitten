---
status: pending
title: "Preserve fail-closed clarification and persistence behavior"
type: backend
complexity: medium
---

# Task 05: Preserve fail-closed clarification and persistence behavior

## Overview

Extend closed provider maps for Cursor without treating native `agent acp` support as proof of structured clarification capability. Allow V2 saved-run records to retain Cursor provider identity while keeping profiles, credentials, versions, and raw runtime details out of persistence.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Cursor MUST remain `unsupported` for structured clarification until a distinct complete credentialed capability contract exists.
- 2. Native Cursor recipe identity and recipe overrides MUST NOT infer clarification support or add a Cursor entry to verified clarification recipes.
- 3. V2 run records MUST accept and reload `providerKind: "cursor"` with existing record-version and workspace-membership invariants intact.
- 4. Persisted records MUST NOT contain a runtime profile, authentication method, CLI version, transcript, capability result, raw error, or credential.
- 5. This task MUST NOT bump or migrate the persistence schema and MUST preserve V1 compatibility.
</requirements>

## Subtasks
- [ ] 5.1 Keep Cursor absent from verified structured-clarification evidence.
- [ ] 5.2 Make capability classification exhaustive and fail closed for Cursor recipes.
- [ ] 5.3 Extend the V2 provider schema for persisted Cursor session identity.
- [ ] 5.4 Prove a Cursor run record round-trips through normal workspace membership checks.

## Implementation Details

Follow the TechSpec "Data Models" and "Monitoring and Observability" sections. Treat authentication/version success as insufficient evidence for optional capability support and preserve the pointers-only persistence contract.

### Relevant Files
- `src/config/clarificationCapability.ts` — exhaustive provider recipe identity and unsupported classification.
- `src/config/clarificationCapability.test.ts` — default/override Cursor fail-closed regression cases.
- `src/persistence/runRecord.ts` — V2 provider-kind schema for saved records.
- `src/persistence/runStore.test.ts` — real V2 Cursor save/load round-trip coverage.

### Dependent Files
- `src/config/configLoader.ts` — provides resolved Cursor recipe identity to capability classification.
- `src/app/controller.ts` — forwards provider identity generically through runtime/session flows.
- `src/persistence/runWriter.ts` — retains the existing pointers-only record writing path.

### Related ADRs
- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) — first-class local session boundary.
- [ADR-003: Use a Certified Native Cursor ACP Profile with Adapter-Owned Login](adrs/adr-003.md) — fail-closed optional capabilities and runtime-only profile data.

## Deliverables
- Exhaustive, unsupported Cursor clarification classification.
- V2 saved-run Cursor provider identity support without a schema migration.
- Persistence and fail-closed capability tests.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for saved-run restoration **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Exact `cursor` `agent acp` identity has no package-backed verified clarification recipe.
  - [ ] Default Cursor and command, argument, or environment overrides remain unsupported.
  - [ ] No Cursor path acquires a structured clarification capability from display or profile metadata.
- Integration tests:
  - [ ] A V2 record containing a Cursor conversation saves and reloads with `providerKind: "cursor"` and normal workspace membership.
  - [ ] Reloaded Cursor records contain no runtime-profile, authentication, version, transcript, or raw-error fields.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Cursor login or version success cannot enable unverified structured clarification.
- Cursor saved sessions retain only the existing safe provider identity data.
