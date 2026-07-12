---
status: pending
title: "PR-title Conventional-Commit lint workflow"
type: infra
complexity: low
dependencies: []
---

# Task 04: PR-title Conventional-Commit lint workflow

## Overview
release-please derives versions and the changelog from Conventional Commits, and under squash-merge the commit of record is the PR title.
This task enforces Conventional-Commit PR titles so the automation always has clean input, using a single GitHub Action and no local git hooks.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a workflow using `amannn/action-semantic-pull-request` that validates PR titles against Conventional Commits on `pull_request` events (opened, edited, synchronize).
- MUST allow the standard types (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, `revert`) and permit the `!` breaking marker.
- MUST NOT add commitlint or husky local hooks (per ADR-001/ADR-002).
- MUST pin the action to a specific version, matching the repo's workflow-pinning style.
- SHOULD document that the repo uses squash-merge with "default to PR title" so the linted title becomes the commit.
</requirements>

## Subtasks
- [ ] 4.1 Add `.github/workflows/pr-title.yml` running the semantic-PR action
- [ ] 4.2 Configure the allowed types and the `!` breaking marker
- [ ] 4.3 Pin the action to a specific version
- [ ] 4.4 Document the squash-merge + PR-title convention (README/CONTRIBUTING note)

## Implementation Details
New `.github/workflows/pr-title.yml`.
See the TechSpec "Component Overview" (PR-title lint) and ADR-001 (enforcement over local hooks).
The repo's "Default to PR title for squash merge commits" setting is a manual GitHub prerequisite, noted alongside the workflow.

### Relevant Files
- `.github/workflows/pr-title.yml` - new workflow
- `.github/workflows/ci.yml` - reference for the existing workflow style and version pinning

### Dependent Files
- The repo squash-merge setting is a manual prerequisite (no code dependency)

### Related ADRs
- [ADR-001: V1 scope for the automated release train](../adrs/adr-001.md) - PR-title enforcement over local hooks
- [ADR-002: V1 product scope](../adrs/adr-002.md) - C9 clean commit input

## Deliverables
- `.github/workflows/pr-title.yml` validating Conventional-Commit PR titles
- Documented squash-merge + PR-title convention
- A YAML-validity test for the workflow **(REQUIRED where testable)**
- Test coverage >=80% on any helper/validation added **(REQUIRED where code exists)**

## Tests
- Unit tests:
  - [ ] the workflow file parses as valid YAML and triggers on `pull_request` (opened, edited, synchronize)
  - [ ] the allowed-types list includes `feat` and `fix` and the config permits the `!` breaking marker
  - [ ] the action is pinned to a specific version (not a floating tag)
- Integration tests:
  - [ ] (CI-observable) a PR titled `chore: x` passes the check and a PR titled `nonsense` fails it (documented as a one-time observed acceptance)
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- A non-conventional PR title fails the check; a conventional one passes
- No local git hooks are added
- The squash-merge + PR-title convention is documented
