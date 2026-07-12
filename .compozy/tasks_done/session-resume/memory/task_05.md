# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add an opt-in real-adapter reload confirmation phase to `selfcheck`, with one honest capability/replay verdict for every resolved configured session.

## Important Decisions

- Keep plain `--self-check` process-free for compiled-artifact and default-suite coverage; make `bun run selfcheck` pass an explicit `--reload-probe` flag for the manual/nightly real-adapter gate.
- Count only replayed conversation/history domain events (`user_message`, `agent_message`, `tool_call`, or `plan`) as confirmation; status/config/branch notifications cannot turn an empty reload into a pass.
- Seed the newly created ACP session with one deterministic short prompt before disposing it, so a reload has history that must be replayed.

## Learnings

- The worktree already contains overlapping, uncommitted self-check highlighting work in `src/app/selfCheck.ts` and `src/app/selfCheck.test.ts`; preserve it and audit commit scope before staging.
- Task 04's `loadSession` and `ReadyState.canLoadSession` implementation is present in the worktree and its task file is completed, although `_tasks.md` intentionally remains a topology-only pending table.
- The opt-in ACP-wire integration confirms both configured fake agents through separate `AgentConnection` instances; the default suite skips this file unless `KITTEN_RELOAD_PROBE_INTEGRATION=1`.
- The manual real-adapter run confirmed Codex replay, while Claude failed before reload because the organization disables Claude Code subscription access; this is an environment/auth result, not evidence that Claude replay is absent.

## Files / Surfaces

- Touched: `src/app/selfCheck.ts`, `src/app/selfCheck.test.ts`, `src/index.ts`, `test/firstRunBoot.test.ts`, `test/reloadProbe.integration.test.ts`, `package.json`, and `README.md`.

## Errors / Corrections

- Baseline search found no reload-probe result types or the required `reload confirmed`, `capability absent`, and `reload failed` output phrases.
- `bun run selfcheck` exited 1: Claude reported `loadSession=true` but prompt creation was blocked by the organization's disabled subscription access; Codex reported `loadSession=true` and `reload confirmed`.
- Fresh `bun run typecheck && bun test` exited 0 with 1019 pass / 1 opt-in skip / 0 fail, but emitted the pre-existing OpenTUI `theme_mode` listener warning, so verification is not warning-free.
- `bun test --coverage` exited 0 with 98.50% lines overall and 87.16% lines for `src/app/selfCheck.ts`, while emitting the same inherited listener warning.

## Ready for Next Run

- Implementation, documentation, unit tests, opt-in ACP integration, typecheck, coverage, and build are present.
- Re-run `bun run selfcheck` after Claude Code access is enabled (API key or admin policy); both adapter lines must confirm before the Phase-1 go/no-go gate is green.
- Do not mark task 05 complete or auto-commit until the repository verification gate is warning-free and the real adapter probe is accepted as clean evidence.
