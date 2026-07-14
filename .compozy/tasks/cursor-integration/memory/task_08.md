# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add a real opt-in Cursor ACP lifecycle contract while preserving the empty production certification list until reviewed native evidence exists.

## Important Decisions

- The disabled harness returns before resolving the built-in recipe, probing `agent --version`, or constructing a connection.
- Initial certification takes an exact semantic-version candidate from the opt-in run environment, then requires the observed native version and full built-in `agent acp` recipe to match it before evidence can be emitted.
- Permission evidence is request-driven because ACP advertises auth methods but does not advertise permission support; any received request is cancelled through `AgentConnection.onPermission` and recorded only as booleans.
- The absent local `agent` prerequisite means this run must leave the production certified-profile list empty unless that external state changes.

## Learnings

- The current ACP SDK exposes authentication choices through `initialize.authMethods`; permission handling is an agent-to-client request whose safe terminal response is `cancelled`.
- Focused contract/config tests pass with 85 tests and one intentionally skipped native contract; repository coverage passes with 1,733 tests, three opt-in skips, 97.29% function coverage, and 98.16% line coverage.
- The fresh typecheck, full test suite, self-check, and compiled build all exit successfully. The full suite still emits the inherited `NO_COLOR`/`FORCE_COLOR` warning from `site/test/scaffold.test.ts`.
- `agent` is not installed or discoverable in this environment, so no reviewed native lifecycle evidence exists and no exact production version can be committed.

## Files / Surfaces

- Added `test/cursorAcp.contract.test.ts` for the gated real lifecycle plus dependency-injected fail-closed, timeout, disposal, authentication, version, recipe, permission, and evidence tests.
- Updated `src/config/configLoader.ts` with exact recipe-and-version profile matching while keeping the production certification list empty.
- Updated `src/config/configLoader.test.ts` with altered command, ordered-argument, environment, and version fail-closed coverage.
- Updated this task-local memory only; shared workflow memory did not need promotion.

## Errors / Corrections

- The first evidence-privacy assertion treated the allowed boolean field name `promptCompleted` as prompt content. The assertion now checks forbidden payload values and sensitive key classes while retaining the required content-free boolean.
- Do not mark the task complete or commit while the native contract is skipped; successful simulated/unit coverage is not certification evidence.

## Ready for Next Run

- Install and authenticate a Cursor CLI that supports `agent --version`, `agent acp`, and `cursor_login`.
- Run `KITTEN_CURSOR_ACP_CONTRACT=1 KITTEN_CURSOR_ACP_CANDIDATE_VERSION=<exact-semver> bun test test/cursorAcp.contract.test.ts` with the observed version supplied exactly, then review the emitted content-free evidence.
- Only after a reviewed full pass, add that exact version to the production certification list, rerun all gates without warnings, update task/master tracking, and create the automatic local commit.
