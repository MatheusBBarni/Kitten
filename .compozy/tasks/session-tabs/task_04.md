---
status: pending
title: "Replace fixed controller plan with mutable conversation registry"
type: refactor
complexity: high
---

# Task 04: Replace fixed controller plan with mutable conversation registry

## Overview

Refactor the controller from a configuration-seeded fixed fleet into a mutable registry of independently owned conversation runtimes. The registry must create and restore dynamic conversations in stable workspace order while preserving per-conversation failure isolation and immutable configuration.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST make registry iteration, runtime lookup, branch refresh, fresh-session recovery, and disposal work for dynamic record-only SessionIds rather than a fixed configuration plan.
2. MUST create one dedicated AgentConnection, ACP session, subscription, and runtime state per conversation.
3. MUST restore V2 conversations in persisted workspace order and restore V1 entries only through matching resolved configuration descriptors.
4. MUST bind store placeholders and event subscriptions before ACP replay so replayed state is retained.
5. MUST keep configuration read-only and retain unavailable conversations independently when provider or ACP restoration fails.
</requirements>

## Subtasks
- [ ] 4.1 Replace fixed-fleet lifecycle ownership with a mutable conversation registry.
- [ ] 4.2 Register dynamic conversations with isolated runtime state and descriptor lookup.
- [ ] 4.3 Restore versioned saved conversations in deterministic workspace order.
- [ ] 4.4 Preserve constrained legacy restoration without fabricating missing descriptors.
- [ ] 4.5 Expose runtime standing and recovery paths for dynamic unavailable conversations.

## Implementation Details

Use the TechSpec’s **Component Overview**, **Data Flow**, **Persistence and Restore**, and **Availability and Retry** sections. The controller remains the sole owner of ACP connections, subscriptions, loading, recovery, and runtime disposal.

### Relevant Files
- `src/app/controller.ts` — fixed plan, runtime maps, restore, readiness, fresh-start, and disposal flows.
- `src/app/controller.test.ts` — controller behavior, replay, degraded runtime, and lifecycle coverage.
- `src/config/configLoader.ts` — immutable provider recipes and startup seed resolution.
- `src/config/configLoader.test.ts` — descriptor, CWD, title, and duplicate-provider resolution tests.
- `test/sessionRestore.integration.test.ts` — saved-run to controller restore behavior.
- `test/sessionPicker.integration.test.tsx` — picker-selected record restoration through the cockpit.

### Dependent Files
- `src/persistence/runRecord.ts` — versioned persistence data consumed by restore.
- `src/persistence/runStore.ts` — validated records and summaries.
- `src/persistence/runWriter.ts` — snapshots registry-backed workspace state.
- `src/store/appStore.ts` — dynamic execution slices, focus, availability, and restoration state.
- `src/app/actions.ts` — public recovery and fresh-session actions.
- `src/ui/SessionPicker.tsx` — saved-run flows that initiate controller restore.

### Related ADRs
- [ADR-003: Use a Mutable Registry with One Dedicated Runtime per Conversation](adrs/adr-003.md) — establishes isolated dynamic runtimes.
- [ADR-004: Separate Workspace Metadata from Session State and Persist a Versioned Workspace](adrs/adr-004.md) — governs record-driven V2 restoration and constrained V1 migration.

## Deliverables
- Mutable controller registry with dedicated dynamic runtime ownership.
- Record-driven V2 restore and configuration-backed V1 restoration behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests covering dynamic saved-run restoration and failure isolation **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Dynamic conversations receive distinct runtime/session identities even when they share a provider.
  - [ ] Runtime enumeration, lookup, readiness, recovery, branch refresh, and disposal work for record-only dynamic IDs.
  - [ ] V2 restore creates store identity and subscriptions before replay and preserves persisted order/selection.
  - [ ] One connection/load failure leaves only that conversation unavailable while siblings continue.
  - [ ] V1 restore keeps matching configuration-backed entries and safely ignores unmatched pointers.
- Integration tests:
  - [ ] A saved run with dynamic visible/background conversations restores through the picker even when startup configuration differs.
  - [ ] Unavailable restored conversations expose a recovery path without preventing usable siblings from booting.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing.
- Test coverage >=80%.
- Controller lifecycle behavior no longer assumes a fixed configuration plan.
- Each conversation has isolated runtime failure and restoration behavior.
