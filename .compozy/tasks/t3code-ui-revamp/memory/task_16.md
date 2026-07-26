# Task Memory: task_16.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Apply the restrained T3-inspired visual hierarchy to the integrated desktop
  supervision shell, with three labelled wide regions and one focused narrow
  surface that restores the preserved board context.

## Important Decisions

- Treat the existing renderer token layer as the design authority; no
  `DESIGN.md` or separate copy authority exists in the repository.
- Keep Task 16 focused on automated responsive-shell structure and compiled
  styling. The packaged native lifecycle matrix remains the downstream Task 17
  and release gate.
- Replace the modal-as-default workbench with an in-flow labelled region.
  Narrow mode hides the preserved board landmark from the accessibility tree
  and exposes an explicit `Back to board` action instead of creating a second
  modal navigation layer.
- Pin the visual direction at restrained product chrome, utility-only motion,
  and high information density. Color always remains paired with status text.
- Use `(max-width: 55.999rem)` as the renderer-owned narrow shell boundary.
  Resizing changes only `workbenchMode`; board, card, attempt, review, and
  draft selections stay in the existing renderer-local store.

## Learnings

- The pre-change shell always mounts `CardInspector` as a right-side HeroUI
  drawer and narrow CSS stacks the project sidebar above the board. Neither
  shape satisfies Task 16's wide three-region or narrow one-surface contract.
- The worktree contains the intentionally uncommitted prerequisite stack from
  Tasks 1-15. Task 16 changes must be isolated by exact paths and hunks.
- Earlier task runs record an inherited desktop per-file coverage gate failure;
  focused evidence and the repository-wide gate must be reported separately.
- Happy DOM's default viewport resolves to the wide shell. Responsive
  integration coverage needs a controllable `matchMedia` test seam rather than
  directly mutating `workbenchMode`, because the shell now derives that mode.
- The supported `styles:build` command emits the semantic status utilities,
  focus-visible variants, and both Tailwind and base reduced-motion rules into
  `generated.css`; the generated file remains command-owned.
- The authoritative `bun run verify` now executes all 360 isolated coverage
  tests successfully and reports 92.38% function / 93.10% line coverage
  overall, but exits non-zero on the repository's 80%-per-file policy.
  Inherited low-coverage files remain, and Task 16 surfaces below the per-file
  threshold are `WorkflowBoard.tsx`, `WorkflowBoardContainer.tsx`, and
  renderer `main.tsx`.
- A fresh `bun run build` succeeds and regenerates Tailwind output before the
  Electrobun build. The focused Task 16 suite passes 47/47.

## Files / Surfaces

- Touched surfaces: `styles.css`, command-generated `generated.css`, `main.tsx`,
  `WorkflowBoardContainer.tsx`, `useResponsiveShellMode.ts`,
  `ProjectSidebar.tsx`, `WorkflowBoard.tsx`, `CardInspector.tsx`, their focused
  renderer tests, and `test/cardInspectorRenderer.integration.test.ts`.
- `ReviewPanel.tsx` also gained a controlled/uncontrolled selected-file
  fallback after full verification exposed that its existing tests could not
  select a file when `selectedFileId` was omitted.

## Errors / Corrections

- Repository shell commands must use the `rtk` prefix. The initial read-only
  skill preflight used raw `sed`; all subsequent commands use `rtk`.
- Existing tests treated the workbench as an ARIA dialog and sometimes fired
  the review shortcut before its manifest-backed action existed. Assertions
  now target the labelled complementary region and wait for `Open review`
  before exercising the command.
- The first post-fix coverage run transiently lost `git` inside two review
  fixture tests; an isolated rerun passed 13/13. A final full `verify` rerun
  passed all tests and failed only the deterministic per-file coverage gate.
- Do not mark Task 16 complete, update task tracking, or create the automatic
  commit until the authoritative verification command exits zero.

## Ready for Next Run

- Implementation and focused regressions are present in the shared dirty
  prerequisite stack. The remaining blocker is raising every red file in the
  desktop coverage report to the repository's 80% per-file threshold without
  expanding Task 16 silently.
