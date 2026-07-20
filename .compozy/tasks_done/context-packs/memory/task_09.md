# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add one optional whole immutable sealed Context Pack to the existing handoff preview/confirm flow, with source-identity-only deduplication and fresh Recipient Fit at attach and final confirm.

## Important Decisions

- Model attachment cardinality as one optional handoff field; add/remove operates on that whole value and never exposes sealed sub-block edits.
- Keep ordinary handoff items in the bundle and apply deduplication only while the attachment is included. Removing the attachment therefore restores ordinary items without reconstructing or rewriting either source.
- Carry independently resolved ordinary-item source identities and compare exact identity strings only. A matching path without a matching identity remains visible.
- Discard any identity pre-populated by an injected assembler; only the controller-owned filesystem resolver may authorize deduplication. Also strip assembler-injected attachments so every sealed value enters through the fresh-fit path.
- Treat the sealed payload string as the prompt block itself. Handoff composition does not trim, redact, parse, or reserialize it.
- Preserve the existing target picker and confirmation flow. Initial failed fit excludes the optional attachment; a failed final recheck keeps the already combined preview open and sends nothing.
- Keep the two new controller methods optional at the interface boundary for legacy/manual test fixtures; the handoff path treats absence as unavailable evidence and therefore fails closed.

## Learnings

- The task-08 controller already owns exact sealed custody and a private arbitrary-target Recipient Fit evidence helper; task 09 can expose a narrow handoff-specific assessment without widening UI agent authority.
- Existing handoff begin/target selection is synchronous, so ordinary source identities must be resolved synchronously at the controller/application boundary rather than moving filesystem work into the pure assembler.
- Ordinary file identity uses the same realpath containment plus `dev:ino` vocabulary as Context Pack materialization. Pending handoff diffs use a distinct `diff:pending:` prefix, so they deduplicate only against an exact matching sealed source identity.

## Files / Surfaces

- Implemented: `src/core/types.ts`, `src/core/bundleAssembler.ts`, `src/app/handoff.ts`, `src/app/controller.ts`, `src/ui/HandoffPreview.tsx`, `test/fakeController.ts`, and the canonical core/app/controller/UI test suites.
- Coverage includes cardinality, independently resolved identity deduplication, same-path/different-identity retention, spoofed-identity rejection, exact-byte/no-redaction custody, whole-pack UI removal/restoration, initial and final fit failures, one-send confirmation, and a real-controller handoff integration.

## Errors / Corrections

- Baseline `rg` for attachment/exclusion vocabulary returned exit 1: task 09 has no implementation yet.
- The worktree contains many unrelated tracked and untracked edits. Preserve them and stage only task-owned paths/hunks.
- One UI test initially failed because its assertion referenced an undefined marker constant. The production behavior was correct; the assertion now uses the intended literal and passes.
- Typecheck initially exposed older/manual `SessionController` fixtures that do not implement task-09 suppliers. The interface was corrected to optional suppliers while application behavior remains fail-closed when either supplier is absent.

## Ready for Next Run

- Completed implementation and self-review with the invariant intact: one exact sealed value may suppress only ordinary blocks with the same independently resolved identity, and failed final fit preserves the unsent preview.
- Fresh targeted coverage passed 352 tests; the repository coverage gate passed 2,744 runnable tests with 4 credential-gated skips and enforced the 80% threshold. `HandoffPreview.tsx` reported 100% function and 98.10% line coverage.
- Fresh broad verification passed typecheck and all 2,744 runnable tests with the same 4 credential-gated skips. The headless self-check reported `SELF-CHECK OK`, and `build:local` compiled `dist/kitten-darwin-arm64` successfully.
- Existing non-blocking warning: the site scaffold test reports that `NO_COLOR` is ignored while `FORCE_COLOR` is set.
- Task tracking is complete. Keep task/memory tracking files out of the automatic commit and stage only Task 09 source/test hunks because the worktree contains unrelated edits.
- Local implementation commit created as `cb22d1b` (`feat: compose sealed Context Packs into handoffs`); nothing was pushed.
