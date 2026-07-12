---
status: pending
title: Add showcase config model as the source of truth for copy, claims, and links
type: frontend
complexity: medium
---

# Task 02: Add showcase config model as the source of truth for copy, claims, and links

## Overview

Create a single, typed config module that holds the launch content and verified CTA data so content cannot drift across components. This enforces the PRD trust requirement to keep claims and paths consistent and creates the data contract that multiple page sections can share without duplication.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON WHAT — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST define a single exported config object in `site/src/config/showcase-config.ts` that includes site metadata, proof assets, install command source, and repository details.
2. MUST ensure there is exactly one primary install command path and expose it as a clearly typed value.
3. MUST include fallback strings and a11y copy for star count state and proof messaging.
4. SHOULD keep content model fields aligned with TechSpec sections (`Core Interfaces`, `Data Models`) rather than duplicating UI wiring logic.
5. SHOULD centralize all PRD-sensitive promises so review and documentation pull from one source.
</requirements>

## Subtasks

- [ ] 02.01 Define a config schema and exported object for install command, proof section, requirements, FAQ, and repo metadata.
- [ ] 02.02 Add explicit constant(s) for `repoOwner`, `repoName`, and install verification source.
- [ ] 02.03 Export typed values for hero, proof, requirements, and FAQ content consumed by `index.astro`.
- [ ] 02.04 Add a lightweight config validation/test file that verifies one primary install route exists.
- [ ] 02.05 Provide placeholder-safe defaults for any optional fields to avoid runtime crashes during render.

## Implementation Details

This task maps directly to TechSpec "Core Interfaces" and "Data Models" sections and converts those intent points into one concrete config module.

- `site/src/config/showcase-config.ts`: primary source of truth for all launch copy, command data, and repo metadata.
- `site/src/config/showcase-config.test.ts` (if test harness exists in task_01 scope): verify the one-primary-command invariant and required non-empty route fields.

### Relevant Files

- `site/src/config/showcase-config.ts` — central site contract for copy and commands.
- `site/src/config/showcase-config.test.ts` — validation for config integrity (or equivalent config smoke script).
- `site/src/pages/index.astro` — consumes config in the next task.

### Dependent Files

- `.compozy/tasks/kitten-showcase-site/task_03.md` — reads config contract to render sections.
- `.compozy/tasks/kitten-showcase-site/task_05.md` — uses repo metadata for GitHub API inputs.

### Related ADRs

- [ADR-001: Build a Focused Proof-Led Astro Showcase](../adrs/adr-001.md) — drives content boundaries and what the page can claim.
- [ADR-003: Keep showcase delivery as a separate Astro subproject in `site/`](../adrs/adr-003.md) — requires config to live in site boundary.

## Deliverables

- Typed configuration module that owns install route, requirement copy, and metadata.
- Config validation check to prevent placeholder or missing primary install command.
- Unit test (or equivalent smoke check) for config integrity.
- Integration check to ensure `index.astro` and child components can consume the config without duplicate constants.
- Unit test coverage target: >=80% for config validation logic.

## Tests

- Unit tests:
  - [ ] `primaryInstallCmd` must be present and non-empty.
  - [ ] Configuration must expose exactly one `source: "verified-route"` entry.
  - [ ] Repo metadata fields (`repoOwner`, `repoName`) must be non-empty strings.
- Integration tests:
  - [ ] Build-time import test confirms every rendered section has corresponding config data in dev/CI compile.
  - [ ] Render smoke test fails if config is missing a required field used by page sections.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80% for config verification
- All PRD-sensitive claims and CTA inputs are sourced from one exported config object
- No section-level copy constants duplicate repository or command values
