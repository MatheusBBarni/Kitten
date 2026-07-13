---
status: completed
title: "npm platform-package generator in scripts/build.ts"
type: infra
complexity: medium
dependencies: []
---

# Task 06: npm platform-package generator in scripts/build.ts

## Overview
For `npx kitten` to run without Bun, the npm package must ship the prebuilt binary per platform.
This task extends `scripts/build.ts` with seam-gated functions that generate an `@kitten/<slug>` package directory (a `package.json` with `os`/`cpu` plus the copied binary) for each built target, following the script's existing injectable-write convention so the logic is unit-tested without cross-compiling.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `platformPackageManifest(target, version)` returning a serialized platform `package.json` with `name @kitten/<slug>`, `version`, `os`, `cpu`, `files: ["kitten-<slug>"]`, and no install scripts and no `exports`.
- MUST add `writePlatformPackage(artifact, version, outDir, write?)` that writes the manifest and copies the binary into the package dir, gated behind an injectable `write` seam like the existing `writeManifest`.
- MUST read the version from `package.json` at build time (NOT from `src/version.ts`), keeping this task independent of task_01.
- MUST call the generator for each target in `buildAll`/the CLI entry, behind a `BuildOptions` seam so existing behavior is preserved when disabled.
- MUST use the same four slugs as `BUILD_TARGETS` and map each to its correct `os`/`cpu` (darwin/linux x arm64/x64).
</requirements>

## Subtasks
- [x] 6.1 Add `platformPackageManifest` producing the per-slug `package.json`
- [x] 6.2 Add `writePlatformPackage` with an injectable write seam
- [x] 6.3 Read the build-time version from `package.json`
- [x] 6.4 Wire generation into `buildAll`/the CLI behind a `BuildOptions` seam
- [x] 6.5 Unit-test the manifest fields and the write behavior with injected fakes

## Implementation Details
Extend `scripts/build.ts`, adding functions near `renderManifest`/`buildAll` and reusing the `BuildOptions`/`Bun.write` seam pattern.
See the TechSpec "Core Interfaces" (`PlatformPackage`, `platformPackageManifest`, `writePlatformPackage`) and "Data Models" (platform package shape).
Match the `test/build.test.ts` structure, which injects `run`/`hash`/`writeManifest` fakes and captures writes into local arrays.

### Relevant Files
- `scripts/build.ts` - `BUILD_TARGETS`, `BuildArtifact`, `BuildOptions`, `buildAll` (~L142), `renderManifest`, the `Bun.write` seam (~L183)
- `test/build.test.ts` - existing unit tests to extend (inject fakes)
- `package.json` - build-time version source

### Dependent Files
- `bin/kitten.mjs` / `package.json` - task_07's launcher resolves the `@kitten/<slug>/kitten-<slug>` this task produces
- `.github/workflows/release.yml` - task_08 publishes the generated platform packages

### Related ADRs
- [ADR-001: V1 scope for the automated release train](../adrs/adr-001.md) - npm-native binary via optionalDependencies platform packages

## Deliverables
- `platformPackageManifest` + `writePlatformPackage` added to `build.ts`
- Generation wired into `buildAll`/CLI behind a seam, existing behavior preserved when off
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test generating the host platform package **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `platformPackageManifest({platform:"darwin-arm64",...}, "1.2.3")` yields `name "@kitten/darwin-arm64"`, `os ["darwin"]`, `cpu ["arm64"]`, `version "1.2.3"`, `files ["kitten-darwin-arm64"]`, and NO `scripts`/`exports`
  - [x] each of the four slugs maps to the correct `os`/`cpu` pair
  - [x] `writePlatformPackage` with an injected write records a `package.json` write and a binary copy under `<outDir>/@kitten/<slug>/`
  - [x] `buildAll` with the generation seam enabled and injected fakes produces four platform packages plus the existing `SHA256SUMS`
  - [x] `buildAll` behavior is unchanged when the generation seam is disabled
- Integration tests:
  - [x] generating the host platform package writes a resolvable `package.json` + binary under the output dir
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Four correct `@kitten/<slug>` packages are generated from the four targets
- Existing build/manifest behavior is preserved
- No dependency on `src/version.ts`
