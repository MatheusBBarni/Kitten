# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- `src/config/configLoader.ts` (AppConfig defaults + zod-validated user overrides) and `src/config/readiness.ts` (per-agent `initialize`-handshake readiness with distinct not-ready reasons, independent per agent). Tests >=80% coverage incl. integration against the mock ACP agent.

## Important Decisions
- Readiness reason taxonomy: `binary_not_found | handshake_failed | handshake_timeout | capability_mismatch`. Added `handshake_timeout` beyond the task's three modes because an agent that spawns and then blocks on a login prompt would otherwise hang startup forever. Timeout default 15s, injectable.
- `binaryExists` (Bun.which) is only a cheap pre-filter that skips the spawn; the handshake is what actually decides ready. Requirement is "not merely checking the binary exists" - satisfied.
- Readiness probes with a throwaway connection and always `dispose()`s it (finally). task_07's controller spawns its own long-lived connections. A dispose() that throws must not mask the verdict.
- `checkAgentReadiness` never throws; `checkAllAgentsReadiness` = `Promise.all` over already-absorbing probes, so per-agent independence falls out and config order is preserved.
- Config merge is field-level per agent; `env` shallow-merges over the default env, other fields replace. Zod `.strict()` on both levels so a typo'd key errors instead of being silently dropped. Invalid/malformed config throws `ConfigError` rather than silently falling back to defaults.
- Agent ids modeled as explicit object keys (`{"claude-code"?, codex?}`) not `z.record(z.enum(...))` - zod v4 makes an enum-keyed record exhaustive/required.
- `defaultAppConfig()` returns a fresh deep-ish copy per call (args/env cloned) so a caller mutating it cannot poison the next load. Tested.

## Learnings
- Default agent commands are real and verified end-to-end on this machine: `npx -y @agentclientprotocol/claude-agent-acp@0.57.0` and `npx -y @agentclientprotocol/codex-acp@1.1.0` both complete `initialize` at ACP protocol v1. (`@zed-industries/claude-code-acp` is the old, renamed package - do not use.)
- ACP SDK error semantics: an agent throwing a plain `Error` from `initialize` reaches the client as JSON-RPC "Internal error" with the original text buried in `error.data.details`; only a thrown `RequestError` propagates its message. Added `handshakeErrorMessage`/`errorDetails` in `agentConnection.connect()` to unwrap that detail, otherwise every real handshake failure reads as the useless word "Internal error".
- `ndJsonStream`'s writable only implements `write` - it never forwards `close`/`abort` to the sink it wraps. The `close`/`abort` handlers in `spawnAgentTransport` were therefore unreachable dead code (and the sole cause of the repo-wide `bun test --coverage` exit 1: bun's `coverageThreshold` is enforced per file, and transport.ts sat at 77.78% funcs).

## Files / Surfaces
- new: `src/config/{configLoader.ts, readiness.ts, configLoader.test.ts, readiness.test.ts}`
- modified: `src/agent/agentConnection.ts` (export `SUPPORTED_PROTOCOL_VERSION`; unwrap nested handshake error detail), `src/agent/transport.ts` (drop unreachable sink `close`/`abort`), `test/mockAgent.ts` (new `onInitialize` seam to script a rejecting/odd handshake)

## Errors / Corrections
- First cut asserted the rejecting-mock's message reached readiness verbatim; it did not (SDK flattens plain errors to "Internal error"). Root cause fixed in the adapter rather than weakening the assertion.
- Tried covering `spawnAgentTransport`'s `abort()` with a `writer.abort()` test; it timed out because ndJsonStream swallows abort. Deleted the unreachable code instead of testing behavior that cannot occur.

## Ready for Next Run
- Verified: `bun run typecheck` exit 0; `bun test` 90/90 pass; `bun test --coverage` exit 0 (configLoader 100%/100%, readiness 93.75% funcs/98.92% lines). Real-agent smoke: both default agents report READY at ACP v1.
- `bun test --coverage` now exits 0 for the first time (was exit 1 at baseline). Note in shared memory.
- Public API for task_07 / task_14: `loadAppConfig({path?, env?})`, `defaultAppConfig()`, `parseAppConfig(src, path?)`, `resolveConfigPath(env?)`, `findAgentConfig(config, id)`, `ConfigError`, `CONFIG_PATH_ENV_VAR`; `checkAgentReadiness(agentConfig, opts?)`, `checkAllAgentsReadiness(appConfig, opts?)`, `AgentReadiness`, `NotReadyReason`, `DEFAULT_HANDSHAKE_TIMEOUT_MS`. Readiness opts seams: `{createConnection?, binaryExists?, timeoutMs?}`.
