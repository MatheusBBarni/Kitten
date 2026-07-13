---
status: completed
title: "Repository file discovery source and safety policy"
type: backend
complexity: high
---

# Task 01: Repository file discovery source and safety policy

## Overview

Create the fail-soft, injectable source that produces safe repository-relative file candidates for one session workspace. This is the implementation foundation for the @ selector’s normal-file boundary and must enforce the Git, filesystem, binary, ignore, and terminal-safety policies before any UI receives a path.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST create a typed, fail-soft repository-file source that returns only ready or unavailable results; expected subprocess, stream, attribute, and filesystem failures MUST NOT reject.
2. MUST resolve the repository root, list candidates, apply the current ignore policy, and preserve NUL-delimited path handling as specified in the TechSpec "Integration Points" section.
3. MUST exclude control-character paths, paths outside the resolved root, non-regular files, generated/non-text attribute matches, and bounded-prefix binary files.
4. MUST process filesystem checks with named bounded concurrency and MUST NOT cap the searchable eligible candidate set.
5. MUST retain no source bytes or binary verdicts after one discovery call and MUST return deterministic lexical path order.
</requirements>

## Subtasks
- [x] 1.1 Add the repository-file source contract and its production implementation.
- [x] 1.2 Enforce the Git root, ignore, attribute, path-safety, and normal-file candidate policies.
- [x] 1.3 Add the bounded binary and filesystem safety checks.
- [x] 1.4 Expose injectable subprocess and filesystem seams for deterministic tests.
- [x] 1.5 Add direct coverage for success, unavailable, safety, and bound conditions.

## Implementation Details

Create the application-layer discovery module described in TechSpec "System Architecture > Component Overview" and "Integration Points". Follow the fail-soft subprocess pattern in the branch reader; keep all I/O out of the UI and core layers.

### Relevant Files
- `src/config/gitBranch.ts` — established injectable, fail-soft Git subprocess pattern.
- `src/config/gitBranch.test.ts` — expected test style for command options, exits, and stream failures.
- `.compozy/tasks/file-selector-at/_techspec.md` — authoritative Git command, attribute, ignore, and filesystem policy.
- `.compozy/tasks/file-selector-at/adrs/adr-005.md` — exact normal-file and terminal-safe-path decision.

### Dependent Files
- `src/app/actions.ts` — task_02 consumes the source through the controller action boundary.
- `src/app/controller.ts` — task_02 injects the production source.
- `src/ui/PromptEditor.tsx` — task_06 receives only the source’s safe relative paths.

### Related ADRs
- [ADR-002: Limit V1 to Normal Repository Files and Preserve Composition on No Match](adrs/adr-002.md) — defines the candidate boundary and non-blocking failure requirement.
- [ADR-003: Discover Repository Files Through an Injected Controller-Owned Git Source](adrs/adr-003.md) — places discovery behind the controller action boundary.
- [ADR-005: Use Conservative Attributes and Bounded Binary Detection](adrs/adr-005.md) — defines ignore, attribute, binary, and safe-path policy.

## Deliverables
- New `src/app/fileDiscovery.ts` with typed source/result contracts and bounded fail-soft discovery.
- New colocated `src/app/fileDiscovery.test.ts` covering Git and filesystem seams.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for repository discovery against injected Git/filesystem doubles **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Root resolution, NUL-delimited `ls-files` parsing, and stable lexical path ordering return the expected relative paths.
  - [x] `check-ignore --no-index` removes ignored candidates, including a tracked path that currently matches ignore rules.
  - [x] Attribute triples exclude generated/non-text values and malformed output returns unavailable.
  - [x] C0/C1 filenames, root escapes, symlinks, non-regular paths, and NUL-prefix binary files never appear.
  - [x] Prefix reads are limited to 4 KiB, worker concurrency never exceeds its constant, and no candidate cap truncates results.
- Integration tests:
  - [x] An injected repository fixture with ignored, generated, binary, safe whitespace, and duplicate-basename files returns only the intended relative candidates.
  - [x] A non-repository cwd or failed Git process yields an unavailable result without throwing.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The source returns only safe repository-relative normal files or a typed unavailable result.
- No Git, filesystem, or path-policy failure can reject into a caller.
