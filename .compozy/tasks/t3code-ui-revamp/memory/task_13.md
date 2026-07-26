# Task Memory: task_13.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the card workbench review surface around a manifest-first flow, bounded
  selected-file chunk reads, fail-closed dispositions, and mutation-free
  Request changes draft preparation.

## Important Decisions

- Consume the existing Task 06/08/09 RPC and command contracts without
  introducing renderer-owned review truth.
- Keep selected evidence, file, and chunk offset local to the inspector review
  surface; preserve the card-owned request-changes draft in the existing
  namespaced desktop view store.
- Treat host manifest availability as authoritative. Never infer currentness
  from timestamps, revision equality, or locally matching identities.
- Use Product register with low visual variance and motion and high information
  density; reuse existing semantic tokens and HeroUI controls.
- Keep only the current diff chunk in rendered component state. Chunk navigation
  retains bounded offsets and follows the host's exact `nextOffset`.
- Preserve file selection by old/new repository-relative path identity so a
  refreshed evidence artifact can keep the same file selected even when opaque
  evidence and file IDs change.

## Learnings

- `CardInspector` currently fetches manifests for evidence summaries and only
  forwards `Open review` to an optional callback; no review panel or diff viewer
  exists yet.
- The host contract already exposes ordered manifest files, bounded chunk
  offsets, approval preconditions, and typed stale/missing/oversized/unsafe
  errors.
- The worktree contains broad uncommitted changes from prerequisite tasks.
  Task 13 edits and staging must remain narrow.
- TanStack Query keys isolate evidence/file/offset responses, so an unmounted
  prior-file observer cannot render a late chunk into the current selection.
- Request changes can switch the existing namespaced draft source inside
  `CardInspector`; keying the composer by source gives deterministic focus
  without a host call.

## Files / Surfaces

- Added `ReviewPanel.tsx` / `.test.tsx` and `DiffViewer.tsx` / `.test.tsx`.
- Updated `CardInspector.tsx` to open review, retain review/file context,
  prepare the isolated request-changes draft, and reload after stale rejection.
- Updated `useInspectorCommands.ts` / `.test.tsx` with exact evidence-bound
  approval and review-rejection callbacks.
- Added `packages/desktop/test/reviewPanel.integration.test.tsx` for
  manifest-before-chunk ordering, approval, unified request-change submission,
  stale refresh preservation, keyboard order, and mutation-envelope privacy.

## Errors / Corrections

- Fresh `bun run test:coverage` executed 334 tests with zero failures and
  reported 92.34% functions / 93.41% lines overall, but exited 1 on inherited
  unrelated per-file floors. Examples include `workflowApiServer.ts`,
  `main.ts`, `StageSetupModal.tsx`, and existing workflow-board surfaces.
- Task 13's new review surfaces clear the required floor in that full run:
  `ReviewPanel.tsx` is 80.00% functions / 94.40% lines, `DiffViewer.tsx` is
  100.00% / 89.61%, `CardInspector.tsx` is 86.67% / 98.88%, and
  `useInspectorCommands.ts` is 100.00% / 97.87%.
- The exact `bun run verify` gate passes typecheck and acceptance, then exits 1
  only when it reaches that inherited per-file coverage failure.
- The packaged Electrobun build passes, but native lifecycle capture cannot run:
  Task 17 owns `test/native/runLifecycleCapture.ts`, its fixtures, and artifact
  directory, and those surfaces do not exist yet. No product-owner waiver was
  supplied.
- Because repository verification is not clean and native packaged evidence is
  unavailable, Task 13 remains pending. Tracking checkboxes/status and the
  automatic commit were intentionally not produced.

## Ready for Next Run

- Focused Task 13 behavior, the complete 334-test run, desktop acceptance,
  typecheck, packaged build, root self-check, scope-only diff checks, privacy
  scan, and packet validation are green.
- Resume closure only after the inherited per-file coverage gate is fixed or
  explicitly waived and Task 17's native lifecycle harness can produce the
  required packaged evidence (or the product owner explicitly waives it).
