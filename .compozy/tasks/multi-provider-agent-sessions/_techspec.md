# TechSpec: Kitten Multi-Session Fleet

## Executive Summary

This feature turns Kitten's two-agent, single-directory cockpit into an N-session fleet by replacing one root assumption: the store keys session state by provider (`Record<AgentId, SessionState>`) rather than by a session identity.
The work splits provider kind from instance identity, moves the working directory onto each session, extends the session state model with `finished` and `error`, adds a Ctrl+S overview that routes attention, re-addresses the existing hand-off to a chosen session, and adds layered attention notifications (status strip, terminal bell, native OS notification).
It ships as one coherent release so the curated hand-off, Kitten's differentiator, lands on the new session model in the same slice rather than regressing (ADR-002).

The layered architecture already in place (pure `core`, an ACP adapter, an external store with targeted subscriptions, a controller, and the UI) is preserved; every change is an extension along an existing seam rather than a new layer.
The primary trade-off is deliberate breadth in one release: the identity rename touches roughly 114 sites and lands together with new behavior, in exchange for never leaving the hand-off half-migrated.
Runtime session spawn and kill, grouping, ranked triage, and persistence are out of scope (PRD Non-Goals) and the fleet is seeded from config.

## System Architecture

### Component Overview

- **Core domain (`src/core`)** - owns `SessionId`, `ProviderKind`, the extended `SessionStatus`, the reshaped `SessionState`, and the `needsAttention` predicate. Stays protocol-free and remains the reducer's single-writer domain (ADR-003, ADR-004, ADR-006).
- **ACP adapter (`src/agent`)** - unchanged boundary, extended to map `PromptStopReason` and transport or handshake failure to the new `finished`/`error` status events (ADR-006). Still one connection per session.
- **Store (`src/store`)** - holds `sessions: Record<SessionId, SessionState>`, `order: SessionId[]`, and `focusedSessionId`, plus the overlay slots including a new `sessions` overlay. New selectors `selectSessionList`, `selectNextNeedy`, and per-session status feed the overview and the notifier.
- **Controller (`src/app`)** - starts one runtime per session descriptor, each against its own `cwd`, keyed `Map<SessionId, AgentRuntime>`. Re-addresses the hand-off to a chosen target session and labels each approval with its session and directory.
- **Config (`src/config`)** - loads `providers` (spawn recipes) plus a `sessions` list, resolves per-session `cwd`, and runs readiness per session (ADR-005).
- **Sessions overview (`src/ui`, new)** - the Ctrl+S modal overlay: a selectable card list with jump-to-next, modeled on the existing approval and hand-off overlays.
- **Notifier (`src/notify`, new)** - subscribes to session-status transitions, rings the bell, and shells out to a per-OS notification tool while Kitten is unfocused (ADR-007).

Data flow is unchanged in shape: the adapter translates ACP updates into domain events, the controller routes each event into the owning session's store slice, the reducer writes session state, and the store notifies only the selectors whose slice changed. The overview, status strip, and notifier are three readers of the same derived state.

## Implementation Design

### Core Interfaces

The primary domain types every component depends on:

```typescript
export type ProviderKind = "claude-code" | "codex" // renamed from AgentId
export type SessionId = string // Kitten-assigned instance identity, stable from config load
export type SessionStatus = "idle" | "working" | "awaiting_approval" | "finished" | "error"

export interface SessionState {
  id: SessionId
  providerKind: ProviderKind
  title: string
  cwd: string
  task?: string
  acpSessionId: string // empty until the ACP handshake completes
  turns: Turn[]
  status: SessionStatus
  referencedFiles: Map<string, "read" | "edited">
  pendingDiffs: PendingDiff[]
  plan: PlanEntry[]
}

export const needsAttention = (s: SessionStatus): boolean =>
  s === "awaiting_approval" || s === "error" || s === "finished"
```

The store surface, keyed by session identity:

```typescript
export interface AppState {
  sessions: Record<SessionId, SessionState>
  order: SessionId[]
  focusedSessionId: SessionId
  overlays: OverlayState // approval | handoffPreview | sessions
}

export interface AppStore {
  applyEvent(sessionId: SessionId, event: DomainSessionEvent): void
  startSession(sessionId: SessionId, acpSessionId: string): void
  setFocus(sessionId: SessionId): void
  openSessions(): void
  closeSessions(): void
  // openApproval / openHandoffPreview now carry SessionId, cwd, and title
}
```

The notifier boundary, with the per-OS channel behind an injectable seam:

```typescript
export interface NotificationChannel {
  notify(input: { title: string; provider: ProviderKind; cwd: string; state: SessionStatus }): void
}

export interface Notifier {
  /** Subscribe to the store; fires bell + OS notification on a transition into needs-you while unfocused. */
  watch(store: AppStore): Unsubscribe
}
```

### Data Models

- **SessionState** (above) is the reduced per-session record; `referencedFiles` and `pendingDiffs` remain pure derivations of the tool-call turns.
- **SessionDescriptor** (config) - `{ provider: ProviderKind; cwd: string; title?: string; task?: string }`. `title` defaults to the `cwd` basename; `task`, when present, is sent as the first prompt.
- **AppConfig** - `{ providers: Record<ProviderKind, ProviderRecipe>; sessions: SessionDescriptor[]; telemetryEnabled: boolean }`, where `ProviderRecipe` is today's `command`/`args`/`env`. Zero-config yields one session per provider in the launch directory.
- **DomainSessionEvent** - the `status` variant now carries the extended `SessionStatus`. No other variant changes.
- **ApprovalOverlay / HandoffPreviewOverlay** - gain `sessionId` (and, for hand-off, `targetSessionId`), plus the source session's `title` and `cwd` for labeling.
- **TelemetryEvent** - reused as-is; new content-free counters ride the existing shape.

### Actions and Events (internal command surface)

Kitten has no network API; its surface is the keymap-driven action set and the domain event stream.

- New keymap command `sessions` bound to `Ctrl+S` (`COCKPIT_KEYMAP`), and a `SESSIONS_KEYMAP` for the overlay: up and down to move, Enter to jump into the highlighted session, a key to jump to the next needs-you session, Esc to dismiss.
- New controller action `jumpToNextNeedy()` sets focus to `selectNextNeedy(focusedSessionId)`.
- Hand-off (`Ctrl+T`) gains a target-selection step before the redacted preview; the preview and curation are otherwise unchanged.
- Notifier fires on the domain `status` transition into a needs-you value; it emits no action and carries no prompt content.

## Integration Points

- **ACP agents** - unchanged: one spawned adapter subprocess per session over the ACP `ClientSideConnection`, authenticated by the user's own agent auth. Each session calls `newSession(cwd)` with its own directory.
- **Operating-system notifications** - `osascript` (macOS), `notify-send` (Linux), and a PowerShell toast (Windows), selected by OS detection and invoked as best-effort shell-outs with no added dependency; failure falls back to the terminal bell (ADR-007).
- **Terminal focus** - DECSET 1004 focus reporting through OpenTUI drives the unfocused gate; where unavailable, the notifier degrades to notifying on every needs-you transition.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/core/types.ts` | modified | Rename `AgentId`, add `SessionId`, reshape `SessionState`, extend `SessionStatus`. High blast radius (~114 sites). | Land the rename behind typecheck + tests first. |
| `src/store/appStore.ts` | modified | `Record<SessionId>` + `order` + `focusedSessionId`; add `sessions` overlay slot. Core store invariants. | Preserve structural sharing and `Object.is` equality. |
| `src/store/selectors.ts` | modified | Key by `SessionId`; add `selectSessionList`, `selectNextNeedy`. | Add selectors; keep subscriptions narrow. |
| `src/app/controller.ts` | modified | `Map<SessionId>`; one runtime per session with its own `cwd`; approvals carry session + cwd. | Generalize `startAgent`/`getSession`/`runtimes`. |
| `src/app/actions.ts` | modified | Replace `nextAgentId` targeting with session targeting; add `jumpToNextNeedy`. | Rework focus and hand-off targeting. |
| `src/app/handoff.ts` | modified | Source and target are chosen sessions, not "the other agent". | Add target selection; keep bundle assembly. |
| `src/agent/agentConnection.ts` | modified | Map `PromptStopReason` and failures to `finished`/`error`. | Replace the unconditional `idle` emit. |
| `src/config/configLoader.ts` | modified | `providers` + `sessions` schema, per-session `cwd`, zero-config default. | Rewrite schema, defaults, and merge. |
| `src/config/firstRun.ts` | modified | Readiness and repo checks per session. | Evaluate per session; do not block the fleet on one bad session. |
| `src/ui/StatusStrip.tsx`, `theme.ts` | modified | Labels and tones for `finished`/`error`; chips per session. | Extend `STATUS_LABELS` and status tones. |
| `src/ui/keymap.ts` | modified | Add `Ctrl+S` command, `SESSIONS_KEYMAP`, help and hints. | Extend keymap tables. |
| `src/ui/ApprovalPrompt.tsx`, `HandoffPreview.tsx` | modified | Show session + cwd; hand-off target picker. | Label prompts; add picker step. |
| `src/ui/SessionsOverlay.tsx` | new | The Ctrl+S overview and jump-to-next. | New component on the overlay pattern. |
| `src/notify/*` | new | Bell + per-OS notification + focus gate. | New module wired at boot. |
| `src/telemetry/recorder.ts` | modified | Attention-latency and multi-session counters. | Add content-free counters. |
| `src/index.ts` | modified | Wire per-session boot and the notifier. | Extend boot wiring. |

## Testing Approach

### Unit Tests

- Reducer and selectors: `needsAttention` across every status; `selectNextNeedy` ordering (`awaiting_approval` before `error` before `finished`, then `order`) and wrap-around; per-session status isolation (one session's event never mutates another's slice).
- Adapter status mapping: each `PromptStopReason` maps to the expected `SessionStatus`, a thrown prompt and a transport close map to `error`, `cancelled` maps to `idle`.
- Config: zero-config seeds one session per provider in the launch directory; a `sessions` list resolves per-session `cwd`; unknown keys and a non-repo `cwd` are reported, not silently accepted.
- Notifier: a transition into needs-you while unfocused fires exactly one bell and one channel call; while focused it fires neither; deduplication holds while the state persists; a failing channel still rings the bell.
- Hand-off: target selection routes the bundle to the chosen session; curation and redaction are unchanged (characterization test guarding the moat).

### Integration Tests

- Boot a controller with three seeded sessions (two sharing a provider) against mock connections; assert three live runtimes, correct focus, and per-session directories.
- Drive one session to `awaiting_approval` while another finishes; assert the overview lists both, jump-to-next lands on the approval first, and the approval prompt shows the right session and cwd.
- A session whose adapter fails to spawn appears not-ready in the overview while the rest of the fleet stays usable.
- Existing hand-off end-to-end still passes after re-addressing, exercised through the same test renderer the current suite uses.

## Development Sequencing

### Build Order

1. **Identity refactor** - rename `AgentId` to `ProviderKind`, add `SessionId`, reshape `SessionState`, move the store to `Record<SessionId>` + `order` + `focusedSessionId`, key selectors by `SessionId`. No dependencies. Behavior-preserving: seed the same two sessions and keep every existing test green.
2. **Config model** - `providers` + `sessions` schema, per-session `cwd`, zero-config default. Depends on step 1 (uses `SessionId`/`ProviderKind`).
3. **Controller N-runtime** - one runtime per session descriptor with its own `cwd`, `Map<SessionId>`, approvals carrying session + cwd. Depends on steps 1 and 2.
4. **Session states** - extend `SessionStatus`, map stop reason and failures in the adapter, add `needsAttention`, `selectSessionList`, `selectNextNeedy`. Depends on step 1.
5. **Ctrl+S overview and jump-to-next** - `SessionsOverlay`, the `sessions` overlay slot, the keymap command, the `jumpToNextNeedy` action. Depends on steps 3 and 4.
6. **Session-addressed hand-off** - target selection and source/target session ids on the preview overlay. Depends on steps 1 and 5 (reuses the overview selection for the target picker).
7. **Safe multi-session approvals** - label the approval prompt and status rows with session title and cwd. Depends on step 3.
8. **Attention notifier** - bell, per-OS shell-out, and focus gating, subscribed to status transitions. Depends on step 4.
9. **Telemetry extension** - attention-latency and multi-session counters. Depends on steps 4 and 8.

### Technical Dependencies

- No new runtime service or infrastructure. The only external dependencies are the OS notification tools already present on each platform and the ACP adapter packages already pinned in config.
- OpenTUI must expose terminal focus events for the notifier's gate; where it does not, the notifier uses its documented fallback rather than blocking the build.

## Monitoring and Observability

- Metrics (opt-in, content-free, via the existing telemetry recorder): max concurrent sessions per run, time from a session entering a needs-you state to the next user action (attention latency), waiting time on unfocused sessions (idle-fleet), share of focus switches made through the Ctrl+S overview, and hand-off invocations on runs touching two or more sessions.
- Structured fields carry only `sessionRef`, event type, and timestamp; never prompt, transcript, or path content.
- No alerting: Kitten is a local tool. The metrics feed the post-launch validation cohort described in the PRD, not an operational dashboard.

## Technical Considerations

### Key Decisions

- **Decision:** Key the store by a Kitten `SessionId` with an `order` array. **Rationale:** preserves the immutable structural-sharing and `Object.is` selector equality the store depends on. **Trade-off:** an explicit order array to maintain. **Rejected:** a `Map` (breaks immutability), the ACP id as key (absent for not-ready sessions). See ADR-004.
- **Decision:** Split config into `providers` and `sessions`. **Rationale:** expresses multi-directory, repeated-provider fleets and keeps the pinned adapter definition central. **Trade-off:** a config rewrite. **Rejected:** self-contained sessions, agents-plus-refs. See ADR-005.
- **Decision:** Derive `finished`/`error` from `PromptStopReason` and failures. **Rationale:** one truthful status every surface reads. **Trade-off:** reliable crash detection needs transport-close wiring. **Rejected:** finished-only, raw-stop-reason-on-session. See ADR-006.
- **Decision:** Per-OS shell-out notifications with focus gating. **Rationale:** native reach with zero new dependencies. **Trade-off:** three per-OS paths and a focus listener. **Rejected:** a cross-platform dependency, un-gated firing. See ADR-007.

### Known Risks

- The identity rename is wide and lands with new behavior. Mitigation: sequence it first as a behavior-preserving refactor gated by the existing typecheck and test suite before any feature rides on it.
- The hand-off can regress while the model generalizes. Mitigation: a characterization test around curation and redaction, and treat any hand-off regression as a release blocker (ADR-002).
- Detecting `error` reliably depends on observing subprocess or transport exit, which the adapter does not surface today. Needs a small prototype to confirm the transport exposes a close signal; until then an unresponsive session holds its last state rather than showing a false `finished`.
- Terminal focus reporting varies by terminal. Mitigation: notify-on-transition when focus is unknown, so a missing signal never silences a real need.

## Architecture Decision Records

- [ADR-001: N-Session Model as Infrastructure Beneath the Hand-off Wedge, Not a Ctrl+S Headline](adrs/adr-001.md) - the session model is infrastructure under the hand-off differentiator; the overview stays thin.
- [ADR-002: Ship the Full Attention Cockpit as a Single V1](adrs/adr-002.md) - the whole slice ships in one release so the hand-off never regresses.
- [ADR-003: Native OS-Level Attention Notifications in V1](adrs/adr-003.md) - attention layers the status strip, a terminal bell, and a native notification.
- [ADR-004: N-Session Identity Model - Split Provider Kind from Instance Identity](adrs/adr-004.md) - key the store by a Kitten `SessionId` with an order array; provider kind becomes a field.
- [ADR-005: Fleet Configuration Model - Providers Plus a Sessions List](adrs/adr-005.md) - config splits into spawn recipes and a per-session list with its own `cwd`.
- [ADR-006: Attention State Model and Jump-to-Next](adrs/adr-006.md) - extend `SessionStatus`, map the stop reason, and derive needs-you.
- [ADR-007: Layered Attention Notifications - Per-OS Shell-Out with Focus Gating](adrs/adr-007.md) - per-OS shell-out, gated on terminal focus, with the bell as fallback.
