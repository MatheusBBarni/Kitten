# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the conversation-first desktop inspector and direct composer contract,
  including controlled attempt selection, evidence summaries, durable delivery
  feedback, safe drafts, and streamed-refresh scroll preservation.

## Important Decisions

- Consume the existing host inspector, queue-v2, review-manifest, and
  `submitCardPrompt` authorities; do not create renderer-owned transcript or
  lifecycle state.
- Reuse `submitCardPrompt` for explicit retry: an ambiguous delivery
  terminalizes and releases the old attempt, so the restored text is admitted
  as a new initial attempt only after the user retries.
- Extend the bounded card-inspector projection with review-evidence identity
  only, then load manifest file summaries through TanStack Query. Diff chunks
  remain untouched until review opens.
- Keep scroll following renderer-local: follow on initial load, near-end reads,
  or durable submission acceptance; otherwise retain the exact upward
  `scrollTop` across revision refresh.

## Learnings

- The pre-change inspector tests are green (24 focused tests), but only cover
  basic hierarchy and immediate-send copy; the task contract is largely
  uncovered.
- The inspector projection currently omits review-evidence identity, so the
  renderer cannot load manifest-only changed-file summaries for the producing
  attempt.
- An interrupted queue does not need a new RPC discriminator; the old attempt
  is terminal and explicit retry belongs to the normal initial-admission path.
- The generic projection boundary blocked the existing attention
  `form.prompt`; permit that exact typed inspector path while retaining the
  repository-wide rejection of arbitrary `prompt` keys.
- Focused verification is green: 59 tests cover timeline, composer, attention,
  inspector integration, view-store selection, RPC safety, and ACP inspector
  projection behavior.
- Desktop coverage executes 316 tests without failures and reaches 93.44%
  overall line coverage. The repository command remains red on inherited
  per-file thresholds; Task 12 surfaces meet the threshold after removing two
  unused default callback closures from the composer.
- Fresh root typecheck, desktop build, TUI self-check, and root build are green.
  The root unisolated test command exposed one suite-order failure in the
  prerequisite board-workbench refresh test (315/316 desktop tests); the exact
  test passes immediately in isolation.
- Packaged native lifecycle capture is not executable yet: Task 17 owns the
  harness and its declared `test/native` files and package commands are absent.
  ADR-006 therefore keeps this task partial without a product-owner waiver.

## Files / Surfaces

- `packages/desktop/src/attempts/inspectorProjection.ts`
- `packages/desktop/src/attempts/activityIngestor.ts`
- `packages/desktop/src/renderer/features/inspector/AttemptTimeline.tsx`
- `packages/desktop/src/renderer/features/inspector/PersistentComposer.tsx`
- `packages/desktop/src/renderer/features/inspector/CardInspector.tsx`
- `packages/desktop/src/renderer/features/inspector/useInspectorCommands.ts`
- `packages/desktop/src/renderer/features/inspector/AttentionBlockerPanel.tsx`
- Colocated renderer tests plus
  `packages/desktop/test/attempt-inspector.integration.test.ts` and the shared
  RPC boundary in `packages/desktop/src/shared/rpc.ts`.

## Errors / Corrections

- Existing dirty renderer and host changes belong to prerequisite tasks and
  must be preserved; stage only the Task 12 delta if verification permits a
  commit.
- Initial inspection suggested a missing host retry command. Tracing terminal
  dispatch behavior showed the runtime is released, so adding such a command
  would have been unnecessary scope expansion.
- Do not update Task 12 tracking or create the automatic commit: repository
  coverage, the unisolated root test gate, and packaged native verification are
  not all clean.

## Ready for Next Run

- Re-run the Task 12 focused suite after any shared-tree changes.
- Resolve or waive the inherited per-file coverage gate and the native capture
  dependency, then re-run exact `verify` and root test gates before tracking or
  committing.
