---
status: completed
title: Define shared supervision, review-evidence, and prompt-submission contracts
type: backend
complexity: medium
---

# Task 01: Define shared supervision, review-evidence, and prompt-submission contracts

## Overview

Define the plain-JSON contracts that all supervision, evidence, review, and
prompt-submission work consumes. This freezes identity, limit, result, and
fail-closed semantics without exposing host-only capabilities or prematurely
registering unimplemented RPC handlers.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Shared contracts MUST define supervision groups/items, evidence availability, manifest/file summaries, bounded diff chunks, evidence preconditions, submission sources/results, approval results, and stable errors.
2. Submission sources MUST be exactly `initial`, `composer`, and `request_changes`.
3. Evidence and supervision payloads MUST remain plain JSON and MUST NOT contain database, filesystem, worktree-path, Git-process, ACP-session, Skill-content, secret, prompt, transcript, or patch-blob authority.
4. Contract limits MUST encode the 2,000-file manifest and 64 KiB decoded chunk boundaries from the TechSpec.
5. Existing bootstrap, board, inspector, and Settings contracts MUST remain compatible.
6. New endpoint registration MUST wait until corresponding host handlers exist so this task remains independently typecheckable.
</requirements>

## Subtasks

- [ ] 1.1 Define supervision status, group, count, item, revision, and evidence-availability types.
- [ ] 1.2 Define immutable evidence manifest, file-summary, chunk, and precondition types.
- [ ] 1.3 Define unified prompt-submission and evidence-bound approval inputs and results.
- [ ] 1.4 Define stable fail-closed error codes and recovery-hint enums.
- [ ] 1.5 Extend projection validation coverage for all new contracts.
- [ ] 1.6 Verify existing RPC envelope compatibility.

## Implementation Details

Follow the TechSpec sections **Core Interfaces**, **API Endpoints**, and
**Security and Privacy**. Add reusable contract types and validation coverage,
but leave production endpoint registration to the host integration tasks.

### Relevant Files

- `packages/desktop/src/shared/rpc.ts` — canonical typed plain-JSON wire contracts and projection validator.
- `packages/desktop/test/desktopShell.test.ts` — cross-envelope serialization and projection-boundary coverage.

### Dependent Files

- `packages/desktop/src/host/boardRpc.ts` — consumes the supervision contracts.
- `packages/desktop/src/host/desktopRpc.ts` — consumes evidence and submission command contracts.
- `packages/desktop/src/renderer/client.ts` — exposes the renderer-facing typed client.
- `packages/desktop/src/main.ts` — registers production request handlers.
- `packages/desktop/src/host/electrobunWindow.ts` — enforces the Electrobun bridge boundary.

### Related ADRs

- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — supervision priority and fail-closed review semantics.
- [ADR-003: Derive Supervision on Read and Keep Navigation Renderer-Local](adrs/adr-003.md) — authoritative projection ownership.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — manifest-first and bounded chunk contracts.
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](adrs/adr-005.md) — direct submission sources and outcomes.

## Deliverables

- Shared supervision, evidence, submission, approval, and error contracts.
- Projection-boundary and backward-compatibility regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for typed desktop RPC envelope compatibility **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Accept a 2,000-file manifest containing summaries but no patch blobs.
  - [ ] Accept a valid 64 KiB decoded text chunk and reject oversized or inconsistent offset metadata.
  - [ ] Accept exactly the three declared submission sources and reject an unknown source.
  - [ ] Accept declared stable error codes and reject unknown error codes.
  - [ ] Reject cycles, class instances, binary handles, privileged keys, and host-only values.
  - [ ] Verify supervision items expose only bounded identifiers, enums, counts, versions, and timestamps.
- Integration tests:
  - [ ] Serialize and deserialize every new envelope through the desktop RPC boundary without losing discriminants.
  - [ ] Verify existing bootstrap, board, inspector, and Settings envelopes remain valid.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Later host and renderer tasks consume one shared contract vocabulary.
- No new contract crosses Kitten's host-owned authority boundary.
