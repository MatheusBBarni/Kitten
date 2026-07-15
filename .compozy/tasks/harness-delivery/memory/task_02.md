# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the exact harness runtime-profile evidence gate and adapter-only prompt envelope while preserving ordinary ACP prompt mapping.

## Important Decisions

- Preserve the prior Cursor certification boundary: the production Cursor profile remains unsupported until a reviewed credentialed `agent --version` and ACP contract pass supplies an exact version.
- Do not invent portable ACP `_meta` semantics; the installed SDK defines `_meta` only as an implementation extension and the pinned adapters must be proven independently before any harness encoder is enabled.
- Keep `CERTIFIED_HARNESS_PROFILES` evidence-derived and empty in production until complete credentialed results exist. Candidate provider-specific encoders are injectable only for deterministic and opt-in contract proof.
- Revalidate profile id, exact command, ordered arguments, complete environment, adapter package/version, and SDK version again at the agent boundary before calling ACP `prompt`.

## Learnings

- `@agentclientprotocol/sdk` 1.2.1 `prompt()` resolves at terminal turn completion and exposes only user content blocks plus non-portable `_meta`.
- The workspace has no `agent` binary, matching the existing Cursor contract handoff; therefore task completion and automatic commit remain gated on external credentialed evidence.
- Focused deterministic tests pass: 100 passed, 2 credentialed tests skipped, 0 failed. Task-owned production modules have 100% line coverage for `harnessCapability.ts` and 97.5% for `agentConnection.ts`.
- The fresh repository gate reached 2,027 passed, 4 skipped, and 2 unrelated failures in `test/releaseWorkflow.test.ts`; both failures predate this task and reject the existing `NODE_AUTH_TOKEN` / `secrets.NPM_TOKEN` workflow text.
- The opt-in Claude Code run failed during initialization because the adapter could not find its darwin-arm64 native binary; it emitted no certification evidence.
- The opt-in Codex run completed a real turn but failed the exact synthetic response check, proving that `codex-prompt-meta-v1` is not certified for the pinned adapter; it emitted no certification evidence.

## Files / Surfaces

- Added `src/config/harnessCapability.ts` and its unit tests for evidence-derived exact profiles, future-provider admission, and default-deny mismatches.
- Added the opaque `HarnessPromptEnvelope`, profile-specific ACP request encoding, and pre-prompt rejection in `src/agent/agentConnection.ts`; extended its in-memory wire tests.
- Added `test/harnessAdapter.contract.test.ts` for opt-in Claude Code and Codex evidence and extended `test/cursorAcp.contract.test.ts` for Cursor harness evidence.
- Updated prompt-capture test seams in `src/app/controller.test.ts`, `test/index.integration.test.tsx`, and `test/sessionRestore.integration.test.ts` to accept the widened agent-boundary input without changing production controller behavior.

## Errors / Corrections

- The task brief asks to certify all three built-ins, but repository policy explicitly forbids guessing a Cursor version. Implement deterministic fixtures and opt-in evidence collection without enabling an unreviewed production profile.
- Agent updates are frame-coalesced, so credentialed contracts now wait for the first delivered agent-message event after terminal `prompt()` resolution before judging the exact synthetic response.
- A focused Bun coverage invocation exits nonzero at 66.86% aggregate because importing `agentConnection.ts` pulls unrelated low-coverage modules into the calculation; the task-owned modules themselves exceed the required 80% target.

## Ready for Next Run

- Install/authenticate the native Cursor `agent` CLI and capture its exact semantic version.
- Reinstall the Claude adapter's optional native SDK binary, then rerun its opt-in contract. A future Codex candidate must use a genuinely adapter-supported hidden channel; the current prompt `_meta` candidate failed and must remain uncertified.
- Run Cursor with `KITTEN_CURSOR_ACP_CONTRACT=1` plus its exact candidate-version input after the native CLI is available.
- Only complete the built-in contract-results catalog after reviewing complete content-free evidence from all three runs; then rerun typecheck, focused tests/coverage, and the full repository gate.
- Leave `task_02.md` and `_tasks.md` pending and do not commit until credentialed evidence and the repository gate are clean.
