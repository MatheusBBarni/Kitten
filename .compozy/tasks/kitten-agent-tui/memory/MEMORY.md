# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State
- task_01 (scaffold) complete and verified. Bun+TS project with pinned deps, `@opentui/react` JSX tsconfig, src layer skeleton (core/agent/config/store/app/ui/telemetry), runnable placeholder cockpit entry.
- task_02 (domain core) complete and verified. `src/core/types.ts` (all domain types) + `src/core/sessionReducer.ts` (pure reducer + `createSessionState`). No ACP import in src/core.
- task_03 (agent adapter) complete and verified. `src/agent/{agentConnection,acpTranslate,transport}.ts` + `test/mockAgent.ts`. `AgentConnection` = ACP anti-corruption boundary; ACP SDK confined to `src/agent` (+ test double). `bun test` = 58/58 pass; tsc clean; src/agent ~97.7% lines (acpTranslate 100%).
- task_04 (config + readiness) complete and verified. `src/config/{configLoader,readiness}.ts`. `bun test` = 90/90 pass; tsc clean; `bun test --coverage` now exits 0 (see Learnings).
- task_05 (reactive store) complete and verified. `src/store/{appStore,selectors}.ts`. `bun test` = 121/121 pass; tsc clean; `bun test --coverage` exits 0; both store files 100%.
- task_06 (bundle assembler + redactor) complete and verified. `src/core/{bundleAssembler,secretRedactor}.ts`. `bun test` = 177/177 pass; tsc clean; `bun test --coverage` exits 0; redactor 100%, assembler 96.8% lines.

## Shared Decisions
- ACP SDK package is `@agentclientprotocol/sdk` (pinned 1.2.1), NOT `@zed-industries/agent-client-protocol`. Import ACP types only inside the Agent Adapter Layer (src/agent) per ADR-003 anti-corruption boundary.
- Exact version pinning is mandatory (bunfig `install.exact = true`). Pinned: @opentui/core & @opentui/react 0.4.3, react 19.2.7, @agentclientprotocol/sdk 1.2.1, zod 4.4.3, ws 8.21.0, react-devtools-core 7.0.1.
- Entry contract: `src/index.ts` must stay import-side-effect-free (guarded by `import.meta.main`); render logic lives in `src/app/bootstrap.tsx` (`renderCockpit(renderer)`) so tests drive it. JSX only in `.tsx` files.
- Domain `tool_call` event carries a partial `ToolCallUpdate` (toolCallId required, other fields optional, `diff` nullable-to-clear) — NOT a full `ToolCallRecord` as the techspec literally prints. Both ACP `tool_call` and `tool_call_update` translate to this one domain event; the reducer upserts by toolCallId (omitted fields preserved, `diff: null` clears). Adapter (task_03) must emit this partial shape.
- `SessionState` (src/core/types.ts) extends the techspec shape with a `plan: PlanEntry[]` field so the `plan` domain event has a home. `referencedFiles: Map<path, "read"|"edited">` (edit is sticky/wins) and `pendingDiffs` (edit-kind + has diff + status pending/in_progress) are pure derivations recomputed by the reducer, never written directly. `PendingDiff = { toolCallId, path, unified }`.
- Core public API: `createSessionState(agentId, sessionId)` and `sessionReducer(state, event)` from `src/core/sessionReducer.ts`; all types from `src/core/types.ts`. The reducer is the single writer of SessionState (store in task_05 applies it per slice).
- Default agent spawn commands (verified working, ACP v1): `npx -y @agentclientprotocol/claude-agent-acp@0.57.0` and `npx -y @agentclientprotocol/codex-acp@1.1.0`. The `@zed-industries/claude-code-acp` package is renamed/deprecated - do not use it. Versions are pinned per ADR-005.
- Layers above `src/agent` must never import the ACP SDK. When one needs a protocol constant, re-export it as a plain value from the adapter (precedent: `SUPPORTED_PROTOCOL_VERSION` in `agentConnection.ts`, consumed by the readiness capability check).
- The store (task_05) adds NO dependency: ADR-004's "external store with targeted subscriptions" is satisfied by a hand-rolled, framework-agnostic store. Do not add Zustand. The React binding (`useSyncExternalStore` over `subscribeSelector`) is task_08's job, not the store's.
- Per-agent `AgentStatus` is stored ONLY inside `sessions[agentId].status` and written only by `sessionReducer`. Never add a parallel status field to the store - the status strip and the transcript must not be able to drift.
- Config is loaded from an optional JSON file (`KITTEN_CONFIG` env, else `$XDG_CONFIG_HOME/kitten/config.json`, else `~/.config/kitten/config.json`), zod-`.strict()`-validated and merged field-level over `defaultAppConfig()`. An invalid config throws `ConfigError` - it never silently falls back to defaults.

## Shared Learnings
- Non-TTY UI tests: `createTestRenderer({width,height})` from `@opentui/core/testing` + `testRender(<C/>, {width,height})` from `@opentui/react/test-utils`. Destroying a renderer with a mounted React root MUST be wrapped in `act()` (+`IS_REACT_ACT_ENVIRONMENT=true`) or bun test emits an act warning.
- Adding any new dependency must respect the global bunfig `minimumReleaseAge` guard; only the pre-1.0 core deps are allow-listed via `minimumReleaseAgeExcludes`. New fast-moving pins may need adding there.
- Verification gates are `bun run typecheck` + `bun test` (+ `bun test --coverage`). `bun build --compile`/`--target=bun` FAILS at baseline: @opentui/core cannot resolve its platform binaries (`@opentui/core-darwin-x64`, ...). This is an OpenTUI packaging issue owned by task_12; do NOT treat a failing compile as a per-task regression.
- Bun enforces `coverageThreshold` (0.8) PER FILE, not on the aggregate. One file below 80% funcs fails the whole run even when "All files" is green. `bun test --coverage` exits 0 as of task_04; a non-zero exit is now a real regression.
- `bun build <file> --target=bun | grep -c <pkg>` proves a type-only import did not breach the ADR-003 boundary (store bundle contains zero ACP).
- zsh has no `PIPESTATUS`; `${PIPESTATUS[0]}` silently yields nothing. Redirect to a file and read `$?` when verification needs a real exit code.
- ACP SDK error semantics: an agent throwing a plain `Error` from a request handler reaches the client as JSON-RPC "Internal error", with the original text only in `error.data.details`; a thrown `RequestError` propagates its message. `agentConnection.connect()` unwraps that nested detail so handshake failures stay legible.
- `ndJsonStream`'s writable implements only `write` - it never forwards `close`/`abort` to the sink it wraps. Sink-level teardown hooks are dead code; process teardown belongs in `AgentTransport.dispose()`.
- ACP SDK API (`@agentclientprotocol/sdk` v1.2.1): values `ClientSideConnection`, `AgentSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION` (=1); `Stream` + all schema types are type-only (`verbatimModuleSyntax` needs split `import type`). Client impls supply `requestPermission`/`sessionUpdate` (+ optional fs/terminal). SDK receive loop delivers session/update notifications before the prompt response resolves (FIFO on one stream).

## Agent Adapter Public API (task_03, for tasks 04/05/07)
- `src/agent/agentConnection.ts`: `createAgentConnection({config, transport?, scheduler?})` → `AgentConnection` (connect/newSession/prompt/cancel/onUpdate/onPermission/dispose). `connect()`→`ReadyState` ({ready:true,protocolVersion} | {ready:false,error}). Emits domain `status` events itself (working on prompt start, idle on resolve, awaiting_approval around permission). `onUpdate` stream is already per-frame coalesced.
- `src/agent/transport.ts`: `spawnAgentTransport` (default Bun.spawn) + `createInMemoryTransportPair()` (tests). `FrameScheduler`/`createFrameScheduler` for coalescing (injectable).
- `test/mockAgent.ts`: `startMockAgent(stream, {sessionId?, onPrompt?})` in-process ACP `Agent` double; `onPrompt(req, ctx)` where ctx has `update/requestPermission/readTextFile/writeTextFile`; records `prompts`/`permissionOutcomes`.

## Open Risks
- Pre-1.0 churn: @opentui/* and ACP SDK ship breaking changes; keep them isolated behind the adapter boundary and re-pin deliberately.

## Config & Readiness Public API (task_04, for tasks 07/13/14)
- `src/config/configLoader.ts`: `loadAppConfig({path?, env?})` → `AppConfig`; plus `defaultAppConfig()`, `parseAppConfig(source, path?)`, `resolveConfigPath(env?)`, `findAgentConfig(config, id)`, `ConfigError`, `CONFIG_PATH_ENV_VAR`. Telemetry opt-in is `AppConfig.telemetryEnabled` (default false) — task_13 reads it.
- `src/config/readiness.ts`: `checkAgentReadiness(agentConfig, opts?)` and `checkAllAgentsReadiness(appConfig, opts?)` → `AgentReadiness[]` (one verdict per agent, config order, never throws). `NotReadyReason = binary_not_found | handshake_failed | handshake_timeout | capability_mismatch`, each with a ready-to-display `message`. Opts seams: `{createConnection?, binaryExists?, timeoutMs?}` (default handshake budget 15s).
- Readiness spawns a throwaway connection and disposes it; task_07 must create its own long-lived `AgentConnection`s afterwards.

## Store Public API (task_05, for tasks 07/08-13)
- `src/store/appStore.ts`: `createAppStore({sessionIds?, focusedAgentId?})` → `AppStore`. Reads: `getState()`, `subscribe(listener)`, `subscribeSelector(selector, listener, isEqual?)` (caches per subscription; default `Object.is`). Actions: `applyEvent(agentId, event)`, `startSession(agentId, sessionId)` (resets the slice), `setFocus(agentId)`, `openApproval`/`closeApproval`, `openHandoffPreview`/`closeHandoffPreview`. Also exports `AGENT_IDS`.
- `AppState = { sessions: Record<AgentId, SessionState>, focusedAgentId, overlays: { approval, handoffPreview } }`. Overlay payloads: `ApprovalOverlay {agentId, request}` and `HandoffPreviewOverlay {sourceAgentId, targetAgentId, bundle}`.
- Every action is a no-op (no state change, no notification) when it would not change anything: `setFocus` to the focused agent, closing a closed overlay. State is immutable with structural sharing, so an untouched agent's slice keeps its identity.
- `src/store/selectors.ts`: `selectFocusedAgentId`, `selectFocusedSession`, `selectApprovalOverlay`, `selectHandoffPreview`, `selectHasOpenOverlay`, plus curried per-agent `selectIsFocused | selectAgentSession | selectAgentStatus | selectAgentTurns | selectAgentPlan | selectAgentPendingDiffs | selectAgentReferencedFiles`. Curried selectors return a new function per call - React callers must `useMemo` them.
- The store does NOT batch: the adapter's per-frame coalescing is the only batching layer. `applyEvent` notifies synchronously.

## Bundle Assembly Public API (task_06, for task_12)
- `src/core/bundleAssembler.ts`: `createDeterministicAssembler({limits?, redactor?})` → `BundleAssembler` (`assemble(session, target) → HandoffBundle`). Also exports `BundleAssembler`, `BundleLimits`, `DEFAULT_BUNDLE_LIMITS` (maxTurns 20, maxTurnChars 600, maxSummaryChars 4000). Factory, not a class, matching repo convention; the ADR-002 strategy seam is the `BundleAssembler` interface, so the Phase 2 LLM assembler is a drop-in.
- `assemble` already applies redaction and reports `redactionCount`. Callers must NOT redact again - `HandoffBundle.summary` and `pendingDiffs[].unified` come back clean, and a second pass would double-count. `path`/`toolCallId` are never redacted.
- `src/core/secretRedactor.ts`: `createSecretRedactor(patterns?)` → `SecretRedactor` (`redact(text) → {text, count}`); plus `defaultSecretPatterns()`, `REDACTION_PLACEHOLDER` (`[REDACTED]`), `SecretPattern`. Line-oriented, so a secret inside a unified diff is stripped without disturbing the `+`/`-` prefixes or hunk headers. Patterns are normalized to global on construction.
- Redaction is deliberately biased to false negatives (a missed secret is caught by the mandatory human preview; an over-eager match corrupts the bundle the target agent must work from). The preview step is a safety control, not just UX - never auto-send a bundle without it.
- The excerpt is bounded and drops whole turns from the head, announcing them as `[N earlier turn(s) omitted]`. `redactionCount` counts only what survives into the bundle.

## Handoffs
- task_03 done — see "Agent Adapter Public API" above. Downstream: task_05 (store) consumes the coalesced `onUpdate` DomainSessionEvent stream and applies via `sessionReducer`; task_07 (controller) creates/orchestrates connections and registers `onPermission`.
- task_04 done — see "Config & Readiness Public API" above. Downstream: task_07 loads config to construct connections and surfaces readiness; task_14's first-run flow renders `AgentReadiness.message` per `NotReadyReason`.
- task_06 done — see "Bundle Assembly Public API" above. Downstream: task_12 calls `assemble(sourceSession, targetAgentId)`, renders the bundle in the preview overlay (`openHandoffPreview`), and on confirm sends it to the target via `connection.prompt`. Nothing else depends on it.
- task_05 done — see "Store Public API" above. Downstream: task_07 wires `connection.onUpdate` → `applyEvent`, `newSession` → `startSession`, `onPermission` → `openApproval`/`closeApproval`, hand-off → `setFocus`; task_08 owns the `useSyncExternalStore` React binding over `subscribeSelector` (the store ships none); task_13 observes transitions via `subscribe`.
