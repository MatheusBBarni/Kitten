---
status: completed
title: "release-please config and version-floor manifest"
type: infra
complexity: low
dependencies: []
---

# Task 03: release-please config and version-floor manifest

## Overview
There is no versioning or changelog tooling; the version lives as a placeholder `0.0.0` stamped from a hand-typed tag.
This task adds the release-please configuration and manifest that make the release PR the single source of version truth and drive the grouped, human-readable changelog consumed by the release workflow.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `release-please-config.json` configuring a single Node package at the repo root with `release-type: node`.
- MUST add `.release-please-manifest.json` seeding the version floor (the first version off `0.0.0`; default `0.1.0` - see Open Questions in the PRD/TechSpec).
- MUST configure changelog sections mapping `feat` -> Features, `fix` -> Fixes, and `!`/`BREAKING CHANGE` -> Breaking Changes.
- MUST configure release-please to bump `package.json` `version`, keeping it the single version source consumed by ADR-004's version module.
- SHOULD keep the config minimal - no monorepo or plugin configuration the single package does not need.
</requirements>

## Subtasks
- [x] 3.1 Add `release-please-config.json` for a single root Node package
- [x] 3.2 Add `.release-please-manifest.json` seeding the version floor
- [x] 3.3 Configure the Breaking/Features/Fixes changelog sections
- [x] 3.4 Ensure the config bumps `package.json` `version`
- [x] 3.5 Add a validity test asserting the config/manifest parse and reference the root package

## Implementation Details
New `release-please-config.json` and `.release-please-manifest.json` at the repo root.
These are consumed by the release-please job in task_05.
See the TechSpec "Data Models" (release-please config) section and ADR-003.
The version-floor value is an Open Question (default `0.1.0`).

### Relevant Files
- `release-please-config.json` - new, single-package config
- `.release-please-manifest.json` - new, version floor
- `package.json` - the `version` release-please bumps

### Dependent Files
- `.github/workflows/release.yml` - task_05's release-please job reads this config
- `src/version.ts` - task_01 reads the `package.json` version release-please maintains (no code dependency)

### Related ADRs
- [ADR-003: One consolidated release workflow](../adrs/adr-003.md) - consumes this config
- [ADR-001: V1 scope for the automated release train](../adrs/adr-001.md) - release-please as the cut, manifest as single version source

## Deliverables
- Valid `release-please-config.json` + `.release-please-manifest.json`
- Changelog sections grouped Breaking/Features/Fixes
- A validity test for the config and manifest **(REQUIRED)**
- Test coverage >=80% on any parsing/validation helper added **(REQUIRED where code exists)**

## Tests
- Unit tests:
  - [x] `release-please-config.json` parses as JSON and declares the root package with `release-type: node`
  - [x] `.release-please-manifest.json` parses and sets the root package to the seeded floor version
  - [x] the config's `changelog-sections` include `feat` -> Features, `fix` -> Fixes, and a Breaking section
  - [x] the config keeps `package.json` as the versioned file (no extra-files drift)
- Integration tests:
  - [x] (CI-observable) release-please parses the config against the repo without error on a dry run (documented as the acceptance check)
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- release-please reads the config and treats `package.json` as the single version source
- The generated changelog renders Breaking/Features/Fixes groups
- The first release version is seeded above `0.0.0`
