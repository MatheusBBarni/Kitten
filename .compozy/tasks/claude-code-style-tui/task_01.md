---
status: completed
title: "Palette: warm accent and chrome color keys"
type: frontend
complexity: medium
dependencies: []
---

# Task 01: Palette: warm accent and chrome color keys

## Overview
Extend the cockpit palette with Kitten's warm brand accent and the new chrome colors the reskin needs (banner tones and context-usage thresholds), tuned for both dark and light terminals.
This is the foundational look-and-feel layer every other visual task reads from, and it must preserve the no-hard-coded-color rule and the existing theme test invariants.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add new keys to the `CockpitPalette` interface for the reskin: a grouped `context: { ok; warn; critical }` for context-usage thresholds, plus any banner-specific tones, per the TechSpec "Data Models" section.
- MUST retune `accent` to Kitten's warm brand accent in BOTH `DARK_PALETTE` and `LIGHT_PALETTE`, keeping light/dark parity.
- MUST set every new key in both palette constants so no mode is missing a color.
- MUST NOT introduce the settings-modal palette registry or `ThemePreference` (ADR-004) — add keys to the existing constants only.
- MUST NOT hard-code any color outside `theme.ts`; all consumers read through `usePalette()`.
- MUST extend `theme.test.tsx` invariants to cover the new keys (distinct tones, both-mode presence).
</requirements>

## Subtasks
- [x] 1.1 Add the new keys (context thresholds, banner tones) to the `CockpitPalette` interface.
- [x] 1.2 Set warm-accent and new-key values in `DARK_PALETTE` and `LIGHT_PALETTE`.
- [x] 1.3 Verify no-truecolor legibility of the new keys in both modes.
- [x] 1.4 Extend `theme.test.tsx` to assert the new keys exist, are distinct, and repaint on a theme flip.

## Implementation Details
Modify `src/ui/theme.ts` (the `CockpitPalette` interface and the two palette constants) and `src/ui/theme.test.tsx`.
Group related colors (e.g. a nested `context` object) and keep names semantic, per the TechSpec "Technical Considerations" and ADR-004.
Do not touch `paletteFor`, `usePalette`, or `syntaxStyleFor` beyond adding keys.

### Relevant Files
- `src/ui/theme.ts` — `CockpitPalette`, `DARK_PALETTE`, `LIGHT_PALETTE`; the single color source.
- `src/ui/theme.test.tsx` — palette invariants (distinct tones, light/dark parity, `PaletteProbe` repaint).

### Dependent Files
- `src/ui/WelcomeBanner.tsx` (task_03) — reads banner tones + accent.
- `src/ui/PromptEditor.tsx` (task_04) — reads accent for the chevron.
- `src/ui/StatusStrip.tsx` (task_11) — reads context thresholds + run-state colors.

### Related ADRs
- [ADR-004: Extend the Existing Palette Instead of Building the Theme Registry](adrs/adr-004.md) — Add accent/chrome keys to the palette constants; defer the registry.
- [ADR-001: V1 Scope for the Claude Code-Style TUI Reskin](adrs/adr-001.md) — Kitten-branded accent, legible dark/light/no-truecolor.

## Deliverables
- New `context` threshold group and banner tones on `CockpitPalette`, set in both constants.
- Retuned warm `accent` in both modes.
- Extended `theme.test.tsx` invariants.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test: `PaletteProbe` repaints new keys on a `theme_mode` flip **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Every new key is present in both `DARK_PALETTE` and `LIGHT_PALETTE`.
  - [x] `context.ok`, `context.warn`, and `context.critical` are three distinct values in each mode.
  - [x] `accent` differs between dark and light and is non-empty in both.
  - [x] `paletteFor("light")` returns the light accent; `paletteFor(null)` falls back to dark.
- Integration tests:
  - [x] `PaletteProbe` mounted via `testRender` repaints to the light accent after `renderer.emit("theme_mode","light")`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Warm accent and context thresholds render legibly in dark, light, and no-truecolor terminals
- No hard-coded color is introduced outside `theme.ts`
