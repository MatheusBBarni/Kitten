## Overview

Kitten should let a solo power user assign an optional foreground color to each
field in their existing personal `/statusline` layout. The feature solves a
fast-recognition problem: a developer who repeatedly checks folder, branch,
provider, model, effort, or context state should be able to make the most
important field visually distinct without creating a scripting or theming
system.

V1 is intentionally narrow. It accepts a known CSS color name or opaque
`#RRGGBB`, persists a canonical color value, affects only the associated field
text, and keeps existing preview and explicit-confirmation behavior. Uncolored
fields continue to follow the active theme; separators stay muted.

### Summary / Differentiator

Terminal prompt tools show that per-segment color is an established
expectation, but they commonly expose a broad template, palette, or scripting
model. Kitten's differentiator is an item-local, declarative, non-executable
configuration that fails closed, previews the exact normalized result, and
writes only after confirmation. [Claude Code](https://code.claude.com/docs/en/statusline),
[Starship](https://starship.rs/config/), and
[Oh My Posh](https://ohmyposh.dev/docs/configuration/segment)

## Problem

The current statusline makes all configured fields visually equivalent. A
developer can select which data is shown, but cannot make the field that
matters most in an active session easier to identify at a glance. The
workaround is either to accept the uniform presentation or adopt a separate,
more general terminal customization tool.

That is a poor fit for Kitten's cockpit. Claude Code's statusline is
configurable but executes a user-provided command; Starship and Oh My Posh
provide flexible styling systems that include templates, palettes, backgrounds,
and other composition rules. Kitten should meet the narrow scanability need
without introducing executable configuration or a general theming surface.

### Market Data

- Claude Code treats a statusline as a persistent view for context, cost,
  directory, and Git status, but its customization path runs shell commands.
  [Documentation](https://code.claude.com/docs/en/statusline)
- Starship and Oh My Posh both support foreground styling for prompt segments,
  confirming per-field color as a familiar terminal UX pattern while
  illustrating the scope that Kitten should avoid in V1.
  [Starship](https://starship.rs/config/),
  [Oh My Posh](https://ohmyposh.dev/docs/configuration/colors)
- Stack Overflow's 2025 survey reports that 84% of software developers using
  agents at work use them for software development, while 46% distrust
  AI-tool accuracy and only 33% trust it. A strict proposal boundary and
  explicit preview are therefore product-relevant trust mechanisms, not
  incidental implementation detail.
  [Survey](https://survey.stackoverflow.co/2025/ai)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Per-item foreground color | Critical | Every existing statusline field may retain its simple form or use a structured form with an optional foreground `color`. |
| F2 | Canonical safe color input | Critical | Accept known CSS names and opaque six-digit `#RRGGBB`; normalize accepted input to one canonical `#RRGGBB` value and reject everything else. |
| F3 | Exact preview and confirmation | Critical | Preview and config diff show the same canonical field colors that will become active only after explicit confirmation. |
| F4 | Theme-preserving rendering | High | Explicit color affects only the field value. Uncolored fields use normal theme text and separators remain theme-muted. |
| F5 | Compatibility and recovery | High | Existing uncolored personal layouts remain valid; malformed proposals or saved values fail closed and existing reset/recovery paths remain available. |

### Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Personal `/statusline` layout | Extends the existing single-user layout rather than adding provider, repository, team, or shared profiles. |
| Statusline preview and config diff | Presents canonical colors at the current terminal width before an explicit write. |
| Theme Preferences | Continues to govern uncolored text and separators; valid explicit field colors stay user-selected rather than being silently transformed. |
| Existing strict configuration and proposal flow | Retains hard rejection, data-use disclosure, and explicit confirmation semantics. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Scanability feedback | >=4.0/5 average from >=5 voluntary users within 60 days | Short opt-in release feedback asks whether the configured fields are faster to identify. |
| Evidence of adoption | >=3 voluntarily shared active configurations or qualitative adoption reports within 60 days | Review linked issue feedback, community reports, and direct opt-in responses; collect no telemetry. |
| Invalid-input containment | 100% of specified malformed-color test cases rejected | Automated tests cover malformed hex, unknown names, alpha, transparency, terminal controls, ANSI, and unsupported keys. |
| Layout resilience | 100% pass rate for 64- and 80-column preview/footer scenarios | Automated resize and no-overflow coverage for active footer and preview. |
| Persistence safety | 0 configuration writes before explicit confirmation in the release test suite | Controller/integration tests assert preview and cancellation never persist a layout. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: Quick Win

## Council Insights

- **Recommended approach:** Ship the item-local foreground-color extension as
  a small, reversible experiment with strict input normalization, preview, and
  confirmation.
- **Key trade-offs:** Fixed colors maximize predictable user intent but may be
  less legible after a terminal or theme change. V1 preserves theme defaults
  when a color is absent and exposes the current preview; it does not silently
  guess contrast or mutate a valid requested color.
- **Risks identified:** Malformed or hostile input, configuration drift, footer
  overflow, user expectations for a broader styling platform, and weak evidence
  of demand. Mitigate with strict rejection, canonical persistence,
  current-width preview, existing recovery, documented V1 exclusions, and
  voluntary feedback rather than new telemetry.
- **Stretch goal (V2+):** Consider a semantic statusline styling model only if
  evidence shows repeated demand across multiple independent styling dimensions
  and an accessibility policy can be defined without guessing terminal
  backgrounds.

## Out of Scope (V1)

- **Separator or background colors** — expands the visual system beyond
  item-local foreground scanability.
- **Gradients, alpha, bold, underline, arbitrary CSS/RGBA, or `transparent`**
  — complicates validation, rendering, and terminal compatibility without
  serving the core hypothesis.
- **Scripts, templates, ANSI, arbitrary commands, or external data** — violates
  the declarative, non-executable statusline safety boundary.
- **Automatic contrast adjustment or theme-token persistence** — Kitten must
  not guess a terminal background or silently alter a valid user request.
- **Manual color editor or picker** — configuration is sufficient to validate
  the value before investing in a separate interaction model.
- **Provider, repository, team, or shared profiles** — V1 remains one personal
  layout.
- **New telemetry** — adoption is evaluated through voluntary feedback,
  preserving the existing local, content-free telemetry posture.

## Architecture Decision Records

- [ADR-001: Keep statusline colors item-local and declarative](adrs/adr-001.md)
  — accepts a canonical, foreground-only personal-layout extension and rejects
  a premature theming system.

## Open Questions

- Which maintained set of CSS names should be documented as V1-supported while
  retaining the agreed known-name input contract?
- What opt-in release-feedback channel and 60-day review cadence will be used
  to evaluate adoption without adding telemetry?
- Should the preview copy explicitly remind users that a fixed color can look
  different after a theme or terminal change, while preserving the decision not
  to auto-adjust it?
