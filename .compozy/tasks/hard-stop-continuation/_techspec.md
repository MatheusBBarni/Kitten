# Technical Specification: Hard Stop Continuation

## Executive Summary

Implement Hard Stop Continuation as a dedicated live-only lifecycle that mirrors Kitten's established separation of pure reducer state from controller-owned effects. The core records one generation-fenced continuation request and one recoverable payload; the controller owns cancellation, settlement, provider-capability admission, safe dispatch, and teardown. `PromptEditor` renders a content-free recovery status and routes submission or second Escape through typed `ControllerActions`.

The primary trade-off is deliberate: a dedicated lifecycle duplicates a small amount of steering-shaped state rather than reusing steering or a controller-only closure. That cost preserves the semantic difference between an ordinary post-interrupt prompt and a steering follow-up, keeps the state testable and live-only, and makes unsafe provider behavior fail closed. Same-session continuation is enabled only for an explicitly attested provider capability; all other outcomes restore the draft and require `/new`.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/core/types.ts` and `src/core/postInterruptContinuation.ts` | Define the closed continuation state, request, phases, capability verdict, and pure state transitions. | Protocol-free; no I/O, ACP, timers, or UI imports. |
| `src/core/sessionReducer.ts` | Applies continuation events as the sole writer of `SessionState.postInterruptContinuation`. | Does not send prompts or inspect connections. |
| `src/store/selectors.ts` | Projects stable content-free composer status and the one-time recovery payload. | Recovery blocks are exposed only to the focused composer selector. |
| `src/app/actions.ts` | Exposes typed queue, recovery acknowledgement, and Hard Stop actions to the UI. | No UI component reaches a connection directly. |
| `src/app/controller.ts` | Owns the post-interrupt coordinator, active-prompt settlement, generation fencing, capability admission, ordinary dispatch, cleanup, and harness transition. | Only application layer that coordinates live connections and lifecycle effects. |
| `src/app/harnessDelivery.ts` and persistence projections | Represent the closed `settled_interrupted` checkpoint without storing continuation content. | Content-free state only. |
| `src/ui/PromptEditor.tsx` | Renders queued/fallback state, queues one continuation, copies recovery content once, and gives queued continuation precedence to second Escape. | Uses selectors and `ControllerActions` only. |
| `src/telemetry/recorder.ts` and `src/core/bundleAssembler.ts` | Record allowlisted local outcomes and retain the existing transcript-only handoff boundary. | Never accept continuation text, request IDs, raw errors, routes, or capabilities. |

### Data Flow

1. `PromptEditor` invokes the typed Hard Stop action only for an eligible working session.
2. The controller captures the current `ActivePromptLifecycle`, clears any current steering ownership, creates a generation-fenced post-interrupt state, and requests provider cancellation.
3. A continuation submitted during or after this Hard Stop is accepted once into reducer-owned live state. Ordinary prompt and steering paths remain unavailable for that one submission.
4. The controller waits for the captured lifecycle's terminal settlement and the provider's attested safe-settlement verdict. It rechecks session ID, generation, request ID, and lifecycle identity before every transition.
5. Safe settlement moves the request to ordinary dispatch; uncertainty moves it to one-time recovery and records only a closed, content-free outcome.
6. `PromptEditor` copies a recovered payload into its native editor buffer, then acknowledges it so raw blocks leave store state. The run writer, telemetry recorder, diagnostics, and handoff assembler never receive those blocks.

### PRD Traceability

| PRD goal or user story | Technical component(s) |
| --- | --- |
| Safe explicit Hard Stop and ordinary continuation | Controller coordinator, action seam, core state/events, attested capability. |
| Visible queued continuation and second Escape | Selectors plus `PromptEditor` title/key handling and one-time recovery selector. |
| Draft-plus-`/new` uncertainty fallback | Coordinator recovery event, harness notice projection, existing start-fresh path. |
| Truthful first-harness recovery | Harness delivery `settled_interrupted` state, checkpoint writer, and restore projection. |
| Live-only privacy boundary | State stays outside turns; writer exclusion, closed telemetry events, and handoff negative tests. |
| Preserved approval/clarification precedence | Existing `working`-only Escape guard and controller interaction ownership remain unchanged. |

## Implementation Design

### Core Interfaces

The project-native contract notation is TypeScript, per clarification. Keep the following types protocol-free in `src/core/types.ts`; place pure transition helpers in `src/core/postInterruptContinuation.ts`.

```ts
export type PostInterruptContinuationPhase =
  | "idle" | "queued" | "waiting" | "dispatching" | "recovery"

export interface PostInterruptContinuationRequest {
  readonly id: string
  readonly generation: number
  readonly blocks: readonly PromptBlock[]
  readonly phase: PostInterruptContinuationPhase
}

export interface PostInterruptContinuationState {
  readonly interruptedTurnId: string | null
  readonly request: PostInterruptContinuationRequest | null
  readonly recovery: readonly PromptBlock[] | null
}
```

```ts
export interface ControllerActions {
  queuePostInterruptContinuation(input: PromptInput, sessionId?: SessionId): PostInterruptContinuationResult
  recoverPostInterruptContinuation(sessionId?: SessionId): void
  acknowledgePostInterruptRecovery(sessionId: SessionId, requestId: string): void
  cancel(sessionId?: SessionId): Promise<void>
}
```

`PostInterruptContinuationEvent` must use a closed union parallel to steering: enqueue, wait, dispatch, deliver, recover, and acknowledge. Every event after enqueue carries the exact request ID and generation. Reducer transitions are idempotent for stale or duplicate events and reject a second accepted request while one is pending.

### Data Models

| Model | Fields | Lifecycle and storage rule |
| --- | --- | --- |
| `PostInterruptContinuationRequest` | `id`, `generation`, `blocks`, `phase` | One live-only request per session. `blocks` never become a `Turn` until ordinary dispatch succeeds. |
| `PostInterruptContinuationState` | `interruptedTurnId`, `request`, `recovery` | Reducer-owned session field. Clear request on delivery; retain recovery only until composer acknowledgement. |
| `HardStopContinuationCapability` | closed provider verdict and fixed unsupported reason | Derived at the adapter/readiness boundary; app code receives only the protocol-free result. |
| `HarnessDelivery` | existing fields plus `state: "settled_interrupted"` | Content-free checkpoint for a cancelled first harness turn; distinct from `delivered` and `failed`. |
| `HardStopOutcome` | fixed outcome enum, provider kind, bounded duration bucket | Local opt-in telemetry only. No prompt text, request ID, raw error, endpoint, route, or capability value. |

Initialize `postInterruptContinuation` with `createSessionState`, add it to `SessionState`, and add reducer cases without modifying transcript semantics. The run writer must serialize only the expanded closed harness checkpoint. It must not inspect or serialize `PostInterruptContinuationState`.

### Action and Controller Design

1. Replace the direct Hard Stop branch in `actions.cancel()` with a controller-injected `beginHardStop` operation. The generic action remains the UI entry point, but the controller captures the active lifecycle before requesting cancellation.
2. Add `queuePostInterruptContinuation()` to `ControllerActions`. It composes the existing `PromptInput` into `PromptBlock[]`, rejects empty input and duplicate queue attempts, and dispatches a pure enqueue event. It must not create a transcript turn or invoke the provider.
3. Add `recoverPostInterruptContinuation()` for second Escape. If a continuation is queued, it dispatches recovery locally and returns without another provider cancellation. If none is queued, existing Escape semantics apply.
4. The controller coordinator owns one record keyed by session ID with the captured lifecycle identity, generation, request ID, cancellation request outcome, timeout handle, and capability verdict. It must invalidate that record on session replacement, conversation close, connection error, and controller disposal.
5. On a safe settlement, the coordinator clears `activePrompts` through the existing lifecycle path before it dispatches the continuation as an ordinary prompt. It atomically changes the reducer phase to dispatching, invokes the normal prompt route once, then delivers a normal user turn only after dispatch is accepted.
6. On cancellation failure, settlement timeout, connection error, stale generation, missing capability, or close, the coordinator dispatches recovery. It never falls back to steering, retries, a concurrent prompt, or automatic `/new`.

### Harness Delivery and Persistence

For a fresh harness-bearing turn, Hard Stop must defer the existing indeterminate failure transition until cancellation and terminal settlement are classified. A confirmed same-generation interruption moves the harness checkpoint from `in_flight` to `settled_interrupted`; the subsequent ordinary continuation must not attach the harness again. A failed or ambiguous interruption retains the existing `failed` path.

Update the closed checkpoint union and every projection together:

- `src/app/harnessDelivery.ts` for creation, transition, restoration, and notices.
- `src/store/appStore.ts` for checkpoint projection and session cleanup.
- `src/persistence/runRecord.ts` for strict Zod acceptance of `settled_interrupted`.
- `src/persistence/runWriter.ts` for content-free snapshot writing.
- controller restoration to retain the truthful checkpoint without resurrecting a continuation draft.

### API Endpoints

Kitten exposes no HTTP endpoint for this feature. The implementation adds only the in-process `ControllerActions` methods defined above. ACP-specific safe-settlement evidence remains inside `src/agent/`; it is translated to a protocol-free capability verdict before app/controller code uses it.

## Integration Points

| Integration | Contract | Failure behavior |
| --- | --- | --- |
| ACP adapter layer | Supplies an explicit attested safe-settlement capability and terminal evidence for the active session generation. | Missing, unsupported, stale, or failed evidence returns a closed unavailable verdict; no continuation dispatch. |
| Existing prompt lifecycle | Provides one captured settlement promise and active lifecycle identity. | A late or duplicate callback cannot advance a continuation after identity or generation changes. |
| Harness delivery checkpoint | Represents `settled_interrupted` separately from delivered and failed. | Ambiguous cancellation stays failed; continuation recovers to the composer. |
| Persistence | Writes only the closed harness checkpoint. | Restart never reconstructs queued text or dispatch authority. |
| Local telemetry | Emits allowlisted outcome and timing records when opt-in is enabled. | Disabled telemetry is a no-op; invalid or content-bearing fields cannot be encoded. |
| Handoff assembly | Continues to consume transcript turns only. | Pending/recovered continuation content cannot enter a handoff bundle. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/types.ts` | Modified | Adds live-only state/event/capability vocabulary; incorrect widening can contaminate protocol boundaries. | Add closed TypeScript unions and comments documenting non-persistence. |
| `src/core/postInterruptContinuation.ts` | New | Pure single-slot state machine; stale-event behavior is safety-critical. | Implement deterministic helpers and isolated unit tests. |
| `src/core/sessionReducer.ts` | Modified | Becomes the sole writer for continuation lifecycle. | Add event cases and preserve structural sharing. |
| `src/store/selectors.ts` | Modified | UI needs stable phase and one-time recovery access. | Add content-free status selector plus focused recovery selector. |
| `src/app/actions.ts` | Modified | Routes UI input to Hard Stop/queue/recovery without direct transport access. | Add typed actions and keep ordinary/steering admission distinct. |
| `src/app/controller.ts` | Modified | Owns cancellation, settlement, generation fencing, and one safe ordinary dispatch. | Add coordinator lifecycle and cleanup at every runtime boundary. |
| `src/app/harnessDelivery.ts` | Modified | Needs truthful first-turn interruption state. | Add `settled_interrupted` transition and fail-closed ambiguity handling. |
| `src/persistence/runRecord.ts`, `src/persistence/runWriter.ts`, `src/store/appStore.ts` | Modified | Closed checkpoint must persist without raw continuation content. | Update schema, projection, writer, restoration, and negative privacy tests together. |
| `src/ui/PromptEditor.tsx` | Modified | Must distinguish queueing/recovery/second Escape from steering and ordinary send. | Add selector-driven status, action routing, and native-buffer restore effect. |
| `src/telemetry/recorder.ts` | Modified | New outcome evidence must remain content-free. | Add fixed event union, no-op method, and allowlist tests. |
| `src/core/bundleAssembler.ts` and `src/app/handoff.ts` | Test-only verification | Current transcript-only boundary is correct but must remain so. | Add sentinel negative regression coverage; no new data path. |

## Testing Approach

### Unit Tests

- Test the pure continuation state machine for empty input, one accepted request, duplicate rejection, phase progression, recovery acknowledgement, stale request IDs, stale generations, and structural sharing.
- Test `settled_interrupted` harness transitions separately from `delivered` and `failed`, including duplicate/stale transition no-ops.
- Test selector stability: generic composer status contains no raw blocks, and the recovery selector exposes one exact payload only until acknowledgement.
- Test closed telemetry record creation and schema allowlists with sentinel continuation content; assert that no allowed record can carry it.
- Test strict persistence schema and run-writer snapshots: `settled_interrupted` round-trips, while queued blocks, request IDs, raw errors, and recovery text do not appear.

### Integration Tests

- Use deferred fake prompt lifecycles to prove a continuation submitted before settlement is held and then sent exactly once as an ordinary next prompt after safe settlement.
- Cover cancellation failure, timeout, connection error, session replacement, close, disposal, delayed completion, duplicate completion, stale generation, and missing/unsupported capability. Each must leave a recoverable draft and make zero continuation dispatches.
- Cover a fresh harness turn: original prompt has one harness, confirmed interruption reaches `settled_interrupted`, continuation is ordinary, and no duplicate harness appears.
- Cover repeated Escape: the first cancellation reaches the provider once; the second Escape restores the queued draft locally and does not increment cancellation count.
- Cover `PromptEditor` visible phases, queue submission, recovery copying, editable later drafts, prompt history and file-reference preservation, and unchanged approval/clarification precedence.
- Assemble a handoff and inspect telemetry, persisted run data, and diagnostics fixtures using a sentinel continuation draft; assert the sentinel never appears.
- Run attested-adapter integration fixtures for every enabled profile and assert all other profiles return the closed fallback before dispatch.

## Development Sequencing

### Build Order

1. Add protocol-free TypeScript continuation types, pure helpers, session initialization, reducer events, and selector contracts — no dependencies.
2. Add action-layer queue/recovery methods and their unit tests — depends on step 1.
3. Add the controller Hard Stop coordinator, lifecycle fencing, attested-capability admission, and ordinary-dispatch path — depends on steps 1 and 2.
4. Add `settled_interrupted` harness transition plus app-store, strict persistence, and restoration projections — depends on steps 1 and 3.
5. Integrate `PromptEditor` queued/recovery/second-Escape behavior and preserve existing interaction precedence — depends on steps 2 and 3.
6. Add closed telemetry outcomes and sentinel privacy coverage for persistence, diagnostics, and handoff — depends on steps 3 and 4.
7. Add the full deferred-lifecycle, UI, adapter-capability, and race regression matrix; run the repository gate — depends on steps 1 through 6.

### Technical Dependencies

- Existing `ActivePromptLifecycle.settlement` and generation identity remain the authoritative local turn boundary.
- Attested provider capability evidence must be available before a profile can enable same-session continuation.
- Existing `PromptEditor` native-buffer recovery, steering selector pattern, strict persistence schemas, and local telemetry recorder remain reusable seams.
- No new package, directory hierarchy, HTTP service, database, remote telemetry sink, or retry scheduler is required.

## Monitoring and Observability

Add a closed, opt-in local Hard Stop outcome taxonomy such as `queued`, `dispatched`, `restored`, `fallback_unsupported`, `fallback_cancel_failed`, `fallback_timeout`, `fallback_connection_error`, and `fallback_generation_changed`. Records may contain provider kind and coarse duration buckets only.

Monitor these release gates:

- Zero continuation content, request IDs, raw errors, endpoints, routes, or capability values in telemetry, persistence, diagnostics, and handoff fixtures.
- Zero duplicate ordinary dispatches after a hard stop in the deterministic race suite.
- Proof-eligible same-session continuation completion and fallback frequency, measured only when telemetry is enabled.
- Time from authoritative settlement to ordinary continuation dispatch, measured in coarse local buckets.

No remote logging, automatic alerting, or content-bearing debug channel is introduced by this feature.

## Technical Considerations

### Key Decisions

- **Core state plus controller effects** — keeps lifecycle transitions deterministic while retaining all transport authority in the controller. The alternative controller-only state weakens the normal store contract; steering reuse has incompatible semantics.
- **Attested safe settlement** — distinguishes provider-proof from local promise settlement. The alternative generic callback path can dispatch into ambiguous provider state.
- **Metadata-only restore** — persists `settled_interrupted` but never queued text. The alternative durable draft path violates the live-only privacy contract.
- **Layered verification gate** — covers pure state, controller races, UI recovery, persistence, telemetry, handoff, and adapter profiles. Controller-only or manual coverage cannot prove the required boundaries.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| An adapter reports terminal state without actual safe continuation semantics | Medium | Require an explicit attested capability, exact profile integration tests, and unsupported fallback by default. |
| A stale callback sends a withdrawn draft | Medium | Fence every asynchronous callback with session, generation, request, and lifecycle identity; atomically remove the slot before dispatch. |
| A new surface serializes continuation content | Medium | Keep blocks outside turns and persisted projections; add sentinel negative tests across every output surface. |
| Escape conflicts with a modal interaction | Low | Preserve the working-only guard and modal precedence; regress approval and clarification tests. |
| The state machine grows toward generic orchestration | Low | Enforce one slot, no retries, no durable queue, and no new scheduler in the ADR-backed scope. |

## Architecture Decision Records

- [ADR-001: Use a bounded, proof-gated same-session continuation](adrs/adr-001.md) — Defines the product-level one-slot, fail-closed continuation contract.
- [ADR-002: Prioritize visible automatic recovery with a lossless fallback](adrs/adr-002.md) — Selects automatic safe recovery and deliberate `/new` fallback.
- [ADR-003: Model continuation state in the core and effects in the controller](adrs/adr-003.md) — Keeps pure live state reducer-owned and all effects controller-owned.
- [ADR-004: Gate continuation on attested settlement and persist only closed metadata](adrs/adr-004.md) — Requires provider proof, `settled_interrupted`, and content-free persistence/observability.
