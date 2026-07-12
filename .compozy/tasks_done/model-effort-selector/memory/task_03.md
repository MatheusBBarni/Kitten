# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Adapter gains live `setSessionConfigOption(sessionId, configId, value): Promise<ConfigOption[]>` and captures `newSession.configOptions` (currently discarded), emitting an initial `config_options` event via the existing `emit` path. Session stays live on switch.

## Important Decisions
- newSession emits `config_options` ONLY when the ACP response includes a `configOptions` field (`!= null`). Absent field (agent lacks the capability) → no emit; the reducer default `[]` already covers it. An explicit empty `[]` from the agent → empty event (no fabrication). This keeps existing exact-events tests green while satisfying both unit tests.
- `setSessionConfigOption` mirrors `cancel`: it awaits the SDK call and propagates (throws) on transport failure; the controller action (task_05) is the existing error path that catches → `onError`, so it never rejects into the UI/React tree. It does NOT emit `status: "error"` (a switch failure is not a session crash in the confirmed-state model). No config-corrupting event is emitted on failure.
- Value passed as plain string → matches the SDK request union's select branch `{ value: SessionConfigValueId }`; no explicit SDK request-type import needed.

## Learnings
- `translateConfigOptions` was module-private in `acpTranslate.ts` (task_02); exported it for reuse by both the `setSessionConfigOption` response mapping and `newSession` capture.
- Emitting an empty event on EVERY newSession would break existing exact-`events` assertions (e.g. "full prompt turn"). Gating on `configOptions != null` avoids that.

## Files / Surfaces
- `src/agent/acpTranslate.ts` (export translateConfigOptions)
- `src/agent/agentConnection.ts` (interface + impl + newSession capture)
- `test/mockAgent.ts` (serve/answer config options + emit config_option_update)
- `src/agent/agentConnection.test.ts` (unit + integration)

## Errors / Corrections
- Adding `setSessionConfigOption` to the interface broke two other stub connections that had to be updated to compile: `src/app/controller.test.ts` (StubConnection) and `src/app/selfCheck.ts` (offline connection). Task_05 owns controller/actions; these were only stubbed to satisfy the interface.
- SDK wraps an agent-thrown `set_config_option` error into a generic "Internal error" over the wire (detail in `data.details`), so the error-path test asserts `.rejects.toThrow()` without a message pattern.

## Ready for Next Run
- Adapter surface done and green (605 pass, typecheck clean, coverage acpTranslate 100% / agentConnection ~96%). task_04 (store/selectors/allowlist) and task_05 (controller seed + action) can build on `setSessionConfigOption` and the `config_options` emit. Remember: allowlist filters by `category`, and codex live-advertisement is still unverified (see shared MEMORY open risk).
