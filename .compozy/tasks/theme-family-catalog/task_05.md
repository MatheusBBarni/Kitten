---
status: completed
title: Publish the catalog contract and release evidence
type: docs
complexity: medium
---

# Task 05: Publish the catalog contract and release evidence

## Overview

Publish the finished catalog as an accessible, source-attributed product contract and capture final verification evidence for the atomic release. Keep the documentation aligned with the implemented canonical IDs, aliases, provenance, Settings behavior, and user-visible compatibility guarantees.

<critical>
- ALWAYS READ [the PRD](./_prd.md), [the TechSpec](./_techspec.md), and every related ADR before implementation.
- REFERENCE [ADR-001](adrs/adr-001.md), [ADR-002](adrs/adr-002.md), [ADR-003](adrs/adr-003.md), and [ADR-004](adrs/adr-004.md) for the release, provenance, compatibility, and Settings contracts.
- FOCUS on durable documentation and verification evidence for the completed feature; do not introduce runtime behavior, palette values, aliases, or UI features in this task.
- MINIMIZE documentation scope to the theme catalog contract and its discoverability links. Do not alter unrelated product documentation.
- TESTS REQUIRED: add or extend documentation-contract tests, then run the fresh full project typecheck and test gate after all packet work is complete.
</critical>

<requirements>
- 1. MUST document exactly the implemented 18 canonical preset IDs, family/variant labels, source URLs, and license/attribution information in a readable catalog table or equivalent accessible structure.
- 2. MUST document declared aliases as compatibility input only, explain canonical resolution, and state that aliases are not rewritten on boot but an explicit later selection persists a canonical ID.
- 3. MUST document the Settings picker behavior: deterministic family grouping, keyboard navigation with bounded scrolling, instant application, and documentation-first provenance.
- 4. MUST keep the README and project context discoverability links accurate without duplicating a second mutable catalog source.
- 5. MUST provide fresh release evidence by passing documentation-contract tests and `rtk bun run typecheck && rtk bun test` after the completed implementation.
</requirements>

## Subtasks

- [x] Reconcile `docs/theme-catalog.md` with the implemented core catalog, aliases, provenance, accessibility, and compatibility contracts.
- [x] Add the user-facing Settings-picker and canonical-persistence behavior to the catalog documentation.
- [x] Update the smallest necessary README and context references so the canonical documentation remains discoverable.
- [x] Add or extend a documentation-contract test that prevents roster, source, and discoverability drift.
- [x] Run targeted documentation tests and the fresh full typecheck/test gate; record any inherited failure separately from feature evidence.

## Implementation Details

### Relevant Files

- `docs/theme-catalog.md` — canonical user-facing preset, provenance, alias, accessibility, and Settings behavior documentation.
- `README.md` — theme catalog discoverability link.
- `CONTEXT.md` — product terminology and theme catalog context.
- `test/syntaxHighlightingDocs.test.ts` — existing documentation-contract test pattern to extend or mirror.
- `.compozy/tasks/theme-family-catalog/_prd.md` and `.compozy/tasks/theme-family-catalog/_techspec.md` — requirements and implementation contract references.

### Dependent Files

- `src/core/themeCatalog.ts` — implemented canonical IDs, display metadata, aliases, source URLs, and attribution authority.
- `src/config/configLoader.ts`, `src/config/configWriter.ts`, and `src/config/configWatcher.ts` — compatibility behavior documented from verified implementation.
- `src/ui/SettingsView.tsx` and `src/ui/theme.ts` — picker and accessibility behavior documented from verified implementation.
- Existing test suite and project scripts — final release evidence sources.

### Related ADRs

- [ADR-001: Deliver a finite, accessibility-gated 18-preset catalog atomically](adrs/adr-001.md)
- [ADR-002: Preserve instant selection and documentation-first provenance in V1](adrs/adr-002.md)
- [ADR-003: Make the core theme catalog the identity and compatibility authority](adrs/adr-003.md)
- [ADR-004: Project catalog metadata into typed scrollable Settings rows](adrs/adr-004.md)

## Deliverables

- Updated accessible catalog documentation matching the shipped canonical roster, provenance, aliases, Settings behavior, and compatibility guarantees.
- Accurate README and context links to the single catalog document.
- A documentation-contract regression test covering roster/source/discoverability drift.
- Fresh targeted and full-gate verification evidence, with inherited failures clearly distinguished if present.

## Tests

- Unit tests:
  - [x] Assert documentation names all 18 implemented canonical IDs exactly once and does not advertise unsupported custom or downloaded palettes.
  - [x] Assert every documented preset has a source URL and attribution/license entry matching the core catalog contract.
  - [x] Assert documentation states alias canonicalization, no startup rewrite, explicit canonical persistence, instant Settings application, and bounded keyboard scrolling.
  - [x] Assert README and context links point to the canonical theme catalog documentation.
- Integration tests:
  - [x] Run the documentation-contract test alongside relevant catalog/config/Settings suites to verify public claims against the implemented interfaces.
  - [x] Run `rtk bun run typecheck && rtk bun test` as fresh release evidence; report an inherited unrelated failure without broadening scope.
- Test coverage target: >=80% for new documentation-contract assertions and changed documentation validation branches.
- All targeted documentation tests and the fresh project gate pass before release handoff.

## Success Criteria

- Public documentation is source-attributed, accessible, and exactly aligned with the shipped 18-preset catalog.
- Compatibility and Settings behavior are clear without creating a second identity or provenance source.
- Documentation discoverability remains accurate across README and context surfaces.
- Documentation-contract tests and fresh full verification provide release evidence.
- Any inherited gate failure is recorded distinctly and does not produce an unsupported completion claim.
