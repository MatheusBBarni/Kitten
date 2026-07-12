# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add capability-gated OSC 8 provenance to referenced-file rows only, preserving every visible keep/drop, highlight, reason, summary, and diff behavior.

## Important Decisions

- Use OpenTUI's renderer `capabilities.hyperlinks` flag and native React `<a href>` metadata; Kitten will not emit escape bytes.
- Keep the capability-to-target mapping in an exported pure helper so link metadata can be verified without relying on captured spans.

## Learnings

- OpenTUI 0.4.3 exposes terminal support at `renderer.capabilities?.hyperlinks`, renders links through `<a href>`, and provides `setRendererCapabilities` in the test package.
- The full coverage run passes 976 tests and reports 97.32% functions / 98.70% lines overall; `HandoffPreview.tsx` reports 100% functions / 97.81% lines.

## Files / Surfaces

- `src/ui/HandoffPreview.tsx`: capability read, pure `fileProvenanceTarget`, and optional `<a href>` metadata for referenced-file rows only.
- `src/ui/HandoffPreview.test.tsx`: helper tests, supported/unsupported frame coverage, full-preview provenance assertion, and kept/dropped color/reason assertions.

## Errors / Corrections

- Baseline targeted preview test passes but emits the inherited `theme_mode` listener warning and TreeSitter-destroyed fallback warnings; the final gate must be warning-free before completion or commit.
- Fresh `bun run typecheck && bun test && bun run selfcheck` exits 0 with 976 passing tests and `SELF-CHECK OK`, but still emits the inherited warnings. Per the verification contract, task status/checklists remain pending and no commit was created.

## Ready for Next Run

- Implementation and task-specific evidence are in the working tree. Re-run the full gate after the inherited OpenTUI warnings are resolved or explicitly waived; only then update task tracking and commit.
