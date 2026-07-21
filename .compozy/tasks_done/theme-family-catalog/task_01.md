---
status: completed
title: Create the protocol-free theme catalog
type: refactor
complexity: medium
---

# Task 01: Create the protocol-free theme catalog

## Overview

Create the single, pure core authority for the complete 18-preset catalog: canonical IDs, family and variant labels, display labels, source/provenance metadata, and the explicitly declared legacy-alias map. Derive the public preset ID type from that authority without introducing runtime, UI, config, or telemetry dependencies.

<critical>
- ALWAYS READ [the PRD](./_prd.md), [the TechSpec](./_techspec.md), and the related ADRs before implementation.
- REFERENCE [ADR-001](adrs/adr-001.md) and [ADR-003](adrs/adr-003.md) for the atomic 18-preset and single-authority contracts.
- FOCUS on a pure `src/core/themeCatalog.ts` module. It MUST NOT import OpenTUI, React, filesystem/config, telemetry, ACP, or process APIs.
- MINIMIZE changes to type declarations only; do not change configuration parsing, palette values, Settings UI, persistence, telemetry, or public documentation in this task.
- TESTS REQUIRED: colocated Bun unit tests must cover the complete catalog and alias invariants.
</critical>

<requirements>
- 1. MUST declare exactly these canonical IDs in deterministic catalog order: `catppuccin-frappe`, `catppuccin-latte`, `catppuccin-macchiato`, `catppuccin-mocha`, `dracula-alucard`, `dracula`, `gruvbox-dark-hard`, `gruvbox-dark-medium`, `gruvbox-dark-soft`, `nord`, `one-dark`, `rose-pine-dawn`, `rose-pine-main`, `rose-pine-moon`, `tokyo-night-day`, `tokyo-night-moon`, `tokyo-night`, and `tokyo-night-storm`.
- 2. MUST make each catalog entry include canonical ID, family, nullable variant, display label, source URL, and license/attribution text; source details must agree with `docs/theme-catalog.md`.
- 3. MUST expose a typed, explicit alias map and canonicalization helper that accept only own declared string keys, never reinterpret aliases as new identities, and preserve every canonical ID unchanged.
- 4. MUST derive `ThemePresetId` in `src/core/types.ts` from the catalog while retaining `ThemePreference` as the built-in themes plus `ThemePresetId`.
- 5. MUST keep the module protocol-free and deterministic; no dynamic discovery, remote fetch, user-defined palette, or inferred alias behavior is permitted.
</requirements>

## Subtasks

- [ ] Define the immutable catalog entry shape, ordered catalog, canonical ID list, and lookup helpers in `src/core/themeCatalog.ts`.
- [ ] Encode catalog family, variant, display, source, and attribution metadata for every approved preset.
- [ ] Add the explicit alias-map contract and a safe canonicalization helper with no prototype-chain lookup.
- [ ] Replace the handwritten preset union in `src/core/types.ts` with a catalog-derived `ThemePresetId` while retaining built-in theme preferences.
- [ ] Add focused `src/core/themeCatalog.test.ts` coverage and update `src/core/types.test.ts` only where the derived type contract needs proof.

## Implementation Details

### Relevant Files

- `src/core/themeCatalog.ts` — new pure catalog authority and canonicalization helpers.
- `src/core/types.ts` — derive `ThemePresetId`; preserve `ThemePreference`.
- `src/core/themeCatalog.test.ts` — new catalog and alias invariant tests.
- `src/core/types.test.ts` — type-facing behavior regression coverage.
- `docs/theme-catalog.md` — existing provenance source of truth to reconcile against; do not edit it in this task.

### Dependent Files

- `src/config/configLoader.ts` — will consume the catalog for validation and input canonicalization.
- `src/ui/theme.ts` — will consume canonical preset IDs for exhaustive palette lookup.
- `src/ui/SettingsView.tsx` — will project catalog metadata into Settings rows.

### Related ADRs

- [ADR-001: Deliver a finite, accessibility-gated 18-preset catalog atomically](adrs/adr-001.md)
- [ADR-003: Make the core theme catalog the identity and compatibility authority](adrs/adr-003.md)

## Deliverables

- A pure `src/core/themeCatalog.ts` exporting the complete ordered 18-preset catalog and typed canonical ID surface.
- Complete family, variant, display, source URL, and attribution metadata for every catalog entry.
- An explicit, safe alias map plus canonicalization helper that preserves canonical identity and rejects inherited keys.
- `ThemePresetId` derived from the catalog and focused Bun tests proving roster, metadata, typing, and alias invariants.

## Tests

- Unit tests:
  - [ ] Assert the roster has exactly 18 unique IDs in the approved deterministic order.
  - [ ] Assert every entry has non-empty provenance metadata and singleton families use a null variant.
  - [ ] Assert canonical IDs round-trip and aliases resolve only to declared canonical IDs; unknown, `toString`, and `__proto__` do not resolve.
  - [ ] Assert the alias map has no self-reference or alias chain and uses own keys only.
  - [ ] Assert the catalog-derived type continues to accept built-ins through `ThemePreference`.
- Integration tests:
  - [ ] Run the affected core type and catalog suites together to prove the pure module imports without UI, config, or telemetry side effects.
- Test coverage target: >=80% for new catalog and canonicalization branches.
- All targeted tests pass before handoff.

## Success Criteria

- The catalog is the sole core definition of all 18 canonical preset identities and their provenance metadata.
- `ThemePresetId` cannot drift independently from the catalog roster.
- Alias handling is explicit, finite, prototype-safe, and does not create a second identity namespace.
- The core module remains free of runtime and presentation dependencies.
- Targeted core tests pass with the stated coverage target.
