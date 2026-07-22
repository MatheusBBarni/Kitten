---
status: completed
title: Extract minimal protocol-free engine contracts
type: refactor
complexity: high
---

# Task 05: Extract minimal protocol-free engine contracts

## Overview

Create packages/engine as the deliberately small shared-contract boundary for
normalized attempt activity, certified-profile readiness, and scoped question
outcomes. It shares no application lifecycle, renderer, persistence, worktree,
or ACP-wire ownership.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Engine MUST export protocol-free contracts for readiness, normalized activity, Direct ACP attempt lifecycle, and generation-fenced questions/outcomes.
2. Engine MUST NOT import ACP SDKs, React, Electrobun, SQLite, Bun host APIs, board/card state, worktrees, persistence, or application controllers.
3. ACP wire translation MUST remain adapter-local to packages/tui and desktop adapters.
4. Existing Cockpit behavior MUST be preserved through a narrow compatibility adaptation rather than controller/store/persistence relocation.
5. Pure contract tests MUST cover normalized ordering, stale generations, and terminal question outcomes.
</requirements>

## Subtasks

- [x] 5.1 Create the engine package and constrained export boundary.
- [x] 5.2 Define opaque IDs and protocol-free readiness and attempt contracts.
- [x] 5.3 Define normalized activity and scoped-question outcome contracts.
- [x] 5.4 Adapt the TUI seam to consume minimal shared contracts.
- [x] 5.5 Prove forbidden imports and contract behavior with focused tests.

## Implementation Details

Follow the TechSpec Component Overview and Core Interfaces. Extract only values
that both applications can consume without lifecycle ownership.

### Relevant Files

- packages/engine/package.json — engine package boundary.
- packages/engine/src/contracts.ts — shared protocol-free models.
- packages/engine/src/index.ts — constrained public exports.
- packages/engine/src/contracts.test.ts — pure contract coverage.
- packages/tui/src/agent/agentConnection.ts — TUI ACP adapter compatibility seam.
- packages/tui/src/agent/acpTranslate.ts — normalized event translation seam.
- packages/tui/src/config/readiness.ts — existing readiness taxonomy.

### Dependent Files

- packages/desktop/src/attempts/directAcpAttempt.ts — future desktop adapter consumer.
- packages/desktop/src/attention/attemptAskUserBridge.ts — future generation-bound consumer.
- packages/tui/src/agent/askUserMcp.ts — reference-only scoped form behavior.

### Related ADRs

- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — application boundary.
- [ADR-007: Stage the Cockpit workspace relocation behind compatibility gates](adrs/adr-007.md) — preserves Cockpit behavior during extraction.

## Deliverables

- UI-free engine package with minimal exported contracts.
- TUI compatibility adaptation without changed ACP/controller behavior.
- Forbidden-import and pure-contract test coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for existing TUI adapter behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Preserve activity ordering metadata without importing ACP values.
  - [x] Classify ready and not-ready profile outcomes.
  - [x] Reject stale generation and non-terminal question outcomes.
- Integration tests:
  - [x] Run existing TUI AgentConnection and readiness contracts through the adaptation.
  - [x] Assert engine imports no TUI or desktop application surface.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Engine exports are protocol-free and application-lifecycle-free.
- Existing Cockpit ACP and readiness behavior remains unchanged.
