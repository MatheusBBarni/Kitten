# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Classify only exact bundled `kitten-ask-user` failed-tool envelopes at the ACP adapter boundary while retaining no provider text or transport metadata.

## Important Decisions

- `AgentConnectionImpl` owns the private eligible tool-call ID set because ACP updates can omit titles; pure envelope parsing remains in `acpTranslate.ts`.
- A full `tool_call` replaces any prior eligibility for the same ID, and only titles with the non-empty `mcp.kitten-ask-user.` prefix are eligible.
- Terminal `completed` and `failed` updates are translated before eligibility is removed so the terminal envelope can still be classified.
- Classification additionally requires the ACP tool update to be terminally `failed`; matching content on `in_progress` or `completed` updates remains generic.

## Learnings

- Pre-change baseline: an exact bundled failed `busy` envelope translates to a generic tool call with no `failureKind` and `diff: null`.
- ACP tool result text is represented as one `ToolCallContent` item with `type: "content"` wrapping a text `ContentBlock`.
- Fresh focused verification passes 152 tests across `acpTranslate.test.ts` and `agentConnection.test.ts`.
- Fresh coverage verification passes 2,541 tests with 4 credential-gated skips and 0 failures; repository coverage is 97.17% functions / 98.22% lines, with `acpTranslate.ts` at 100% / 99.08% and `agentConnection.ts` at 97.22% / 99.72%.

## Files / Surfaces

- Touched: `src/agent/acpTranslate.ts`, `src/agent/acpTranslate.test.ts`, `src/agent/agentConnection.ts`, and `src/agent/agentConnection.test.ts`.

## Errors / Corrections

- Self-review tightened classification from status-agnostic parsing to explicit `status === "failed"` and added negative coverage for in-progress and completed updates.
- The required aggregate gate `rtk bun run typecheck && rtk bun test && rtk bun run selfcheck && rtk bun run build` is red before selfcheck/build because `Markdown > registers capabilities on a direct multi-block mount before code rendering` fails only in the 138-file aggregate run. It failed twice with 2,540 passing tests; the isolated test and all 40 tests in `src/ui/Markdown.test.tsx` pass, and the earlier coverage-wide run passed all 2,541 non-gated tests. No Markdown files are touched by this task.

## Ready for Next Run

- Implementation and task tests are ready for finalization, but do not mark task complete or commit automatically until the inherited aggregate Markdown gate is green or the user authorizes an exception.
