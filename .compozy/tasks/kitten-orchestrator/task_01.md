---
status: pending
title: Establish Private Workspace and Cockpit Package Boundary
type: infra
complexity: medium
---

# Task 01: Establish Private Workspace and Cockpit Package Boundary

## Overview

Create the Bun workspace boundary that separates a private repository coordinator from Kitten’s unchanged public Cockpit package. This is a structural change only: package identity, public launcher metadata, package pins, and installed behavior remain stable.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The root `package.json` MUST be private and declare only the `apps/*` Bun workspace boundary.
- The root MUST expose thin filtered coordinator commands for Cockpit without owning Cockpit runtime sources or public publish metadata.
- `apps/cockpit/package.json` MUST retain the exact public `@matheusbbarni/kitten` name, bin entry, files list, publish access, version policy, and native platform package pins.
- `apps/cockpit/tsconfig.json` MUST preserve strict TypeScript and OpenTUI JSX behavior with app-local `src` and `test` includes.
- Root `bunfig.toml` and `bun.lock` MUST remain the workspace install and test-policy authorities.
- No lifecycle install script, public package rename, or new user-visible behavior may be introduced.
</requirements>

## Subtasks

- [ ] 1.1 Convert the root manifest into a private workspace coordinator with filtered Cockpit command delegates.
- [ ] 1.2 Create the Cockpit public manifest with the preserved package, launcher, publish, script, and platform-pin contract.
- [ ] 1.3 Establish the Cockpit TypeScript configuration with unchanged compiler behavior and app-local source/test discovery.
- [ ] 1.4 Retain root Bun installation, lockfile, and coverage policy configuration unchanged except where workspace syntax requires it.
- [ ] 1.5 Add manifest and configuration contract coverage for private-root and public-Cockpit invariants.

## Implementation Details

Follow the workspace layout and command contract in the TechSpec. The public manifest is the authority for package version reads in `src/version.ts` and the build tool, so its final relative location must preserve those imports once the Cockpit tree is relocated.

### Relevant Files

- package.json — replace public-package ownership with private workspace coordination and filtered commands.
- bunfig.toml — retain install pins and the 80% coverage test policy at the workspace root.
- bun.lock — retain as the root workspace lockfile.
- tsconfig.json — source for the Cockpit TypeScript project configuration.
- apps/cockpit/package.json — new public Cockpit package manifest.
- apps/cockpit/tsconfig.json — new strict, app-local TypeScript configuration.
- test/package-shim.test.ts — public manifest and launcher contract coverage before suite relocation.
- test/dependencies.test.ts — package pin and lifecycle-script coverage before suite relocation.

### Dependent Files

- src/version.ts — package version import that must resolve against the Cockpit public manifest after relocation.
- scripts/build.ts — package version reader that must retain the public manifest contract after relocation.
- test/ciWorkflow.test.ts — root command and isolated-coverage contract coverage before suite relocation.

### Related ADRs

- [ADR-003: Make the repository root a private workspace coordinator](adrs/adr-003.md)
- [ADR-004: Keep release ownership at the root while Cockpit owns build output](adrs/adr-004.md)

## Deliverables

- A private workspace-root manifest and preserved root Bun policy files.
- A publishable Cockpit manifest with unchanged public package and launcher identity.
- An app-local TypeScript project configuration matching current strict/OpenTUI behavior.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration-style command-resolution tests with 80%+ coverage **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] The root manifest is private, declares `apps/*`, and has no public publish surface.
  - [ ] The Cockpit manifest preserves the exact package name, bin mapping, files list, publish access, and four platform pins.
  - [ ] Neither manifest introduces lifecycle install hooks or a new Bun engine constraint.
  - [ ] The Cockpit TypeScript configuration retains strict mode and OpenTUI JSX settings.
- Integration tests:
  - [ ] A root filtered Cockpit command resolves the Cockpit package without selecting a source entrypoint directly.
  - [ ] A frozen workspace installation retains the root lockfile contract.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- The root coordinates a Bun workspace without becoming a publishable Kitten package.
- Cockpit remains the sole public package with unchanged package and launcher identity.
