# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Done. `config_option_update` now translates to the `config_options` domain event; other dropped variants still return `null`.

## Important Decisions

- Absent ACP `category` maps to `""` (kept opaque; the visible-category allowlist lives above the adapter, ADR-004).
- Boolean options are skipped in `translateConfigOptions` via `option.type !== "select"` (also drops any future non-select variant).
- Grouped select options (`SessionConfigSelectGroup`) are flattened into a single ordered `{value,name}` list - V1 has no group UI.

## Learnings

- ACP `SessionConfigOption` is a discriminated union on `type: "select" | "boolean"`; select `options` is `SessionConfigSelectOption[] | SessionConfigSelectGroup[]` (detect group via absence of `"value"` key).
- `ConfigOptionUpdate.configOptions` carries the full set (not a delta).

## Files / Surfaces

- `src/agent/acpTranslate.ts` - added `config_option_update` case + `translateConfigOptions`/`flattenSelectOptions` helpers; imports SDK config types.
- `src/agent/acpTranslate.test.ts` - config-options describe block incl. reducer round-trip; added `plan_update`/`usage_update` to the still-dropped it.each.

## Errors / Corrections

- Test fixtures for `plan_update`/`usage_update` needed correct SDK shapes: `plan: {type:"markdown",planId,content}` and `{used,size}` (not `entries`/`inputTokens`).

## Ready for Next Run

task_03 adds `AgentConnection.setSessionConfigOption` + captures `newSession.configOptions`, feeding the same `config_options` event. Extend `test/mockAgent.ts` for the round-trip.
