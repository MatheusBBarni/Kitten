# PRD: Accessible Source-Attributed Theme Family Catalog

## Overview

Kitten will offer terminal developers a finite, built-in catalog of 18 recognizable theme presets alongside Auto, Light, and Dark. The catalog solves the gap between a developer's established visual preferences and Kitten's current five-choice list while making readable rendering, source provenance, and durable choice part of the product promise.

V1 serves all terminal developers, especially people who work for long periods in the terminal or rely on clear visual distinction between text, status, tool, syntax, selection, and message surfaces. It deliberately competes on trusted curation and accessibility rather than catalog size, custom imports, or a theme marketplace.

## Goals

- Give developers one complete, source-verified set of 18 curated presets across the agreed seven theme families.
- Make every selectable preset readable in normal and constrained terminal color environments, with clear keyboard focus and selected-state visibility.
- Preserve the fast, immediate-selection experience developers already use in Settings: a keyboard move changes and saves the active theme without a separate confirmation step.
- Make a selected theme a trustworthy personal preference that remains recognizable and available through ordinary restarts and configuration changes.
- Give users and maintainers a public, auditable record of every included preset's source and license/attribution.
- Ship only when the complete catalog satisfies the agreed accessibility, provenance, navigation, and preference-integrity quality gate.

## User Stories

### Terminal developer

- As a terminal developer, I want to choose a familiar named theme family and variant so that Kitten fits the visual environment I already use.
- As a keyboard-first user, I want to move through the theme list and have my active theme change immediately so that I can make a quick, direct choice without a separate save flow.
- As a developer using a short terminal, I want every available theme to remain reachable and the current family context to stay understandable so that a larger catalog does not become harder to use.
- As a developer sensitive to contrast or visual fatigue, I want text, syntax, selection, and status information to remain distinguishable in my chosen theme so that I can use Kitten comfortably and safely.
- As a returning user, I want Kitten to remember my exact selected theme so that my personal workspace remains consistent across ordinary restarts and configuration refreshes.

### Trust-conscious user or maintainer

- As a trust-conscious user, I want each built-in theme to have public source and license/attribution information so that I can understand where the visual identity comes from.
- As a maintainer, I want the catalog to reject unverified, private, or paid-only sources so that Kitten's built-in choices remain credible and supportable.

## Core Features

### F1. Complete curated family catalog — Critical

Kitten presents exactly these built-in presets in V1:

- **Catppuccin:** Frappe, Latte, Macchiato, Mocha
- **Dracula:** Alucard, Dracula
- **One Dark:** One Dark
- **Nord:** Nord
- **Rosé Pine:** Dawn, Main, Moon
- **Tokyo Night:** Day, Moon, Night, Storm
- **Gruvbox Dark:** Hard, Medium, Soft

The catalog is complete as a family experience. Kitten does not release a partial subset of these families as the V1 product.

### F2. Grouped, keyboard-first selection — Critical

Settings keeps Auto, Light, and Dark at the top. It then shows the curated catalog in alphabetical family order, with contextual variants under non-selectable family headings. Singleton families repeat their full name so they remain understandable out of context.

All variants are reachable from the keyboard in a short terminal. Keyboard focus is visible without relying only on color, skips headings, and keeps the active family context understandable while a user moves through the list. Resetting returns the preference to Auto.

### F3. Immediate durable choice — Critical

Moving to a selectable option immediately applies it as the active theme and makes it the user's saved preference. There is no preview-only mode, explicit confirmation, cancellation, undo flow, or separate save action in V1.

An explicit named theme remains selected even when the terminal's own light/dark mode changes. Auto continues to follow the terminal's normal light/dark behavior.

### F4. Accessibility-gated rendering — Critical

Every catalog theme must preserve clear, readable terminal output rather than merely matching an attractive source swatch. Text, muted text, accents, banners, context indicators, status, tool output, syntax, selections, and message surfaces must remain legible and distinguishable in both full-color and limited-color terminal environments.

Kitten may make narrowly documented foreground adjustments where necessary for readability, but must retain each source theme's recognizable identity. A theme that cannot meet the full readability bar does not ship in V1.

### F5. Stable, trustworthy preferences — High

Every preset has a durable identity that users can retain in personal configuration. A future catalog retirement must preserve a clear compatible successor rather than silently changing a user's preference to an unrelated option.

If Kitten recognizes a legacy name, it uses the current choice for the live session without unexpectedly rewriting user-owned configuration. A later intentional selection saves the current canonical name.

### F6. Documentation-first provenance — High

The public theme catalog documentation lists each included family, its exact variants, upstream source, and license/attribution record. It also explains the finite-catalog boundary, source-faithful readability adjustments, stable-preference policy, and excluded editions.

Settings remains focused on choosing a readable theme. V1 adds neither inline source metadata nor a dedicated credits screen.

### F7. Privacy-compatible catalog signals — High

Theme-related measurement remains local, opt-in, and limited to predefined choices. It never records prompt content, code, source URLs, theme labels, or other free-form user text. These signals may inform later maintenance but do not replace the V1 launch gate.

## User Experience

1. A developer opens Settings from the existing keyboard entry point and lands on Theme.
2. The developer first sees Auto, Light, and Dark, followed by alphabetized family headings and indented theme variants.
3. The keyboard focus visibly identifies the row being navigated. Family headings do not receive selection.
4. Moving to a variant immediately updates the active cockpit appearance, including syntax and semantic status surfaces, and saves that preference.
5. The developer may continue navigating until they find the most comfortable recognizable palette or press Reset to return to Auto.
6. On a later launch or ordinary configuration refresh, Kitten restores the selected canonical theme. An explicit theme remains pinned even when the terminal changes its own light/dark mode.
7. A developer who wants source or license information follows the documented Theme Catalog link from Configuration guidance rather than leaving the selection flow.

Accessibility requirements:

- Normal rendered text meets the 4.5:1 readability threshold against its adjacent surface in full-color and limited-color terminal modes.
- Selection and keyboard focus provide a visible, non-color-only state distinction; adjacent interface state cues meet the 3:1 threshold where applicable.
- Semantic message, selection, status, tool, and syntax surfaces remain distinct rather than collapsing into a single color cue.

## High-Level Technical Constraints

- The catalog remains finite and built in; no runtime downloads, remote gallery, custom import, or marketplace is part of this product.
- Every included preset has a public, verifiable source and compatible license/attribution record. Paid, private, and source-unverifiable editions are excluded.
- A named theme preference must remain durable, strict, and compatible with prior recognized names; an unknown value must not masquerade as a valid curated choice.
- Theme selection must remain local to the user's application and retain Kitten's opt-in, content-free telemetry posture.
- The chosen theme affects the complete visible cockpit experience, including ordinary text and semantic output, rather than only a decorative background.

## Non-Goals (Out of Scope)

- **Custom or imported themes** — V1 must keep provenance and accessibility guarantees bounded.
- **Theme marketplace, community gallery, or runtime downloads** — Kitten differentiates through a trusted finite catalog, not a large discovery platform.
- **Partial family releases** — The agreed 18 presets ship together or are deferred until the full quality gate is met.
- **Gruvbox Light variants** — These are intentionally deferred beyond the agreed V1 catalog.
- **Inline attribution and an in-app credits view** — Public documentation is the V1 provenance surface.
- **Preview, confirm, cancel, undo, or separate save controls** — Theme movement remains immediate and durable.
- **Adaptive contrast tuning or personal visual calibration** — These are potential later accessibility opportunities, not part of the source-faithful V1 promise.
- **A general Kitten reskin** — The catalog improves choice and readability without redefining the product's interaction model or brand chrome.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver the complete 18-preset catalog, grouped keyboard selection, immediate durable choice, public attribution documentation, and full readability gate as one release.
- Success criteria: all 18 presets meet the complete quality gate; every variant is keyboard-reachable; no partial families or unverified sources enter the catalog.

### Phase 2

- Maintain the catalog through documented source or attribution corrections and assess privacy-safe local signals, support feedback, and reported readability issues.
- Success criteria: any change preserves user preference trust, public provenance, and the original readability standard; no evidence shows systematic difficulty discovering or retaining a readable theme.

### Phase 3

- Consider a bounded terminal theme health check or accessibility calibration experience only if Phase 2 evidence shows users need help evaluating text, selection, or state visibility.
- Success criteria: a follow-on proposal demonstrates a user need that the static curated catalog cannot address without becoming a custom-theme platform.

## Success Metrics

| Metric | Target | Release evidence |
| --- | --- | --- |
| Catalog completeness | 18 of 18 agreed presets available | The published catalog matches the approved family-and-variant roster. |
| Provenance coverage | 18 of 18 presets have a direct public source and compatible attribution | The Theme Catalog documentation contains a reviewed record for every included family. |
| Readability coverage | 100% of required rendered foreground/surface pairs meet at least 4.5:1 | A release review covers full-color and limited-color rendering for every preset. |
| Keyboard reachability | 18 of 18 variants reachable; 0 family headings selectable | A short-terminal journey completes every theme choice solely by keyboard. |
| Preference integrity | 18 of 18 canonical choices restore; 0 silent startup rewrites for known legacy names | A returning-user journey preserves the intended active choice. |
| Privacy integrity | 0 theme events include user content or free-form catalog data | A privacy review confirms all theme signals remain local, opt-in, and predefined. |

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A theme looks recognizable but is uncomfortable or unreadable in a real terminal | Users lose trust in the accessibility promise | Treat complete rendered readability as a release gate and exclude any preset that cannot meet it. |
| A crowded catalog makes selection harder than the current short list | Users abandon Settings or select a theme unintentionally | Use alphabetized families, non-selectable headings, visible focus, persistent family context, and short-terminal reachability as product requirements. |
| Attribution or licensing information is incomplete or disputed | Maintainer and user trust is damaged | Include only direct public sources with compatible records and keep the documentation auditable. |
| Immediate selection surprises users while browsing | Users feel they lost a preferred appearance | Make the active state unmistakable, preserve keyboard predictability, and retain Reset-to-Auto as the fast recovery path. |
| The all-or-nothing gate delays the catalog | The feature appears to make no progress | Communicate the catalog as one verified release; defer a nonconforming theme rather than weaken the promise or ship a partial family experience. |
| Usage is hard to measure without central analytics | Future prioritization lacks broad adoption data | Use local opt-in signals only as supplementary evidence and rely on the complete quality gate for V1 release. |

## Architecture Decision Records

- [ADR-001: Deliver a finite, accessibility-gated 18-preset catalog atomically](adrs/adr-001.md) — Commits the finite 18-preset scope, source fidelity, and all-or-nothing quality bar.
- [ADR-002: Preserve instant selection and documentation-first provenance in V1](adrs/adr-002.md) — Retains immediate durable selection, keeps attribution in documentation, and uses the quality gate as the launch criterion.

## Open Questions

- What minimum terminal dimension should define the short-terminal user journey for the grouped catalog?
- What privacy-preserving, local-only feedback can complement the quality gate when judging whether users discover and retain accessible themes?
- What maintenance policy should govern a public but archived upstream source such as Atom One Dark?
- Under what evidence threshold should a future theme-health-check or calibration proposal be opened?
