---
status: pending
title: "Theme palette registry, resolver, and live usePalette"
type: frontend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 03: Theme palette registry, resolver, and live usePalette

## Overview
Replace the two-palette terminal-mode branch with a keyed palette registry and resolve the effective palette from the user preference ahead of the terminal mode.
This lets a theme change (auto, light, dark, Catppuccin Mocha, Catppuccin Latte) repaint the cockpit live while preserving today's auto-follow behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add Catppuccin Mocha (dark) and Catppuccin Latte (light) palettes alongside the existing dark/light, in a registry keyed by a stable palette `id`; each `CockpitPalette` MUST carry that `id`.
- MUST add `resolvePalette(pref, mode)` returning the terminal-derived palette for `"auto"`, the pinned or preset palette for a known preference, and the terminal-derived palette as a fallback for an unknown id.
- MUST make `usePalette` read the preference via `selectThemePreference` and re-render on a preference change and on a terminal `theme_mode` flip while the preference is `"auto"`.
- MUST re-key `syntaxStyleFor` by the effective palette `id` rather than by `ThemeMode`.
- MUST keep every palette free of hard-coded call-site colors and legible across light and dark terminal backgrounds.
</requirements>

## Subtasks
- [ ] 3.1 Add a stable `id` to `CockpitPalette` and to the existing dark/light palettes
- [ ] 3.2 Author the Catppuccin Mocha and Latte palettes and assemble the keyed registry
- [ ] 3.3 Implement `resolvePalette(pref, mode)` with the auto path and unknown-id fallback
- [ ] 3.4 Wire `usePalette` to the preference selector and the live terminal mode
- [ ] 3.5 Re-key `syntaxStyleFor` by palette id and verify preset legibility on both backgrounds

## Implementation Details
Modify `src/ui/theme.ts`.
Reuse `paletteFor` for the `"auto"` path and consume the store preference through the selector added in task_02.
See the TechSpec "Core Interfaces" (theme) section and ADR-005; the two Catppuccin palettes must satisfy the module's no-hard-coded-color and legibility rules.

### Relevant Files
- `src/ui/theme.ts` — palettes, registry, `resolvePalette`, `usePalette`, `syntaxStyleFor`

### Dependent Files
- Every view calling `usePalette` (`CockpitApp`, `StatusStrip`, `ConversationView`, `MessageView`, `ToolCallRow`, `ApprovalPrompt`, `HandoffPreview`) re-renders through it
- `src/ui/SettingsView.tsx` — task_08 lists the registry entries as theme options
- `src/ui/theme.test.tsx` — extend with resolver and registry cases

### Related ADRs
- [ADR-005: Theme override via a palette registry](../adrs/adr-005.md) — the registry and resolution order
- [ADR-003: Include 1-2 named theme presets in V1](../adrs/adr-003.md) — Mocha and Latte in V1

## Deliverables
- A keyed palette registry including Catppuccin Mocha and Latte, each palette carrying an `id`
- `resolvePalette` and a preference-aware `usePalette`, with `syntaxStyleFor` keyed by palette id
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting a live repaint on a preference change **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `resolvePalette("auto", "dark")` returns the dark palette and `("auto", "light")` the light palette
  - [ ] `resolvePalette("light", <any mode>)` pins light and `("dark", <any mode>)` pins dark
  - [ ] `resolvePalette("catppuccin-mocha", <any mode>)` returns the Mocha palette (id `"catppuccin-mocha"`)
  - [ ] `resolvePalette("catppuccin-latte", <any mode>)` returns the Latte palette
  - [ ] `resolvePalette(<unknown id>, "dark")` falls back to the dark terminal palette
  - [ ] `syntaxStyleFor` returns and caches distinct styles for two different palette ids
- Integration tests:
  - [ ] a rendered view re-renders with the Mocha palette when the store preference changes from `"auto"` to `"catppuccin-mocha"`
  - [ ] with preference `"auto"`, a terminal `theme_mode` flip re-resolves the palette
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A preference change repaints the cockpit live; the auto path matches prior behavior
- Presets are legible on light and dark backgrounds and use only palette tokens
