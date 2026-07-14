---
status: pending
title: "Add Cursor readiness preflight and recovery messages"
type: backend
complexity: medium
---

# Task 02: Add Cursor readiness preflight and recovery messages

## Overview

Add a lightweight, injectable Cursor preflight that validates certification and CLI version before a long-lived connection is created. It turns unavailable, uncertified, incompatible, and authentication outcomes into concise Cursor-only recovery messages while preserving existing provider readiness behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. Readiness MUST consume only resolved runtime-profile metadata; certification and authentication fields MUST remain absent from user JSON.
- 2. Standard and overridden Cursor recipes MUST return `uncertified_recipe` before a version probe or ACP connection is attempted.
- 3. A certified profile MUST check that its binary exists, then injectably verify `agent --version` is successful, non-empty, valid semantic-version output, and exactly equal to the certified profile version before connection startup.
- 4. Missing, malformed, nonzero, thrown, or mismatched version output MUST yield `version_mismatch` without building an ACP connection.
- 5. Authentication-not-ready output from the adapter MUST map to `authentication_required` with safe actionable detail; legacy generic failure fakes MUST remain compatible.
- 6. The reusable controller-facing preflight MUST not perform a disposable ACP handshake or authentication, while the existing readiness helper retains timeout, protocol mismatch, and guaranteed disposal behavior after preflight succeeds.
- 7. Recovery text MUST be content-free and Cursor-specific; non-Cursor providers MUST bypass version probing and retain their current behavior.
</requirements>

## Subtasks
- [ ] 2.1 Define the injectable certification/version preflight result and probe seam.
- [ ] 2.2 Add Cursor-only preflight outcomes and concise recovery formatting.
- [ ] 2.3 Compose the preflight with the existing handshake verdict without double-spawning a connection.
- [ ] 2.4 Preserve generic protocol, timeout, disposal, and sibling-independence semantics.
- [ ] 2.5 Cover failure taxonomy and three-provider aggregate readiness.

## Implementation Details

Follow the TechSpec "Provider Resolution and Readiness Algorithm" and "Integration Points." Keep the preflight reusable by the controller without making a second ACP connection; the adapter remains responsible for ACP authentication.

### Relevant Files
- `src/config/readiness.ts` — preflight seam, NotReadyReason taxonomy, recovery formatting, aggregate readiness, and handshake composition.
- `src/config/readiness.test.ts` — injected probe/connection behavior and independent three-provider outcomes.

### Dependent Files
- `src/app/controller.ts` — invokes the lightweight preflight before each long-lived Cursor connection.
- `src/config/firstRun.ts` — already forwards readiness messages verbatim into first-run guidance.
- `src/telemetry/recorder.ts` — later records bounded readiness outcomes without error detail.

### Related ADRs
- [ADR-002: Launch Cursor by Default as an Independently Available Third Session](adrs/adr-002.md) — independent recovery and sibling usability.
- [ADR-003: Use a Certified Native Cursor ACP Profile with Adapter-Owned Login](adrs/adr-003.md) — version validation before session startup and authentication recovery.

## Deliverables
- Injectable Cursor version/certification preflight with safe readiness messages.
- Cursor-only `version_mismatch`, `uncertified_recipe`, and `authentication_required` classification.
- Preserved generic handshake and disposal behavior after successful preflight.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for independent three-provider readiness **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Missing Cursor binary skips both version probe and connection creation.
  - [ ] Uncertified override skips both probe and connection creation with `uncertified_recipe`.
  - [ ] Empty, malformed, nonzero, thrown, and mismatched version results return `version_mismatch` before spawn.
  - [ ] An exact version continues to the existing ready handshake and disposes the probe connection.
  - [ ] Adapter authentication-required output maps to the safe Cursor-specific readiness reason while a generic handshake failure remains unchanged.
- Integration tests:
  - [ ] Claude Code and Codex bypass Cursor version probing and retain their current readiness behavior.
  - [ ] Aggregate three-provider readiness keeps ready siblings usable for every Cursor preflight failure.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No uncertified or version-mismatched Cursor process reaches ACP initialization.
- A Cursor-only failure returns an actionable message without blocking a ready sibling.
