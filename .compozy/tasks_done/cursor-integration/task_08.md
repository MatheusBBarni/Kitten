---
status: completed
title: "Add the opt-in Cursor contract and certify the production profile"
type: infra
complexity: high
---

# Task 08: Add the opt-in Cursor contract and certify the production profile

## Overview

Add the credentialed, opt-in contract that can certify one exact native Cursor ACP profile after a reviewed real run. Until that external evidence exists, the production profile remains fail closed and the normal test suite never locates or starts Cursor.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. The real Cursor contract MUST skip unless `KITTEN_CURSOR_ACP_CONTRACT=1`; normal tests MUST never locate or spawn Cursor.
- 2. An enabled run MUST capture `agent --version`, require one exact semantic version, and match it to the candidate certified profile before certification.
- 3. The contract MUST use the resolved built-in `agent acp` recipe, never a fake or arbitrary command.
- 4. The contract MUST verify initialize, `cursor_login` authentication, `session/new`, one benign prompt, and clean disposal in that order.
- 5. Permission request/response behavior MUST be denied or cancelled safely when advertised and recorded only as explicit boolean evidence.
- 6. Evidence and committed source data MUST include only recipe identity, exact version, and boolean checks; they MUST exclude prompts, code, credentials, paths, overrides, and telemetry.
- 7. A skipped, failed, timed-out, or partial run MUST NOT certify the profile, enable optional capabilities, or weaken the existing uncertified/override path.
- 8. The exact version literal MUST be committed only with a reviewed full contract pass; no version may be guessed in source.
</requirements>

## Subtasks
- [ ] 8.1 Add the opt-in real Cursor ACP contract from the existing credentialed contract pattern.
- [ ] 8.2 Validate exact semantic-version output and full native recipe identity.
- [ ] 8.3 Exercise authentication, session, benign prompt, optional permission, and disposal behavior.
- [ ] 8.4 Produce only reviewed content-free certification evidence.
- [ ] 8.5 Commit the exact certified profile and fail-closed override tests only after a reviewed pass.

## Implementation Details

Follow the TechSpec "Credentialed Contract" and "Technical Dependencies" sections. This task has an external prerequisite: a locally installed, authenticated Cursor CLI supporting `agent --version`, `agent acp`, and `cursor_login`; the current workspace has no `agent` binary.

### Relevant Files
- `test/cursorAcp.contract.test.ts` — new opt-in real Cursor lifecycle, timeout, permission, evidence, and disposal contract.
- `src/config/configLoader.ts` — exact certified profile literal and complete-recipe profile matching after approved evidence.
- `src/config/configLoader.test.ts` — exact version/profile and altered command, ordered-args, environment, or version fail-closed coverage.

### Dependent Files
- `src/agent/agentConnection.ts` — owns the normal adapter authentication behavior exercised by the real contract.
- `src/config/readiness.ts` — rejects non-certified or mismatched profiles before long-lived startup.
- `src/config/clarificationCapability.ts` — remains unsupported unless a separate capability-specific certification exists.

### Related ADRs
- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) — certified local integration scope.
- [ADR-002: Launch Cursor by Default as an Independently Available Third Session](adrs/adr-002.md) — independent availability under failed certification.
- [ADR-003: Use a Certified Native Cursor ACP Profile with Adapter-Owned Login](adrs/adr-003.md) — exact native profile and reviewed credentialed evidence.

## Deliverables
- Opt-in real Cursor ACP contract with safe timeout and disposal behavior.
- Reviewed, content-free evidence format for one exact certified profile.
- Exact-profile resolution and altered-recipe fail-closed tests, committed only alongside reviewed contract evidence.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the credentialed native ACP lifecycle **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] The disabled contract skips without locating or spawning a Cursor process.
  - [ ] Missing, malformed, or non-semantic-version output cannot create certification evidence.
  - [ ] Any command, ordered-argument, environment, or version change resolves as uncertified.
  - [ ] Authentication rejection or a missing advertised method fails the contract without certifying a profile.
- Integration tests:
  - [ ] With the explicit environment gate and authenticated exact recipe, the contract initializes, authenticates, opens a session, completes a benign prompt, and disposes without an unexpected close.
  - [ ] An advertised permission request is safely denied/cancelled and recorded only as a boolean check.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- An authenticated reviewed full pass is the only path that commits an exact Cursor certified version.
- Normal tests and unavailable/uncertified Cursor profiles remain fail closed and never start a real Cursor process.
