# TechSpec: Reliable Concurrent MCP Calls for Supervised Work

## Executive Summary

Implement issue #27 as a focused repair to `kittenMcpBridge`: admit multiple
independently authenticated sockets for one session-generation route, then apply
the existing four-pending-call route limit as the only concurrent-call gate. The
controller remains the owner of session authority, clarification lifecycle, and
delegated child execution. The bridge keeps its private endpoint, capability
authentication, generation fencing, strict frames, and per-route lifetime limit.

The repair also gives the existing tool-call surface a closed, protocol-free
failure projection and forwards a content-free bridge outcome to opt-in local
telemetry. The primary trade-off is small connection and adapter classifier state
instead of a queue, persistent history, or automatic retry. This directly serves
the PRD's **P0: Mixed-Work Continuity**, **P0: Truthful Outcome States**, and
**P0: Deliberate Recovery Guidance** without expanding into a work scheduler.

## System Architecture

### Component Overview

| Component | Responsibility and boundary | Change |
| --- | --- | --- |
| `src/agent/askUserMcp.ts` | One short-lived authenticated child connection per MCP invocation; returns fixed JSON errors. | Preserve transport and exact `busy`/`unavailable` envelopes. |
| `src/app/kittenMcpBridge.ts` | Private endpoint, capability validation, route admission, socket lifecycle, bridge failure reporting. | Replace singleton socket ownership with per-route socket membership and isolated disconnect settlement. |
| `src/app/controller.ts` | Owns runtime/generation authority, targeted clarification lifecycle, delegated work, and bridge construction. | Add targeted handle cancellation and wire failure categories to the recorder. |
| `src/agent/acpTranslate.ts` and `agentConnection.ts` | ACP anti-corruption boundary. | Classify only controlled bundled-MCP error output into a domain failure kind. |
| `src/core/types.ts` and `sessionReducer.ts` | Protocol-free transcript model and sole state writer. | Store and merge the optional closed failure kind. |
| `src/ui/ToolCallRow.tsx` | Existing visible MCP outcome surface. | Render distinct textual capacity and unavailable states; no retry button. |
| `src/telemetry/recorder.ts` | Opt-in, local, content-free telemetry. | Record a closed bridge outcome category only. |

### Data Flow

1. `ask_user` and `agent_run` child invocations open separate local sockets and send a strictly parsed frame containing a capability and call ID.
2. The bridge validates the capability, associates the socket with at most one route, reserves the existing per-route pending capacity, then dispatches the clarification or agent-run operation.
3. Each pending call retains its originating socket. A successful terminal result is sent only to that socket. A fifth pending call receives `busy` immediately; no call is queued.
4. A socket disconnect cancels only its exact clarification handle or loses only its own agent-run response. Route replacement, session closure, and controller disposal still invalidate the entire route.
5. The child returns its fixed error envelope through ACP. The adapter recognizes only the bundled server's exact envelope and emits a protocol-free failure kind. The reducer stores it and `ToolCallRow` renders content-free guidance.
6. Independently, bridge failure reasons are mapped in the controller to a closed opt-in telemetry outcome. No raw bridge or user content crosses that boundary.

## Implementation Design

### Core Interfaces

The production implementation remains TypeScript. The Go structure below is a
compact contract notation required by this planning workflow; it documents the
route admission boundary and is not a new Go package or runtime dependency.

```go
// Documentation-only contract; production code is TypeScript.
type RouteAdmission struct {
    RouteID string // private, never rendered or recorded
    CallID  string
}

type RouteAdmitter interface {
    Reserve(RouteAdmission) error // nil or bounded busy/invalid/unavailable
}
```

Add the following TypeScript types in existing files. `failureKind` is absent for
ordinary tool calls; `null` on an update deliberately clears a prior classification.

```ts
export type ToolCallFailureKind = "temporary_capacity" | "unavailable"

export interface ToolCallUpdate {
  toolCallId: string
  status?: ToolCallStatus
  failureKind?: ToolCallFailureKind | null
}

export interface ClarificationRequestHandle {
  readonly requestId: string
  readonly outcome: Promise<ClarificationOutcome>
  cancel(reason: ClarificationSessionLossReason): boolean
}
```

Bridge mechanics stay local to `kittenMcpBridge.ts`; do not expose route maps or
socket identities outside that module. Implement the following rules:

- Replace `Route.boundSocket` with route-owned membership, such as `Set<KittenMcpBridgeSocket>`, while `ConnectionState.route` remains the one-route-per-socket guard.
- Bind a valid socket before reservation; call `reserveCall` unchanged for duplicate IDs, the four-pending-call bound, and the 256-call route lifetime bound.
- Keep `PendingCall.socket`; on a socket close/error, select only pending entries whose socket matches. Call `handle.cancel("connection_error")` for a clarification, delete that entry, and do not invoke `closeRoute`.
- For a disconnected `agent_run`, delete only the bridge pending entry. The child observes `unavailable`; the controller may finish the underlying start, but Kitten does not replay it.
- Keep `closeRoute` as the exclusive whole-route teardown path. It cancels all route clarifications, closes active sockets through the listener, deletes maps, and removes the endpoint.
- Convert the controller's start-guard and route availability failures into `KittenMcpBridgeError("busy")` or `KittenMcpBridgeError("unavailable")` at the control boundary. Do not infer a category from arbitrary error text in the bridge.

The adapter maintains a private set/map keyed by ACP tool-call ID. When a full
tool call identifies the bundled `mcp.kitten-ask-user.*` server, mark that ID as
eligible. For its later ACP updates, parse only a single text content block whose
JSON is exactly `{ "error": "busy" }` or `{ "error": "unavailable" }`; emit the
closed failure kind and discard the text. Remove eligibility after a terminal
update. All other ACP tool content continues through existing translation rules.

### Data Models

| Model | Location | Change and invariant |
| --- | --- | --- |
| `Route` | `src/app/kittenMcpBridge.ts` | Holds private route authority plus a set of bound sockets, `callIds`, `pending`, `totalCalls`, and `closing`. No one socket owns the route. |
| `ConnectionState` | `src/app/kittenMcpBridge.ts` | Retains buffered bytes, exactly zero or one route reference, and closed state. It must be removed on every close path. |
| `PendingCall` | `src/app/kittenMcpBridge.ts` | Keeps the origin socket and optional exact clarification handle, allowing per-socket settlement. |
| `ClarificationRequestHandle` | `src/app/controller.ts` | Gains targeted `cancel(reason)` backed by the interaction coordinator; cancellation is idempotent. |
| `ToolCallFailureKind` | `src/core/types.ts` | Closed union `temporary_capacity | unavailable`; protocol-free and never stores source error text. |
| `ToolCallRecord` / `ToolCallUpdate` | `src/core/types.ts` | Optional `failureKind`; reducer preserves omitted values and clears only explicit `null`. |
| `McpBridgeFailureCategory` | `src/telemetry/recorder.ts` | Closed telemetry union `capacity_limited | unavailable | invalid_request`, with no identity or content fields. |

No database schema, persisted error history, configuration key, or public API is
introduced. Socket endpoint and capability remain ephemeral private authority.

### API Endpoints

There is no HTTP or public API change. The internal newline-delimited local IPC
protocol remains source-compatible:

| Frame | Existing request | Result after this work |
| --- | --- | --- |
| `ask` | `{ kind, callId, capability, form }` | Separate valid sockets for one route may be admitted until four calls are pending; excess receives `{ kind: "error", error: "busy" }`. |
| `agent_run` | `{ kind, callId, capability, request }` | Same admission rules; controller start-guard saturation becomes bounded `busy`, unavailable route becomes `unavailable`. |
| `error` | `{ kind: "error", callId?, error }` | Keeps `invalid_request | busy | unavailable`; child keeps its exact fixed JSON tool-error envelope. |

Do not add protocol fields for retry tokens, queues, failure text, endpoint
details, route IDs, or execution history.

## Integration Points

### ACP and bundled MCP child

The child already opens a private local connection and returns fixed tool-error
content. Preserve capability authentication and strict result-frame validation.
The ACP adapter is the only place allowed to inspect ACP `ToolCallContent`; core
and UI receive only `ToolCallFailureKind`. There is no external network service,
new SDK, or remote integration.

### Controller and interaction coordinator

`kittenMcpBridge` calls the existing controller-owned clarification factory. Add
targeted cancellation to the returned handle so a failed child socket cannot
cancel another socket's valid clarification. The controller remains responsible
for generation checks before enqueue and at agent-run dispatch, preserving
same-parent and cross-session isolation.

### Telemetry

Pass the bridge's existing `onFailure` callback when the controller constructs it.
Map it to a recorder method that accepts only the closed category. The recorder
must remain disabled-by-default, local JSONL only, and structurally unable to
receive prompts, task text, capabilities, endpoints, call IDs, session IDs, or
raw errors. Keep existing `agent_run_control` telemetry unchanged.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| `src/app/kittenMcpBridge.ts` | modified | High lifecycle risk: replaces route-wide socket exclusivity with per-socket ownership. | Implement membership, targeted settlement, typed control failures, and remove stream-limit admission. |
| `src/app/controller.ts` | modified | Medium lifecycle risk: exposes exact clarification cancellation and maps bridge failures. | Add idempotent handle cancellation, typed busy/unavailable control errors, recorder wiring. |
| `src/agent/acpTranslate.ts`, `agentConnection.ts` | modified | Medium presentation/privacy risk: classify only controlled error envelopes. | Add bounded classifier state and tests; never forward raw content. |
| `src/core/types.ts`, `sessionReducer.ts` | modified | Low data-model risk: optional domain field needs merge semantics. | Add and test `failureKind` preservation and explicit clearing. |
| `src/ui/ToolCallRow.tsx` | modified | Low UX risk: wording must be distinct without implying replay. | Render accessible textual state and known-outcome manual guidance; add no action control. |
| `src/telemetry/recorder.ts` | modified | Medium privacy risk: new event must stay closed and opt-in. | Add fixed type/method/event and no-content tests. |
| bridge, controller, adapter, UI, and integration tests | modified | High regression-prevention value. | Replace false-contention expectations and add layered concurrency/isolation evidence. |

## Testing Approach

### Unit Tests

- **Bridge admission and lifecycle** (`src/app/kittenMcpBridge.test.ts`): replace the competing-stream rejection test with two distinct authenticated sockets on one route: a pending `agent_run` and a pending `ask` both dispatch. Verify a fifth pending call across distinct sockets gets immediate `busy`, does not queue, and reports the capacity category. Verify duplicate ID, malformed frame, unauthorized capability, call lifetime limit, generation replacement, and cross-route rejection remain unchanged.
- **Per-socket disconnect**: with two admitted same-route sockets, close/error one while it owns an ask or an agent-run. Assert only that call settles/cancels, the other pending call and route stay live, and a new valid socket can still be admitted. Separately assert route replacement/dispose still cancels all route-owned work and removes the endpoint.
- **Controller boundary** (`src/app/controller.test.ts`): prove a concurrent same-route `agent_run.start` projects `busy`, an unavailable route projects `unavailable`, targeted handle cancellation is idempotent, and unrelated interaction requests remain active. Retain existing four-visible-child launch and parent-generation ownership tests.
- **Core and adapter** (`src/core/*test.ts`, `src/agent/acpTranslate.test.ts`): test initial/update merge and explicit `null` clearing; classify exact `busy` and `unavailable` envelopes only for remembered bundled-MCP tool IDs; reject malformed, extra-key, unrelated-server, or arbitrary text content without retaining it.
- **UI and telemetry** (`src/ui/ToolCallRow.test.tsx`, `src/telemetry/recorder.test.ts`): assert textual capacity/unavailable wording, normal failed rows unchanged, no retry control, and recorder records only the fixed category when enabled and nothing when disabled. Assert no free-text telemetry property exists.

### Integration Tests

- Extend `test/askUserMcp.integration.test.ts` with the real generated child and private IPC: invoke `ask_user` and `agent_run` concurrently from one parent environment, which creates separate sockets, then settle both and assert their structured results.
- Fill all four route slots with separate child invocations and assert the next request receives the fixed busy tool error. Settle calls and prove a later invocation succeeds without re-registration.
- Run the same mixed flow against two parent session environments. Assert each can control only its own route and cannot poll or observe the other's delegated child, even while the other has pending calls.
- Add an ACP fixture/provider-level path that emits a bundled MCP failed tool call with each exact envelope and assert the transcript stores and renders the projected state. Do not use a real external provider or network.

Run the focused tests first, then the repository quality gates required by `CLAUDE.md`/`RTK.md`: `rtk bun run typecheck`, `rtk bun test`, `rtk bun run selfcheck`, and `rtk bun run build` because controller, bridge, and visible UI behavior change.

## Development Sequencing

### Build Order

1. **Define closed contracts and tests** — no dependencies. Add domain `ToolCallFailureKind`, telemetry category types, typed controller-control error contract, and targeted clarification-handle cancellation; write failing unit tests for merge, cancellation, and category mapping.
2. **Refactor bridge route admission and socket lifecycle** — depends on step 1. Replace `boundSocket`, retain capacity reservation, make disconnect settlement per socket, and update bridge lifecycle tests.
3. **Wire controller authority and telemetry** — depends on steps 1 and 2. Implement exact interaction cancellation, convert authoritative controller busy/unavailable failures, and connect the bridge callback to the opt-in recorder.
4. **Project failures through the ACP boundary and core** — depends on step 1 and the stable child envelope preserved in step 2. Add bundled-tool eligibility tracking, exact-envelope classification, reducer merge behavior, and adapter tests.
5. **Render truthful tool outcomes** — depends on step 4. Add `ToolCallRow` labels and manual-only guidance; verify no retry UI or raw detail appears.
6. **Prove end-to-end behavior and run quality gates** — depends on steps 2 through 5. Add real-child mixed-call, saturation, disconnect, cross-session, and ACP fixture coverage, then run the required verification commands.

### Technical Dependencies

- Existing private endpoint implementation, capability generation, strict IPC parser, and route call bounds remain available and unchanged in interface.
- The controller's interaction coordinator must support exact request cancellation before the bridge disconnect refactor lands.
- The bundled child must continue returning the fixed `{ "error": ... }` envelope; changing it requires updating the exact adapter classifier and its tests in the same change.
- No external infrastructure, service credential, database migration, configuration rollout, or provider upgrade is required.

## Monitoring and Observability

Add a new opt-in local event, for example `kitten_mcp_bridge_failure`, with only
`mcpBridgeFailureCategory: "capacity_limited" | "unavailable" | "invalid_request"`.
It is emitted through the existing recorder from the controller's bridge callback.
It records neither a raw bridge reason nor any user or route identity. Existing
`agent_run_control` remains the measure of controller operation outcomes.

Use the following release checks rather than an alerting service:

| Signal | Interpretation | Release response |
| --- | --- | --- |
| `capacity_limited` rate during dogfood | Genuine bounded pressure after false stream contention is removed. | Review capacity assumptions; do not add a queue without a new decision. |
| `unavailable` rate | Route, lifecycle, or transport availability regression. | Inspect local content-free category trends and focused tests; never mine prompts or raw errors. |
| Mixed-call integration and cross-session test pass rate | Direct proof of the PRD's continuity and isolation promise. | Block release on a failure. |
| Telemetry schema/privacy tests | Structural proof that observation remains opt-in and content-free. | Block release on a failure. |

## Technical Considerations

### Key Decisions

- **Decision:** use multi-socket bounded admission on the existing route. **Rationale:** the child intentionally uses a connection per invocation, while the route already owns correct capacity and authorization. **Trade-off:** more exact lifecycle bookkeeping. **Rejected:** a queue, a persistent child socket, and unbounded fanout.
- **Decision:** cancel work by originating socket, but invalidate all work only at route lifecycle boundaries. **Rationale:** one failed child connection must not break another valid call. **Trade-off:** an ambiguous `agent_run.start` can finish without its caller receiving a result. **Rejected:** route-wide close on every disconnect.
- **Decision:** project only `temporary_capacity` and `unavailable` into the protocol-free transcript. **Rationale:** it gives truthful, bounded UX without storing provider output. **Trade-off:** unrelated MCP errors stay generic. **Rejected:** raw error display and one universal retry state.
- **Decision:** no automatic replay. **Rationale:** a disconnected start may have reached the controller and must not be duplicated. **Trade-off:** the author may need a deliberate follow-up after a known terminal outcome. **Rejected:** reconnect-and-resend behavior and durable history in V1.

### Known Risks

- **Disconnect races with a terminal result (medium):** use idempotent pending deletion and handle cancellation; test result-before-close and close-before-result ordering.
- **Controller busy loses its semantic category (medium):** use a typed local error/result at the control boundary, not message-string inspection; assert bridge output is `busy`.
- **ACP provider update shape differs (medium):** keep classification at the ACP boundary and test title-on-create/content-on-update sequencing. If a certified provider cannot expose the exact envelope, retain generic failure rather than guess or leak text.
- **New telemetry violates privacy (low if typed):** expose only a closed enum through the recorder interface and test disabled and enabled paths.
- **Scope creeps into scheduling or replay (medium):** reject queues, durable histories, shared capacity, dashboards, and configuration controls from this implementation.

## Architecture Decision Records

- [ADR-001: Keep concurrent MCP admission controller-owned and bounded](adrs/adr-001.md) — Keeps session authority and resource bounds at the controller/bridge boundary.
- [ADR-002: Center the MVP on mixed supervised work and deliberate recovery](adrs/adr-002.md) — Defines the primary supervised-work scenario and forbids automatic replay.
- [ADR-003: Admit independently authenticated sockets within route capacity](adrs/adr-003.md) — Replaces false singleton-socket contention with bounded per-route admission and isolated socket lifecycle.
- [ADR-004: Project closed MCP failures without replaying ambiguous work](adrs/adr-004.md) — Carries only bounded capacity/unavailable states through the transcript and opt-in telemetry.
