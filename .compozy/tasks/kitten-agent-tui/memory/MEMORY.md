# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts obvious from the repository, PRD documents, or git history.

## Current State
- Done + verified: task_01..task_13. Remaining: packaging/first-run (14).
- Baseline after task_13: `bun test` 405/405 pass, `bun run typecheck` clean, `bun test --coverage` exits 0 (per-file 0.8 threshold).
- Telemetry: `src/telemetry/recorder.ts` (opt-in local JSONL) + `src/core/telemetryHeuristics.ts` (pure). Recorder is NOOP when `config.telemetryEnabled` false (no sink, no fs). Wired via `createCockpitSession()` in index.ts → recorder threaded renderCockpit→CockpitApp→createHandoffFlow; readiness recorded at boot, `recorder.watch(store)` derives first_response_ms + reexplanation_detected. Records are content-free (no text field).
- Entry chain: `src/index.ts` -> `src/ui/main.tsx` (`renderCockpit`) -> `src/ui/CockpitApp.tsx` -> `src/ui/ConversationView.tsx`.

## Shared Decisions
- ACP SDK is `@agentclientprotocol/sdk` (pinned 1.2.1). Import ACP types only inside `src/agent` (ADR-003); re-export protocol constants as plain values.
- Exact version pinning is mandatory (bunfig `install.exact = true`); new deps must respect `minimumReleaseAge`.
- `src/index.ts` stays import-side-effect-free (`import.meta.main` guard). JSX only in `.tsx`.
- Config: optional JSON (`KITTEN_CONFIG` -> `$XDG_CONFIG_HOME/kitten/config.json` -> `~/.config/kitten/config.json`), zod-`.strict()`, field-level merge over `defaultAppConfig()`. Invalid config throws `ConfigError`.
- No Zustand. Hand-rolled store + `useSyncExternalStore` binding (ADR-004). Store does NOT batch; every action no-ops when nothing changes; state immutable with structural sharing.
- `referencedFiles`/`pendingDiffs` are pure reducer derivations; per-agent `AgentStatus` lives ONLY in `sessions[agentId].status`.
- Redaction is biased to false negatives; the human preview is the safety control. `assemble` redacts as it builds - callers must NOT redact again.
- Factories over classes for public constructors (`createX(...)`), interfaces as the seam.
- V1 does not surface agent thoughts: `translateSessionUpdate` maps `agent_thought_chunk` to `null`; adding them means touching types + reducer + translator together.
- All UI colors come from `src/ui/theme.ts` (`usePalette()`); never hard-code a color. `src/ui/keymap.ts` is the single source of truth for dispatch/help; overlays (`APPROVAL_KEYMAP`, `HANDOFF_KEYMAP`) are modal and swallow every key.

## Shared Learnings
- Verification gates: `bun run typecheck` + `bun test` + `bun test --coverage`. `bun build --compile` FAILS at baseline (@opentui/core platform binaries) - owned by task_14, not a per-task regression.
- Never gate on `rtk tsc` (no `tsc` on PATH → false "No errors found"). Use `bun run typecheck`.
- Bun enforces `coverageThreshold` (0.8) PER FILE, not aggregate; a non-zero `bun test --coverage` exit is a real regression. It also gates non-test helpers under `test/`, so every helper there needs its own test.
- `bun build <file> --target=bun | grep -c <pkg>` proves a type-only import did not breach the ADR-003 boundary.
- zsh has no `PIPESTATUS`; redirect to a file and read `$?` when verification needs a real exit code.
- ACP SDK v1.2.1: values `ClientSideConnection`, `AgentSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION` (=1); `Stream` + schema types are type-only. SDK delivers session/update notifications before the prompt response resolves.
- Non-TTY UI tests (only relevant to task_14 packaging): `createTestRenderer`/`testRender` via `test/reactTui.ts`; assert through `waitForFrame`, never a bare capture.

## Open Risks
- Pre-1.0 churn: @opentui/* and the ACP SDK ship breaking changes; keep them behind adapter boundaries and re-pin deliberately.
- @opentui/core 0.4.3: `<markdown>` paints nothing unless `streaming` is true (Kitten passes it permanently); `<scrollbox>` reserves a horizontal-scrollbar row even under `scrollX:false` (pass `horizontalScrollbarOptions={{visible:false}}`). Re-check on bumps.

## Handoffs
Contracts remaining tasks (13, 14) depend on (signatures live in source; these are the non-obvious parts):

- **task_04 config/readiness** - `loadAppConfig`, `defaultAppConfig`, `findAgentConfig`, `ConfigError`; `checkAllAgentsReadiness(appConfig)` → `AgentReadiness[]` in config order, never throws. `NotReadyReason = binary_not_found | handshake_failed | handshake_timeout | capability_mismatch`, each with a display-ready `message`. (task_14 first-run renders these.)
- **task_05 store** - `createAppStore(...)` → `getState`, `subscribe`, `subscribeSelector`, `applyEvent`, `startSession`, `setFocus`, `openApproval`/`closeApproval`, `openHandoffPreview`/`closeHandoffPreview`; plus `AGENT_IDS`. `src/store/selectors.ts` curried per-agent selectors return a new fn per call (React callers must `useMemo`). `selectHasOpenOverlay` covers approval + handoff preview.
- **task_07 controller** (only path the UI may use to reach an agent) - `await createSessionController({config, cwd?, store?, createConnection?, onError?})` → `{ store, actions, runtimes(), runtime(agentId), isReady(agentId), dispose() }`. Never rejects. `ControllerActions = { sendPrompt(input, agentId?) → Promise<PromptResult|null>, cancel(agentId?), switchFocus(agentId?), respondPermission(outcome) }`; `agentId` defaults to focused. `sendPrompt` records `user_message` turn synchronously, drops blank prompts, returns `null` instead of throwing.
- **task_12 hand-off** - `src/app/handoff.ts` `createHandoffFlow({controller, assembler?})` → `{ begin(): boolean, confirm(edits): Promise<PromptResult|null>, cancel() }`. `begin` assembles the focused session and calls `openHandoffPreview` (false if any overlay open / empty transcript / target not ready); direction derived from focus (`nextAgentId`). `confirm` composes prompt blocks, calls `sendPrompt(blocks, target)` then `switchFocus(target)`; empties compose to `[]` (nothing sent). `composeHandoffBlocks`/`createHandoffEdits`/`HandoffEdits` are pure and exported.

- **task_13 telemetry** - `createTelemetryRecorder({enabled, sink?, now?, sessionRef?})` → NOOP when disabled. Methods: `handoffInvoked`, `handoffSent({targetAgentId, editChars})`, `agentReady`/`agentUnready`, `watch(store)`. `recordReadiness(recorder, runtimes)`, `resolveTelemetryPath(env?)`, `createJsonlFileSink(path)`. Pure core: `bucketChars`, `editedCharCount`, `detectReexplanation(events, threshold)`. `index.ts` `createCockpitSession(deps?)` returns `{controller, recorder}` (injectable seams). handoff flow takes optional `recorder`.

Consumers still to build:
- task_14's first-run flow renders `AgentReadiness.message` per `NotReadyReason`.
