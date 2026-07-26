# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the renderer-owned cross-project Work Inbox on top of the authoritative
  supervision query, preserving existing repository/board navigation and the
  Task 10 board/workbench return-context contract.
- Required evidence includes grouped rendering/filtering/accessibility unit
  coverage plus cross-project selection, refresh recovery, single-query
  invalidation, and responsive selection integration coverage.

## Important Decisions

- Treat the host-provided group order, counts, and item order as display truth;
  the renderer may filter within each group but must not reprioritize items.
- Preserve the heavily dirty shared worktree and edit only the Task 11 seam;
  overlapping Task 10/query/store files require diff-aware changes.
- The frozen content-free `SupervisionItem` contract exposes durable board/card
  identities but no titles or repository paths. Join repository/board labels
  from `WorkspaceProjection`, use the durable card identity as the card label,
  and do not reopen Task 05 RPC scope.
- Key selection, React rows, and focus targets by the durable board/card pair,
  not card ID alone. Keep an unmatched supervision row visible with explicit
  repository/navigation-unavailable text and disable navigation until workspace
  identity catches up.
- Keep review-evidence availability as text on every row. An unavailable
  evidence state still opens the card workbench but exposes no review action in
  the inbox.

## Learnings

- The repository currently has uncommitted work from Tasks 01-10, including
  modifications to the Task 11 controller/container/query/view-store
  dependencies.
- The workflow-wide desktop coverage gate is already known to fail per-file on
  inherited surfaces; Task 11 still requires fresh focused and full-gate
  evidence before its status or commit can change.
- A single TanStack supervision query plus projection/attempt invalidation is
  sufficient; the renderer performs no per-board supervision reads.
- Existing sidebar pin/archive/hide/name preferences can scope displayed inbox
  rows without changing authoritative host counts or order.

## Files / Surfaces

- `packages/desktop/src/renderer/features/board/ProjectSidebar.tsx`
  - Added grouped Work Inbox rendering, shared project/board/card search,
    authoritative counts/order, evidence/actionable-time labels, explicit
    loading/unavailable/empty/filtered states, keyboard semantics, durable
    selection identity, and preference scoping.
- `packages/desktop/src/renderer/features/board/ProjectSidebar.test.tsx`
  - Added group/order/count, filtering, state, evidence, keyboard/current,
    unmatched-identity, and preference coverage.
- `packages/desktop/src/renderer/features/board/useWorkflowBoardController.ts`
  - Consumes the single supervision query and exposes typed renderer state.
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.tsx`
  - Opens inbox items through the existing workbench store contract while
    recording/restoring board context and preserving narrow mode.
- `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.test.tsx`
  - Added cross-project open, anchor, refresh, missing-card recovery,
    responsive-selection, and no-N+1 integration coverage.
- `packages/desktop/src/renderer/query/desktopQueries.ts`
  - Added the supervision query key/options and invalidation.
- `packages/desktop/src/renderer/query/desktopQueries.test.ts`
  - Added supervision binding, fallback, and invalidation assertions; this
    untracked file also contains pre-existing Task 10 evidence-query tests.

## Errors / Corrections

- Corrected inbox current state and focus IDs from card-only identity to
  board/card identity after self-review found cross-board collision risk.
- Corrected the transient supervision/workspace mismatch so a row cannot expose
  an enabled no-op navigation control.
- Fresh focused verification passes:
  - `rtk bun run typecheck`
  - `rtk bun test src/renderer/features/board/ProjectSidebar.test.tsx src/renderer/features/board/WorkflowBoardContainer.test.tsx src/renderer/query/desktopQueries.test.ts`
  - Result: 26 pass, 0 fail, 126 assertions.
- Fresh broad non-coverage gates pass:
  - `rtk bun run build`
  - `rtk compozy tasks validate --name t3code-ui-revamp`
  - Packet result: all tasks valid, 17 scanned.
- Fresh `rtk bun run verify` executes 305 tests with 0 failures and reports
  92.34% function / 93.28% line coverage overall, but exits 1 because inherited
  per-file thresholds remain red. Task 11's `ProjectSidebar.tsx` is
  91.38%/98.53% and `desktopQueries.ts` is 95.65%/93.60%; inherited large files
  including `workflowApiServer.ts`, `main.ts`, `WorkflowBoardContainer.tsx`,
  `useWorkflowBoardController.ts`, and older modal surfaces remain below 80%.
- Coverage isolation also emits existing asynchronous DnD `act(...)` warnings;
  there are no test failures.
- The packaged native lifecycle matrix remains assigned to pending Task 17;
  Task 11 did not create browser artifacts or misreport automated DOM coverage
  as native proof.

## Ready for Next Run

- Implementation and self-review are complete, but Task 11 must remain pending:
  do not update task/master checkboxes and do not auto-commit until the
  repository's per-file coverage gate is clean.
- Preserve all other dirty Task 01-10 work. When the gate is repaired, rerun
  focused tests, `rtk bun run verify`, build, packet validation, then stage only
  understood Task 11 hunks because several files overlap prior tasks.
