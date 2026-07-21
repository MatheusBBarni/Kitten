# Product Requirements Document: Statusline Context Headroom Field

## Overview

Kitten will add **CONTEXT** as an optional field in a developer's custom **/statusline** layout. For the focused coding-agent session, it displays the existing remaining-context headroom as **ctx <remaining>%**. It gives developers running long-lived agent sessions a compact, at-a-glance cue for deciding when a voluntary handoff may be sensible.

The feature addresses a gap created when a developer adopts a custom layout: the legacy footer's context cue is no longer automatically visible, and context cannot be requested as a first-class layout item. V1 restores that choice without creating a new context-management workflow, policy, or data-collection surface.

Context visibility is an established expectation in coding-agent interfaces. [Claude Code](https://code.claude.com/docs/en/statusline) supports context-window information in its statusline, while [Gemini CLI](https://geminicli.com/docs/get-started/configuration-v1/) exposes context usage in its footer configuration. Kitten differentiates by keeping the field bounded, non-executable, and truthful when a value is unavailable.

## Goals

- Let long-running-session users include remaining context headroom in a saved custom statusline.
- Make the cue useful for voluntary handoff timing without implying a guaranteed capacity limit or directing user behavior.
- Omit the field completely when a valid current value is unavailable; never display a placeholder or estimate.
- Preserve the existing statusline experience for users who have not saved a custom layout.
- Preserve the existing content-free privacy boundary: the feature adds no telemetry, stored resolved values, or new usage collection.
- Validate the product hypothesis through moderated scenarios rather than production tracking.

## User Stories

### Long-running coding-agent operator

- As a developer running an agent through extended work, I want to see remaining context in my chosen statusline so that I can judge whether to complete the current unit of work or hand it off voluntarily.
- As a developer switching focus between live agent sessions, I want the context cue to reflect the session I am currently viewing so that I do not make a decision from another session's state.

### Statusline customizer

- As a developer who has saved a custom layout, I want to request **CONTEXT** alongside the fields I already use so that I retain the information hierarchy that matters to my workflow.
- As a developer reviewing a proposed layout, I want to see the same context behavior before and after saving so that the result is predictable.

### Developer with unavailable context

- As a developer whose session has no valid current context value, I want the field to disappear cleanly so that I am not misled by an estimate, placeholder, or stale-looking number.

## Core Features

### Critical: Selectable CONTEXT field

Developers can include **CONTEXT** in a custom **/statusline** layout. The field is a supported identifier in the existing statusline experience, allowing a developer to describe the desired layout naturally and receive a bounded result.

### Critical: Focused-session remaining-headroom cue

When a valid current value is available, the field displays **ctx <remaining>%** for the focused session only. The cue is informational and supports voluntary judgment; it does not suggest, require, or initiate a handoff.

### Critical: Honest absent-data behavior

When valid remaining-context data is unavailable or invalid, **CONTEXT** is omitted along with adjacent spacing. The product does not replace the missing value with a placeholder, a default percentage, or an estimate.

### High: Predictable custom-layout presentation

The statusline preview and the saved layout show the same field ordering and omission behavior. On narrow terminals, the layout preserves its established priority behavior by dropping trailing fields cleanly instead of wrapping or misrepresenting the context cue.

### High: Legacy-footer continuity

Users who have not saved a custom statusline continue to receive the existing footer experience unchanged. The feature is additive and opt-in through custom layout selection.

## User Experience

1. A developer opens **/statusline** and asks for a layout that includes context, such as folder, model, and context.
2. The statusline experience recognizes **CONTEXT** as a supported field and presents the proposed layout for review.
3. After the developer saves the layout, their active custom statusline includes **ctx <remaining>%** whenever the focused session has a valid current value.
4. While the developer works through a long session, the cue remains a quiet part of the chosen layout. It does not interrupt, warn, or instruct.
5. If the value is unavailable, the cue disappears without a substitute value or broken spacing.
6. If the terminal becomes too narrow, lower-priority trailing fields drop according to established layout behavior; the statusline stays concise and single-line.

The copy remains compact, neutral, and readable in a terminal. The field must not depend on color alone, urgency language, or a visual threshold to communicate its meaning. Discoverability comes from listing **CONTEXT** among available statusline identifiers.

## High-Level Technical Constraints

- The feature uses only the existing content-free remaining-headroom information available for the focused session; it must not establish a second source of context information.
- The field must preserve the product's existing custom-statusline review and saved-layout experience.
- The product must preserve user privacy by avoiding additional telemetry, retention of resolved context values, or new sharing behavior.
- When a valid value is absent, the visible product behavior is omission, not estimation.
- Users without a saved custom layout must continue to see the legacy footer unchanged.

## Non-Goals (Out of Scope)

- **Low-context warnings, thresholds, freshness labels, or provider-provenance UI** — these add meaning and visual policy before the simple cue proves valuable.
- **Handoff recommendations or automatic handoffs** — the feature supports a voluntary decision; it does not make one for the developer.
- **New context collection, telemetry, or persistence of resolved values** — V1 reuses an existing content-free cue and preserves the current privacy boundary.
- **Multi-session dashboards or context-aware target selection** — the field serves the currently focused session only.
- **Arbitrary statusline scripts, templates, timers, or dynamic commands** — the statusline remains a safe, bounded configuration surface.

## Phased Rollout Plan

### MVP (Phase 1)

- Add the optional **CONTEXT** field to the existing custom-statusline experience.
- Display **ctx <remaining>%** for the focused session only when a valid current value exists.
- Omit unavailable or invalid values, retain predictable narrow-terminal behavior, and leave the legacy footer unchanged.
- Validate with a moderated long-session scenario: at least 9 of 12 participants must identify the cue as informational and at least 8 of 12 must report that it helped them time a voluntary handoff.

### Phase 2

- Review moderated feedback to determine whether compact explanatory copy or statusline discoverability needs refinement.
- Continue to avoid warnings, thresholds, handoff recommendations, and automation unless qualitative evidence demonstrates a clear unmet need.
- Proceed only if users can add the field without assistance and accurately explain its role.

### Phase 3

- Reassess richer context-management opportunities only if users demonstrate repeated demand and a shared understanding of the cue.
- Any future guidance or multi-session coordination must be proposed as a separate product initiative with its own user research and decision record.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Handoff clarity | At least 9 of 12 participants identify the cue as informational rather than a guaranteed countdown | Moderated long-session scenario and comprehension check |
| Handoff usefulness | At least 8 of 12 participants report that the cue helped them time a voluntary handoff | Moderated scenario debrief |
| Customization completion | At least 10 of 12 participants save a layout containing CONTEXT without help in 90 seconds or less | Moderated task observation |
| Honest absent-state behavior | 100% of study scenarios with no valid value show no placeholder or estimate | Scenario observation and release review |
| Legacy continuity | 100% of users without a saved custom layout retain the existing footer experience | Release review |
| Privacy integrity | 0 additional telemetry events or retained resolved context values | Product and configuration review |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users read a percentage as a promise that the session can safely continue | Use neutral context copy, omit invalid values, and make comprehension a primary success metric. |
| The field consumes statusline space without changing a meaningful decision | Evaluate it in realistic long-session handoff scenarios before adding follow-on features. |
| Users expect context alerts or automated assistance | State the field-only boundary in product copy and defer those workflows to a separate initiative. |
| Different agent experiences make the cue feel inconsistent | Treat it as an informational focused-session value and omit it whenever a valid current value is not available. |
| A command-backed competitor raises expectations for arbitrary customization | Emphasize the predictable, bounded, non-executable Kitten experience rather than matching unsafe flexibility. |

## Architecture Decision Records

- [ADR-001: Keep CONTEXT as a local, optional, field-only headroom indicator](adrs/adr-001.md) — Use a bounded local display and defer policy, provenance UI, and automation.
- [ADR-002: Make CONTEXT a voluntary, omission-first handoff-awareness cue](adrs/adr-002.md) — Optimize V1 for long-running-session handoff clarity and omit absent values.

## Open Questions

- Does moderated research show that **ctx <remaining>%** is immediately understandable, or does the statusline discovery flow need a short explanation?
- Do long-running-session users retain the field after initial configuration, or do they prefer the existing footer only?
- If future evidence supports richer guidance, which non-interruptive user need is strongest: clearer explanation, user-initiated detail, or multi-session visibility?
