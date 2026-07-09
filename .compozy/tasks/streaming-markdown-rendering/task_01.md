---
status: pending
title: "Register Markdown markup theme scopes"
type: frontend
complexity: low
dependencies: []
---

# Task 01: Register Markdown markup theme scopes

## Overview
Kitten's Markdown renders structure (headings, emphasis, lists, quotes, links) in flat body-text color because `theme.ts` registers only code-syntax scopes.
This task registers the `markup.*` scopes the Markdown grammar emits so that structure is styled and theme-aware.
It lights up the existing transcript immediately and is the foundation every rendered surface builds on.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST extend `syntaxThemeFor` in `src/ui/theme.ts` to register the `markup.*` scopes the grammar emits: `markup.heading` and `markup.heading.1` through `.6`, `markup.strong`, `markup.italic`, `markup.strikethrough`, `markup.raw` and `markup.raw.block`, `markup.list`/`markup.list.checked`/`markup.list.unchecked`, `markup.quote`, and `markup.link`/`markup.link.label`/`markup.link.url`.
- MUST derive every color from the existing palette or the `dark` branch already used in `syntaxThemeFor`, keeping both dark and light legible and honoring the no-hard-coded-background rule.
- MUST use only style attributes `SyntaxStyle.fromTheme` supports (`foreground`, `bold`, `italic`, `underline`, `dim`); `markup.strikethrough` MUST be expressed with color or `dim` only, since no strike attribute exists.
- MUST NOT change `syntaxStyleFor` caching or the `theme_mode` reactivity; new scopes flow through the existing per-mode cache.
- MUST leave the existing code-fence scopes unchanged so current highlighting is unaffected.
</requirements>

## Subtasks
- [ ] 1.1 Append `markup.*` entries to the array returned by `syntaxThemeFor`, keyed by the grammar's capture names.
- [ ] 1.2 Choose theme-aware foregrounds and attributes for headings, emphasis, inline code, quotes, lists, and links from the palette.
- [ ] 1.3 Add theme tests asserting the new scopes are registered and styled in both modes.
- [ ] 1.4 Confirm existing code-scope tests and the transcript still render unchanged.

## Implementation Details
Modify `syntaxThemeFor` in `src/ui/theme.ts`, appending `markup.*` entries to the array it returns alongside the existing code scopes.
See TechSpec "Implementation Design > Core Interfaces" for the theme-entry shape and the intended scope-to-style mapping, and TechSpec "System Architecture" for how the scopes flow through `syntaxStyleFor`.
No new files are required.

### Relevant Files
- `src/ui/theme.ts` - `syntaxThemeFor` (the scope-to-style table) and `syntaxStyleFor` (the per-mode cache that consumes it).
- `src/ui/theme.test.tsx` - the existing `syntaxStyleFor(mode).getStyle(scope)` assertion pattern to extend.

### Dependent Files
- `src/ui/MessageView.tsx` - consumes the syntax style; its transcript output gains styled structure with no code change.

### Related ADRs
- [ADR-003: Shared Markdown Renderer](../adrs/adr-003.md) - defines the theme-registration half of the rendering approach.

## Deliverables
- `markup.*` scopes registered in `syntaxThemeFor`, theme-aware for dark and light.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration coverage that the transcript renders styled structure **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] `syntaxStyleFor("dark").getStyle("markup.heading.1")` is defined and bold.
  - [ ] `syntaxStyleFor("dark").getStyle("markup.strong")` is bold and `markup.italic` is italic.
  - [ ] `syntaxStyleFor("dark").getStyle("markup.link.url")` is defined.
  - [ ] A heading scope's `fg` differs between `syntaxStyleFor("dark")` and `syntaxStyleFor("light")`.
  - [ ] `markup.strikethrough` is registered with a color or `dim` (no strike attribute asserted).
- Integration tests:
  - [ ] A transcript message containing `## Heading` renders the heading text with a non-default foreground span (via `captureSpans`).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Headings, emphasis, lists, quotes, and links render styled and theme-aware in the transcript.
- Code-fence highlighting and `theme_mode` reactivity are unchanged.
