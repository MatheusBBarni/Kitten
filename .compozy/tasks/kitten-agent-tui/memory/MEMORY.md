# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State
- Complete + verified: task_01 (scaffold), task_02 (`src/core/{types,sessionReducer}.ts`), task_03 (`src/agent/*` + `test/mockAgent.ts`), task_04 (`src/config/*`), task_05 (`src/store/*`), task_06 (`src/core/{bundleAssembler,secretRedactor}.ts`), task_07 (`src/app/{controller,actions}.ts`).
- Baseline at end of task_07: `bun test` 209/209 pass, `bun run typecheck` clean, `bun test --coverage` exits 0.
- Remaining: the UI tasks (08-12), telemetry (13), packaging/first-run (14). Nothing mounts the controller yet - `src/app/bootstrap.tsx` still renders the task_01 placeholder cockpit.

## Shared Decisions
- ACP SDK is `@agentclientprotocol/sdk` (pinned 1.2.1), NOT `@zed-industries/agent-client-protocol`. Import ACP types only inside `src/agent` (ADR-003 anti-corruption boundary). When a higher layer needs a protocol constant, re-export it as a plain value from the adapter (precedent: `SUPPORTED_PROTOCOL_VERSION`).
- Exact version pinning is mandatory (bunfig `install.exact = true`). New deps must also respect the global `minimumReleaseAge` guard; pre-1.0 core deps are allow-listed via `minimumReleaseAgeExcludes`.
- Entry contract: `src/index.ts` stays import-side-effect-free (`import.meta.main` guard); render logic lives in `src/app/bootstrap.tsx` (`renderCockpit(renderer)`). JSX only in `.tsx` files.
- Domain `tool_call` event carries a partial `ToolCallUpdate` (toolCallId required, rest optional, `diff: null` clears) - NOT the full `ToolCallRecord` the techspec prints. Both ACP `tool_call` and `tool_call_update` map to it; the reducer upserts by toolCallId.
- `SessionState` adds `plan: PlanEntry[]` beyond the techspec shape. `referencedFiles` and `pendingDiffs` are pure reducer derivations, never written directly.
- Per-agent `AgentStatus` lives ONLY in `sessions[agentId].status`, written only by `sessionReducer`. Never add a parallel status field anywhere.
- No Zustand. ADR-004's "external store with targeted subscriptions" is satisfied by the hand-rolled store; the `useSyncExternalStore` React binding is task_08's job.
- Config: optional JSON file (`KITTEN_CONFIG` env → `$XDG_CONFIG_HOME/kitten/config.json` → `~/.config/kitten/config.json`), zod-`.strict()`-validated, field-level merge over `defaultAppConfig()`. Invalid config throws `ConfigError`; never silently falls back.
- Default agent spawn commands (verified, ACP v1): `npx -y @agentclientprotocol/claude-agent-acp@0.57.0` and `npx -y @agentclientprotocol/codex-acp@1.1.0`. `@zed-industries/claude-code-acp` is renamed/deprecated - do not use.
- Redaction is biased to false negatives on purpose; the human preview is the safety control. Never auto-send a hand-off bundle without the preview.
- Factories over classes for public constructors (`createX(...)`), interfaces as the seam.

## Shared Learnings
- Verification gates: `bun run typecheck` + `bun test` + `bun test --coverage`. `bun build --compile` FAILS at baseline (@opentui/core cannot resolve platform binaries) - owned by task_12/14, not a per-task regression.
- Bun enforces `coverageThreshold` (0.8) PER FILE, not on the aggregate. `bun test --coverage` exits 0 today; a non-zero exit is a real regression.
- `bun build <file> --target=bun | grep -c <pkg>` proves a type-only import did not breach the ADR-003 boundary.
- zsh has no `PIPESTATUS`; redirect to a file and read `$?` when verification needs a real exit code.
- Non-TTY UI tests: `createTestRenderer({width,height})` from `@opentui/core/testing` + `testRender(<C/>, {width,height})` from `@opentui/react/test-utils`. Destroying a renderer with a mounted React root MUST be wrapped in `act()` (+`IS_REACT_ACT_ENVIRONMENT=true`).
- ACP SDK error semantics: an agent throwing a plain `Error` from a request handler reaches the client as JSON-RPC "Internal error" with the real text in `error.data.details`; `connect()` unwraps it. A thrown `RequestError` keeps its message.
- ACP SDK v1.2.1 API: values `ClientSideConnection`, `AgentSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION` (=1); `Stream` + schema types are type-only (`verbatimModuleSyntax`). SDK delivers session/update notifications before the prompt response resolves (FIFO on one stream).
- `ndJsonStream`'s writable only implements `write`; it never forwards `close`/`abort`. Process teardown belongs in `AgentTransport.dispose()`.

## Open Risks
- Pre-1.0 churn: @opentui/* and the ACP SDK ship breaking changes; keep them behind the adapter boundary and re-pin deliberately.

## Public APIs (for downstream tasks)
- **Agent adapter (task_03)** - `src/agent/agentConnection.ts`: `createAgentConnection({config, transport?, scheduler?})` → `AgentConnection` (connect/newSession/prompt/cancel/onUpdate/onPermission/dispose). `connect()` → `ReadyState`. The adapter emits its own `status` domain events (working on prompt, idle on resolve, awaiting_approval around permission) and coalesces `onUpdate` per frame. `src/agent/transport.ts`: `spawnAgentTransport`, `createInMemoryTransportPair()`, `createFrameScheduler`. `test/mockAgent.ts`: `startMockAgent(stream, {sessionId?, protocolVersion?, onInitialize?, onPrompt?})`; handle records `prompts`/`permissionOutcomes`.
- **Config & readiness (task_04)** - `loadAppConfig({path?, env?})`, `defaultAppConfig()`, `parseAppConfig`, `resolveConfigPath`, `findAgentConfig`, `ConfigError`, `CONFIG_PATH_ENV_VAR`. `checkAgentReadiness(agentConfig, opts?)` / `checkAllAgentsReadiness(appConfig, opts?)` → `AgentReadiness[]` (config order, never throws); `NotReadyReason = binary_not_found | handshake_failed | handshake_timeout | capability_mismatch`, each with a display-ready `message`. Readiness spawns a throwaway connection and disposes it - the controller owns its own long-lived connections.
- **Store (task_05)** - `createAppStore({sessionIds?, focusedAgentId?})` → `AppStore`: `getState`, `subscribe`, `subscribeSelector(selector, listener, isEqual?)`, `applyEvent(agentId, event)`, `startSession(agentId, sessionId)` (resets the slice), `setFocus`, `openApproval`/`closeApproval`, `openHandoffPreview`/`closeHandoffPreview`; plus `AGENT_IDS`. `AppState = { sessions, focusedAgentId, overlays: { approval, handoffPreview } }`. Every action is a no-op when nothing would change; state is immutable with structural sharing. The store does NOT batch (adapter coalescing is the only batching layer). `src/store/selectors.ts` ships narrow selectors; curried per-agent selectors return a new function per call, so React callers must `useMemo` them.
- **Session controller (task_07)** - `src/app/controller.ts`: `await createSessionController({config, cwd?, store?, createConnection?, newMessageId?, onError?})` → `SessionController` = `{ store, actions, runtimes(), runtime(agentId), isReady(agentId), dispose() }`. Never rejects: a failed connect/handshake/`session/new` yields `AgentRuntimeState {ready:false, error}` for that agent only, its connection is disposed, and focus falls through to the first ready agent. `src/app/actions.ts`: `ControllerActions = { sendPrompt(input, agentId?) → Promise<PromptResult|null>, cancel(agentId?), switchFocus(agentId?) (omitted = cycle), respondPermission(outcome) }`; `agentId` defaults to the focused agent. `sendPrompt` records the `user_message` turn itself (ACP never echoes prompts back), drops blank prompts, and returns `null` (reporting via `onError`) instead of throwing - UI callbacks must never reject. Permission requests queue FIFO behind the store's single approval slot; `dispose()` cancels every queued one.
- **Bundle assembly (task_06)** - `createDeterministicAssembler({limits?, redactor?})` → `BundleAssembler.assemble(session, target)`; `DEFAULT_BUNDLE_LIMITS` (maxTurns 20, maxTurnChars 600, maxSummaryChars 4000). `assemble` already redacts and reports `redactionCount` - callers must NOT redact again. Excerpt drops whole turns from the head, announcing `[N earlier turn(s) omitted]`. `createSecretRedactor(patterns?)`, `defaultSecretPatterns()`, `REDACTION_PLACEHOLDER`.

## Handoffs
- task_07 done - see "Session controller" above. It is the only thing the UI may use to reach an agent.
- task_08 boots the controller, owns the `useSyncExternalStore` React binding over `subscribeSelector` (the store ships none), reads `runtimes()`/`isReady()` for the status strip's not-ready indicator, and binds the focus key to `actions.switchFocus()`. It must also replace the placeholder `src/app/CockpitApp.tsx` (task files call it `src/ui/CockpitApp.tsx`).
- task_10 calls `actions.sendPrompt(text)` / `actions.cancel()`; task_11 reads `overlays.approval` and answers with `actions.respondPermission(outcome)`.
- task_12 calls `assemble(sourceSession, targetAgentId)`, renders it via `openHandoffPreview`, and on confirm sends it through `actions.sendPrompt(blocks, targetAgentId)` then `actions.switchFocus(targetAgentId)`.
- task_13 observes state transitions via `store.subscribe` and reads `AppConfig.telemetryEnabled`; task_14's first-run flow renders `AgentReadiness.message` per `NotReadyReason`.
