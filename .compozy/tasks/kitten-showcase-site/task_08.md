---
status: pending
title: Add launch documentation and final validation checks in repository README
type: docs
complexity: medium
---

# Task 08: Add launch documentation and final validation checks in repository README

## Overview

Update repository documentation to expose the dedicated showcase site, required prerequisites, and the exact launch verification checklist. This makes the project externally understandable and ensures the public promise stays aligned with shipped implementation.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON WHAT — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add clear README links or commands for the showcase page and its verified install path.
2. MUST include a concise launch checklist covering repository visibility, license presence, recording availability, and command verification status.
3. MUST record the site's maintenance and measurement posture (no V1 telemetry, one verified CTA).
4. MUST add explicit commands for smoke validation (`build`, section/asset checks, copy flow, and star fallback review).
5. SHOULD keep README updates non-blocking to existing root command documentation.
</requirements>

## Subtasks

- [ ] 08.01 Add a "Showcase Site" section to README with canonical public URL and install path note.
- [ ] 08.02 Add concise launch readiness checks and success criteria from the PRD and TechSpec.
- [ ] 08.03 Include verification notes for star fallback and reduced-motion proof playback behavior.
- [ ] 08.04 Add a short note on V1 telemetry policy and what remains manual/launch-aggregated measurement.
- [ ] 08.05 Ensure no duplicate or contradictory claims are introduced near existing CLI README sections.

## Implementation Details

This task references PRD non-goals and success criteria to ensure claims and launch expectations remain synchronized.

- `README.md`: project-facing documentation for launch and maintenance operators.

### Relevant Files

- `README.md` — canonical user-facing documentation for launch and installation.
- `.github/workflows/showcase-site.yml` — source URL and deployment details referenced by docs.
- `.compozy/tasks/kitten-showcase-site/_techspec.md` — checklist items and constraints to mirror.

### Dependent Files

- `.compozy/tasks/kitten-showcase-site/task_07.md` — workflow details and target URL for documentation.

### Related ADRs

- [ADR-004: Defer site telemetry collection until post-launch](../adrs/adr-004.md) — documentation must reflect telemetry posture.
- [ADR-002: Center V1 on a Verified Two-Agent Handoff](../adrs/adr-002.md) — public messaging constraints.

## Deliverables

- README section for showcase project entry with commands and expectations.
- Launch verification checklist aligned to PRD metrics and technical constraints.
- Updated copy for existing install docs if conflicts appear.
- Unit-level doc checks for presence of key section headings.
- Integration smoke command list for end-to-end validation.
- Unit test coverage target: >=80% for any doc validation checks introduced.

## Tests

- Unit tests:
  - [ ] README includes a dedicated showcase section with public URL and install route note.
  - [ ] Launch checklist explicitly states one verified install route only.
- Integration tests:
  - [ ] End-to-end smoke: `cd site && bun run build && bun run preview` serves expected index sections.
  - [ ] Verification script or checklist run validates star fallback/CTA behavior against latest implementation.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80% for introduced documentation checks
- README launch guidance matches implemented site behavior
- No contradiction between README claims and TechSpec acceptance gates
