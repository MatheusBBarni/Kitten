---
status: completed
title: Add motion-safe media presentation, styling, and accessibility hardening
type: frontend
complexity: high
---

# Task 06: Add motion-safe media presentation, styling, and accessibility hardening

## Overview

Finalize the user experience quality of the launch page with clear responsive layout, media controls, reduced-motion behavior, and strong accessibility defaults. This task ensures the proof section supports comprehension for keyboard and assistive users while preserving the product trust message.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON WHAT — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add responsive styling for section structure so the landing page remains readable on mobile and desktop.
2. MUST implement reduced-motion-safe media behavior for the proof recording using poster and explicit controls.
3. MUST verify semantic landmarks and focus order remain stable after styling additions.
4. MUST keep copy density low in key conversion sections, avoiding content overflow and motion-heavy emphasis.
5. SHOULD add recording assets to `site/public` with naming and fallback semantics suitable for production launch.
</requirements>

## Subtasks

- [x] 06.01 Add responsive layout and spacing tokens for all section components.
- [x] 06.02 Implement reduced-motion behavior for proof media and ensure captions or text alternatives remain visible.
- [x] 06.03 Add poster/asset references and fallback copy for video media in launch scenarios.
- [x] 06.04 Update Proof and Hero sections with keyboard-focus and contrast-safe presentation classes.
- [x] 06.05 Add explicit `prefers-reduced-motion` handling and accessible fallback controls.
- [x] 06.06 Include alt text and labeling for non-text proof explanation content.
- [x] 06.07 Validate light/dark contrast assumptions against terminal and browser backgrounds likely used in release.

## Implementation Details

This task implements the accessibility and media guarantees in TechSpec "Build Order" and PRD "Accessible, Fast Evaluation Experience."

- `site/src/components/Proof.astro`: media section with poster, controls, and motion-aware behavior.
- `site/src/styles/*` or inline component styles: responsive and focus-visible updates.
- `site/public/*`: recording assets and static fallback imagery.
- `site/src/components/Hero.astro` and `site/src/components/Faq.astro`: layout polish and reading order checks.

### Relevant Files

- `site/src/components/Proof.astro` — motion behavior and accessible proof delivery.
- `site/src/components/Hero.astro` — initial viewport presentation and readable CTA emphasis.
- `site/src/styles/site.css` or equivalent shared styling file — responsive/a11y improvements.
- `site/src/components/Faq.astro` — text density and readability controls.
- `site/public/` assets — recording file + poster for stable proof load.

### Dependent Files

- `.compozy/tasks/kitten-showcase-site/task_03.md` — base section components to style.
- `.compozy/tasks/kitten-showcase-site/task_04.md` — install CTA markup for focus/contrast alignment.
- `.compozy/tasks/kitten-showcase-site/task_05.md` — star control state texts included in a11y pass.

### Related ADRs

- [ADR-001: Build a Focused Proof-Led Astro Showcase](../adrs/adr-001.md) — proof-first presentation constraints.
- [ADR-002: Center V1 on a Verified Two-Agent Handoff](../adrs/adr-002.md) — trust and control emphasis over decoration.

## Deliverables

- Motion-sensitive styling and a media-safe proof section that remains understandable without forced playback.
- Responsive behavior for the showcase sections across narrow and wide viewports.
- Accessibility hardening for keyboard navigation and assistive announcement context.
- Unit-level coverage for any media-state helper utility if introduced.
- Integration smoke for reduced-motion and keyboard focus order.
- Unit test coverage target: >=80% for introduced helper/style-state logic.

## Tests

- Unit tests:
  - [x] `prefers-reduced-motion` branch in proof media helper (if helper exists) returns expected behavior.
  - [x] Validation checks confirm heading and landmark sequence remains intact.
  - [x] CTA text remains present and readable at mobile breakpoints.
- Integration tests:
  - [ ] Keyboard tab flow reaches hero→install→proof→requirements→FAQ without dead ends.
  - [x] Motion toggle simulation leaves proof controls usable when playback is reduced or disabled.
  - [ ] Screenshot smoke for primary sections in narrow viewport does not clip CTAs.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80% for new a11y/media state helpers
- Proof content plays or degrades cleanly with reduced-motion enabled
- Page remains usable via keyboard and assistive text at all viewport sizes
