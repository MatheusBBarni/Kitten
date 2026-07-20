---
status: pending
title: "Prove and update global npm installations"
type: backend
complexity: high
---

# Task 05: Prove and update global npm installations

## Overview

Add the npm-owned update path at the Node launcher boundary, where package ancestry is observable. It must update only a verified global package installation, preserve ordinary forwarding for every other command, and refuse local, `npx`, missing, split-root, or otherwise ambiguous contexts without spawning a binary or downloading a standalone release.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST handle `--update` in the Node launcher only after preserving normal compiled-binary forwarding for any invocation containing `--version` or `--help`.
2. MUST derive and canonicalize the executing main package root, resolved host platform binary, and the sole canonical path from `npm root --global`; both package paths MUST be true path-segment descendants of that global root.
3. MUST reject prefix lookalikes, local dependencies, `npx`-like caches, missing npm, malformed root output, failed canonicalization, missing manifests, split main/platform roots, and npm failures before an npm install, binary spawn, or standalone fallback occurs.
4. MUST invoke exactly `npm install --global @matheusbbarni/kitten@latest` as an argument array with inherited terminal streams only after both global-ownership proofs succeed.
5. MUST read verified main package versions before and after the npm transaction without module-cache reuse; unchanged versions MUST report already-current and changed versions MUST report the npm channel plus prior/result versions.
6. MUST keep this Node-only, Bun-free, and package-contained under `bin/`; no shell interpolation, registry override, extra package manager, or cross-runtime abstraction may be added.
</requirements>

## Subtasks

- [ ] 5.1 Supply canonical package-location and manifest seams from the Node entrypoint.
- [ ] 5.2 Classify global npm ownership with canonical root ancestry.
- [ ] 5.3 Run the exact npm transaction only for a proven global installation.
- [ ] 5.4 Report npm version outcomes and safe refusals without fallback.
- [ ] 5.5 Preserve existing non-update platform resolution and binary forwarding.
- [ ] 5.6 Add deterministic unit and packed-package integration coverage.

## Implementation Details

Implement TechSpec "Node npm update boundary" and "Integration Points — npm global installation" entirely within the shipped Node launcher files. This task must not delegate an ambiguous invocation to `src/index.ts`, modify release assets, or add a package outside the existing npm shim boundary.

### Relevant Files

- `bin/kitten.mjs` — Node composition root that supplies package-root, canonical-path, manifest, and command seams.
- `bin/launcher.mjs` — deterministic platform resolution, ownership classification, npm transaction, output, and non-update forwarding control flow.
- `test/launcher.test.mjs` — existing injected launcher call-order and failure tests.
- `test/npm-launcher.integration.test.ts` — existing packed main-shim and host-platform-package fixture under Node without Bun.
- `package.json` — read-only contract showing that the published package ships only `bin/` plus platform optional dependencies.

### Dependent Files

- `README.md` — later guidance describes the exact global npm command and safe-refusal behavior.
- `src/index.ts` — standalone-only compiled dispatch must remain uninvolved in rejected npm contexts.
- `test/package-shim.test.ts` — later documentation/package assertions rely on unchanged published shim topology.

### Related ADRs

- [ADR-001: Preserve Verified Installation Channels with Fail-Closed Updates](adrs/adr-001.md) — requires positive npm ownership before mutation.
- [ADR-002: Make Every Update Outcome Self-Describing and Fail Closed](adrs/adr-002.md) — requires prior/result channel output and recoverable refusal.
- [ADR-003: Keep Update Mutation at Its Provenance Boundary](adrs/adr-003.md) — assigns npm mutation to the Node launcher.
- [ADR-005: Prove Update Transactions with Isolated Local Tests](adrs/adr-005.md) — requires deterministic package-boundary evidence.

## Deliverables

- Node launcher global-npm provenance proof and exact npm update transaction.
- Deterministic version outcome and safe-refusal output for all npm contexts.
- Injected launcher tests and Node-only packed-package fixtures.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for local, npx-shaped, global-updated, and already-current package layouts **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Existing platform resolution and binary forwarding remain unchanged for ordinary non-update arguments.
  - [ ] `--version` and `--help` combined with `--update` forward only to the compiled binary and never query or invoke npm.
  - [ ] Proven global main and platform roots run `npm root --global` then exactly `npm install --global @matheusbbarni/kitten@latest`.
  - [ ] Changed post-transaction version reports npm prior/result, while unchanged version reports npm already-current.
  - [ ] Main-outside-root, platform-outside-root, prefix collision, local path, npx-like path, missing npm, malformed root, failed realpath, missing manifest, and npm nonzero each refuse without npm install or binary spawn.
- Integration tests:
  - [ ] A packed local launcher with a fake npm root refuses `--update` and produces no fake `install --global` log entry.
  - [ ] An npx-shaped package path outside the fake global root refuses with the same no-mutation behavior.
  - [ ] A controlled fake global root containing the shim and matching platform package records only the exact npm install argv and emits npm prior/result output.
  - [ ] A second global fixture whose manifest version remains unchanged emits the already-current result without fallback.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Only a canonical proven global npm installation can invoke the npm update command.
- Every unsupported npm context remains unchanged, never spawns a standalone update, and receives actionable recovery output.
