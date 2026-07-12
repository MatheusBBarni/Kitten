---
status: pending
title: "Self-describing version module, --version/--help, and ACP clientInfo"
type: backend
complexity: medium
dependencies: []
---

# Task 01: Self-describing version module, --version/--help, and ACP clientInfo

## Overview
kitten cannot report its own version: the string is hardcoded `"0.0.0"` in `package.json` and in the ACP `clientInfo`, and there is no `--version` or `--help`.
This task adds `src/version.ts` as the single version source (a bundled `package.json` import), adds the two CLI flags, and wires the real version into the ACP handshake so users and agents always see the published version.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `src/version.ts` exporting `KITTEN_VERSION: string` from a bundled `package.json` JSON import (import attributes), per ADR-004.
- MUST add `--version` handling in `src/index.ts` that prints `KITTEN_VERSION` and exits 0, as a sibling predicate to the existing `wantsSelfCheck`.
- MUST add `--help` handling that prints examples-first usage plus the channel-matched install/upgrade commands and exits 0.
- MUST replace the hardcoded `clientInfo.version: "0.0.0"` in `src/agent/agentConnection.ts` with `KITTEN_VERSION`.
- MUST NOT introduce an arg-parsing library or `--define`; use bare `process.argv` predicates matching the existing dispatch.
- MUST keep unknown flags falling through to launching the cockpit (behavior unchanged).
</requirements>

## Subtasks
- [ ] 1.1 Add `src/version.ts` re-exporting `package.json`'s version as `KITTEN_VERSION`
- [ ] 1.2 Add a `--version` predicate + dispatch in `src/index.ts`
- [ ] 1.3 Add a `--help` predicate + dispatch with examples and install/upgrade commands
- [ ] 1.4 Point `agentConnection.ts` `clientInfo.version` at `KITTEN_VERSION`
- [ ] 1.5 Cover version equality, `--version`, `--help`, clientInfo, and the compiled binary's `--version`

## Implementation Details
Create `src/version.ts`; modify `src/index.ts` (the top-level `if (import.meta.main)` dispatch, adding `wantsVersion`/`wantsHelp` beside `wantsSelfCheck`); modify `src/agent/agentConnection.ts` (the `initialize` call's `clientInfo`).
See the TechSpec "Core Interfaces" (version module) and "CLI Surface" sections.
Follow the repo's ESM convention: explicit `.ts` import extensions and the `resolveJsonModule` import-attribute style already used in `test/tsconfig.test.ts`.

### Relevant Files
- `src/version.ts` - new single version source (imports `package.json`)
- `src/index.ts` - flag dispatch (`wantsSelfCheck` ~L228, `if (import.meta.main)` ~L232)
- `src/agent/agentConnection.ts` - hardcoded `clientInfo: { name: "kitten", version: "0.0.0" }` ~L168
- `package.json` - the `version` field `KITTEN_VERSION` reads (owned by release-please via task_03)

### Dependent Files
- `test/build.integration.test.ts` - extend to assert the compiled binary's `--version` equals `package.json`'s version
- `src/version.test.ts` (new, or a colocated test) - unit assertions
- task_06/task_07 - platform packages/launcher stamp the same version for consistency (no code dependency)

### Related ADRs
- [ADR-004: Version source of truth via a bundled package.json JSON import](../adrs/adr-004.md) - this task implements it
- [ADR-002: V1 product scope - self-describing install](../adrs/adr-002.md) - C5, `--version`/`--help`

## Deliverables
- `src/version.ts` exporting `KITTEN_VERSION`
- `--version` and `--help` working under both `bun run` and the compiled binary
- ACP `clientInfo.version` reporting the real version
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting the compiled binary reports the version **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `KITTEN_VERSION` strictly equals `package.json`'s `version` field
  - [ ] `wantsVersion(["--version"])` is true; `wantsVersion(["--self-check"])` is false
  - [ ] dispatch with `--version` writes exactly `KITTEN_VERSION` + newline to stdout and exits 0
  - [ ] dispatch with `--help` writes usage containing `npx kitten` and `--self-check` and exits 0
  - [ ] `agentConnection` `initialize` sends `clientInfo.version === KITTEN_VERSION` (mocked connection)
  - [ ] an unknown flag (`--nope`) triggers neither version/help/self-check nor an error (falls through)
- Integration tests:
  - [ ] `test/build.integration.test.ts`: the host-compiled binary run with `--version` prints the same string as `package.json`'s version
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `kitten --version` and `--help` work in dev (`bun run`) and in the compiled binary
- No hardcoded `"0.0.0"` remains in `src/`; ACP `clientInfo` reports the real version
- No new runtime dependency added
