# Task Memory: task_14.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a default-off, local-only, content-free workflow measurement boundary with
  closed versioned events, bounded persistence/aggregates, isolated host hooks,
  and a revision-fenced accessible Settings control.

## Important Decisions

- Preserve `LifecycleDiagnostics` for required operational recovery evidence.
  Optional product measurement uses a separate sink so opt-out cannot suppress
  recovery diagnostics.
- Reuse the existing revision-fenced `updatePreferences` Settings command for
  the measurement boolean; the host callback flips the recorder immediately
  only after a successful settings commit.
- Use schema version 1 with exact-key validation and fixed event, outcome,
  reason, fixture, duration, count, and byte-bucket catalogs. Reject unknown
  fields and non-plain objects without reflecting rejected content in errors.
- Create one default-off recorder in `main.ts`, persist accepted rows only to a
  private local JSONL file under Electrobun user data, and inject the same sink
  into supervision, prompt, review, and safe-boundary dispatch hooks.
- Remove the older open-ended follow-up telemetry callback from
  `attemptCoordinator.ts`; safe-boundary outcomes now use the closed
  measurement schema.

## Learnings

- The pre-change tree has no `workflowMeasurement.ts`; Settings currently
  projects only the theme preference, and existing lifecycle diagnostics cover
  recovery/review operations rather than opt-in product measurement.
- The worktree contains extensive uncommitted changes from prior tasks,
  including `desktopCoordinator.ts`, `lifecycleDiagnostics.ts`, and
  `renderer/client.ts`. Task 14 must preserve and compose with those edits.
- Focused typecheck and 67 Task 14-adjacent tests pass. The full desktop
  acceptance suite also passes.
- The fresh full `verify` run passes typecheck and all 348 tests, then exits 1
  only at the inherited 80%-per-file coverage gate. Overall coverage is 92.35%
  functions / 93.34% lines. Task 14 surfaces exceed the target:
  `lifecycleDiagnostics.ts` 90.91% / 99.54%,
  `workflowMeasurement.ts` 100% / 98.80%, `boardRpc.ts` 100% / 97.87%,
  `desktopRpc.ts` 100% / 81.20%, `settingsRpc.ts` 100% / 89.87%,
  `SettingsView.tsx` 90% / 100%, `useSettingsController.ts` 100% / 100%,
  and `attemptCoordinator.ts` 91.43% / 99.58%.
- `bun run build` and `compozy tasks validate --name t3code-ui-revamp` are
  green; the packet validator reports all 17 tasks valid.

## Files / Surfaces

- Schema and recorder:
  `packages/desktop/src/host/lifecycleDiagnostics.ts`,
  `packages/desktop/src/host/workflowMeasurement.ts`, and their tests.
- Host hooks and composition:
  `packages/desktop/src/host/boardRpc.ts`,
  `packages/desktop/src/host/desktopRpc.ts`,
  `packages/desktop/src/attempts/attemptCoordinator.ts`, and
  `packages/desktop/src/main.ts`.
- Settings:
  `packages/desktop/src/shared/desktopRpc.ts`,
  `packages/desktop/src/host/settingsRpc.ts`,
  `packages/desktop/src/renderer/settings/useSettingsController.ts`,
  `packages/desktop/src/renderer/settings/SettingsView.tsx`, and associated
  host, renderer, and integration tests.
- Cross-flow coverage:
  `packages/desktop/test/workflowMeasurement.integration.test.ts`.

## Errors / Corrections

- The home-level `.agents/skills` mirror did not contain the required workflow
  skills; the authoritative repo-local copies are under `.agents/skills`.
- The full coverage gate remains red on inherited out-of-scope files including
  `desktopCoordinator.ts`, `workflowApiServer.ts`, `main.ts`,
  `StageSetupModal.tsx`, `WorkflowBoard.tsx`,
  `WorkflowBoardContainer.tsx`, `useWorkflowBoardController.ts`, and
  `TaskEditModal.tsx`. Do not broaden Task 14 to repair those files.

## Ready for Next Run

- Task 14 implementation and scoped verification are ready, but task status and
  checkboxes must remain pending and no automatic commit may be created until
  the repository-defined full coverage gate is clean.
