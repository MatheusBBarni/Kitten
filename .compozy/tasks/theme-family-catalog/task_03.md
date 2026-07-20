---
status: pending
title: Expand palette rendering and accessibility coverage
type: frontend
complexity: medium
---

# Task 03: Expand palette rendering and accessibility coverage

## Overview

Render every canonical catalog preset through a complete Cockpit palette while preserving terminal-mode fallback, syntax-style caching, and live repaint behavior. The resulting palette set is an atomic visual quality gate: all 18 presets must meet the approved truecolor and ANSI-256 readability requirements.

<critical>
- ALWAYS READ [the PRD](./_prd.md), [the TechSpec](./_techspec.md), and the related ADRs before implementation.
- REFERENCE [ADR-001](adrs/adr-001.md) and [ADR-003](adrs/adr-003.md) for the atomic accessibility gate and canonical-ID authority.
- FOCUS on `src/ui/theme.ts` and its colocated tests; use the core catalog only for identity and provenance references.
- MINIMIZE visual scope: preserve existing built-in terminal-mode palettes, syntax parsing/cache lifecycle, consumers, and fallback semantics; do not add downloads, custom palettes, or UI controls.
- TESTS REQUIRED: test all 18 presets over truecolor and ANSI-256 fallback with the specified contrast and cache contracts.
</critical>

<requirements>
- 1. MUST define a complete `CockpitPalette` for every canonical catalog ID and use an exhaustive typed registry keyed only by `ThemePresetId`.
- 2. MUST canonicalize before preset lookup so aliases resolve to the same palette object and syntax-style cache entry as their canonical ID; unknown and inherited values MUST retain terminal-mode fallback.
- 3. MUST retain every semantic palette role and ensure readable foreground/background pairs meet 4.5:1 in truecolor and after ANSI-256 fallback, including message and selection surfaces.
- 4. MUST preserve distinct status and tool affordances, deterministic syntax styles, existing consumers, and immediate live palette resolution across terminal modes.
- 5. MUST keep palette color values in the UI layer; source, license, family, display, and alias authority remain in the core catalog.
</requirements>

## Subtasks

- [ ] Import catalog-derived types and canonicalization helpers into `src/ui/theme.ts` without moving UI palette values into core.
- [ ] Define all approved preset palettes and replace the string-indexed preset registry with an exhaustive `Record<ThemePresetId, CockpitPalette>`.
- [ ] Update resolver and syntax-style cache paths so aliases share canonical palette identity and cache behavior.
- [ ] Verify direct palette consumers retain their existing fallback and repaint behavior.
- [ ] Expand `src/ui/theme.test.tsx` with full roster, contrast, ANSI-256, resolver, and cache regression matrices.

## Implementation Details

### Relevant Files

- `src/ui/theme.ts` — `CockpitPalette`, preset registry, `resolvePalette`, ANSI-256 fallback, and syntax-style cache.
- `src/ui/theme.test.tsx` — semantic field, readability, resolver, cache, and repaint coverage.
- `src/core/themeCatalog.ts` — canonical ID and alias authority consumed by the UI.
- `src/core/types.ts` — catalog-derived preset ID type.
- `docs/theme-catalog.md` — provenance reference; palette values stay UI-owned.

### Dependent Files

- `src/ui/bootBanner.tsx` — resolves the active palette.
- `src/ui/Markdown.tsx` — consumes syntax styles.
- `src/ui/ToolCallRow.tsx` — consumes semantic palette roles.
- `src/ui/SettingsView.tsx` — will derive theme selection labels and active palette information from the catalog and resolver.

### Related ADRs

- [ADR-001: Deliver a finite, accessibility-gated 18-preset catalog atomically](adrs/adr-001.md)
- [ADR-003: Make the core theme catalog the identity and compatibility authority](adrs/adr-003.md)

## Deliverables

- An exhaustive typed 18-preset palette registry in `src/ui/theme.ts` with complete semantic roles.
- Canonical palette resolution and syntax-style caching that share objects and cache entries across alias/canonical input.
- Preserved terminal fallback, live repaint, and consumer contracts.
- Expanded palette tests proving roster completeness, contrast, ANSI-256 fallback, resolver safety, and cache behavior.

## Tests

- Unit tests:
  - [ ] Assert registry keys exactly equal the core catalog IDs and every palette's `id` equals its registry key.
  - [ ] Assert every palette has all `CockpitPalette` semantic roles and canonical IDs resolve across both terminal modes.
  - [ ] Assert every declared alias resolves to its canonical palette object; unknown and `__proto__` use terminal-mode fallback.
  - [ ] Assert syntax styles are stable per canonical palette, distinct across presets where expected, and shared by alias/canonical inputs.
  - [ ] Assert all required foreground/background contrast pairs meet 4.5:1 in truecolor and under ANSI-256 fallback, with distinct message, selection, status, and tool affordances.
- Integration tests:
  - [ ] Exercise the live theme-resolution/repaint path across terminal modes using the existing UI test seam to ensure consumers receive the selected canonical palette.
- Test coverage target: >=80% for changed palette registry, resolver, fallback, and syntax cache branches.
- All targeted tests pass before handoff.

## Success Criteria

- All 18 catalog presets render through complete, typed UI palettes.
- Palette lookup, alias compatibility, and syntax caching use canonical identity without unsafe property access.
- The documented readability gate passes in truecolor and ANSI-256 fallback.
- Existing built-in fallback and live UI palette behavior remain intact.
- Targeted palette tests pass with the stated coverage target.
