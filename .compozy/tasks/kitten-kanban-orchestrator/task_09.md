---
status: completed
title: Add deterministic project-plus-user Skill Catalog and snapshots
type: backend
complexity: high
---

# Task 09: Add deterministic project-plus-user Skill Catalog and snapshots

## Overview

Create the desktop-owned local Skill Catalog that resolves project roots before
user roots, diagnoses invalid entries and collisions, and produces immutable
Skill snapshots. It makes stage defaults and Run Context provenance stable,
selectable identities rather than free-text instructions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. Catalog discovery MUST scan configured project roots before configured user roots with deterministic root and entry ordering.
2. Roots and discovered Skill locations MUST be canonicalized; symlink aliases to one SKILL.md MUST yield one entry.
3. Readable, valid, non-empty UTF-8 SKILL.md content MUST be required; invalid roots/files MUST yield diagnostics and no fallback free-text Skill.
4. Catalog identities MUST derive from canonical location and validated-content digest, with root class, metadata, and diagnostics retained.
5. Same-name distinct canonical locations MUST expose a collision and MUST NOT auto-select by display name.
6. Snapshot construction MUST retain exact validated content, digest, and identity for immutable future Run Contexts.
</requirements>

## Subtasks

- [x] 9.1 Define catalog root, entry, diagnostic, and snapshot contracts.
- [x] 9.2 Resolve and canonicalize project and user roots deterministically.
- [x] 9.3 Validate Skill files, digest content, and deduplicate aliases.
- [x] 9.4 Surface collision and invalid-root diagnostics with stable selection identity.
- [x] 9.5 Persist/rebuild catalog projections and immutable snapshots.
- [x] 9.6 Add isolated filesystem and temporary-SQLite coverage.

## Implementation Details

Follow the TechSpec Local Skill roots integration point and Data Models. Existing
repository skill directories are examples only; do not make their aliases an
implicit selection rule.

### Relevant Files

- packages/desktop/src/catalog/contracts.ts — root, entry, diagnostic, and snapshot models.
- packages/desktop/src/catalog/skillCatalog.ts — discovery, validation, canonicalization, and digest logic.
- packages/desktop/src/catalog/skillCatalog.test.ts — isolated filesystem resolver coverage.
- packages/desktop/src/catalog/catalogProjection.ts — journal/projection adapter.
- packages/desktop/src/catalog/catalogProjection.test.ts — temporary SQLite evidence.
- packages/desktop/src/catalog/index.ts — limited host export boundary.
- packages/desktop/src/catalog/fixtures.ts — test-only catalog fixture helpers.

### Dependent Files

- packages/desktop/src/attempts/runnableValidator.ts — valid Skill prerequisite.
- packages/desktop/src/attempts/attemptCoordinator.ts — immutable Run Context input.
- packages/desktop/src/renderer/settings/CatalogRootsPanel.tsx — future diagnostics consumer.

### Related ADRs

- [ADR-006: Resolve Workflow Skills from deterministic project and user catalog roots](adrs/adr-006.md) — catalog precedence and snapshots.
- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — durable catalog projection.

## Deliverables

- Deterministic project-plus-user catalog and collision diagnostics.
- Stable catalog identity and immutable validated-content snapshots.
- Filesystem and persistence contract suite.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for catalog reopen/rebuild behavior **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Verify a project entry orders before a user entry and distinct same-name paths surface a collision.
  - [x] Deduplicate two symlink aliases resolving to one Skill location.
  - [x] Diagnose missing, unreadable, malformed, non-UTF8, and empty Skill files.
  - [x] Verify changed bytes change digest/identity while an earlier snapshot remains exact.
- Integration tests:
  - [x] Reopen and rebuild persisted catalog entries and diagnostics without changing ordering or identity.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- No stage or attempt must rely on a free-text Skill name.
- Future catalog changes cannot rewrite an existing immutable snapshot.
