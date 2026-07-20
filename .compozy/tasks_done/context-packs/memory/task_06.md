# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the dedicated generation-bound Context Pack MCP bridge, isolated same-binary child mode, and exact closed tool surface for Task 06.

## Important Decisions

- Keep controller lifecycle orchestration outside this task: the bridge accepts an established route plus injected authorization/capability facades and revalidates them per request.
- Do not import, modify, or stage the unrelated untracked Task 05 materializer; bounded workspace reads are invoked through the injected facade.
- Use a separate `--context-pack-mcp` process mode and Context Pack-only IPC capability; scoped `ask_user` forwards through this route rather than the mixed bridge.
- Expose explicit `revoke` reasons for child settlement, parent generation change, and denied launch; authorization drift also closes the route after returning a generic denial.

## Learnings

- MCP SDK 1.29 publishes object-shaped strict Zod schemas correctly; keeping each tool's top-level schema object-shaped preserves `additionalProperties: false` in `tools/list`.
- Host-side byte validation must verify both the requested cap and returned UTF-8/source byte identity even when the injected materializer facade is expected to enforce the same limits.
- Targeted coverage after the final hardening pass: `contextPackMcp.ts` 81.36% functions / 91.95% lines; `contextPackBridge.ts` 93.48% functions / 98.02% lines.

## Files / Surfaces

- Added `src/agent/contextPackMcp.ts`, `src/agent/contextPackMcp.test.ts`, `src/app/contextPackBridge.ts`, `src/app/contextPackBridge.test.ts`, and `test/contextPackBridge.integration.test.ts`.
- Updated `src/index.ts` and `test/firstRunBoot.test.ts` for the isolated reserved child mode.

## Errors / Corrections

- The workspace already contains broad unrelated dirty state. Task 06 edits and staging must remain narrow.
- Initial authorization-denial cleanup closed the socket before its generic error frame could be sent; cleanup now occurs immediately after the denial response.
- Self-review tightened raw scoped-question validation, absolute workspace roots, bounded draft summaries, and returned workspace-byte verification before the final gate.
- Staged-diff review found an accidental type-only dependency on the untracked Task 05 materializer contract; the registrar now owns its closed workspace-read types so the Task 06 commit is self-contained.
- The first final full-suite run hit one unrelated Markdown renderer test failure; that test passed in isolation, and the immediately repeated full repository gate passed cleanly.

## Ready for Next Run

- Implementation and self-review are complete. Final fresh verification passed after the last correction: targeted coverage kept both Task 06 production files above 80%; `bun run typecheck && bun test` passed with 2,713 tests, 4 opt-in skips, and 0 failures; `bun run selfcheck` reported `SELF-CHECK OK`.
- Later controller lifecycle work should construct the facade from the AppStore/materializer/clarification seams and call `revoke` on the documented terminal events.
