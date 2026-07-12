---
status: pending
title: Build core showcase landing page sections and single-page layout
type: frontend
complexity: high
---

# Task 03: Build core showcase landing page sections and single-page layout

## Overview

Implement the one-route landing page and section components that deliver the primary handoff promise, authentic proof narrative, verified install intent, requirements, and trust FAQ. This task turns the TechSpec architecture into renderable structure and guarantees the page is immediately understandable within the PRD conversion path.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON WHAT — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST implement a single browser route at `/` that renders the full showcase structure.
2. MUST include all functional content sections required by PRD core features 1, 2, 3, 4, and 6.
3. MUST keep heading hierarchy and section IDs stable for manual QA and potential future automation.
4. MUST render install, proof, requirements, and FAQ content from the config module created in Task 02.
5. MUST avoid embedding unverified product claims outside the config-sourced narrative source.
</requirements>

## Subtasks

- [ ] 03.01 Build `site/src/pages/index.astro` as the one-page composition root and semantic section container.
- [ ] 03.02 Add `site/src/components/Hero.astro` with trust-first statement and primary install CTA placement.
- [ ] 03.03 Add `site/src/components/Proof.astro` with annotation hooks/placeholders for screen recording context.
- [ ] 03.04 Add `site/src/components/Requirements.astro` to cover prerequisites and handoff behavior constraints.
- [ ] 03.05 Add `site/src/components/Faq.astro` covering scope and fallback scenarios from PRD.
- [ ] 03.06 Add `site/src/components/SiteControls.astro` for repository link/star control area and CTA cluster.
- [ ] 03.07 Add shared section wrappers and IDs that match PRD copy structure and TechSpec component mapping.

## Implementation Details

This is the section-composition layer from the TechSpec component overview.

- `site/src/pages/index.astro`: route container and section order.
- `site/src/components/Hero.astro`: first-screen narrative and install focus.
- `site/src/components/Proof.astro`: reviewed handoff proof sequence and media container.
- `site/src/components/Install.astro`: CTA container and command presentation shell.
- `site/src/components/Requirements.astro`: scoped usage and safety constraints.
- `site/src/components/Faq.astro`: concise clarifying questions list.
- `site/src/components/SiteControls.astro`: repository + trust controls container (star and CTA adjuncts).

### Relevant Files

- `site/src/pages/index.astro` — root route and semantic flow.
- `site/src/components/Hero.astro` — lead narrative and intent.
- `site/src/components/Proof.astro` — evidence-led demonstration section.
- `site/src/components/Install.astro` — install action surface.
- `site/src/components/Requirements.astro` — conversion blockers and setup clarifications.
- `site/src/components/Faq.astro` — trust/scope clarifying copy.
- `site/src/components/SiteControls.astro` — repository call-to-action and secondary control area.

### Dependent Files

- `.compozy/tasks/kitten-showcase-site/task_04.md` — enhances `Install.astro` with copy interactions.
- `.compozy/tasks/kitten-showcase-site/task_05.md` — integrates live star state into `SiteControls.astro`.
- `.compozy/tasks/kitten-showcase-site/task_06.md` — adds styling/motion behavior to all section components.

### Related ADRs

- [ADR-001: Build a Focused Proof-Led Astro Showcase](../adrs/adr-001.md) — defines primary messaging and proof-first layout.
- [ADR-002: Center V1 on a Verified Two-Agent Handoff](../adrs/adr-002.md) — constrains content and scope.
- [ADR-003: Keep showcase delivery as a separate Astro subproject in `site/`](../adrs/adr-003.md) — structural boundary.

## Deliverables

- Complete one-page layout with all required sections wired to config.
- Reusable components for the hero/proof/install/requirements/FAQ flows.
- Unit-level static validation that expected section IDs/keys exist in generated markup.
- Integration build and route smoke output verifying all sections render in the default config.
- Unit test coverage target: >=80% for any helper utilities introduced in this task.

## Tests

- Unit tests:
  - [ ] Config-driven section IDs for Hero/Proof/Install/Requirements/FAQ are included in render output.
  - [ ] Each section title text renders from config and does not duplicate hardcoded product claims.
  - [ ] Route renders without any hardcoded install path not sourced from `showcase-config.ts`.
- Integration tests:
  - [ ] `cd site && bun run build` completes and includes `dist/index.html`.
  - [ ] Manual keyboard smoke validates heading order and tab reachability across top-level sections.
  - [ ] Manual viewport checks for desktop and mobile show no broken section ordering.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80% on touched validation/render utilities
- Full route renders with all required sections in sequence
- No hardcoded duplicate claim strings outside shared config
