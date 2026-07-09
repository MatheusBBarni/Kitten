# TechSpec: Resumable Cross-Agent Sessions

## Executive Summary

Resume is built on a decisive codebase fact: the store's replay path already rebuilds a transcript from streamed updates, so `loadSession`'s re-streamed history flows through the existing `onUpdate -> applyEvent -> sessionReducer` chain with no new reducer code.
The work is therefore additive at the edges: a small persistence writer that snapshots each run to one JSON file per run under XDG state, a widening of the ACP adapter to capture the `loadSession` capability and call it, a restore path in the controller that mirrors the existing `startAgent` ordering, a `Ctrl+R` picker overlay cloned from `HandoffPreview`, and a per-agent restoration badge.
The two hard rules the design leans on are already enforced elsewhere in the app: `startSession` must bind a slice before its updates are subscribed, and hand-off direction derives from focus rather than being stored.

The primary technical trade-off: Kitten persists only pointers plus the curated bundle and rehydrates transcripts live from each agent, which keeps the at-rest surface tiny but makes liveness depend on an external adapter.
That dependency is why restoration collapses to two honest states - `live` when the agent reloads the session, `unavailable` when it cannot - rather than a stored read-only history, and why a confirmation probe against the pinned adapters gates the live-resume promise.

## System Architecture

### Component Overview

- **Run store (`src/persistence/`, new).** Owns the on-disk record. Subscribes to the app store, debounces, redacts, and writes one JSON file per run; lists/loads/deletes records for the picker. Gated by a `persistenceEnabled` config flag, no-op when disabled.
- **ACP adapter (`src/agent/agentConnection.ts`, modified).** Gains a `loadSession(sessionId, cwd)` method and a widened `ReadyState` that carries the agent's `loadSession` capability out past the ACP boundary. Optionally gains `deleteSession` for later use.
- **Restore orchestration (`src/app/controller.ts`, `src/index.ts`, modified).** Given a persisted run, restores each agent independently: bind the slice, `loadSession` or fall back, subscribe, then set focus. Records each pane's `live`/`unavailable` status.
- **Session picker overlay (`src/ui/SessionPicker.tsx`, new).** A modal that reads the run store, lists the current project's runs, filters live, previews, and triggers restore. Mirrors `HandoffPreview`/`ApprovalPrompt`.
- **Store additions (`src/store/appStore.ts`, modified).** A `sessionPicker` overlay slot and a `restoration` map, each with actions and selectors; `selectHasOpenOverlay` updated so the shell stands down when the picker is open.
- **Keymap (`src/ui/keymap.ts`, modified).** A `resume-session` command bound to the free `Ctrl+R`, plus help-panel entries.
- **First-run disclosure (`src/config/firstRun.ts`, modified).** One line stating that sessions are remembered, where, and how to delete them.
- **Confirmation probe (`src/app/selfCheck.ts`, modified).** Verifies the pinned adapters reload a prior session.

Data flow on resume: picker reads run store -> restore orchestration calls adapter `loadSession` -> ACP `session/update` notifications -> `applyEvent` -> reducer rebuilds the pane; focus and the bundle come from the run record; the restoration badge reads `AppState.restoration`.

## Implementation Design

### Core Interfaces

The persisted record and its summary (the only new domain types):

```ts
// src/persistence/runRecord.ts
export interface PersistedRunRecord {
  version: 1
  runId: string
  cwd: string
  gitBranch: string | null
  focusedAgentId: AgentId
  createdAt: number
  updatedAt: number
  agents: Record<AgentId, PersistedAgent>
  handoffBundle: HandoffBundle | null   // already redacted by the assembler
}
export interface PersistedAgent {
  sessionId: string
  lastPrompt: string    // redacted before write
  messageCount: number
  status: AgentStatus
}
```

The run store surface the writer and picker depend on:

```ts
// src/persistence/runStore.ts
export interface PersistedRunSummary {
  runId: string; updatedAt: number; gitBranch: string | null
  focusedAgentId: AgentId; lastPrompt: string; messageCount: number
}
export interface RunStore {
  save(record: PersistedRunRecord): void            // debounced + atomic
  list(cwd: string): PersistedRunSummary[]           // project-scoped
  load(cwd: string, runId: string): PersistedRunRecord | null
  delete(cwd: string, runId: string): void
  deleteAll(): void
  flush(): void                                      // final write on exit
}
export function createRunStore(opts: { enabled: boolean; path?: string }): RunStore
```

The ACP adapter additions - a widened `ReadyState` plus one new method mirroring `newSession`:

```ts
// src/agent/agentConnection.ts
export type ReadyState =
  | { ready: true; protocolVersion: number; canLoadSession: boolean }
  | { ready: false; error: string }
// new on AgentConnection:
loadSession(sessionId: string, cwd: string): Promise<void>
```

The restore state and the controller entry point:

```ts
// src/store/appStore.ts (additions)
export type RestorationMode = "live" | "unavailable"
setRestoration(agentId: AgentId, mode: RestorationMode | null): void
openSessionPicker(): void
closeSessionPicker(): void
// src/app/controller.ts (new): restore one agent, mirroring startAgent ordering
restoreAgent(config: AgentConfig, stored: PersistedAgent, focusedAgentId: AgentId): Promise<void>
```

### Data Models

`PersistedRunRecord` is the single stored entity, one instance per run, serialized to `~/.local/state/kitten/sessions/<project>/<runId>.json`.
`<project>` is a deterministic encoding of the run's absolute `cwd` (same approach Claude Code uses to encode its project directories); `<runId>` is a Kitten-minted id independent of ACP session ids.
Derived `SessionState` fields (`referencedFiles`, `pendingDiffs`) are never stored - they rebuild from the re-streamed transcript.
Two new in-memory `AppState` members support the UI: `overlays.sessionPicker: boolean` (or a small slot object) and `restoration: Record<AgentId, RestorationMode | null>`.
One new config field, `persistenceEnabled: boolean`, defaults to `true` and follows the exact shape of `telemetryEnabled`.

### API Endpoints

Not applicable: Kitten is a terminal application with no HTTP surface.
The equivalent external surface is the ACP client calls (`loadSession`, and later `deleteSession`) and the new `AgentConnection` methods, specified in Core Interfaces and Integration Points.

## Integration Points

- **Agent adapters over ACP** - `@agentclientprotocol/claude-agent-acp@0.57.0` and `@agentclientprotocol/codex-acp@1.1.0` (pinned).
  Kitten reads `initialize().agentCapabilities.loadSession` at connect and calls `ClientSideConnection.loadSession` when it is `true`.
  Both pinned adapters resolve `loadSession` by id from their own on-disk stores, so a days-old id reloads as long as the underlying transcript still exists.
- **Authorization** - none; the adapters are local subprocesses Kitten already spawns, using the user's existing agent auth.
- **Error handling** - a missing capability, a rejected/`resource_not_found` load, or a purged transcript resolves to the `unavailable` state for that pane; the other pane restores independently, mirroring the existing `failAgent` degrade.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/persistence/*` | new | Run store: record type, XDG path, one-file-per-run writer, redaction. Low risk, isolated. | Build the writer and RunStore; reuse `resolveTelemetryPath` logic. |
| `src/agent/agentConnection.ts` | modified | Add `loadSession`, widen `ReadyState`, capture `agentCapabilities`. Medium risk: touches the ACP boundary. | Extend interface + impl; keep wire types behind the adapter. |
| `src/app/controller.ts`, `src/index.ts` | modified | Restore path + writer construction. Medium risk: ordering is load-bearing. | Add `restoreAgent`; construct RunStore in `createCockpitSession`. |
| `src/store/appStore.ts`, `src/store/selectors.ts` | modified | `sessionPicker` slot, `restoration` map, actions, selectors, `selectHasOpenOverlay`. Low risk, additive. | Add slots/actions/selectors. |
| `src/ui/SessionPicker.tsx` | new | Picker overlay cloned from `HandoffPreview`. Low-medium risk: keyboard modality. | Build gate + dialog; mount in `CockpitFrame`. |
| `src/ui/keymap.ts`, `src/ui/CockpitApp.tsx` | modified | `resume-session` -> `Ctrl+R`, dispatch case, help entries. Low risk. | Add binding + dispatch + hints. |
| `src/config/configLoader.ts` | modified | `persistenceEnabled` flag (default true). Low risk, mirrors telemetry. | Add const/field/schema/merge. |
| `src/config/firstRun.ts` | modified | One disclosure line. Low risk. | Add line within the 60s onboarding budget. |
| `src/app/selfCheck.ts` | modified | Reload confirmation probe. Low risk, test-only surface. | Add probe against pinned adapters. |
| `src/ui/ConversationView.tsx` / `StatusStrip.tsx` | modified | Per-pane restoration badge + "start fresh from bundle" affordance. Low risk. | Read `restoration`; render badge. |

## Testing Approach

### Unit Tests

- **Run store**: save/list/load/delete/deleteAll and the debounce + atomic-overwrite behavior, against an injected temp dir; assert redaction runs on `lastPrompt`; assert no-op when `enabled` is false (mirrors the telemetry `NOOP_RECORDER` tests).
- **Adapter**: `loadSession` calls `ClientSideConnection.loadSession` with the right params and re-streams updates through `onUpdate`; `ReadyState.canLoadSession` reflects `agentCapabilities.loadSession`. Use the existing fake-connection pattern from `agentConnection.test.ts`.
- **Restore orchestration**: with a fake `AgentConnection`, assert `startSession` runs before subscription, that a `loadSession` failure yields `restoration = unavailable` while the other agent still restores, and that `focusedAgentId` is set from the record. Reuse the controller test harness.
- **Store/keymap/picker**: `sessionPicker` slot flips `selectHasOpenOverlay`; `Ctrl+R` maps to `resume-session`; the picker filters and previews given a fake RunStore.

### Integration Tests

- **Confirmation probe** (the PRD Phase-1 gate): a `selfcheck` path that starts each pinned adapter, creates a session, reloads it by id in a fresh connection, and reports whether history re-streamed. Run manually and in a nightly/opt-in CI job, not on every push, because it spawns external binaries.

## Development Sequencing

### Build Order

1. **Run store + `persistenceEnabled` flag** - no dependencies. Record type, XDG path, one-file-per-run writer with redaction and atomic overwrite, debounced store subscription constructed in `createCockpitSession`, and the config flag mirroring `telemetryEnabled`. Produces run files (also delivers crash/close autosave).
2. **Adapter `loadSession` + capability capture** - independent of step 1. Add the method, widen `ReadyState`, capture `agentCapabilities.loadSession` at `connect()`.
3. **Confirmation probe in `selfCheck`** - depends on step 2 (needs the adapter `loadSession`). Verifies the pinned adapters reload a prior session; gates the live-resume default.
4. **Restore orchestration + restoration state** - depends on steps 1 (run files to restore) and 2 (`loadSession`). `restoreAgent` mirrors `startAgent` ordering; adds `AppState.restoration` + `setRestoration` + selector; degrades per agent.
5. **"Resume last run" fast-path** - depends on step 4. On startup, offer the newest run for the current project.
6. **`Ctrl+R` session picker overlay** - depends on steps 1 (list runs), 4 (invoke restore), and the store/keymap wiring. Add the `sessionPicker` slot, `resume-session` binding, `SessionPicker.tsx`, project scope, fuzzy filter, preview, informative rows.
7. **Data control + first-run disclosure** - depends on steps 1 (files) and 6 (picker UI). Per-session delete and global delete from the picker; the disclosure line.
8. **Degradation UX** - depends on step 4. Per-pane `live`/`unavailable` badge and the "start fresh from bundle" affordance for an unavailable pane.
9. **Resume telemetry counters** - depends on steps 4 and 6. Emit the events behind the PRD success metrics.

Steps 1-3 map to PRD Phase 1, steps 4-6 to Phase 2, steps 7-9 to Phase 3.

### Technical Dependencies

- The step-3 confirmation probe must pass before the live-resume default is shipped; a negative result reopens the read-only-floor fallback from ADR-002.
- Pinned adapter versions (`claude-code-acp@0.57.0`, `codex-acp@1.1.0`); a bump revalidates the probe.

## Monitoring and Observability

Reuse the existing opt-in telemetry recorder; add content-free counters mapped to the PRD success metrics:

- `session_resumed` with fields `{ mode: "picker" | "last-run", liveCount: 0 | 1 | 2 }` - feeds resume adoption and two-sided live fidelity.
- `resume_pane_unavailable` with `{ agent }` - tracks degradation frequency.
- `resume_first_action` with `{ continued: boolean }` via the existing re-explanation heuristic - feeds continue-without-re-explain.
- Timing fields around picker-open and load-settle - feed picker responsiveness (< 150 ms interactive, < 3 s to a usable cockpit).
- No prompt content is recorded, consistent with the current recorder.

## Technical Considerations

### Key Decisions

- **Decision:** One JSON file per run under XDG state, written by a debounced store subscription.
  **Rationale:** Delete and "show current record" are the common operations and both are filesystem-trivial; the store is the single source of truth.
  **Trade-offs:** Overwrite must be atomic; keep-forever growth is unbounded.
  **Alternatives rejected:** Append-only JSONL (delete needs rewrite), per-run + index (double writes), event/interval autosave (missed events or crash loss). See ADR-003.
- **Decision:** Restore via ACP `loadSession` streamed replay, with a two-state (`live`/`unavailable`) model.
  **Rationale:** The streamed-replay path already rebuilds transcripts, and pointers-only storage has no transcript to show when reload fails.
  **Trade-offs:** Liveness depends on an external adapter; ordering is load-bearing.
  **Alternatives rejected:** Store a transcript snapshot (enlarges at-rest surface), a new rehydrate action (unnecessary), parse agent JSONL directly (brittle). See ADR-004.
- **Decision:** Unit tests with fakes plus one real confirmation probe in `selfcheck`.
  **Rationale:** Matches the repo's injectable-seam test culture and keeps CI fast while still exercising the real reload once.
  **Trade-offs:** The probe is not on every push, so an adapter regression is caught nightly/pre-release rather than per-commit.

### Known Risks

- **Ordering regression** (`startSession` after subscribe/load) silently drops replayed history. *Likelihood:* medium during refactors. *Mitigation:* a unit test asserting bind-before-subscribe; mirror the existing controller comment.
- **Purged or unsupported session** yields `unavailable`. *Likelihood:* rises past Claude's 30-day window. *Mitigation:* gate on capability, catch load failure, render bundle + metadata, offer fresh start.
- **Redaction gap on a new persisted field.** *Likelihood:* low. *Mitigation:* funnel all persisted strings through one redaction helper; unit-test it.
- **Atomic-write correctness** on crash mid-write. *Likelihood:* low. *Mitigation:* write-temp-then-rename.

## Architecture Decision Records

- [ADR-001: Two-Layer Whole-Cockpit Resume - Reliable Relationship, Best-Effort Liveness](adrs/adr-001.md) - Restore the hand-off relationship reliably and per-agent liveness best-effort, with a data-at-rest gate.
- [ADR-002: V1 Rollout Shape - Whole-Cockpit Resume Delivered End-to-End](adrs/adr-002.md) - Ship the full two-layer resume in one V1 release built in internal phases.
- [ADR-003: Cockpit-Run Persistence - One JSON File Per Run, Debounced Store Subscription](adrs/adr-003.md) - Persist a small record per run under XDG state, on by default, redacted, deletable.
- [ADR-004: Live Restore via loadSession Replay, with Two-State Degradation](adrs/adr-004.md) - Rebuild panes through the existing streamed-replay path and model degradation as live/unavailable, refining ADR-001's three-state wording.
