# Technical Specification: Session Tabs

## Executive Summary

Session Tabs replaces Kitten's fixed configuration-seeded lifetime fleet with a mutable, controller-owned conversation registry. Each fresh tab receives its own AgentConnection and ACP session, while a separate pure workspace model owns tab lifecycle, display name, ordering, focus, and attention acknowledgement. SessionState and the existing session reducer remain the protocol-free source of agent execution state.

The implementation persists the workspace in a version-2 run record and migrates version-1 records into visible tabs. It adds a TabWorkspace UI above the focused conversation, reuses the Sessions overlay for overflow and background work, and keeps Ctrl+H/Ctrl+L conditional on Kitty keyboard events. The primary trade-off is more controller and persistence complexity in exchange for preserving Kitten's current per-session failure isolation, safe lifecycle semantics, and no-config-mutation rule.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
|---|---|---|
| `src/core/workspace.ts` | Defines pure workspace state, lifecycle transitions, focus fallback, and attention acknowledgement. | No ACP, I/O, React, timers, or process access. |
| `src/core/types.ts` | Retains SessionState as agent execution state; adds protocol-free workspace and persistence-facing descriptor types. | Does not import ACP SDK types. |
| `src/store/appStore.ts` | Atomically stores normalized execution sessions plus WorkspaceState; exposes workspace mutations. | The only mutable app state; delegates execution events to sessionReducer and workspace transitions to workspaceReducer. |
| `src/store/selectors.ts` | Produces narrow visible-tab, background-work, duplicate-label, shared-workspace, and attention-queue views. | Must preserve structural sharing so streaming in one conversation does not re-render unrelated tab items. |
| `src/app/controller.ts` | Owns the mutable conversation registry, one dedicated runtime per conversation, dynamic creation, restore, and per-conversation disposal. | The only owner of AgentConnection, ACP session creation/loading, subscriptions, and permission promises. |
| `src/app/actions.ts` | Exposes UI-safe conversation actions: create, rename, select, background, reopen, and confirmed close. | All UI agent effects pass through ControllerActions and degrade instead of throwing. |
| `src/persistence/*` | Writes and validates version-2 workspace records; accepts version-1 records for migration. | No transcript serialization; ACP stores remain the transcript source. |
| `src/ui/TabWorkspace.tsx` | Renders visible tab items, state glyphs/text, duplicate-name suffixes, overflow entry, and mouse selection. | Uses narrow selectors and ControllerActions only. |
| `src/ui/TabDialog.tsx` | Hosts the rename input and the active-work close choices in one modal slot. | Modal keyboard ownership; no direct state or connection writes. |
| `src/ui/SessionsOverlay.tsx` | Evolves into the universal keyboard fallback and background-work/overflow picker. | Reuses existing modal selection, attention routing, and scroll behavior. |
| `src/ui/CockpitApp.tsx` and `src/ui/keymap.ts` | Mount the workspace, empty-workspace branch, dialog, and capability-gated global tab commands. | Keymap remains the single source of truth; commands stand down for shell and overlays. |
| `src/index.ts` | Requests Kitty keyboard disambiguation from OpenTUI at renderer creation. | Renderer bootstrap only; no feature state. |

### Data Flow

1. Configuration resolves initial provider recipes and startup seeds. The controller registers those seeds as Visible workspace conversations.
2. A new-tab action asks ControllerActions to inherit the focused visible conversation's provider recipe and working directory. The controller allocates a new SessionId, creates a store placeholder, then opens a dedicated ACP session.
3. Agent updates enter `AppStore.applyEvent`. The existing session reducer updates execution state; the workspace reducer observes status transitions to update acknowledgement metadata without altering SessionState.
4. Tab selection, rename, backgrounding, reopen, and close requests flow through ControllerActions to atomic store transitions. Only controller operations may create, cancel, dispose, or restore runtimes.
5. RunWriter snapshots non-Closed execution records plus persistable workspace metadata as a version-2 record; it omits ephemeral notices. Restore rebuilds the registry from the record, with per-conversation degradation.
6. TabWorkspace subscribes only to tab view models. SessionsOverlay supplies all background and overflow navigation. Approval overlays retain the conversation ID captured by the controller.

### PRD Requirement Mapping

| PRD goal or user-story capability | Primary technical components |
|---|---|
| Keep multiple live conversations in one run; create a clean fresh conversation. | `WorkspaceState` and `workspaceReducer` own lifecycle; the mutable controller registry creates one dedicated runtime per `ConversationDescriptor`. |
| Identify, rename, and distinguish conversations. | `WorkspaceConversation.displayName`, rename actions, duplicate-label selectors, `TabDialog`, and version-2 workspace persistence. |
| Navigate with mouse, safe Ctrl+H/Ctrl+L, or a universal fallback. | `TabWorkspace` mouse handlers, renderer capability promotion, `keymap.ts`, and `SessionsOverlay`. |
| Surface and route attention without losing originating identity. | `AttentionRecord`, attention selectors, controller-owned SessionId-tagged permission queue, and the overlay/tab view models. |
| Close active work only through explicit choices, while retaining background work. | `TabDialog` close policy, `ControllerActions`, lifecycle reducer, and idempotent per-conversation teardown. |
| Restore names, order, selected state, lifecycle, and retained context. | Version-2 `workspace` metadata, execution/resume records, `RunWriter`/`RunStore`, and record-driven registry restore with version-1 migration. |
| Keep every conversation reachable in narrow terminals and signal shared workspaces. | Overflow/background `SessionsOverlay`, narrow tab selectors, shared-workspace derivation, and non-color state cues. |

## Implementation Design

### Core Interfaces

The following Go-shaped contract is a language-neutral reducer sketch required by this specification; production code remains TypeScript in `src/core`.

```go
type ConversationLifecycle string

const (
  Visible ConversationLifecycle = "visible"
  Background ConversationLifecycle = "background"
  Closed ConversationLifecycle = "closed"
)

type WorkspaceState struct {
  Order []string
  SelectedVisibleID *string
}

type WorkspaceReducer interface {
  Reduce(WorkspaceState, WorkspaceEvent) WorkspaceState
}
```

The UI action contract extends ControllerActions and keeps agent effects behind the app layer.

```typescript
export interface ConversationActions {
  createConversation(): Promise<SessionId | null>
  renameConversation(id: SessionId, displayName: string): void
  selectConversation(id: SessionId): void
  backgroundConversation(id: SessionId): void
  reopenConversation(id: SessionId): void
  closeConversation(id: SessionId, choice: CloseChoice): Promise<void>
  jumpToNextAttention(): void
}
```

Conventions:

- `createConversation` and `closeConversation` return fail-soft results and route errors through the existing controller error path.
- `CloseChoice` is `"close" | "background" | "cancel" | "keep-open"`. The direct idle-close path uses `close`; an active-work dialog resolves the other choices before calling the controller.
- Backgrounding and rename never invoke ACP. Deliberate cancellation invokes the existing targeted cancel primitive before runtime disposal.
- Unknown or Closed IDs are no-ops in store actions and ignored by late adapter events.

### Data Models

| Type | Fields | Notes |
|---|---|---|
| `ConversationLifecycle` | `visible`, `background`, `closed` | User-owned workspace state. Closed entries are removed from active workspace state and never snapshotted. |
| `ConversationAvailability` | `starting`, `ready`, or `unavailable { reasonCode, retryable }` | Protocol-free, store-visible runtime standing for tab UI. It is not an ACP wire type or raw error payload. |
| `TeardownState` | `open` or `closing` | Prevents duplicate cancellation/disposal while preserving the current lifecycle until teardown succeeds. |
| `WorkspaceConversation` | `sessionId`, `displayName`, `lifecycle`, `createdOrdinal`, `availability`, `teardownState`, `attention` | References execution state by SessionId; never contains ACP wire types. |
| `WorkspaceState` | `conversations: Record<SessionId, WorkspaceConversation>`, `order: SessionId[]`, `selectedVisibleId: SessionId | null` | The single authority for selected agent conversation and creation/display order; `order` is not a user-reorder feature. |
| `AttentionRecord` | `status`, `seen`, `sequence` | Stored inside workspace metadata and updated when a session enters attention status. Queue candidates are non-Closed conversations in `awaiting_approval`, `error`, or `finished` state. |
| `KeyboardCapability` | `unknown` or `kittyConfirmed` | Ephemeral store state. Unknown behaves as legacy and never advertises direct tab chords. |
| `WorkspaceNotice` | `code: "no-provider-available"` | Ephemeral AppStore/UI feedback, cleared by a successful creation or provider refresh; it is never persisted as workspace metadata. |
| `ConversationDescriptor` | `sessionId`, `providerKind`, `cwd`, `initialTitle` | Controller-owned startup data for one runtime; dynamic conversations receive a generated ID. |
| `PersistedConversationV2` | descriptor fields plus ACP resume pointer, status summary, count, last prompt | Execution/resume data only; it contains no lifecycle, display name, order, or selected state. |
| `PersistedWorkspaceV2` | `conversations` metadata, `order`, `selectedVisibleId` | The only persisted source for lifecycle, display names, order, attention acknowledgement, and selection. |
| `PersistedRunRecordV2` | `version: 2`, run metadata, `conversations`, `workspace`, handoff bundle | Replaces the fixed `agents`-only version-1 shape for new writes; selection is stored only in `workspace`. |

#### Workspace Lifecycle Rules

| Event | Preconditions | State transition | Focus and runtime effect |
|---|---|---|---|
| Create | A focused visible conversation exists; otherwise a configured default provider exists. | New conversation becomes Visible at the end of `order`. | Controller starts a new dedicated runtime; select it after the placeholder is committed. |
| Rename | Conversation is not Closed. | Update `displayName` only. | No ACP or runtime effect. |
| Select | Conversation is Visible. | Mark current attention status seen. | Set selected visible ID and agent pane focus. |
| Background | Conversation is not Closed. | Visible → Background. | No runtime, connection, or subscription change. |
| Reopen | Conversation is Background. | Background → Visible. | Select it and retain its runtime. |
| Idle close | Session status is exactly `idle`. | Visible/Background → Closed after successful teardown. | Dispose only that runtime, delete execution slice after teardown, then choose next visible or empty workspace. |
| Confirmed attention/active close | Session status is `working`, `awaiting_approval`, `error`, or `finished`. | Visible/Background → Closed only after the explicit dialog and teardown reach a safe outcome. | Settle owned permissions, cancel only an active targeted ACP turn, dispose the runtime, and ignore late events. |
| Final visible removal | No Visible conversations remain. | `selectedVisibleId = null`. | Render EmptyWorkspace; do not exit Kitten; Background entries remain reachable. |

#### Close Policy

| Current status | Direct close allowed | Required dialog behavior |
|---|---|---|
| `idle` | Yes | Use the `close` choice, state the Closed consequence, then perform idempotent teardown. |
| `working` | No | Offer Background, Cancel deliberately, or Keep open. Cancel requests targeted ACP cancellation. |
| `awaiting_approval` | No | Offer the same choices when the request is queued; if its approval dialog is currently topmost, that dialog keeps keyboard ownership until resolved. |
| `error` | No | Offer the same choices. Cancel deliberately means confirmed session teardown; do not issue a turn cancel when no turn is active. |
| `finished` | No | Offer the same choices. Cancel deliberately means confirmed session teardown; do not issue a turn cancel when no turn is active. |

#### Attention Rules

- Execution status remains owned by SessionState and the existing session reducer.
- The workspace observes status transitions and assigns a new sequence when a conversation enters `awaiting_approval`, `error`, or `finished`.
- Queue order is status rank (approval, error, finished), then nearest forward entry in workspace order, matching existing intent.
- Selection marks the current attention epoch seen. It does not clear underlying status, approval obligation, error state, or finished state.
- Background conversations remain eligible; Closed conversations never appear in the queue.

#### Version-2 Validation Invariants

- Every `workspace.order` ID is unique and exists in both `workspace.conversations` and top-level `conversations`.
- Every persisted workspace conversation is either `visible` or `background`; Closed conversations are omitted from both collections.
- `workspace.selectedVisibleId` is null or references a `visible` conversation in `workspace.order`.
- Workspace metadata is the only source of lifecycle, display name, acknowledgement, order, and selection; top-level conversation descriptors are execution/resume data only.
- Invalid membership, duplicate IDs, invalid lifecycle, or invalid selection marks only the affected conversation unavailable when recoverable; otherwise the record is rejected by the existing fail-soft load boundary.

### API Endpoints

Not applicable: Session Tabs adds no HTTP API. The feature exposes only local application actions.

### Local Action Surface

The local ControllerActions surface is the integration boundary.

| Action | Caller | Behavior |
|---|---|---|
| `createConversation()` | New-tab UI, EmptyWorkspace | Inherit focused provider/cwd; use first configured provider + launch cwd only when no visible tab exists; start an independent ACP session. |
| `renameConversation(id, name)` | Tab dialog | Validate non-empty normalized display name; keep duplicate disambiguation in selectors. |
| `selectConversation(id)` | Mouse tab item, keyboard next/previous, Sessions overlay | Requires Visible lifecycle; updates focus and acknowledgement. |
| `backgroundConversation(id)` | Active-work close dialog | Changes only workspace lifecycle. |
| `reopenConversation(id)` | Sessions overlay/background summary | Moves Background to Visible and selects it. |
| `closeConversation(id, choice)` | Direct close or close dialog | Performs the explicit `close`, background, cancel, or keep-open policy; controller owns effects. |
| `jumpToNextAttention()` | Tab summary and Sessions overlay | Selects the next non-Closed attention candidate, reopening a background candidate first. |

### Persistence and Restore

1. Add a discriminated version union for version-1 and version-2 records in `runRecord.ts` and validation in `runStore.ts`.
2. New writes always produce version 2. The snapshot must allow no selected visible conversation; branch metadata is `null` in that state. Lifecycle, display name, order, acknowledgement, and selection serialize only inside `workspace`.
3. Version-1 restore continues to use current resolved configuration descriptors. It derives Visible workspace order from the matching resolved configuration order, uses the existing `PersistedAgent.sessionId` field as the ACP resume pointer when available, and preserves the legacy focused ID only when it maps to a Visible migrated conversation.
4. Version-1 records cannot recover dynamic descriptors, user display names, lifecycle, attention acknowledgement, or an independently persisted order; they preserve only the current configuration-backed resume behavior.
5. Version-2 restore is record-driven. For every non-Closed persisted conversation, resolve its provider recipe, reconstruct a descriptor, create a store placeholder, then load its ACP session when possible.
6. If a provider or ACP session is unavailable, retain the descriptor as a Visible or Background conversation with `availability: unavailable` and a safe reason code rather than dropping siblings. Do not fabricate a transcript.
7. Background lifecycle, display name, order, selected visible ID, and attention acknowledgement round-trip. Closed conversations do not.
8. Configuration remains immutable; no tab state is written through config writer paths.

### Focus Authority and Empty Workspace

- `WorkspaceState.selectedVisibleId` is the single authority for the selected agent conversation. Remove the independent mutable `AppState.focusedSessionId` field; expose a nullable selector derived from workspace state.
- Extend `FocusedPane` to represent `{ kind: "agent"; sessionId }`, `{ kind: "shell" }`, or `{ kind: "workspace" }`. Agent focus must reference the selected Visible conversation; shell focus preserves the workspace selection; workspace focus represents no selected Visible conversation.
- When selection is null, ConversationView renders EmptyWorkspace, PromptEditor disables prompt submission, StatusStrip renders workspace/background summary, and handoff/model-selection actions are disabled rather than targeting a fabricated session.
- The notifier and attention selectors operate on workspace conversation IDs and never assume a selected ID exists. RunWriter derives branch metadata from the selected Visible session when present, otherwise writes null.
- `switchFocus`, `jumpToNextAttention`, shell toggling, restore, and all non-null legacy selectors must be updated to accept null selection explicitly. An empty workspace is valid, not a fallback sentinel.

### Availability and Retry

- Before runtime creation or restoration, the store commits the descriptor as `availability: starting` so the UI can render a stable tab identity.
- On successful connection and ACP session binding, the controller marks the workspace entry `ready`.
- On provider, connection, load, cancel, or disposal failure, the controller marks the entry `unavailable` with a finite reason code such as `provider-unavailable`, `connection-failed`, `restore-unavailable`, or `teardown-failed`; raw error text remains in the existing controller/runtime path and is not persisted as workspace metadata.
- When no configured provider exists for an empty workspace, `createConversation()` returns null and commits a workspace-level `no-provider-available` notice. It does not create a providerless conversation placeholder.
- An unavailable conversation remains selectable and offers the existing/new retry path only when a descriptor and provider recipe are available.

### Idempotent Teardown State Machine

- `closeConversation` first acquires a per-SessionId close promise. A repeated close request returns that same promise and cannot issue a second cancellation or disposal.
- The store marks `teardownState: closing` while retaining the conversation's current Visible or Background lifecycle, so the user can see that close is in progress and no new close action starts.
- The controller marks the runtime closing and ignores any subsequent adapter event for that ID. It then removes every queued permission request owned by that ID, resolving each with `{ outcome: "cancelled" }`; if one was on screen, it advances the existing queue to the next request.
- For `working` or `awaiting_approval`, the controller requests targeted ACP cancellation. For `error`, `finished`, or `idle`, confirmed close does not send a turn-cancel request.
- After successful required cancellation, the controller unsubscribes, disposes the dedicated runtime, and only then atomically removes the execution session and commits Closed workspace state.
- If cancellation or disposal fails, the controller clears `teardownState`, keeps the conversation Visible or Background, marks availability `unavailable` with `teardown-failed`, and exposes retry. It never reports Closed or deletes state after an uncertain teardown.
- Backgrounding never enters this state machine and never changes the runtime, subscription, or pending permission queue.

### UI and Input Design

- Mount `TabWorkspace` inside CockpitApp's main bordered pane above the focused ConversationView or regular ShellPane content. In alternate-screen shell mode, use the existing full-height shell behavior and do not intercept shell keys.
- Render one `TabItem` per Visible conversation. Each item shows selected marker, name, non-color status glyph/text, and duplicate-name suffix when needed.
- Use OpenTUI `onMouseDown` on tab items. Prevent default focus movement as needed, then call `selectConversation(id)`; never mutate store state in the handler.
- At narrow widths, render a compact visible subset plus a count/entry that opens SessionsOverlay. Do not add multi-row tabs. The overlay lists Visible and Background conversations and remains the canonical keyboard fallback.
- Add one `tabDialog` overlay slot with two variants: rename text entry and close-choice confirmation. Approval remains topmost; all tab dialogs stand down when an approval is pending.
- Add `EmptyWorkspace` when `selectedVisibleId` is null. It offers New Conversation and a background-work entry when any Background conversations exist, and renders the workspace-level no-provider notice when creation cannot start.
- Extend selector-driven view models for duplicate labels, shared-workspace cue, lifecycle, attention glyph, attention seen state, and overflow count.

### Keyboard Capability Policy

- Add ephemeral `keyboardCapability: unknown | kittyConfirmed` to AppState. It is never persisted and defaults to `unknown`, which behaves as legacy.
- Change renderer bootstrap to request OpenTUI Kitty keyboard disambiguation and alternate-key reporting.
- At the renderer boundary, observe key input and promote capability to `kittyConfirmed` only after a valid Kitty-source event. The update is injectable in tests; do not infer support from terminal names or environment variables.
- Register `previous-tab` and `next-tab` in `keymap.ts`, help data, slash commands, and CockpitApp dispatch.
- Dispatch Ctrl+H/Ctrl+L only when both stored capability is `kittyConfirmed` and the current event source is Kitty. A single mismatched or legacy event never triggers tab navigation.
- Help and status hints advertise direct tab chords only when capability is confirmed. Until then, they advertise `/sessions` and attention routing as the keyboard fallback.
- Check overlay state and shell focus before matching or dispatching tab commands. Shell-focused control keys continue through `encodeKey` to the PTY.
- Do not add user-configurable shortcuts in V1.

## Integration Points

| Boundary | Integration | Error and ownership rule |
|---|---|---|
| ACP adapter / AgentConnection | Controller creates and loads one dedicated ACP session per conversation. | ACP types remain in `src/agent`; a failed runtime marks only its conversation unavailable. |
| Provider configuration | Registry reads provider recipes and initial seeds; fresh tabs inherit focused provider/cwd. | Never mutate config; no provider returns `null` and commits the no-provider workspace notice without a placeholder. |
| Permission queue | Controller pending requests remain tagged with SessionId. | Closing/cancelling a conversation settles only its own queued requests before disposal. |
| RunStore and RunWriter | Versioned workspace snapshot and record-driven restore. | Atomic writes remain fail-soft; corrupt/missing entries degrade one conversation. |
| OpenTUI renderer | Kitty keyboard request, mouse events, modal key ownership, and narrow terminal layout. | Capability-gated chords never steal shell or legacy terminal input. |
| Telemetry recorder | Content-free tab lifecycle and switch signals. | Disabled telemetry writes nothing; no names, prompts, paths, or transcript content are recorded. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/types.ts` | Modified | Adds workspace/persistence descriptor types; risk of leaking ACP concepts. | Keep types protocol-free and cover compile-time shape tests. |
| `src/core/workspace.ts` and tests | New | Pure lifecycle and attention-acknowledgement reducer; high correctness leverage. | Add exhaustive transition tests. |
| `src/core/sessionReducer.ts` | Modified | Supplies status-transition observations; risk of mixing workspace policy into execution reduction. | Keep lifecycle out of this reducer; expose only status transition inputs. |
| `src/store/appStore.ts` / `selectors.ts` | Modified | Supports dynamic sessions, nullable visible selection, workspace mutations, and narrow views. | Preserve structural sharing and unknown-ID no-ops. |
| `src/app/actions.ts` | Modified | Adds safe UI action surface. | Keep all async effects fail-soft and individually targeted. |
| `src/app/controller.ts` | Modified | Replaces fixed plan with mutable registry and adds per-conversation creation/disposal/restore. | Maintain one-runtime isolation, permission attribution, and disposal discipline. |
| `src/config/configLoader.ts` | Modified | Supplies initial seeds/default provider policy only. | Keep config read-only after boot. |
| `src/persistence/runRecord.ts` / `runStore.ts` / `runWriter.ts` | Modified | Adds v2 record, v1 decode path, empty-workspace snapshot. | Validate migrations and atomic writes. |
| `src/ui/TabWorkspace.tsx` / `TabDialog.tsx` | New | Main interaction and modal input; risk of UI state ownership drift. | Use selectors and ControllerActions only. |
| `src/ui/CockpitApp.tsx` / `keymap.ts` | Modified | Mounts workspace and dispatches capability-gated commands. | Preserve overlay and shell precedence. |
| `src/ui/SessionsOverlay.tsx` | Modified | Adds background/overflow lifecycle access. | Retain keyboard-only fallback and attention routing. |
| `src/index.ts` | Modified | Requests Kitty keyboard reporting. | Keep renderer factory injectable and test both capability paths. |
| `src/telemetry/recorder.ts` | Modified | Adds content-free lifecycle/switch metrics. | Maintain strict opt-in/no-content behavior. |
| Tests under `src/**` and `test/**` | Modified/new | Covers state, controller, persistence, UI, and end-to-end restore. | Run full typecheck, test, and self-check gate. |

## Testing Approach

### Unit Tests

- Add table-driven `workspace.test.ts` coverage for every lifecycle transition, null selection, final visible removal, deterministic next/previous focus, background reopen, closed-ID no-op, duplicate labels, and shared-workspace derivation.
- Extend core/store tests to prove SessionState remains unchanged by rename/background events and that unrelated session identities remain structurally shared during streaming.
- Test attention epochs: entry into approval/error/finished, seen acknowledgement on selection, repeated attention after a later status transition, background inclusion, and closed exclusion.
- Extend action tests with injected registry/runtime seams: focused inheritance, default-provider empty workspace behavior, background no ACP call, targeted cancel, failure no-op, and explicit close choices.
- Extend controller tests with fake AgentConnection factories: distinct ACP session per tab, independent failure, late-event ignore, per-conversation subscription disposal, permission queue settlement, idempotent close promises, and retained/retryable state after teardown failure.
- Extend persistence unit tests for v2 encode/decode, v1 migration, empty visible workspace, null selection, background preservation, closed omission, corrupt record recovery, and unavailable provider/session degradation.
- Extend keymap tests for unknown-to-confirmed Kitty capability promotion, Kitty-only Ctrl+H/Ctrl+L, legacy non-match, overlay suppression, shell suppression, help/fallback consistency, and command dispatch.

### Integration Tests

- Render CockpitApp with an in-memory controller and fake agents; create, rename, mouse-select, keyboard-select, background, reopen, close, and restore conversations.
- Use OpenTUI mock mouse utilities for tab clicks and Kitty/non-Kitty renderer capabilities for keyboard paths.
- Verify an approval from a background conversation remains attributed to the originating SessionId and that answering it cannot target the selected conversation by mistake.
- Verify narrow terminal rendering exposes every conversation through the Sessions overlay and shows non-color attention labels.
- Verify save → dispose → boot → restore for dynamic visible and background conversations, v1 migration, unavailable restored sessions, and empty workspace.
- Stream multiple fake agents while switching repeatedly and verify only narrow selector subscribers update.
- Run `bun run selfcheck` for view-tree changes, then the full `bun run typecheck && bun test` gate after implementation.

## Development Sequencing

### Build Order

1. Add protocol-free workspace types, pure reducer, lifecycle transition table, and unit tests in `src/core` — no dependencies.
2. Extend AppState, AppStore mutations, focus representation, and selectors to use WorkspaceState — depends on step 1.
3. Add version-2 run-record types, validation, writer snapshot, and version-1 migration tests — depends on steps 1 and 2.
4. Refactor SessionController from immutable plan to mutable registry and add dynamic create/dispose/restore seams — depends on steps 1, 2, and 3.
5. Extend ControllerActions and telemetry interfaces for tab lifecycle commands and content-free events — depends on steps 2 and 4.
6. Enable Kitty keyboard reporting, add capability-gated keymap commands, and test shell/overlay precedence — depends on steps 2 and 5.
7. Build TabWorkspace, EmptyWorkspace, and tab dialog UI using narrow selectors and actions — depends on steps 2, 5, and 6.
8. Extend SessionsOverlay for background work, overflow, and direct attention selection — depends on steps 2, 5, and 7.
9. Add controller, persistence, and UI integration scenarios for dynamic restore, permissions, failure isolation, mouse input, and narrow layouts — depends on steps 3, 4, 6, 7, and 8.
10. Run performance checks, full typecheck, full test suite, and self-check; fix only verified regressions — depends on steps 1 through 9.

### Technical Dependencies

- Existing Bun, TypeScript, React, OpenTUI, ACP SDK, and repository test helpers are sufficient; add no package.
- OpenTUI renderer must support the configured Kitty keyboard option; fallback behavior must remain correct when the terminal does not produce Kitty-source events.
- Provider recipes must remain available from resolved configuration for dynamic creation and version-2 restore.
- Existing RunStore atomic write behavior and agent ACP resume capability remain prerequisites for full workspace restoration.
- The feature must land after or together with any concurrent multi-session model changes so SessionId and session collection semantics are not duplicated.

## Monitoring and Observability

Add only content-free, opt-in telemetry through the existing recorder:

| Signal | Fields | Purpose |
|---|---|---|
| `tab_created` | provider kind, inherited/default source | Multi-tab adoption without task content. |
| `tab_selected` | selection source: mouse, kitty chord, sessions fallback, attention jump | Navigation engagement and fallback reliance. |
| `tab_backgrounded` | none | Background-work usage. |
| `tab_close_confirmed` | outcome: cancel or idle-close | Lifecycle-safety audit. |
| `tab_close_kept_open` | none | Detect confusing close prompts. |
| `tab_restore` | visible count bucket, background count bucket, unavailable count bucket | Workspace restoration quality. |
| `tab_attention_seen` | status kind, lifecycle | Attention response latency. |
| `tab_switch_latency_ms` | duration bucket, source | Verify the 200 ms user-perceived switching goal. |

Rules:

- Never record prompt text, display names, file paths, working directories, transcript content, ACP IDs, or raw error messages.
- Disabled telemetry remains the existing no-op recorder and creates no file or watch.
- Reuse store-watch timing only where it observes content-free state transitions.
- Treat no telemetry as no decision signal; rollout metrics require the PRD's sample and time windows.

## Technical Considerations

### Key Decisions

| Decision | Rationale | Trade-off | Rejected alternative |
|---|---|---|---|
| Dedicated runtime per conversation | Matches current isolation and per-agent degradation. | Higher process/resource use. | Shared provider multiplexing. |
| Separate workspace reducer | Keeps lifecycle/user metadata out of ACP execution state. | More store and selector machinery. | Adding lifecycle to SessionState or React-local state. |
| Version-2 persisted workspace with v1 migration | Restores dynamic tabs while preserving existing saved runs. | Migration and null-focus complexity. | Rejecting legacy runs. |
| Confirmed-Kitty Ctrl+H/Ctrl+L | Protects Backspace/redraw and shell input. | Some terminals use Sessions overlay fallback. | Unconditional chords or shortcut settings in V1. |
| SessionsOverlay as overflow/background fallback | Reuses a tested accessible modal and avoids multi-row tabs. | Adjacent fallback navigation is slower. | New parallel overflow surface. |

### Known Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Fixed-plan assumptions survive in an unmodified restore or writer path. | High | Make workspace-null focus and registry-driven restore explicit in unit and integration tests. |
| Per-tab close leaves an ACP subscription, permission promise, or process alive. | High | Centralize per-conversation teardown; test close while streaming and while awaiting permission. |
| A restored record cannot map a provider descriptor. | Medium | In V2, retain the persisted descriptor as unavailable; in V1, omit an unmatched configuration-backed pointer while preserving siblings and a valid empty workspace. |
| Kitty configuration behaves differently across terminals. | Medium | Require persistent Kitty confirmation plus the current Kitty-source event, test the legacy path, and always retain Sessions fallback. |
| Tab streaming causes broad React re-renders. | Medium | Use per-tab selectors and structural-sharing assertions under concurrent fake streams. |
| Rename/lifecycle data leaks into telemetry or config. | Low | Restrict telemetry event payloads and keep config writer untouched. |
| Empty workspace breaks code assuming focusedSessionId exists. | High | Make nullable selection a first-class selector/store/writer/controller test case. |

## Architecture Decision Records

- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — Establishes product scope and safety exclusions.
- [ADR-002: Prioritize a Restorable, Fast-Switching Conversation Tab Workspace](adrs/adr-002.md) — Defines visible, background-running, and closed product states.
- [ADR-003: Use a Mutable Registry with One Dedicated Runtime per Conversation](adrs/adr-003.md) — Replaces the fixed lifetime plan with per-tab isolated runtimes.
- [ADR-004: Separate Workspace Metadata from Session State and Persist a Versioned Workspace](adrs/adr-004.md) — Defines pure workspace state and v2 persistence with v1 migration.
- [ADR-005: Gate Requested Tab Chords on Kitty Keyboard Events and Retain Sessions Fallback](adrs/adr-005.md) — Protects legacy terminal input while preserving keyboard navigation.
