# Technical Specification: Clarification Question Picker

## Executive Summary

Implement structured clarification as a protocol-free interaction flow that begins at the ACP adapter boundary and ends in a dedicated terminal dialog. The adapter maps the experimental ACP elicitation callback only for verified adapter/version recipes. The core exposes a distinct clarification waiting status. A controller-owned interaction coordinator owns request identity, preemption, resumption, and terminal settlement. The store and UI render only the active interaction.

The primary trade-off is limited compatibility for reliable behavior. A fail-closed allowlist and actual adapter contract tests limit initial provider coverage, while a shared controller coordinator changes more of the existing permission flow than a second queue. In return, Kitten avoids exposing unstable ACP behavior for unknown adapters, prevents stale or misrouted decisions, and makes immediate clarification preemption deterministic without conflating permissions and clarifications.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary and data flow |
|---|---|---|
| ACP adapter in src/agent/agentConnection.ts | Advertises and handles experimental elicitation only when the resolved recipe is verified; maps ACP forms and responses. | ACP types enter and leave here only. It emits a protocol-free clarification payload; the controller attaches Kitten session lifecycle data. |
| Capability classifier in src/config | Resolves each provider configuration to supported or unsupported using an exact verified allowlist. | Runs before connection initialization and passes a protocol-free result to the adapter and UI-facing state. |
| Domain core in src/core | Defines clarification request/outcome data and awaiting clarification status. | Remains pure and ACP-free. Publishes status changes for all attention surfaces. |
| Interaction coordinator in src/app/controller.ts | Owns pending permission and clarification entries, active selection, clarification preemption, resumption, and terminal settlement. | Holds resolver promises and projects only the active interaction into store overlays. |
| Actions and store | Exposes dedicated clarification responses and stores active overlay projections. | Never routes answers through ordinary prompt submission. |
| Clarification UI | Renders the top-priority modal, manages selection and text input, and emits one terminal answer or cancellation. | Operates only on protocol-free view data and controller actions. |
| Attention, notification, telemetry | Presents clarification as needs-attention and records content-free lifecycle metrics. | Reuses the shared needs-attention predicate. |

### Request Lifecycle

1. Configuration classifies a provider recipe as supported or unsupported before connection initialization.
2. A supported connection advertises the ACP elicitation client capability and receives an experimental form request.
3. The adapter normalizes the form into a protocol-free ClarificationPayload and emits it through the connection callback without Kitten session identity or lifecycle knowledge.
4. The controller receives the callback, attaches the Kitten session ID and connection generation to create a ClarificationRequest, marks the session as awaiting clarification, and enqueues it. A clarification becomes active immediately, suspending any active agent interaction and taking top modal priority over all other overlays.
5. The clarification dialog returns exactly one protocol-free outcome: answered values or terminal cancellation.
6. The coordinator verifies the active request ID and connection generation, settles the original adapter callback, restores session status, and resumes the suspended interaction.
7. Disconnect, restart, disposal, or user cancellation terminally cancels the matching request. The request is never persisted or replayed.

### Requirement Traceability

| PRD section | Technical component |
|---|---|
| Goals: fast unblocking and capability transparency | Capability classifier, request timer, coordinator, telemetry records |
| User Stories: active and multi-session users | Session-attributed request view, active interaction coordinator, clarification status |
| User Stories: keyboard-first user | Dedicated clarification keymap and modal input ownership |
| Core Features: choices, text, cancellation | Normalized form model, outcome mapper, dedicated UI state |
| Core Features: return to work | Active-overlay priority resolution and coordinator resumption |
| Core Features: privacy-preserving measurement | Local content-free telemetry events and derived duration |
| High-Level Technical Constraints | ACP boundary, fail-closed allowlist, protocol-free domain types |

## Implementation Design

### Core Interfaces

Production source uses TypeScript. This protocol-free contract is the primary dependency for the controller, store, and UI.

~~~ts
export interface ClarificationPayload {
  prompt: string
  fields: ClarificationField[]
}
export type ClarificationOutcome =
  | { kind: "answered"; values: Record<string, string | string[]> }
  | { kind: "cancelled" }

export interface InteractionCoordinator {
  enqueueClarification(
    sessionId: SessionId, generation: number, payload: ClarificationPayload,
  ): Promise<ClarificationOutcome>
  resolveActive(requestId: string, outcome: ClarificationOutcome): void
  cancelSession(sessionId: SessionId, generation: number): void
}
~~~

Protocol-neutral data-shape sketch in Go format. Production behavior remains defined by the TypeScript contract above.

~~~go
type ClarificationRequest struct {
    RequestID string
    SessionID string
    ConnectionGeneration int
}
type ClarificationOutcome struct {
    Kind string
    Values map[string]any
}
type InteractionCoordinator interface {
    EnqueueClarification(ClarificationRequest) <-chan ClarificationOutcome
    ResolveActive(string, ClarificationOutcome)
    CancelSession(string, int)
}
~~~

### Data Models

| Model | Fields | Ownership |
|---|---|---|
| ClarificationCapability | supported or unsupported, optional diagnostic category | Configuration/readiness result; no ACP type leaves src/agent. |
| VerifiedClarificationRecipe | provider kind, exact built-in package/version identity | Static allowlist backed by real adapter contract tests. |
| ClarificationField | stable ID, label, optional description, mode of single, multi, or text, option list, required flag | Adapter-normalized form view consumed by core and UI. |
| ClarificationOption | stable ID, label, optional description | Protocol-free; selected values never enter telemetry. |
| ClarificationPayload | prompt and normalized fields | Adapter-owned normalized form value with no Kitten session or connection lifecycle data. |
| ClarificationRequest | request ID, session ID, connection generation, payload, creation time | Controller-owned interaction created from callback attribution; store receives a read-only active projection. |
| PendingInteraction | request ID, kind of permission or clarification, session ID, resolver, lifecycle state, payload | Controller only. The discriminant preserves distinct policies and outcome mapping. |
| InteractionState | active entry, suspended agent interactions in deterministic order | Controller only; never persisted. |
| ClarificationOverlay | request ID, session title and cwd, normalized request view | Store projection; discarded when the request settles. |

Clarification request values are in-memory only. Do not persist prompt text, field labels, option labels, text answers, selected values, or active requests.

### API Endpoints

Kitten exposes no HTTP endpoints. The only external request surface is the ACP client callback.

| Surface | Direction | Description | V1 rule |
|---|---|---|---|
| ACP experimental elicitation callback | Agent adapter to Kitten | Receives a form-mode structured clarification request. | Register and advertise only for a verified allowlisted recipe. |
| ACP elicitation response | Kitten to Agent adapter | Returns normalized submitted values or terminal cancellation to the original callback. | Map only after the coordinator validates request ID and connection generation. |
| ControllerActions respond clarification | UI to controller | Submits one protocol-free answer or cancellation for the active request. | Must not call ordinary sendPrompt. |
| ControllerActions capability view | Controller/store to UI | Surfaces supported or unsupported provider capability. | Unknown and overridden recipes remain unsupported. |

V1 supports ACP form-mode fields that normalize to single-select, multi-select, or text input. URL mode or unsupported schema constructs receive terminal cancellation and do not open a dialog.

## Integration Points

| Integration | Purpose | Error and retry behavior |
|---|---|---|
| ACP TypeScript SDK 1.2.1 | Provides experimental elicitation callback and form response types. | Treat the feature as unstable. Registration and response mapping remain inside src/agent. Unexpected schema or transport failures terminally cancel only that request. |
| Built-in ACP adapters | Supply actual provider behavior for contract verification. | Exact tested versions may be allowlisted. New or overridden recipes fail closed until a real contract test passes. |
| Configuration and readiness | Classifies provider recipes before connection startup. | Surface unsupported status without making the provider itself not-ready. |
| Permission request flow | Supplies existing resolver, attribution, and stale-answer patterns. | Migrate queue ownership into the coordinator while retaining separate permission semantics and labels. |
| Attention and notifications | Shows awaiting clarification in status strip, session overview, next-needy navigation, and notifications. | Use the shared pure attention predicate; notification failure remains best-effort. |
| Local telemetry | Measures outcome and latency without content. | Disabled telemetry is a no-op; enabled telemetry writes local JSONL only. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| src/agent/agentConnection.ts | modified | ACP experimental callback, capability advertisement, request/response mapping; high protocol risk | Add dedicated protocol-free types, registration, mapping, capability input, and generation guards. |
| src/config/configLoader.ts and src/config/readiness.ts | modified | Resolve exact allowlist capability and expose availability; medium risk | Add fail-closed classifier and configuration/readiness tests. |
| src/core/types.ts and src/core/sessionReducer.ts | modified | New status, request/outcome types, attention predicate; medium cross-cutting risk | Add awaiting clarification, pure attention behavior, and terminal transitions. |
| src/app/controller.ts | modified | Replace permission-only queue with coordinator; high lifecycle risk | Add discriminated pending entries, clarification preemption/resumption, and full cleanup. |
| src/app/actions.ts | modified | Dedicated UI action to settle original clarification callback; medium risk | Add respond clarification; retain ordinary prompt behavior unchanged. |
| src/store/appStore.ts and src/store/selectors.ts | modified | Active clarification overlay and priority selector; medium focus risk | Add overlay projection, capability selector, and active-modal gating. |
| src/ui/ClarificationPrompt.tsx | new | Keyboard modal with single, multi, text, and cancellation paths; high UX risk | Implement distinct semantics and one-answer guard. |
| src/ui/CockpitApp.tsx and src/ui/keymap.ts | modified | Top-priority mounting and key isolation; medium risk | Mount clarification last and gate paused overlay key handlers. |
| Status, session overview, notifier | modified | Clarification needs-attention visibility; medium product risk | Add labels, ranking, and transition coverage. |
| Telemetry recorder | modified | Content-free request outcome and latency records; privacy risk | Add enum and bucket-only events; prohibit content fields. |
| Adapter, controller, store, UI, integration tests | modified/new | Contract and lifecycle proof; high release risk | Add unit, UI, mock transport, and actual adapter/version contract coverage. |

## Testing Approach

### Unit Tests

- Adapter mapping: normalize supported ACP form fields; terminally cancel URL mode and unsupported schema; map answer and cancellation responses; keep ACP types out of core.
- Capability classification: accept only exact verified recipes; classify custom, overridden, unknown, and upgraded versions as unsupported.
- Domain state: classify awaiting clarification as needs-attention; clear terminal state only for the matching request generation.
- Interaction coordinator: verify FIFO order within a kind, clarification preemption, suspended interaction resumption, duplicate-answer guard, request-ID mismatch, and terminal cancellation.
- Store/selectors: verify active overlay projection, modal-priority selection, capability visibility, structural sharing, and next-needy ranking.
- UI/keymaps: verify arrows and digits, multi-select toggle, text-mode transition, Enter submission, Escape terminal cancellation, non-color selection marker, and no key leakage.
- Telemetry: assert event schemas contain only enums, anonymous references, timestamps, and coarse durations; assert no prompt, option, or response content field exists.

### Integration Tests

- Actual adapter/version contract gate: run a real request-to-response elicitation scenario for every adapter/version before it is added to the allowlist. The test proves advertised capability, request delivery, submitted answer mapping, terminal cancellation, and clean completion.
- In-memory ACP lifecycle: extend the mock agent to issue form elicitation and assert adapter to coordinator to UI action to ACP response round trips.
- Cross-modal preemption: begin a permission and local modal, issue a clarification, verify clarification receives input exclusively, settle it, then verify the suspended interaction returns unchanged.
- Session-loss behavior: disconnect, dispose, and restore sessions with active and suspended clarification entries; assert exactly one terminal cancellation and no replay.
- Attention behavior: issue a background clarification and verify status strip, session overview, next-needy navigation, notifier attempt, and telemetry transition.
- Regression coverage: existing permission, prompt editor, handoff, settings, and session restore tests remain unchanged when no clarification is active.

## Development Sequencing

### Build Order

1. **Establish the ACP contract harness** - no dependencies; inspect the pinned SDK, add a real adapter/version elicitation contract harness, and define the initial verified allowlist only from passing evidence.
2. **Add capability classification and adapter boundary types** - depends on step 1; resolve fail-closed capability before connection initialization and add protocol-free request/outcome mapping in src/agent.
3. **Extend the pure domain model and session lifecycle** - depends on step 2; add clarification status, request identity, generation, terminal outcomes, and shared attention classification.
4. **Replace the permission-only queue with the interaction coordinator** - depends on steps 2 and 3; preserve permission behavior while adding clarification priority, suspension, resumption, and session-loss cleanup.
5. **Project the active interaction through actions, store, and selectors** - depends on steps 3 and 4; add clarification overlay state, active-modal priority, capability visibility, and dedicated response action.
6. **Build the clarification dialog and keyboard behavior** - depends on step 5; render the top-priority dialog, implement all response modes, text focus, terminal cancellation, and focus return.
7. **Extend attention, notifications, and telemetry** - depends on steps 3, 4, and 5; add clarification status visibility and content-free request-scoped metrics.
8. **Complete regression and contract verification** - depends on steps 1 through 7; run targeted unit, UI, integration, actual-adapter contract, typecheck, and full-suite evidence before enabling an allowlist entry.

### Technical Dependencies

- At least one real built-in adapter/version must complete the elicitation contract before V1 can enable structured clarification for that recipe.
- The exact ACP SDK 1.2.1 experimental callback types must be confirmed against the installed package before implementation because the API is unstable.
- Existing modal components need an active-priority gate so suspended overlays cannot consume input behind clarification.
- The test fixture must model an ACP elicitation callback without placing ACP types outside src/agent.

## Monitoring and Observability

When local telemetry is enabled, add content-free records for:

| Event | Fields allowed | Purpose |
|---|---|---|
| clarification presented | anonymous session reference, capability state, focused or unfocused flag, timestamp | Count eligible requests and visibility context. |
| clarification settled | anonymous session reference, terminal kind of answered or cancelled, non-exclusive shape flags for single, multi, and text fields, field-count bucket, coarse latency | Measure completion, cancellation, and unblocking speed for single-mode and mixed-mode forms. |
| clarification preempted or resumed | anonymous session reference, interaction kind, timestamp | Detect modal arbitration behavior. |
| clarification cancelled on session loss | anonymous session reference, loss reason enum, timestamp | Detect adapter or lifecycle instability. |
| capability classified | provider-kind enum, supported or unsupported, diagnostic category | Measure coverage without storing command, package, cwd, or request content. |

Do not log or record prompts, labels, descriptions, option IDs, selected values, text answers, paths, working directories, or adapter commands. The PRD success thresholds are answer completion of at least 80%, median latency of at most 30 seconds, cancellation of at most 20%, zero unnoticed requests in usability testing, and 100% visible capability classification.

## Technical Considerations

### Key Decisions

- **Fail-closed capability allowlist**: enable elicitation only for exact adapter/version recipes backed by real contract tests. This trades initial coverage for reliable behavior on an experimental protocol surface.
- **Protocol-free adapter boundary**: map ACP forms and outcomes inside src/agent; core, controller, store, and UI consume normalized models only. This preserves Kitten's ACP anti-corruption rule.
- **Controller-owned interaction coordinator**: replace the permission-only queue with one discriminated lifecycle owner. This trades a larger controller change for deterministic preemption, resumption, and cleanup.
- **Clarification priority with preserved semantics**: clarification preempts visible modals, while suspended agent interactions remain pending and resume afterward. Permissions retain distinct outcome mapping and language.
- **Terminal cancellation on loss**: never replay a request into a restored session. This trades occasional re-asking for prevention of stale or misrouted decisions.
- **No persistence in V1**: keep request content and answers in memory only. This avoids privacy and recovery complexity and matches the PRD non-goals.

### Known Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| No actual adapter passes the experimental elicitation contract. | Medium | Ship capability transparency with no enabled recipe; do not broaden the allowlist without evidence. |
| ACP SDK behavior changes between versions. | High | Pin exact dependencies, isolate mapping in src/agent, and rerun contract tests before version changes. |
| Clarification preemption causes input leakage from a suspended modal. | Medium | Use one active-modal selector, gate every modal keyboard handler, and cover cross-modal integration tests. |
| A stale answer resolves a new request after reconnect. | Medium | Require stable request IDs and connection-generation matching before settlement. |
| Multi-select or text fields cannot normalize consistently across adapters. | Medium | Support only validated form shapes in V1; terminally cancel unsupported shapes and expand from contract evidence. |
| Added telemetry accidentally captures sensitive content. | Low | Use closed event types with no string content fields and test the record schema structurally. |

## Architecture Decision Records

- [ADR-001: Scope the clarification picker around explicit structured requests](adrs/adr-001.md) — Restricts V1 to verified structured request-and-response capability.
- [ADR-002: Present supported clarification requests as immediate session-attributed dialogs](adrs/adr-002.md) — Requires immediate dialog handling and return to work after a terminal outcome.
- [ADR-003: Fail closed on a verified ACP elicitation allowlist](adrs/adr-003.md) — Enables experimental elicitation only for exact contract-tested adapter versions.
- [ADR-004: Coordinate agent interactions in the controller with clarification priority](adrs/adr-004.md) — Centralizes preemption, resumption, and terminal settlement while preserving distinct interaction semantics.
- [ADR-005: Terminally cancel pending clarification on session loss](adrs/adr-005.md) — Prevents stale or replayed answers across disconnect, restart, or disposal.
