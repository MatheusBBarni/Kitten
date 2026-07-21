# Theme Family Catalog

## Overview

Kitten will expand its current theme choice into a finite, built-in catalog of 18 source-attributed presets for terminal developers. V1 prioritizes accessible readability: each preset must remain recognizable to its upstream palette while every rendered foreground role is proven readable in both truecolor and Kitten's xterm-256 fallback.

The catalog is a strategic UX bet, not a theme platform. It ships atomically with Catppuccin (Frappe, Latte, Macchiato, Mocha), Dracula (Alucard, Dracula), One Dark, Nord, Rosé Pine (Dawn, Main, Moon), Tokyo Night (Day, Moon, Night, Storm), and Gruvbox Dark (Hard, Medium, Soft). Auto, Light, and Dark remain available first.

## Summary / Differentiator

Most terminal products compete on catalog size or custom imports. Kitten will differentiate with a compact, keyboard-first set of recognizable themes whose origin, license/attribution, durable identity, and rendered readability are explicit and verifiable.

## Problem

Theme choice affects a developer's comfort and ability to read the terminal all day, yet Kitten currently offers only Auto, Light, Dark, and two Catppuccin presets. That narrow set forces users to accept an unfamiliar palette or lack a trusted option from a theme family they already use elsewhere. A palette that looks faithful in a source repository can still become difficult to read after terminal color approximation or on selection and message surfaces.

Large scheme collections solve choice by quantity, but make it hard to know whether a palette is authoritative, maintained, compatible, or accessible. Kitten needs a product boundary that protects users from that uncertainty while preserving familiar, source-faithful choices.

### Market Data

iTerm2 includes a preset workflow plus explicit minimum-contrast and selection-color safeguards, demonstrating that palette choice needs rendered-surface accessibility rather than only source hex values. [iTerm2](https://iterm2.com/documentation-preferences-profiles-colors.html) Windows Terminal supports built-in and user-defined schemes with immediate application, while WezTerm lists 1,001 built-in schemes and iTerm2-Color-Schemes offers 450+ themes. [Windows Terminal](https://learn.microsoft.com/en-us/windows/terminal/customize-settings/color-schemes) [WezTerm](https://wezterm.org/colorschemes/index.html) [iTerm2-Color-Schemes](https://github.com/mbadolato/iTerm2-Color-Schemes)

WCAG 2.2 AA requires a 4.5:1 contrast ratio for normal text. Kitten will apply that threshold to every relevant rendered foreground/surface pair in truecolor and xterm-256, not merely to source swatches. [WCAG 2.2](https://www.w3.org/TR/WCAG22/#contrast-minimum)

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Theme Preference | Preset choices remain persistent personal preferences alongside Auto, Light, and Dark. |
| Settings | The existing instant-apply keyboard modal becomes a grouped, scrollable catalog picker without changing its modal precedence. |
| Configuration | Valid choices remain strict, durable configuration values that restore across restarts and external changes. |
| Rendering and syntax | A selected preset controls the live terminal palette and associated syntax appearance. |
| Local telemetry | Opt-in local events retain only fixed preset identifiers; they never include theme names, source URLs, or user content. |

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Finite source-attributed catalog | Critical | Provide the agreed 18 presets with public source, license/attribution, family, and display-name records. |
| F2 | Accessible source-faithful rendering | Critical | Keep each recognizable upstream palette while documenting only the foreground adjustments required to meet the 4.5:1 rendered readability gate. |
| F3 | Grouped keyboard picker | Critical | Keep Auto, Light, and Dark first; present alphabetized family headings and indented variants that apply immediately and remain reachable in short terminals. |
| F4 | Durable theme preferences | High | Preserve stable preset IDs across persistence and restoration; resolve legacy aliases live without silently rewriting user configuration at startup. |
| F5 | Complete family delivery | High | Ship all seven agreed families together rather than exposing partial families or temporary catalog contracts. |
| F6 | Auditable trust boundary | High | Publish provenance and exclusion rules, and retain local, opt-in, content-free measurement constrained to fixed IDs. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Catalog coverage | 18/18 agreed presets | Validate the catalog against the approved family-and-variant roster and public attribution record. |
| Rendered readability | 100% required foreground/surface pairs at >=4.5:1 | Run truecolor and xterm-256 contrast checks across text, muted, accent, banner, context, status, tool, and syntax roles. |
| Picker reachability | 18/18 variants reachable; 0 headings selectable | Exercise keyboard navigation in the minimum supported short-terminal scenario. |
| Preference integrity | 18/18 canonical choices restore; 0 startup writes for aliases | Verify explicit selection, restoration, watcher reconciliation, and alias canonicalization flows. |
| Provenance integrity | 18/18 presets with direct public source and compatible license/attribution | Review the catalog documentation and reject paid, private, or source-unverifiable editions. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Strategic Bet**

## Council Insights

- **Recommended approach:** Ship the full finite catalog only as one authoritative capability with source, readability, picker, persistence, alias, and telemetry evidence.
- **Key trade-offs:** Atomic delivery avoids partial-family and duplicated-contract debt, but concentrates verification work. Engineering gates prove the product is safe to ship; privacy-safe adoption and reversion signals determine whether to evolve it.
- **Risks identified:** Incorrect attribution, xterm contrast regressions, short-terminal picker failure, and persistence/telemetry drift. Each is a release blocker, not a post-launch polish item.
- **Stretch goal (V2+):** A terminal theme health check or accessibility calibration flow that helps users validate readable text and selection surfaces without becoming a custom-theme platform.

## Out of Scope (V1)

- **Custom or imported themes** — User-supplied palettes would make provenance and readability guarantees unbounded.
- **Theme marketplace or runtime downloads** — Catalog size is not the differentiator; this would introduce support, compatibility, and trust obligations.
- **Gruvbox Light variants** — They are intentionally deferred so V1 ships the agreed, complete family set without expanding scope.
- **In-app credits view** — Documentation provides the attribution record without adding a separate runtime surface.
- **Adaptive contrast tuning or visual calibration** — Valuable future accessibility work, but it expands beyond the source-faithful, finite-catalog promise.
- **Broader UI reskinning** — The feature changes theme choice and readability, not Kitten's product chrome or interaction model.

## Architecture Decision Records

- [ADR-001: Deliver a finite, accessibility-gated 18-preset catalog atomically](adrs/adr-001.md) — Commits the bounded catalog, release gates, and fallback if the evidence bar cannot be met.

## Open Questions

- Which privacy-preserving post-release signal can measure adoption, reversion, and retention without expanding Kitten's local-only, opt-in telemetry policy?
- What is the minimum terminal dimension used to certify the grouped picker, and how should the active family context remain visible at that size?
- What maintenance policy should govern a source such as Atom One Dark whose upstream repository is archived but publicly auditable?
- Should a future theme-health-check prototype follow the catalog only after users demonstrate difficulty finding or retaining a readable preset?
