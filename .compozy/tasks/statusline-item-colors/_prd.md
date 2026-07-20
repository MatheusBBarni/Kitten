# PRD: Statusline Item Colors

## Overview

Statusline Item Colors lets a solo Kitten power user visually distinguish the
status information they already choose to display. A user can optionally set a
foreground color for an individual statusline field, preview the exact result,
and save it only after explicit confirmation. Fields without a chosen color
continue to use the active theme's normal text treatment, and separators remain
visually quiet.

The feature addresses a recurring scanability problem in the terminal cockpit:
important values such as branch, provider, model, effort, or context can be
present but visually indistinguishable. V1 is a personal, field-only
personalization feature—not a general theming system.

## Goals

- Help solo power users identify their personally important statusline values
  faster during active coding sessions.
- Let users configure optional per-field foreground colors while preserving the
  existing personal layout and all uncolored behavior.
- Make every color change understandable before it becomes durable through an
  exact preview and explicit confirmation.
- Validate value without new telemetry through voluntary adoption and
  scanability feedback during the first 60 days after availability.

## User Stories

### Solo power user

- As a developer who watches the statusline while working, I want to give my
  branch or context field a distinct color so that I can identify it without
  reading every value.
- As a developer with an existing personal layout, I want to add a color to one
  field without rebuilding or losing the fields and order I already chose.
- As a developer who changes preferences cautiously, I want to see the exact
  active result and saved configuration change before I confirm it.
- As a developer who prefers the active theme, I want to leave a field
  uncolored so that it continues to use the theme's normal text presentation.

### Future evaluator

- As a product maintainer, I want voluntary evidence of scanability benefit and
  demand before expanding this feature into a broader styling product.

## Core Features

### Optional field colors

Users can assign an optional foreground color to every supported statusline
field. Existing uncolored layouts stay valid and retain their current behavior.
The user can apply color selectively rather than being required to style an
entire layout.

### Recognizable, safe color choices

Users can express a color through a familiar known name or a six-digit RGB hex
value. The product shows and saves a single normalized representation, so the
preview, displayed configuration change, and active footer agree.

### Preview-before-save journey

The existing keyboard-first statusline journey remains the single place to
request, review, save, or cancel a color layout. Before saving, the user sees
the current-width statusline preview and the exact personal configuration
change. Cancel leaves the existing layout unchanged.

### Theme-preserving defaults

An explicit color applies only to the associated field value. Separators remain
muted, and a field without an explicit color continues to use normal
theme-derived text. The product does not silently alter a confirmed user color
to infer contrast or a terminal background.

### Clear recovery and compatibility

If a requested or saved color is invalid, the product rejects it clearly rather
than guessing. Users retain the existing recovery options and can continue to
use their prior personal layout. Existing layouts without colors need no action
or migration.

## User Experience

1. A solo power user opens the existing `/statusline` journey to refine their
   personal layout.
2. They describe or select a layout in which one or more existing fields have
   optional foreground colors.
3. Kitten presents a one-line preview at the current terminal width and an
   exact personal configuration diff. The preview makes the chosen field
   distinct, keeps separators muted, and leaves uncolored values theme-derived.
4. The user explicitly saves or cancels. Saving applies the reviewed layout;
   cancelling retains the currently active layout.
5. On later sessions, the saved personal layout remains available. If the user
   does not choose colors, their statusline remains visually unchanged.

The feature is discoverable through the existing `/statusline` command and
requires no new visual editor. Product copy must state that a chosen color is
shown as selected in the current preview and may look different after a user
changes terminal or theme settings.

## High-Level Technical Constraints

- The feature extends only the existing single personal statusline layout; it
  must not introduce provider, repository, team, or shared profiles.
- A color preference is declarative and non-executable. It must never enable
  user scripts, arbitrary commands, templates, external data, or terminal
  control content.
- The active footer and preview must remain one line, respect the current
  terminal width, and keep existing uncolored layouts working.
- The product must show the exact reviewed value before it writes a preference
  and preserve unrelated user preferences.
- No new telemetry is added. Product learning relies on voluntary feedback and
  publicly shared configurations.

## Non-Goals (Out of Scope)

- **Separator or background colors** — V1 focuses on field recognition, not
  whole-layout visual styling.
- **Gradients, alpha, transparency, emphasis, or arbitrary styling syntax** —
  these do not advance the core scanability outcome.
- **Manual color pickers or visual editors** — the existing configuration
  journey is sufficient to validate demand.
- **Automatic contrast adjustment or theme-token persistence** — the product
  does not guess terminal background conditions or rewrite a confirmed color.
- **Scripts, templates, commands, ANSI content, or external data** — these
  violate the declarative personal-preference boundary.
- **Provider, repository, team, or shared profiles** — V1 serves one user's
  personal layout only.
- **New telemetry or behavioral tracking** — adoption is measured through
  voluntary feedback only.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver optional foreground color for existing personal statusline fields.
- Preserve the current preview, explicit confirmation, width-aware rendering,
  recovery, and uncolored-layout behavior.
- Publish concise guidance that colors are field-only and previews reflect the
  user's current terminal and theme.

Success criteria to proceed to Phase 2:

- At least five voluntary users provide scanability feedback within 60 days,
  averaging at least 4.0 out of 5.
- At least three users voluntarily share an active configuration or adoption
  report.
- No confirmed user reports of an accidental pre-confirmation write or lost
  pre-existing personal layout.

### Phase 2

- Review voluntary feedback, support friction, and repeated requests for a
  second styling dimension.
- Improve documentation, discoverability, or recovery messaging only when the
  MVP evidence identifies a concrete user misunderstanding.

Success criteria to proceed to Phase 3:

- Repeated demand identifies the same additional capability from at least five
  independent users.
- A clear user benefit and accessibility expectation are defined without
  weakening the personal, non-executable boundary.

### Phase 3

- Consider a separate product decision for a semantic styling model only if
  Phase 2 establishes demand across several related visual needs.
- Otherwise, retain the proven field-only capability and continue to prioritize
  the core cockpit workflow.

Long-term success criteria:

- The feature remains a trusted, low-friction personal scanability aid rather
  than evolving into an uncontrolled styling surface.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Voluntary scanability feedback | >=4.0/5 average from >=5 users within 60 days | Short opt-in release feedback asking whether important fields are faster to identify. |
| Voluntary adoption evidence | >=3 shared configurations or qualitative reports within 60 days | Linked issue feedback, community reports, and direct opt-in responses; no telemetry collection. |
| Compatibility confidence | 0 confirmed reports of lost existing layouts during the 60-day review | Support and issue-review triage for the release window. |
| Trust in the save journey | 0 confirmed reports of a layout changing before explicit save during the 60-day review | Support and issue-review triage for the release window. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Adoption is too limited to justify ongoing scope | Treat V1 as an evidence-gathering refinement and do not expand without the defined voluntary feedback threshold. |
| Users interpret V1 as a full theming product | State the field-only, personal scope in the command guidance, preview, and release notes. |
| A chosen color becomes hard to read after a theme or terminal change | Show the current preview before save, preserve uncolored theme defaults, and direct users to the existing recovery path. |
| Feedback is too sparse to guide Phase 2 | Keep the feature stable, solicit opt-in feedback through documented channels, and defer expansion rather than infer demand. |

## Architecture Decision Records

- [ADR-001: Keep statusline colors item-local and declarative](adrs/adr-001.md)
  — establishes the foreground-only, canonical, non-executable personal-layout
  boundary.
- [ADR-002: Position statusline colors as a personal scanability experiment](adrs/adr-002.md)
  — defines the target user, user-value hypothesis, and voluntary-feedback gate
  for future expansion.

## Open Questions

- Which maintained set of known color names should product documentation list
  as V1-supported?
- Which opt-in channel will collect the 60-day scanability feedback, and who
  will review it?
- What preview wording best communicates that fixed colors remain user-selected
  and may look different after a terminal or theme change?
