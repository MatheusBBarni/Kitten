# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implemented and verified the SDK-free MCP config domain, strict stdio-only parsing, normalization, defaults, and merge behavior.

## Important Decisions

- The on-disk entry accepts an optional literal `type: "stdio"`; normalization drops that transport marker and emits only the domain fields.
- `command`, `args`, and `env` remain required structural fields. A `url`, non-stdio `type`, or other nested key fails through the strict schema with the server name in the issue path.

## Learnings

- Making `AppConfig.mcpServers` required surfaced 13 explicit test fixtures outside the loader suite; each now declares an empty list so compile-time config construction stays honest.
- The full coverage run reports 96.95% functions and 98.21% lines overall; `src/config/configLoader.ts` is at 100% for both.

## Files / Surfaces

- Domain and loader: `src/core/types.ts`, `src/config/configLoader.ts`.
- Behavioral coverage: `src/config/configLoader.test.ts`.
- Compile-contract fixtures: controller, readiness, UI integration fixtures, session-status integration, and shell-runtime integration.

## Errors / Corrections

- The first typecheck failed only because explicit `AppConfig` fixtures lacked the newly required field; production code and loader tests were already green. Added `mcpServers: []` to those fixtures and reran all gates.

## Ready for Next Run

- Implementation and self-review are complete. Fresh gate: `bun run typecheck && bun test` with 1,238 passing, 0 failing, and the existing opt-in reload probe skipped.
- Source and test changes were committed locally as `e17c2ab` (`feat: add MCP config schema and normalization`); task memory and tracking remain outside the commit by workflow policy.
