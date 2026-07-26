---
status: completed
title: Expose review manifest and chunk RPC with renderer query bindings
type: backend
complexity: high
---

# Task 06: Expose review manifest and chunk RPC with renderer query bindings

## Overview

Expose immutable review evidence through manifest-first, per-file queries and
connect them to the renderer's typed query client. Payloads remain bounded,
plain JSON, and identity-scoped so ordinary board or inspector refreshes never
transport full patch data.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. `getReviewManifest` MUST return immutable metadata/file summaries without patch content.
2. `getReviewDiffChunk` MUST validate opaque identities and offsets and MUST return no more than 64 KiB of decoded text.
3. Missing, stale, unsafe, binary, oversized, and host-unavailable states MUST use stable typed results without raw exceptions.
4. Both methods MUST be registered through the production Electrobun shell and required by the typed renderer client.
5. Manifest query keys MUST be scoped by card/evidence identity; chunk keys MUST include evidence, file, and offset identity.
6. Projection commits MUST invalidate manifests while immutable chunk caching remains bounded by finite garbage collection.
7. RPC payloads MUST NOT contain database rows, Git objects, absolute paths, patch blobs, or host handles.
</requirements>

## Subtasks

- [ ] 6.1 Add manifest and diff-chunk request/result schema methods.
- [ ] 6.2 Adapt evidence-service results to safe host RPC envelopes.
- [ ] 6.3 Enforce server-side identity, offset, encoding, and chunk limits.
- [ ] 6.4 Register both handlers in production desktop composition.
- [ ] 6.5 Add required typed renderer client methods.
- [ ] 6.6 Add identity-scoped query options, invalidation, and bounded caching.
- [ ] 6.7 Add host, bridge, query-key, and payload-boundary coverage.

## Implementation Details

Follow the TechSpec **Typed RPC boundary**, **API Endpoints**, and **TanStack
Query and Zustand** sections. This task exposes immutable evidence reads only;
capture, review mutations, and visual diff presentation remain separate.

### Relevant Files

- `packages/desktop/src/host/desktopRpc.ts` — evidence query adapters and safe result mapping.
- `packages/desktop/src/host/desktopRpc.test.ts` — host query and error-envelope coverage.
- `packages/desktop/src/main.ts` — production handler registration and service injection.
- `packages/desktop/src/renderer/client.ts` — required typed manifest and chunk methods.
- `packages/desktop/src/renderer/query/desktopQueries.ts` — query keys, options, invalidation, and cache limits.
- `packages/desktop/src/renderer/query/desktopQueries.test.ts` — renderer query behavior.

### Dependent Files

- `packages/desktop/src/shared/rpc.ts` — manifest, chunk, unavailable-resource, and schema contracts.

### Related ADRs

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](adrs/adr-001.md) — host-owned authority and projection-only RPC.
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](adrs/adr-002.md) — fail-closed availability states.
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](adrs/adr-004.md) — primary manifest/chunk boundary.

## Deliverables

- Production-wired manifest and bounded chunk queries.
- Typed renderer query bindings with stable invalidation and bounded cache behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for host-to-renderer RPC serialization **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Return deterministic manifest file order without patch/blob content.
  - [ ] Map each unavailable state to its exact stable code without raw host errors.
  - [ ] Reject invalid IDs, negative/non-integer offsets, and client attempts to raise the chunk cap.
  - [ ] Return monotonically advancing chunk offsets and exact terminal state within 64 KiB.
  - [ ] Return binary and oversized metadata without text content.
  - [ ] Prevent query-key collisions across cards, evidence, files, and offsets.
  - [ ] Bound immutable chunk garbage collection independently from normal projections.
- Integration tests:
  - [ ] Register both production schema handlers and delegate to the injected evidence service.
  - [ ] Pass every response through the plain-JSON projection validator.
  - [ ] Invalidate manifests on projection commit without refetching immutable chunks.
  - [ ] Invalidate the full evidence family when the host becomes unavailable.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Large review data never enters board, supervision, inspector, or revision payloads.
- Renderer evidence queries are bounded, typed, and collision-free.
