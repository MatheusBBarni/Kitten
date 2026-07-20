---
status: pending
title: Build the grouped scrollable Settings picker
type: frontend
complexity: medium
---

# Task 04: Build the grouped scrollable Settings picker

## Overview

Project the core theme catalog into typed, grouped, accessible Settings rows and make the expanded picker reliably navigable in a bounded scrollbox. Preserve the existing Settings overlay, keymap, selection state, and instant application/persistence interaction.

<critical>
- ALWAYS READ [the PRD](./_prd.md), [the TechSpec](./_techspec.md), and the related ADRs before implementation.
- REFERENCE [ADR-002](adrs/adr-002.md) and [ADR-004](adrs/adr-004.md) for instant selection, documentation-first provenance, typed projection, and bounded scrolling.
- FOCUS on projection and interaction in `src/ui/SettingsView.tsx`; the core catalog remains the identity source and palettes remain in `src/ui/theme.ts`.
- MINIMIZE behavior changes: preserve Settings overlay precedence, existing Settings key bindings, cursor semantics, focus restoration, and immediate application. Do not add a confirmation flow, package, runtime download, or custom theme editor.
- TESTS REQUIRED: cover grouping/order, unique stable row IDs, scrolling selected rows into view, and instant-selection behavior with existing Settings navigation.
</critical>

<requirements>
- 1. MUST derive preset rows from typed core catalog entries, not duplicate handwritten ID arrays or display-label mappings in Settings.
- 2. MUST group rows deterministically by family and preserve catalog order within each family, displaying each variant or display label clearly.
- 3. MUST assign stable, unique selectable row IDs and use a bounded vertical scrollbox that scrolls the selected row into view during keyboard navigation.
- 4. MUST preserve existing navigation and overlay/keymap behavior while selecting a theme applies it immediately through the existing state/persistence path.
- 5. MUST show documentation-first provenance through the existing catalog documentation route without expanding the picker into an attribution, network, or custom-palette feature.
</requirements>

## Subtasks

- [ ] Replace Settings' handwritten theme option derivation with typed catalog-to-row projection helpers and deterministic family grouping.
- [ ] Render group labels and selectable preset rows with stable IDs, active-state labeling, and no duplicate focus targets.
- [ ] Adapt the existing scrollbox pattern so keyboard movement keeps the selected theme row visible within a bounded viewport.
- [ ] Preserve current Settings keymap, overlay precedence, cursor movement, immediate apply, and persistence wiring.
- [ ] Extend Settings/UI tests and snapshots only where the grouped, scrollable UI contract changes.

## Implementation Details

### Relevant Files

- `src/ui/SettingsView.tsx` — current `THEME_OPTIONS`, selection movement, row rendering, and Settings overlay content.
- `src/ui/SettingsView.test.tsx` — Settings options, navigation, and immediate-apply tests.
- `src/ui/__snapshots__/SettingsView.test.tsx.snap` — update only for intentional rendering changes.
- `src/ui/SessionPicker.tsx` — established stable-row-ID and `scrollChildIntoView` scrollbox pattern.
- `src/ui/SessionsOverlay.tsx` and `src/ui/SlashMenu.tsx` — related bounded scrolling implementation precedents.
- `src/core/themeCatalog.ts` — typed catalog entries, display metadata, and deterministic identity.

### Dependent Files

- `src/ui/keymap.ts` — current Settings navigation bindings that must remain unchanged.
- `src/ui/CockpitApp.tsx` — overlay precedence and focus behavior to preserve.
- `src/ui/theme.ts` — palette resolution for immediate selected-theme display.
- `src/store/appStore.ts` and persistence callback wiring — existing instant selection path.

### Related ADRs

- [ADR-002: Preserve instant selection and documentation-first provenance in V1](adrs/adr-002.md)
- [ADR-004: Project catalog metadata into typed scrollable Settings rows](adrs/adr-004.md)

## Deliverables

- Typed catalog-derived Settings rows, deterministic family grouping, and clear variant/display labels.
- Stable selectable row IDs and a bounded vertical scrollbox that follows keyboard selection.
- Preserved immediate apply/persistence behavior and unchanged Settings keymap/overlay semantics.
- Focused UI tests and intentional snapshot updates covering the expanded catalog picker.

## Tests

- Unit tests:
  - [ ] Assert projected rows contain all and only canonical catalog IDs, with deterministic family grouping and catalog order.
  - [ ] Assert every selectable row ID is stable and unique, with no collision between group labels and theme rows.
  - [ ] Assert keyboard movement updates the selected row and invokes `scrollChildIntoView` for rows outside the bounded viewport.
  - [ ] Assert selecting a row applies the corresponding canonical ID immediately through the existing callback.
  - [ ] Assert the settings view exposes the documentation-first provenance affordance without embedding source metadata in rows.
- Integration tests:
  - [ ] Exercise Settings overlay navigation with existing key bindings and verify overlay precedence/focus behavior remains unchanged while selecting an off-screen preset.
- Test coverage target: >=80% for changed Settings row projection, navigation, and scrolling branches.
- All targeted tests pass before handoff.

## Success Criteria

- The Settings picker presents all catalog themes through a single typed projection with no duplicated identity mapping.
- Users can keyboard-navigate the full catalog without the selected row leaving the visible viewport.
- Selecting a theme remains immediate and reuses the established state/persistence contract.
- Existing Settings keymap, overlay precedence, and focus behavior pass regression coverage.
- Targeted Settings tests pass with the stated coverage target.
