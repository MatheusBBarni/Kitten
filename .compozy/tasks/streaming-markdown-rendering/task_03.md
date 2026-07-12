---
status: completed
title: "Fix #807: guarantee Markdown and diff highlighting in the compiled binary"
type: infra
complexity: high
dependencies: []
---

# Task 03: Fix #807: guarantee Markdown and diff highlighting in the compiled binary

## Overview
The compiled binary silently loses syntax highlighting because `bun build --compile` does not embed OpenTUI's tree-sitter worker, so shipped Markdown fences and diffs render in flat color while the source build highlights them.
This task guarantees the worker and its assets reach the binary and resolves the worker path at startup, then adds a self-check that asserts a highlighted span so the regression can never ship again.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST ensure the OpenTUI tree-sitter worker (`parser.worker.js`) and the language wasm/scm assets it needs are available to the compiled binary, and MUST point OpenTUI at the worker via one of its supported seams (`workerPath` option or `OTUI_TREE_SITTER_WORKER_PATH`) before the renderer or tree-sitter client is created.
- MUST centralize the compile-time wiring in `scripts/build.ts` `compileCommand` and keep any startup extraction in the app bootstrap, preserving the single-binary distribution.
- MUST strengthen `src/app/selfCheck.ts` to render a Markdown fence and a diff containing a known token and to assert that the token renders with a highlighted (non-default foreground) span, failing the process with a non-zero exit when highlighting is absent.
- MUST extend `test/build.integration.test.ts` to run the strengthened self-check against the compiled host binary and fail if highlighting is missing.
- MUST NOT regress the existing `--self-check` success output (`SELF-CHECK OK`) or boot behavior.
</requirements>

## Subtasks
- [ ] 3.1 Determine empirically which assets `bun build --compile` embeds and which the worker still needs; embed or extract the worker plus wasm/scm as required.
- [ ] 3.2 Resolve the worker path at startup via the `workerPath`/env seam before the renderer is created.
- [ ] 3.3 Seed a Markdown fence and a diff in the self-check and assert a highlighted span in-process.
- [ ] 3.4 Extend the build integration test to exercise the strengthened self-check on the compiled binary.
- [ ] 3.5 Validate on a host compile that highlighting survives and document the embedding recipe.

## Implementation Details
Modify `scripts/build.ts` (`compileCommand`), the app bootstrap where the renderer/tree-sitter client is first created, `src/app/selfCheck.ts` (seed content plus the span assertion, threaded so a missing highlight exits non-zero), and `test/build.integration.test.ts`.
Because `captureCharFrame`/stdout are plain text, the highlight assertion MUST run in-process inside the self-check (via `captureSpans`), not in the integration test's stdout check.
See TechSpec "Integration Points" and "Technical Considerations > Known Risks" and ADR-004 for the seam options and the flagged embedding-recipe risk.

### Relevant Files
- `scripts/build.ts` - `compileCommand`, the single compile chokepoint (currently a plain `bun build --compile`).
- `src/app/selfCheck.ts` - mounts the cockpit against an empty offline session and returns `{ frame }` today.
- `src/index.ts` - the `--self-check` dispatch and success/failure output, and the app bootstrap.
- `test/build.integration.test.ts` - compiles the host binary and asserts `SELF-CHECK OK`.
- `node_modules/@opentui/core/parser.worker.js` and `assets/**` (markdown, markdown_inline, typescript, javascript, zig wasm/scm) - the assets that must reach the binary.

### Dependent Files
- `src/ui/main.tsx` - `cockpitElement`, the tree that the self-check mounts.

### Related ADRs
- [ADR-004: #807 worker embedding](../adrs/adr-004.md) - the embed-and-resolve-at-startup decision and its risks.

## Deliverables
- The compiled binary highlights Markdown fences and diffs identically to a source run.
- A self-check that fails with a non-zero exit when highlighting is absent.
- An extended build integration test that runs the strengthened self-check.
- Unit/integration tests with 80%+ coverage for the changed self-check logic **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] The strengthened self-check reports a highlighted span for a known fenced-code token (span `fg` differs from the default text color).
  - [ ] The self-check throws or exits non-zero when the token renders in the default (unhighlighted) color.
- Integration tests:
  - [ ] Compiling the host binary and running `--self-check` exits 0, prints `SELF-CHECK OK`, and the seeded Markdown/diff token is highlighted (span assertion inside the binary).
  - [ ] Regression: `--self-check` output still contains the first agent's display name (`Claude Code`).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Highlighting is present in the compiled binary and proven by the self-check.
- The single-binary distribution is preserved and the embedding recipe is documented in the task or PR.
