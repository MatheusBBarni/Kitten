# TechSpec: Multi-Agent Orchestration Registry

## Executive Summary

Implement V1 as a protocol-free delegation projection in `AppState` with controller-owned live child operations. The controller creates a child through the existing runtime/session path, keeps the parent focused, dispatches the explicit child task, and publishes generation-fenced lifecycle transitions into the store. UI views subscribe to delegation selectors and continue to use normal session, attention, and close surfaces.

The primary trade-off is deliberate: V1 provides visible store-derived group completion rather than an imperative wait API or restored delegation graph. This keeps the model small and prevents a second promise lifecycle, at the cost of deferring automation consumers and restart continuity.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/core/orchestration.ts` | Pure delegation types, reducer, invariant checks, and selectors. | Protocol-free; no ACP, I/O, React, or mutable runtime objects. |
| `src/core/types.ts` | Shared `SessionId`-based delegation model types and workspace metadata additions. | Keeps parent/child identity compatible with existing session state. |
| `src/store/appStore.ts` | Holds `delegation` in `AppState`; atomically adds/removes sessions and delegation records; exposes selector-ready store actions. | Routes session status through existing reducer before updating delegation projection. |
| `src/app/controller.ts` | Owns child runtime creation, task dispatch, generation checks, cancellation, parent-close cascading, and terminal publication. | The only component touching `AgentConnection` or the runtime map. |
| `src/app/actions.ts` | Exposes narrow delegation commands to UI through `ControllerActions`. | UI never reaches controller internals or agent connections. |
| `src/ui/DelegationDialog.tsx` | Captures explicit task and desired outcome from the focused parent. | Uses `ControllerActions` only. |
| `src/ui/SessionsOverlay.tsx`, `TabWorkspace.tsx`, `TabDialog.tsx` | Render lineage, lifecycle, needs-input cues, outcome summaries, and safe parent-close confirmation. | Reuse existing session/attention presentation rather than add a parallel workspace. |

### Data Flow

1. The focused parent opens `DelegationDialog` with `Ctrl+G`, the single source-of-truth binding added to `keymap.ts`.
2. The dialog submits `StartDelegatedChildInput` through `ControllerActions.startDelegatedChild`.
3. The controller validates the parent runtime, allocates a child `SessionId`, and performs one store update that creates the child session, backgrounds it, and records parent-child ownership before starting it.
4. The controller starts the child using the existing session factory path, dispatches the task/outcome prompt, and publishes `running`, attention, or terminal transitions only when its runtime and generation remain current.
5. Store selectors derive ordered children and aggregate group status. Workspace views render **Running**, needs-input, finished, failed, and cancelled states from that projection plus existing session status.
6. A parent-close request checks its child projection first. Confirmation cascades cancellation through controller-owned teardown, then removes the parent only after every owned child is terminal or teardown-failed and visibly reported.

### PRD Traceability

| PRD goal or story | Technical component(s) |
| --- | --- |
| Immediate visible child launch and retained parent focus | `DelegationDialog`, atomic `AppStore.addDelegatedSession`, controller delegated factory, `TabWorkspace`. |
| Explicit task and desired outcome | `StartDelegatedChildInput`, dialog validation, controller prompt dispatch. |
| Normal workspace access to each child | Delegation selectors, `SessionsOverlay`, `TabWorkspace`, optional workspace lineage metadata. |
| Child attention, steering, and stop | Existing interaction coordinator, `ControllerActions` child commands, session-status projection. |
| Settled group outcomes | Immutable terminal child snapshots and aggregate selectors. |
| Safe parent closure with no orphaned work | Parent-close delegation lookup, cascade cancellation, existing teardown path, `TabDialog`. |
| Content-free measurement and restart safety | Controller telemetry hooks and explicit exclusion from persisted run records. |

## Implementation Design

### Core Interfaces

The production source uses TypeScript and keeps the model protocol-free.

```ts
export type DelegatedChildStatus = "starting" | "running" | "needs_input" | "finished" | "failed" | "cancelled"

export interface DelegatedChildSnapshot {
  childId: SessionId
  parentId: SessionId
  parentGeneration: number
  childGeneration: number
  status: DelegatedChildStatus
  task: string
  desiredOutcome: string
  terminal?: { status: "finished" | "failed" | "cancelled"; at: number }
}
```

The following Go-style structure is a workflow-required, language-neutral contract sketch only; it is not target source code for Kitten.

```go
type DelegationGroupSnapshot struct {
    ParentID  string
    ChildIDs  []string
    IsSettled bool
}
```

```ts
export interface StartDelegatedChildInput {
  parentId: SessionId
  task: string
  desiredOutcome: string
}

export interface ControllerActions {
  startDelegatedChild(input: StartDelegatedChildInput): Promise<SessionId | null>
  steerDelegatedChild(childId: SessionId, text: string): Promise<PromptResult | null>
  cancelDelegatedChild(childId: SessionId): Promise<void>
}
```

### Data Models

| Model | Fields | Rules |
| --- | --- | --- |
| `DelegationState` | `parents`, `children` records keyed by `SessionId`. | Immutable, in-process only, and empty after restore. |
| `DelegationParent` | Parent id, current parent generation, ordered child ids, close state. | Parent owns a flat child set only; no nesting or re-parenting. |
| `DelegatedChildSnapshot` | Parent/child ids, both generations, explicit task/outcome, lifecycle, optional terminal snapshot. | Child id is unique; terminal state is immutable and settles once. |
| Workspace conversation metadata | Optional delegation parent/child cue. | Must not duplicate provider, runtime, or interaction payload data. |

Lifecycle transitions are:

`starting → running → finished | failed | cancelled`

`starting` and `running` may transition to `needs_input`; resolving the existing child interaction returns the child to `running`. No terminal state may transition again. A session `error` publishes `failed`; explicit controller cancellation publishes `cancelled`; a terminal completed turn publishes `finished`.

### API Endpoints

No network endpoints are added. The in-process `ControllerActions` API is the only new command surface.

| Command | Inputs | Result | Failure behavior |
| --- | --- | --- | --- |
| `startDelegatedChild` | Parent id, explicit task, desired outcome. | Child id or `null`; parent remains focused. | No-op with workspace feedback for unavailable/closing parent or invalid input. |
| `steerDelegatedChild` | Owned child id and non-empty text. | Existing prompt result. | No-op for unknown, terminal, stale, or closing child. |
| `cancelDelegatedChild` | Owned child id. | Resolves after controller cancellation attempt. | Idempotent; reports teardown failure in child state. |
| `closeConversation` extension | Parent id and confirmed cascade choice. | Existing close result. | Rejects implicit detach; preserves visible failed teardown state. |

### Store and Controller Contract

- Add `delegation` to `AppState`; `AppStore` exposes `addDelegatedSession`, `publishDelegatedChildState`, `removeDelegationChild`, and selectors for parent children and group status.
- `addDelegatedSession` must add the normalized session slice, background workspace conversation, and delegation child in one immutable state update. It must preserve `selectedVisibleId` as the parent.
- Refactor the controller’s private conversation factory so a delegated path can inherit the parent provider and working directory without inheriting focus behavior.
- Record the parent runtime generation at launch and the child runtime generation when registered. Every child publication verifies both current map ownership and matching generations before touching store state.
- Route child permissions and clarifications through the existing interaction coordinator. The delegation projection records only `needs_input`; it never copies interaction payloads or resolver functions.
- Extend parent close handling to discover non-terminal owned children before ordinary teardown. The dialog offers only keep-open or cancel-children-and-close. Cancellation remains idempotent and uses the existing per-session teardown path.
- Do not modify persisted run-record schemas for delegation. Add explicit restore tests proving no delegation ownership is reconstructed from ordinary persisted sessions.

## Integration Points

No external service integration is required. ACP remains behind the current adapter boundary. The feature integrates only with existing internal session creation, workspace visibility, interaction overlays, telemetry recording, and persisted-run restoration.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/types.ts` | modified | Adds delegation model types and optional workspace cue; medium invariant risk. | Preserve `SessionId` ownership and protocol-free imports. |
| `src/core/orchestration.ts` | new | Pure lifecycle reducer and selectors; high correctness value. | Add exhaustive transition tests. |
| `src/store/appStore.ts` | modified | Adds state/actions and atomic insertion/removal path; high consistency risk. | Keep `sessionReducer` as sole writer of `SessionState`. |
| `src/app/controller.ts` | modified | Adds child launch, generation-fenced publication, and cascade close; high lifecycle risk. | Reuse runtime map, coordinator, and teardown paths. |
| `src/app/actions.ts` | modified | Publishes delegation commands to UI; medium boundary risk. | Expose no connections or ACP types. |
| `src/ui/DelegationDialog.tsx` | new | Captures explicit launch data; medium interaction risk. | Keep it modal and validate empty fields locally. |
| Workspace UI and dialogs | modified | Adds lineage/status and parent-close choice; medium UX risk. | Use existing attention and close-copy conventions. |
| Persistence modules | test-only modification | V1 intentionally excludes delegation persistence. | Add negative restore coverage; do not change schema. |

## Testing Approach

### Unit Tests

- `src/core/orchestration.test.ts`: legal lifecycle transitions, terminal immutability, parent/child generation mismatches, flat ownership, aggregate status, cleanup eligibility, and selector structural sharing.
- `src/store/appStore.test.ts`: atomic delegated insertion retains parent focus, child removal does not remove unrelated sessions, session status updates project attention/terminal state, and restore starts with empty delegation state.
- `src/app/controller.test.ts`: two parallel child launches, partial launch failure, stale child publication, one-child failure isolation, child cancel idempotence, parent replacement, confirmed parent cascade, and teardown failure visibility.
- `src/ui/DelegationDialog.test.tsx`, `SessionsOverlay.test.tsx`, `TabWorkspace.test.tsx`, and `TabDialog.test.tsx`: required task/outcome fields, immediate Running indication, lineage cue, needs-input presentation, terminal result navigation, and close confirmation copy.

### Integration Tests

- Use injected controller connection/session factories to drive child startup and terminal events without real agent binaries.
- Exercise a parent and two children through start, one needs-input event, one failure, explicit response, group settlement, and confirmed close.
- Assert no stale or disposed runtime can update the delegation projection after replacement or cancellation.

The required gate is `rtk bun run typecheck && rtk bun test`; run `rtk bun run selfcheck` after new overlay/keymap wiring and `rtk bun run build` before release-facing handoff.

## Development Sequencing

### Build Order

1. Add pure delegation types, reducer, selectors, and exhaustive core tests in `src/core/` — no dependencies.
2. Extend `AppState` and `AppStore` with atomic delegated-session actions and store tests — depends on step 1.
3. Refactor controller session creation and implement generation-fenced child lifecycle/close handling with controller tests — depends on steps 1 and 2.
4. Add `ControllerActions` delegation commands and action-boundary tests — depends on step 3.
5. Add the delegation dialog, `Ctrl+G` keymap entry, lineage/status rendering, and parent-close dialog extension — depends on steps 2 and 4.
6. Add injected multi-child integration coverage and run typecheck, test, self-check, and build gates — depends on steps 1 through 5.

### Technical Dependencies

- Existing dynamic conversation factory, runtime map, connection-generation guard, interaction coordinator, and workspace reducer remain the required internal dependencies.
- No new third-party package, schema migration, external service, or provider-specific capability is required.

## Monitoring and Observability

- Emit opt-in, local, content-free counters for child launch requested/succeeded/failed, time to visible Running, child terminal state, parent cascade requested/completed, and teardown failure.
- Never record child task text, desired outcomes, prompts, transcript content, source code, or result content.
- Reuse existing status and clarification telemetry conventions; attach only session/provider capability classifications already safe for local telemetry.
- Alerting is not introduced for V1. Dogfood review compares launch success, visible-Running latency, attention discovery, terminal collection, and orphan count with PRD targets.

## Technical Considerations

### Key Decisions

- **Store-owned protocol-free state:** selected because UI needs immutable authoritative lifecycle data while ACP runtimes remain controller-private.
- **Ephemeral delegation graph:** selected because restore cannot safely reconstruct live ownership in V1.
- **Selector-derived completion:** selected because current UI state subscriptions meet the V1 need without another promise lifecycle.
- **Atomic child registration:** selected because the UI must never observe an unowned session that appears delegated.
- **Existing interaction coordinator:** retained because it already gives generation-safe, exactly-once resolution for child prompts requiring attention.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Partial child startup leaves inconsistent workspace state | Medium | Register ownership and background session atomically; publish launch failure as a terminal child snapshot. |
| Late events update a replaced or closed child | High | Check runtime map ownership plus parent and child generation before every publication. |
| Parent close races child completion | High | Serialize close per parent, mark close intent first, make terminal publication and cancellation idempotent, and assert final group settlement in tests. |
| Child attention is missed in a background session | Medium | Reuse existing attention queue and show parent-child lineage in all session surfaces. |
| Scope expands into automation | Medium | Keep templates, decomposition, scheduling, persistence, and external APIs out of the component contract. |

## Architecture Decision Records

- [ADR-001: Use a flat, host-owned delegation registry for V1](adrs/adr-001.md) — Bounds V1 to provider-neutral, flat delegation with safe parent ownership.
- [ADR-002: Prioritize fast, explicit child launch in the MVP](adrs/adr-002.md) — Keeps the parent focused and makes visible Running feedback the primary product moment.
- [ADR-003: Keep delegation state protocol-free and ephemeral in AppState](adrs/adr-003.md) — Separates immutable delegation projection from live controller runtimes and excludes persistence.
- [ADR-004: Derive delegation completion from store selectors in V1](adrs/adr-004.md) — Uses store-derived group status instead of a controller completion promise.
