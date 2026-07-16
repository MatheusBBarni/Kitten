---
status: completed
title: Emit Content-Free Experiment Telemetry
type: frontend
complexity: high
---

# Task 10: Emit Content-Free Experiment Telemetry

## Overview

Add the approved local telemetry evidence for changed projections and real history reveals without creating a general analytics channel. The recorder keeps only closed count, duration, and reason buckets, while the conversation view emits once per meaningful enabled change and nothing when telemetry is disabled.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add only transcript_projection_measured and transcript_history_revealed to the closed recorder allowlist.
2. MUST store only the fixed bucket/reason fields defined by the TechSpec Monitoring and Observability section plus existing type, timestamp, and anonymous session reference.
3. MUST bucket raw counts and duration inside recorder APIs; raw values MUST never appear in TelemetryRecord or JSONL output.
4. MUST keep disabled telemetry as a no-op that does not construct, access, or write a sink.
5. MUST thread the existing recorder only through CockpitApp's default ConversationView path.
6. MUST emit only for enabled, meaningful projection/reveal changes and deduplicate rerenders and no-op reveals.
7. MUST never record transcript text, message/tool IDs, paths, prompts, marker keys, arbitrary labels, or raw duration/count values.
</requirements>

## Subtasks

- [ ] Add closed event, reason, field, and bucket contracts to the recorder.
- [ ] Add active-recorder bucket behavior and matching disabled no-op behavior.
- [ ] Cover bucket boundaries, exact serialized shapes, and sentinel privacy rejection.
- [ ] Thread the existing recorder through the default cockpit conversation path only.
- [ ] Emit deduplicated projection/reveal evidence at the task 08 seam.
- [ ] Cover real renderer and local JSONL enabled/disabled behavior.

## Implementation Details

Modify src/telemetry/recorder.ts, src/telemetry/recorder.test.ts, src/ui/CockpitApp.tsx, src/ui/ConversationView.tsx, src/ui/ConversationView.test.tsx, src/ui/CockpitApp.test.tsx, and test/telemetry.integration.test.ts. Reference the TechSpec Monitoring and Observability section rather than duplicating record definitions. Do not add a telemetry context or thread a recorder through unrelated components.

### Relevant Files

- src/telemetry/recorder.ts — closed event/field/bucket contract and active/no-op APIs.
- src/telemetry/recorder.test.ts — exact shape, bucket, and disabled-sink coverage.
- src/ui/CockpitApp.tsx — existing recorder ownership and default conversation threading.
- src/ui/ConversationView.tsx — approved projection/reveal emission seam.
- src/ui/ConversationView.test.tsx — enabled projection/reveal renderer coverage.
- src/ui/CockpitApp.test.tsx — recorder threading through the real cockpit tree.
- test/telemetry.integration.test.ts — local JSONL privacy and disabled behavior.

### Dependent Files

- src/store/appStore.ts — task 02 determines meaningful state changes.
- src/core/transcriptProjection.ts — task 01 supplies projection dimensions.
- src/ui/ConversationView.tsx — task 08 supplies marker/reveal behavior.
- test/sessionStatus.integration.test.tsx — task 07 completes its config fixture migration first.

### Related ADRs

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Preserves live-run privacy.
- [ADR-002: Launch bounded live history as a truth-first experiment](adrs/adr-002.md) — Requires evidence before wider rollout.
- [ADR-003: Separate transcript projection from semantic session state](adrs/adr-003.md) — Defines projection and renderer boundaries.
- [ADR-004: Use strict config, canonical commands, and bounded evidence](adrs/adr-004.md) — Defines closed, opt-in, content-free telemetry.

## Deliverables

- Closed recorder support for projection and reveal evidence.
- Deduplicated enabled emission path and disabled no-op behavior.
- Recorder, renderer, cockpit, and JSONL privacy regressions.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Telemetry integration tests **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Projection measurements bucket visible=120, hidden=880, duration=16, and history-reveal reason without raw values.
  - [ ] Every count/duration boundary and non-finite input normalizes to an allowed bucket.
  - [ ] Disabled recorder with a throwing sink getter neither accesses nor writes the sink.
  - [ ] Exact record keys reject transcript text, identifiers, paths, prompts, marker keys, and arbitrary labels.
- Integration tests:
  - [ ] Enabled changed projection emits one initial/tail/reveal measurement and a real history reveal emits one reveal event.
  - [ ] Rerenders and no-op marker/command activation emit no duplicate record.
  - [ ] Local JSONL records contain no sentinel prompt, text, path, tool, or session content.
  - [ ] Cockpit threading passes recorder only to the default conversation path.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every emitted event has only allowlisted bucket fields.
- Disabled telemetry opens no sink and writes no record.
