---
status: pending
title: Containment-Safe Lazy Workspace Tree Source
type: backend
complexity: medium
---

# Task 2: Containment-Safe Lazy Workspace Tree Source

## Overview

Create a dedicated workspace explorer source for safe, lazy directory listing and file inspection. It must be independent of file completion so the explorer has its own containment, link, filtering, and deterministic ordering contract.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The source MUST accept workspace-relative paths only and reject absolute paths or traversal segments.
- Every list, refresh, and open candidate MUST canonicalize and revalidate the real workspace root and target at use time.
- Symlinks, special files, and `.git` contents MUST never be exposed; hidden and ignored non-`.git` entries remain eligible.
- Directory loading MUST be shallow and on-demand, with directories first and deterministic lexical ordering.
</requirements>

## Subtasks

- [ ] 2.1 Define the explorer source result and injected filesystem boundary.
- [ ] 2.2 Implement lazy root and directory listing with deterministic filtering and ordering.
- [ ] 2.3 Implement file eligibility checks for an open candidate.
- [ ] 2.4 Enforce canonical containment for normal, changed, and linked paths.
- [ ] 2.5 Add adversarial filesystem tests without reusing file completion behavior.

## Implementation Details

Follow the TechSpec “Core Interfaces,” “Directory Listing Algorithm,” “Security and Privacy,” and “Failure Semantics” sections. Use `fileDiscovery.ts` only as the repository’s path-safety reference; this source remains a separate capability with injected filesystem seams.

### Relevant Files

- `src/app/fileDiscovery.ts` — reference for repository safety conventions, not a reuse target.
- `src/app/fileDiscovery.test.ts` — existing filesystem seam and adversarial-path test style.
- `src/core/types.ts` — supplies immutable session workspace identity used by callers.

### Dependent Files

- `src/app/workspaceExplorer.ts` — new source implementation.
- `src/app/workspaceExplorer.test.ts` — new containment, link, filtering, and ordering tests.
- `src/app/actions.ts` — will consume the source through controller-owned capabilities.

### Related ADRs

- [ADR-001: Keep a safety-complete session explorer as the V1 boundary](adrs/adr-001.md) — defines the safety-complete V1 scope.
- [ADR-003: Keep explorer I/O behind separate controller-owned capabilities](adrs/adr-003.md) — requires a separate injected source boundary.

## Deliverables

- A dedicated lazy workspace explorer source with injected filesystem seams.
- Containment and eligibility results that never disclose unsafe entries.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for filesystem races and link handling **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Absolute paths and `..` traversal segments are rejected before traversal.
  - [ ] Broken, escaping, chained, and cyclic symlinks are absent from listings and cannot be opened.
  - [ ] `.git` is excluded at every depth while hidden and ignored non-`.git` entries remain visible.
  - [ ] Listings are shallow, directories-first, and lexically ordered.
  - [ ] A target changed after listing is revalidated and rejected when it escapes or becomes non-regular.
- Integration tests:
  - [ ] A directory tree with containment races produces only safe fixed outcomes and no thrown rejection.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The explorer never returns a path outside the canonical workspace root.
- Loading is lazy and never recurses through the complete repository tree.
