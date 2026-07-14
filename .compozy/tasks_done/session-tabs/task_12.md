---
status: completed
title: "Harden boot/readiness and instrument the integrated flow"
type: refactor
complexity: high
---

# Task 12: Harden boot/readiness and instrument the integrated flow

## Overview

Finalize Session Tabs as a boot-safe, restorable, observable product surface. The application must accept valid empty/unavailable workspace states, degrade failures per conversation, and record only opt-in, content-free tab signals while validating the complete user flow.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST remove boot/readiness assumptions that require a fixed ready fleet when a restored empty workspace or independently unavailable conversation is valid.
2. MUST preserve existing repository gate, renderer cleanup, worker setup, self-check, and per-provider failure isolation behavior.
3. MUST emit only opt-in, local, content-free telemetry for tab creation, selection source, backgrounding, close outcomes, restore counts, attention, and switch-latency buckets.
4. MUST never record display names, prompt text, transcripts, paths, CWDs, ACP IDs, or raw errors in tab telemetry.
5. MUST validate the integrated create, navigate, background, close, save, restore, unavailable, and empty-workspace journeys.
</requirements>

## Subtasks
- [ ] 12.1 Adapt boot/readiness policy for valid empty and partially unavailable workspaces.
- [ ] 12.2 Preserve teardown and self-check guarantees across dynamic runtime states.
- [ ] 12.3 Add fixed-enum, bucketed, opt-in telemetry for the approved tab signals.
- [ ] 12.4 Validate end-to-end Session Tabs restoration and failure isolation.
- [ ] 12.5 Verify privacy, disabled-mode, and terminal cleanup regressions.

## Implementation Details

Use the TechSpec’s **Technical Dependencies**, **Monitoring and Observability**, **Known Risks**, and **Development Sequencing** sections. This task owns product-level boot policy and telemetry, not a standalone test pass.

### Relevant Files
- `src/index.ts` — renderer/session bootstrap, restore, readiness, disposal, and controller watch wiring.
- `src/app/selfCheck.ts` — headless first-paint and reload-probe behavior.
- `src/config/readiness.ts` — independent provider probe taxonomy and cleanup.
- `src/telemetry/recorder.ts` — opt-in local recorder and content-free timing/event schema.
- `test/sessionTabs.integration.test.tsx` — new end-to-end Session Tabs flow coverage.
- `test/index.integration.test.tsx` — boot, restore, renderer, readiness, and cleanup integration tests.
- `test/telemetry.integration.test.ts` — ordered telemetry and payload privacy integration tests.

### Dependent Files
- `src/app/selfCheck.test.ts` — self-check replay and first-paint assertions.
- `src/config/readiness.test.ts` — provider failure and disposal regression tests.
- `src/telemetry/recorder.test.ts` — disabled, content-free, concurrency, and timing unit coverage.
- `test/firstRunBoot.test.ts` — repository/readiness gate behavior.
- `test/index.smoke.test.ts` — inert import and native-allocation safety.
- `test/fakeController.ts` — dynamic runtime/readiness test double support.

### Related ADRs
- [ADR-002: Prioritize a Restorable, Fast-Switching Conversation Tab Workspace](adrs/adr-002.md) — requires restored visible/background and empty-workspace behavior.
- [ADR-003: Use a Mutable Registry with One Dedicated Runtime per Conversation](adrs/adr-003.md) — requires independent failure isolation.
- [ADR-004: Separate Workspace Metadata from Session State and Persist a Versioned Workspace](adrs/adr-004.md) — requires record-driven restore and valid null selection.
- [ADR-005: Gate Requested Tab Chords on Kitty Keyboard Events and Retain Sessions Fallback](adrs/adr-005.md) — requires injectable, safe renderer capability handling.

## Deliverables
- Boot/readiness policy that accepts valid Session Tabs workspace states and preserves cleanup.
- Opt-in content-free telemetry for approved tab lifecycle and responsiveness signals.
- End-to-end Session Tabs integration coverage across restore, failure, and empty-workspace flows.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for boot, restore, telemetry, and privacy **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Empty workspace and a single unavailable restored conversation do not trigger a false fixed-fleet readiness failure.
  - [ ] Provider probe failures remain isolated and every partially created runtime/renderer is disposed on failure.
  - [ ] Disabled telemetry creates no sink/file/watch and emits no events.
  - [ ] Tab telemetry uses only approved fixed enums, counts, and duration buckets with no forbidden content fields.
- Integration tests:
  - [ ] Create, select, background/reopen, close, save, dispose, and boot/restore preserve expected visible/background/empty behavior.
  - [ ] One unavailable restored tab leaves usable siblings and empty workspace affordances available.
  - [ ] Telemetry event ordering, switch-latency bucket, restore-count bucket, and strict payload allowlist hold through the integrated flow.
  - [ ] Self-check and boot cleanup remain correct after dynamic tab and renderer failures.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Valid empty and partially unavailable workspaces boot without violating existing safety gates.
- Telemetry is opt-in, local, content-free, and sufficient to evaluate PRD metrics.
