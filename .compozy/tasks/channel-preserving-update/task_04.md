---
status: completed
title: "Dispatch standalone updates before boot"
type: backend
complexity: medium
---

# Task 04: Dispatch standalone updates before boot

## Overview

Expose the completed standalone update transaction through the compiled `kitten --update` command without entering normal application boot. Preserve the existing metadata contract while making every standalone outcome terminal-visible, correctly exited, and isolated from Cockpit, repository, agent, and npm behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add `--update` recognition adjacent to existing metadata recognizers while preserving `--version` before `--help` precedence.
2. MUST run the standalone update dispatch only after reserved child modes and unhandled version/help flags, but before self-check, repository/readiness gates, renderer creation, agent startup, and normal `main()` boot.
3. MUST write the standalone service outcome exactly once and exit 0 only for updated or already-current results; refused and failed results MUST exit nonzero with their fail-closed recovery text.
4. MUST keep `dispatchCliFlags` synchronous and metadata-only; update orchestration MUST use an injectable async boundary rather than changing established version/help behavior.
5. MUST ensure `--update` never invokes npm, self-check, normal boot, Cockpit UI, or an alternate update channel, and unknown flags MUST retain current boot behavior.
6. MUST keep private installer record mode and public update dispatch distinct from public help content.
</requirements>

## Subtasks

- [x] 4.1 Recognize the public update invocation without disturbing existing metadata flags.
- [x] 4.2 Route standalone outcomes before self-check and normal boot.
- [x] 4.3 Preserve terminal output and process-status semantics for every outcome.
- [x] 4.4 Keep private installer-record behavior separate from public update behavior.
- [x] 4.5 Add in-process precedence and no-boot tests.
- [x] 4.6 Prove compiled-artifact safe refusal from isolated state.

## Implementation Details

Implement TechSpec "Standalone update boundary" at the sole executable entry path in `src/index.ts`. The transaction implementation remains in the standalone module; this task only orchestrates its result through the compiled CLI and preserves the current reserved-mode, version, help, self-check, and normal-boot sequence.

### Relevant Files

- `src/index.ts` — metadata recognizers, synchronous version/help dispatch, reserved-mode ordering, and executable boot path.
- `test/firstRunBoot.test.ts` — existing in-process CLI metadata contract suite.
- `test/build.integration.test.ts` — existing real host compiled-artifact fixture.
- `src/update.ts` — completed standalone update service and outcome formatter consumed by this dispatch boundary.

### Dependent Files

- `README.md` — later public guidance must describe the finalized command behavior.
- `bin/launcher.mjs` — later npm path must preserve metadata forwarding and remain separate from standalone dispatch.
- `test/npm-launcher.integration.test.ts` — later package fixture retains forwarding coverage.

### Related ADRs

- [ADR-001: Preserve Verified Installation Channels with Fail-Closed Updates](adrs/adr-001.md) — forbids fallback or guessed mutation.
- [ADR-002: Make Every Update Outcome Self-Describing and Fail Closed](adrs/adr-002.md) — governs exit and terminal feedback.
- [ADR-003: Keep Update Mutation at Its Provenance Boundary](adrs/adr-003.md) — reserves this path for standalone ownership only.
- [ADR-005: Prove Update Transactions with Isolated Local Tests](adrs/adr-005.md) — requires executable-boundary verification.

## Deliverables

- Public compiled CLI `--update` dispatch before normal boot.
- Injectable dispatch tests for success, refusal, failure, and metadata precedence.
- Compiled-artifact safe-refusal regression coverage.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the compiled command boundary **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] `wantsUpdate(["--update"])` is true and rejects self-check and unknown-only argument lists.
  - [x] Injected updated and already-current outcomes write once and exit 0 with the expected channel/version text.
  - [x] Injected refused and failed outcomes write no-change text, both literal recovery commands, and a nonzero exit without leaking private error causes.
  - [x] `--version --update` prints only the version and `--help --update` prints only help; neither invokes the update runner.
  - [x] `--update --self-check` runs only the update path, while unknown arguments retain normal boot behavior.
- Integration tests:
  - [x] A real host compiled artifact run with `--update` and fresh isolated XDG state returns nonzero safe refusal, creates no registry/target mutation, and emits no self-check, repository-gate, agent, or Cockpit output.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- `kitten --update` is explicit, one-shot, and independent of normal Cockpit boot.
- Metadata precedence remains unchanged and no standalone CLI invocation can trigger npm or a channel fallback.
