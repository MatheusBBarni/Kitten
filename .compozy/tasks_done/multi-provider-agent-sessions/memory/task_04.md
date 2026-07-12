# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Extend `SessionStatus` with `finished`/`error`, map ACP stop reasons + failures in the adapter, add `needsAttention`/`selectSessionList`/`selectNextNeedy`, and add strip labels + theme tones. Build order step 4 (ADR-006). Depends on task_01 (done).

## Important Decisions
- Renamed `AgentStatus` -> `SessionStatus` (techspec Core Interfaces + ADR-006 name it that; task_01 already did the AgentId->ProviderKind rename). Small blast radius (types, theme, selectors, agentConnection, StatusStrip).
- `needsAttention` defined canonically in `core/types.ts` (pure domain predicate over SessionStatus, matches techspec Core Interfaces literal) and re-exported from `selectors.ts` (ADR-006/task list it there).
- `selectNextNeedy` sort: primary = status rank (awaiting_approval 0 < error 1 < finished 2), secondary = circular distance from the pivot session (wrap-around), so it is truly "next after focused". Excludes the pivot session itself. Returns null when no session is needy.
- `selectSessionList` returns `{ id, title, providerKind, status, needsAttention }[]` in `order` (richer than bare status so task_05 overview needs no reselect). New array each call = churns; acceptable for a modal overview.

## Learnings
- Transport ALREADY surfaces a close/exit signal: `AgentTransport.onClose(cb)` backed by `proc.exited` (transport.ts:60, transport.test.ts covers it). It was defined but never wired into `AgentConnection`. So `error` detection needs no new plumbing - just wire onClose -> emit error, guarded by a `closing` flag so intentional dispose() does not emit a false error.

## Files / Surfaces
- src/core/types.ts (SessionStatus, status event, needsAttention)
- src/agent/agentConnection.ts (stop-reason map, prompt-throw error, onClose error, closing flag)
- src/store/selectors.ts (needsAttention re-export, selectSessionList, selectNextNeedy)
- src/ui/StatusStrip.tsx (STATUS_LABELS), src/ui/theme.ts (status tones)
- Tests updated for end_turn->finished: agentConnection.test.ts, controller.test.ts (lines ~736, ~788).

## Errors / Corrections
- `error` tone must differ from `not_ready` tone: `theme.test.tsx` asserts every `palette.status` value is unique. Gave error its own red (dark `#E06C75`, light `#8C1D18`); not_ready keeps `#F26D6D`/`#A32020`. (Semantically distinct: not_ready = never booted, error = crashed mid-run.)

## Ready for Next Run
- task_05 (Ctrl+S overview / jump-to-next): consume `selectSessionList` (returns `SessionListItem[]` = id/title/providerKind/status/needsAttention, in order) and `selectNextNeedy(focusedSessionId)`; add the `jumpToNextNeedy()` action that setFocus to its result (null = no-op).
- task_08 (notifier): key off `needsAttention` transitions; the predicate is in `core/types.ts`, re-exported from `store/selectors.ts`.
- Adapter now emits terminal statuses: `finished` (end_turn/max_tokens/max_turn_requests/refusal), `idle` (cancelled), `error` (prompt throw or unexpected transport close). Any future test that prompts a mock agent to end_turn must expect `finished`, not `idle`.
