---
status: completed
title: "Honest install: installer slug fix, README rewrite, CI resolve-check"
type: docs
complexity: medium
dependencies: []
---

# Honest install: installer slug fix, README rewrite, CI resolve-check

## Overview
Both advertised install paths are broken for a new user: the curl one-liner 404s on a placeholder repo slug (`OWNER/kitten`), and the README documents only the from-source `bun install` flow.
This task fixes the installer slug, rewrites the README to lead with the working install channel and accurate requirements, and adds a CI check that the README's install commands resolve so the docs cannot silently rot.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST replace the placeholder `OWNER/kitten` default in `scripts/install.sh` with the real slug `MatheusBBarni/Kitten`, preserving the `KITTEN_REPO` override.
- MUST rewrite the README to lead with the checksummed curl one-liner (now working) and to state the real requirements: launch from inside a git repository, and Claude Code + Codex installed and authenticated.
- MUST keep the `bun install` / `bun start` contributor flow present but secondary; the `npx`/`npm i -g` hero line is finalized in task_07 when the npm binary ships (do NOT present a not-yet-working command as the primary install).
- MUST add a CI check that the README's documented install URL and repo slug resolve, failing the build on a placeholder (`OWNER/`) or a 404.
- MUST update `test/install.test.ts` for the real slug while preserving the platform-detection assertions.
</requirements>

## Subtasks
- [x] 2.1 Fix the `install.sh` repo slug to `MatheusBBarni/Kitten`
- [x] 2.2 Rewrite the README to lead with the working curl install and accurate requirements
- [x] 2.3 Reference the npm channel as landing with the binary, without a not-yet-working command
- [x] 2.4 Add a CI check that the README install URL/slug resolve (no placeholder, no 404)
- [x] 2.5 Update the installer unit test for the real slug

## Implementation Details
Modify `scripts/install.sh` (the `REPO="${KITTEN_REPO:-OWNER/kitten}"` default ~L21, plus the comment ~L6), `README.md` (Requirements ~L38-41, Getting started ~L43-56), `.github/workflows/ci.yml` (add a resolve-check step), and `test/install.test.ts`.
See the TechSpec "Component Overview" (Docs + installer) and PRD C2/C8.
The real slug from `git remote` is `MatheusBBarni/Kitten` (capital K); pin it exactly.

### Relevant Files
- `scripts/install.sh` - `REPO="${KITTEN_REPO:-OWNER/kitten}"` (~L21, comment ~L6), `detect_platform` maps the four `BUILD_TARGETS` slugs
- `README.md` - Requirements (~L38-41), Getting started (~L43-56), Configuration (~L58)
- `.github/workflows/ci.yml` - single `verify` job; add the README-resolve step here or as a sibling workflow
- `test/install.test.ts` - installer unit tests to update

### Dependent Files
- `README.md` - task_07 promotes `npx kitten` to the hero and adds the version-stamped install success line
- task_08 post-publish smoke verifies the npm channel the finalized README advertises

### Related ADRs
- [ADR-002: V1 product scope - self-describing install](../adrs/adr-002.md) - C2 working curl, C8 honest docs

## Deliverables
- `install.sh` pointing at the real repo; the curl one-liner resolves
- README leading with a working channel and stating the git-repo + dual-agent requirements
- A CI check that the README install commands resolve
- Updated installer unit tests **(REQUIRED)**
- Test coverage >=80% on the touched script/check logic **(REQUIRED)**

## Tests
- Unit tests:
  - [x] sourcing `install.sh` with `KITTEN_REPO` unset resolves `REPO` to `MatheusBBarni/Kitten`
  - [x] a `KITTEN_REPO` override still takes precedence over the default
  - [x] `detect_platform` maps `uname` outputs to the four `BUILD_TARGETS` slugs (darwin/linux x arm64/x64) - existing assertions preserved
  - [x] the resolve-check script flags a README containing `OWNER/` as failing
- Integration tests:
  - [x] the CI resolve-check passes against the real slug fixture and fails against a placeholder/404 fixture
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The documented curl one-liner resolves to the real repo; no `OWNER/` placeholder remains anywhere
- The README leads with a working install channel and states the git-repo + dual-agent requirements
- CI fails if the README's install commands stop resolving
