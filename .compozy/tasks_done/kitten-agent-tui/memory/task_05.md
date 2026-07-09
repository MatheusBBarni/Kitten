# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Reactive `AppStore`: per-agent `SessionState`, focused agent, per-agent status, approval + hand-off overlay slots; events applied via the core reducer; narrow selectors for render-scope isolation (ADR-004). DONE.

## Important Decisions
- No new dependency (no Zustand). ADR-004 allows "a scoped store such as Zustand or a narrowly-scoped reducer"; a ~200-line external store with `subscribe`/`subscribeSelector` covers it and dodges the `minimumReleaseAge` guard.
- Per-agent status is NOT a separate field: it lives in `sessions[agentId].status`, written only by `sessionReducer` from `status` events, and read via `selectAgentStatus(id)`. One copy means the status strip and transcript cannot drift.
- `subscribeSelector(selector, listener, isEqual = Object.is)` caches the selected value per subscription; the store is framework-agnostic (no React import). The `useSyncExternalStore` binding belongs to task_08.
- Per-agent selectors are curried (`selectAgentStatus("codex")`), so React callers must `useMemo` the selector to keep its identity stable.
- `startSession(agentId, sessionId)` always resets the slice via `createSessionState` (unconditional). An earlier idempotency guard was dropped as confusing.
- Overlay payload types are store-owned (`ApprovalOverlay`, `HandoffPreviewOverlay`); `PermissionRequest` is imported type-only from `src/agent/agentConnection.ts` (already protocol-free; `import type` is erased, so no ACP reaches the bundle - verified).

## Learnings
- `bun build src/store/appStore.ts --target=bun | grep -c agentclientprotocol` -> 0. Cheap way to prove a type-only import did not breach the ADR-003 boundary.
- In zsh, `${PIPESTATUS[0]}` does not capture a piped command's exit code (zsh uses `pipestatus`, 1-indexed). Redirect to a file and read `$?` when a real exit code is needed for verification evidence.

## Files / Surfaces
- New: `src/store/appStore.ts`, `src/store/selectors.ts`, `src/store/appStore.test.ts`, `src/store/selectors.test.ts`.
- No existing file changed.

## Errors / Corrections
- None. Typecheck and tests were clean on first full run.

## Ready for Next Run
- task_07 (controller) owns: `store.startSession` after `newSession`, `applyEvent` from `connection.onUpdate`, `openApproval`/`closeApproval` around `onPermission`, `setFocus` on hand-off.
- task_08 must build the React binding (`useSyncExternalStore` over `subscribeSelector`); the store deliberately ships without one.
