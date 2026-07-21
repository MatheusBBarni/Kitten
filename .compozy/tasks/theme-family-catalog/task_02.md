---
status: completed
title: Canonicalize configuration, persistence, and telemetry compatibility
type: backend
complexity: high
---

# Task 02: Canonicalize configuration, persistence, and telemetry compatibility

## Overview

Make the configuration boundary accept declared legacy aliases as input while ensuring all resolved application state, explicit persistence, and content-free telemetry use canonical catalog IDs. Preserve malformed-config fail-closed behavior and the no-startup-rewrite guarantee.

<critical>
- ALWAYS READ [the PRD](./_prd.md), [the TechSpec](./_techspec.md), and the related ADRs before implementation.
- REFERENCE [ADR-001](adrs/adr-001.md) and [ADR-003](adrs/adr-003.md) for alias compatibility, canonical state, and privacy constraints.
- FOCUS on the config boundary, persistence lifecycle, and fixed-field telemetry; do not create new aliases, palettes, Settings rows, or catalog metadata.
- MINIMIZE lifecycle changes: preserve the writer's atomic merge/rename behavior, watcher debounce/signature behavior, and boot subscription ordering.
- TESTS REQUIRED: cover raw alias input, canonical resolved state, no boot repair-write, strict validation, and content-free telemetry.
</critical>

<requirements>
- 1. MUST validate `theme` against canonical catalog IDs plus only the aliases declared by the core catalog, and reject unknown or inherited keys with a named `ConfigError` for `theme`.
- 2. MUST canonicalize aliases at configuration ingestion so `AppConfig.theme`, app-store state, explicit persistence payloads, and `themeSet` telemetry use canonical IDs only.
- 3. MUST preserve an alias's on-disk bytes during boot and watcher reload; compatibility parsing MUST NOT automatically rewrite configuration.
- 4. MUST write only a canonical ID after a user makes a distinct explicit theme selection, while retaining atomic writer behavior and strict re-parse guarantees.
- 5. MUST keep telemetry content-free: theme events may carry the fixed canonical ID but no family, display name, source URL, attribution, arbitrary config text, or user content.
</requirements>

## Subtasks

- [x] Replace duplicated preset validation with the core catalog's canonical IDs and declared alias map in the config loader.
- [x] Canonicalize valid raw theme input at merge/parse time and preserve named errors for malformed, unknown, and inherited values.
- [x] Confirm writer, watcher, boot, and store equality paths retain no-startup-rewrite and duplicate-notification behavior.
- [x] Tighten type use and telemetry recording so observed values are canonical IDs with no expanded metadata.
- [x] Add configuration, persistence, lifecycle, and telemetry regression coverage.

## Implementation Details

### Relevant Files

- `src/config/configLoader.ts` — schema and `mergeAppConfig` canonicalization boundary.
- `src/config/configWriter.ts` — canonical explicit writes and strict re-parse coverage.
- `src/config/configWatcher.ts` — external alias reload and equivalent canonical reload behavior.
- `src/index.ts` — boot config seeding and subscription order; preserve its no-write behavior.
- `src/store/appStore.ts` — canonical equality/no-op persistence seam.
- `src/telemetry/recorder.ts` — fixed, content-free `themeSet` event payload.
- `src/config/configLoader.test.ts`, `src/config/configWriter.test.ts`, `src/config/configWatcher.test.ts`, `src/telemetry/recorder.test.ts` — colocated regression coverage.

### Dependent Files

- `src/core/themeCatalog.ts` — provides canonical IDs, aliases, and safe canonicalization.
- `src/core/types.ts` — supplies catalog-derived `ThemePresetId` and `ThemePreference`.
- `test/cockpitSession.test.ts` — exercises boot/store/persistence behavior.
- `test/configPersistence.integration.test.ts` — exercises real writer/watcher/restart behavior.

### Related ADRs

- [ADR-001: Deliver a finite, accessibility-gated 18-preset catalog atomically](adrs/adr-001.md)
- [ADR-003: Make the core theme catalog the identity and compatibility authority](adrs/adr-003.md)

## Deliverables

- Catalog-backed configuration validation and alias canonicalization at the raw-input boundary.
- Canonical resolved state and explicit persistence, without an alias repair-write during boot or watch reload.
- Content-free telemetry limited to the canonical theme ID and existing fixed event fields.
- Regression tests across loader, writer, watcher, session/persistence integration, and recorder seams.

## Tests

- Unit tests:
  - [x] Table-test every canonical ID and every declared alias through config loading; aliases resolve to their canonical ID.
  - [x] Reject `neon`, `toString`, and `__proto__` with a `ConfigError` naming `theme`.
  - [x] Assert config writer output uses canonical IDs and continues to strict-reparse successfully.
  - [x] Assert watcher alias reload yields canonical config and an equivalent canonical update causes no duplicate callback.
  - [x] Assert `themeSet` records only `type`, `themeId`, `at`, and `sessionRef` without catalog metadata or free text.
- Integration tests:
  - [x] Assert alias-loaded config seeds canonical store state with zero scheduled/write calls, then a distinct explicit selection writes one canonical ID.
  - [x] Assert the real writer/watcher/restart path leaves alias bytes unchanged at boot and writes a canonical ID only after explicit selection.
- Test coverage target: >=80% for changed config canonicalization and telemetry branches.
- All targeted tests pass before handoff.

> The initial authoritative catalog declares no historical aliases. Alias tables and watcher coverage therefore enumerate the empty production map without inventing compatibility input; canonical boot/write lifecycle behavior is exercised directly.

## Success Criteria

- Declared aliases are backward-compatible input only; they never survive in resolved state, explicit persistence, or telemetry.
- Unknown and prototype-inherited theme values fail closed with a clear configuration error.
- Boot and watcher reload preserve user configuration bytes until an explicit change occurs.
- Telemetry remains local, opt-in, and content-free.
- Targeted configuration, lifecycle, persistence, and telemetry suites pass with the stated coverage target.
