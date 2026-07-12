# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Behavior-preserving refactor: key the store by an opaque `SessionId` instead of the provider union. Rename `AgentId`→`ProviderKind`, add `SessionId`, reshape `SessionState` (`id`, `providerKind`, `title`, `cwd`, `task?`, `acpSessionId`). Store becomes `sessions: Record<SessionId>` + `order: SessionId[]` + `focusedSessionId`. Re-key selectors + all call sites. Keep the two-session default boot and every existing test green. No finished/error states, no sessions overlay, no per-session cwd config (later tasks).

## Important Decisions
- **Default-fleet SessionId == providerKind.** For the zero-config two-session boot, each seed's `SessionId` is assigned equal to its provider kind ("claude-code"/"codex"). This is behavior-preserving and keeps test string-literal keys valid, while the store SHAPE (Record<SessionId> + order) already supports N same-provider sessions. task_02/03 will supply distinct ids from the sessions list; the store needs no further change.
- Provider display names + kinds centralized in core as `PROVIDER_KINDS` / `PROVIDER_DISPLAY_NAMES`; store re-exports `AGENT_IDS` as the seed order.
- Selectors renamed `selectAgent*`→`selectSession*`, `selectFocusedAgentId`→`selectFocusedSessionId`; param type SessionId.
- `createSessionState(seed: SessionSeed)`; `startSession(sessionId, acpSessionId)` preserves identity fields, resets transcript.
- Controller: `runtimes: Map<SessionId, AgentRuntime>`; seeds one session per `config.agents` provider with `id=providerKind`, `title=displayName`, `cwd`. `AgentRuntimeState` reshaped to `{ sessionId, providerKind, displayName, title, ready, acpSessionId|error }`. Controller now OWNS store creation (seeds from config); dropped the `store` injection option — `index.createCockpitSession` uses `controller.store`.
- Overlays: approval carries `sessionId` (was agentId); handoff carries `sourceSessionId`/`targetSessionId`.
- Telemetry: watches keyed by SessionId (iterate `state.order`); `agent` record field carries the session ref (value == providerKind for default fleet, so telemetry tests stay green). `handoffSent` arms by target sessionId.
- `bundleAssembler.assemble(session, target: ProviderKind)` — pass target session's providerKind to keep header text unchanged.
- Provider-level structs (readiness `AgentReadiness`, firstRun `AgentSetupState`) keep `agentId` field name but retyped to `ProviderKind` (minimal churn; they are genuinely provider-kind).

## Learnings
- `noUncheckedIndexedAccess` is ON: `Record<SessionId, SessionState>` indexing yields `SessionState | undefined`. Existing `Record<AgentId>` (finite union) did not. Guard or `!` at invariant-safe sites.
- Baseline: 462 pass / 0 fail; typecheck clean.
- `AgentId` appears ~198×; sessionId/agentId refs ~270× across 26 src files + test helpers (test/fakeController.ts, test/mockAgent.ts).

## Files / Surfaces
Core: types.ts, sessionReducer.ts, bundleAssembler.ts. Store: appStore.ts, selectors.ts. App: actions.ts, controller.ts, handoff.ts, selfCheck.ts. Agent: agentConnection.ts. Config: configLoader.ts, readiness.ts, firstRun.ts (type rename only). Telemetry: recorder.ts. UI: cockpitContext, CockpitApp, ConversationView, StatusStrip, PromptEditor, ApprovalPrompt, HandoffPreview, main.tsx. Entry: index.ts. Tests + test/ helpers.

## Errors / Corrections
- `noUncheckedIndexedAccess` forced `!`/guards on every `state.sessions[id].<prop>` in tests (Record<string> keys now yield `| undefined`); src added guards in `applyEvent`/`startFocus`/`setFocus`.
- `test/cockpitSession.test.ts` asserts `createCockpitSession` passes a `store` to the controller. Kept that contract: `index.createCockpitSession` still creates `createAppStore()` (default fleet seeds) and passes it; the controller binds ACP ids onto it. Do NOT drop the `store` injection.

## Ready for Next Run
- Task 01 done & committed: types split (`ProviderKind`/`SessionId`), store keyed by `SessionId` + `order` + `focusedSessionId`, selectors renamed `selectSession*`/`selectFocusedSessionId`, controller `Map<SessionId>`, overlays carry session ids. 465 tests green, tsc clean, build ok.
- task_02 (config model) should build `SessionDescriptor`s and assign distinct `SessionId`s for the `sessions` list; the store already keys by opaque id + order, so no store change needed. Feed resolved per-session seeds into `createSessionController` (which already maps config→seeds).
- When the config gains a non-default provider set, the `index` external `createAppStore()` default-fleet seeds will diverge from controller seeds — task_02/03 should make the controller own store seeding (or pass config-derived seeds to `createAppStore`).
