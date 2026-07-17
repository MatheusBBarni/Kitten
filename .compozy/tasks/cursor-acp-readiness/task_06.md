---
status: completed
title: Review native evidence and add the exact Cursor profile
type: backend
complexity: high
---

# Task 06: Review native evidence and add the exact Cursor profile

## Overview

Make the first production Cursor profile a deliberate release-certification decision, not a compatibility guess. A literal profile may be added only after deterministic behavior and a reviewed opt-in native lifecycle prove one observed local macOS runtime; otherwise the production registry remains empty and the task is reported blocked.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Certification MUST begin only after the focused deterministic suite, full typecheck/test suite, and any required self-check or build verification are green for the completed task packet.
2. The credentialed native contract MUST remain opt-in behind `KITTEN_CURSOR_ACP_CONTRACT=1`, use one observed exact semantic-version candidate, and never run in the normal credential-free suite.
3. Reviewed native evidence MUST prove the complete exact `agent acp` lifecycle: exact recipe/version match, initialization, advertised `cursor_login` authentication, session creation, one synthetic completed prompt, safe permission behavior, clean disposal, no unexpected close, and an `accepted` closed config-capability result from reapplying a visible allowlisted option's current advertised value.
4. Only human-reviewed successful native evidence may authorize adding one literal `cursor-certified` profile to the compiled registry; matching MUST remain exact for command, ordered arguments, complete environment, version, and authentication method.
5. A missing Cursor installation, unavailable authentication, failed contract, `not_advertised` or `rejected` config result, malformed evidence, non-exact version, or unreviewed artifact MUST leave the registry unchanged and cause this task to be reported blocked rather than broadened or completed.
6. The task MUST not add a manifest, user override, version range, runtime discovery acceptance, direct CLI model/config fallback, credential storage, or product telemetry.
7. The resulting compiled profile MUST retain normal-suite isolation and fail closed for every non-identical local recipe or version.
</requirements>

## Subtasks
- [ ] 6.1 Run and record deterministic verification for the completed Cursor packet before native certification.
- [ ] 6.2 Run the explicit local native contract for the observed exact candidate and review its closed evidence.
- [ ] 6.3 Add one compiled profile only when the reviewed evidence satisfies the complete release gate.
- [ ] 6.4 Prove exact matching and non-matching fail-closed behavior in the normal suite.
- [ ] 6.5 Leave the registry empty and report certification blocked when any external proof prerequisite is absent or fails.

## Implementation Details

Follow the TechSpec sections **Development Sequencing**, **Integration Points**, **Testing Approach**, and **Monitoring and Observability**. This task is intentionally an external-evidence gate: it must preserve the credential-free repository contract and never synthesize the release decision from mocks, an installed binary, or a version string alone.

### Relevant Files
- `test/cursorAcp.contract.test.ts` — opt-in native lifecycle, observed candidate, accepted config evidence, and contract activation gate.
- `src/config/configLoader.ts` — compiled exact Cursor registry and strict profile matcher.
- `src/config/configLoader.test.ts` — exact-profile acceptance, mutated-recipe rejection, and empty-registry regression coverage.
- `src/config/readiness.ts` — fail-closed support preflight for the compiled profile boundary.
- `src/config/readiness.test.ts` — certified versus uncertified preflight behavior.

### Dependent Files
- `src/agent/agentConnection.ts` — provides the authenticated ACP lifecycle and confirmed live-config behavior proved by the contract.
- `src/app/controller.ts` — consumes preflight results but must not gain a certification fallback.
- `src/telemetry/recorder.ts` — remains local/default-off and excludes profile/evidence details.
- `README.md` — continues to state the reviewed local-only boundary without broad compatibility claims.

### Related ADRs
- [ADR-001: Keep Cursor support evidence-gated and fail closed](adrs/adr-001.md) — Requires revocable evidence-backed support.
- [ADR-002: Define support by a completed first Cursor task after reviewed proof](adrs/adr-002.md) — Defines the product completion threshold.
- [ADR-003: Keep Cursor certification compiled and gate it on reviewed native evidence](adrs/adr-003.md) — Constrains this release-certification gate.
- [ADR-005: Record a closed live-config capability result in the native contract](adrs/adr-005.md) — Requires closed live-config proof before the support claim.

## Deliverables

- Reviewed opt-in native certification evidence with an `accepted` config result, or a documented blocked gate with the registry left unchanged.
- Exactly one compiled profile only when the reviewed release gate succeeds.
- Exact-profile and fail-closed deterministic regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the reviewed native certification flow **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] The normal suite keeps the native contract skipped before resolving, locating, or spawning Cursor.
  - [ ] The literal compiled profile accepts only the observed command, ordered arguments, complete environment, exact semantic version, and `cursor_login` method.
  - [ ] Any changed command, arguments, environment, version, or authentication method remains uncertified and follows the bounded fail-closed path.
  - [ ] An absent or failed review gate makes no registry change and preserves the empty-registry behavior.
- Integration tests:
  - [ ] On the reviewed local macOS installation, `KITTEN_CURSOR_ACP_CONTRACT=1 KITTEN_CURSOR_ACP_CANDIDATE_VERSION=<observed-semver> rtk bun test test/cursorAcp.contract.test.ts` proves initialization, native authentication, session creation, synthetic prompt completion, safe permission handling, disposal, and an `accepted` live-config result without changing an advertised value.
  - [ ] A fresh deterministic verification after any approved literal addition keeps Claude Code and Codex behavior unchanged and rejects non-identical Cursor configurations.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A production Cursor profile exists only when a reviewed native lifecycle proves the one exact local runtime and accepted ACP live configuration.
- Missing or failed external proof leaves Kitten truthful, fail-closed, and explicitly blocked rather than broadly compatible.
