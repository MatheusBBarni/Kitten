# Technical Specification: Local-first governed Workflow Board

## Executive Summary

This specification delivers the PRD's local-first Workflow Board as a packages-first Bun monorepo. `packages/tui` receives the existing Cockpit through behavior-preserving migration slices, `packages/desktop` owns the Electrobun application and all board lifecycle state, and `packages/engine` contains only UI-free ACP, profile-readiness, normalized-event, and scoped-clarification capability contracts. The desktop renderer communicates exclusively with its Bun host through a typed Electrobun RPC schema; it never accesses ACP connections, worktrees, SQLite, Skill files, or secrets directly.

The desktop host persists all workflow activity in a local SQLite append-only journal and transactionally maintains current-state projections. It starts a fresh Direct ACP session for each Run Attempt, snapshots the resolved Skill and configuration, appends normalized activity to the journal, and marks an unclosed attempt interrupted on restart. The primary trade-off is upfront migration and persistence complexity in exchange for independent applications, replayable history, explicit attention handling, and no false session-resumption claim.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary and dependencies |
| --- | --- | --- |
| Workspace root | Private Bun workspace, exact dependency policy, shared scripts, and package filters. | Contains only workspace coordination; no application runtime. |
| `packages/tui` | Existing Cockpit CLI, OpenTUI UI, controller, store, JSON run persistence, and releases. | Receives behavior-preserving migration slices; may consume UI-free `engine` exports but never desktop state. |
| `packages/engine` | ACP transport contracts, normalized event types, certified-profile readiness contracts, and authenticated scoped `ask_user` protocol primitives. | No React, Electrobun, SQLite, board/card state, worktree ownership, or application controller. |
| `packages/desktop` Bun host | Electrobun lifecycle, typed RPC handlers, Workflow Board coordinator, SQLite journal/projections, worktree lifecycle, catalog resolver, Direct ACP attempts, Attention Blockers, and notifications. | Sole desktop owner of all privileged resources; consumes `engine` contracts. |
| `packages/desktop` renderer | React board, canvas, inspector, settings, notification/attention presentation, Zustand view store, and TanStack Query RPC cache. | Receives snapshots and events only through typed RPC; never imports Bun host implementations. |
| SQLite journal and projections | Immutable board/card/attempt evidence plus current query views. | Opened only by desktop Bun host; updated transactionally. |

### Data Flow

1. The renderer requests a boot snapshot through typed RPC, then stores it in narrow Zustand slices and query caches.
2. A renderer command reaches the desktop coordinator through a typed request. The coordinator validates the command against a current projection, appends the authoritative event, updates projections in one transaction, and publishes a typed projection event back to the renderer.
3. Starting a runnable card provisions or reconciles its card-owned worktree, resolves and snapshots the effective Workflow Skill, creates a Run Context and `attempt_created` event, then opens a fresh certified Direct ACP session.
4. The desktop ACP adapter translates provider updates into protocol-free attempt events. The coordinator appends them before publishing the resulting card/inspector projection.
5. A scoped `ask_user` request becomes one Attention Blocker event, locks the card, emits a card-scoped notification, and waits for one persisted terminal outcome before resuming the same attempt.
6. A normal active-run follow-up remains queued after a terminal turn. The renderer must explicitly confirm it before the coordinator sends it as the next prompt in the same healthy attempt.

### PRD-to-Component Mapping

| PRD section | Technical component |
| --- | --- |
| Blank Board, Trusted Repository, and Linear Workflow Canvas | Desktop board coordinator, stage/edge projections, typed board RPC, React canvas view. |
| Default Workflow Skill After Stage Creation | Catalog resolver, root configuration, skill projections, immutable Run Context snapshot. |
| Card Setup and Runnable Work | Card projection, runnable validator, profile-readiness adapter, worktree coordinator. |
| Persistent Card Inspector and Composer | Attempt-event journal, transcript projection, inspector query, desktop-owned follow-up queue. |
| Attention Blockers and Desktop Notification | Scoped `ask_user` bridge adapter, attention coordinator, notification service, stage-lock projection. |
| Governed Progression and Human Review | Version-fenced transition coordinator and review-disposition projection. |
| Local Settings and Bounded Execution | Desktop preferences/profile/catalog projections and global scheduler. |

## Implementation Design

### Core Interfaces

Production interfaces are TypeScript and stay protocol-free above the ACP adapter boundary.

```ts
export interface DesktopAttemptCoordinator {
  start(cardId: CardId): Promise<StartAttemptResult>
  appendAcpEvent(input: NormalizedAttemptEvent): Promise<void>
  queueFollowUp(input: QueueFollowUpInput): Promise<QueuedFollowUp>
  confirmQueuedFollowUp(attemptId: AttemptId, queueId: QueueId): Promise<void>
  answerAttention(input: AttentionOutcomeInput): Promise<void>
  cancel(attemptId: AttemptId): Promise<void>
}

export interface EventJournal {
  append(command: JournalCommand): Promise<ProjectionDelta>
  snapshot(): Promise<DesktopSnapshot>
  recoverInterruptedAttempts(): Promise<readonly AttemptId[]>
}
```

The generic TechSpec template requires one Go structural definition. It is a conceptual journal contract only; production code remains TypeScript.

```go
type AttemptEvent struct {
    EventID    string
    AttemptID  string
    Sequence   int64
    Actor      string
    Kind       string
    OccurredAt int64
    Payload    []byte
}

type EventJournal interface {
    Append(AttemptEvent) error
}
```

### Data Models

The SQLite schema uses versioned migrations. SQLite records are authoritative for desktop state; renderer Zustand and query data are disposable caches.

| Entity / projection | Required fields | Invariants |
| --- | --- | --- |
| `boards` | `board_id`, trusted repository canonical path, created/updated timestamps, workflow version | One board binds to one verified repository identity. |
| `workflow_stages` | `stage_id`, `board_id`, label, ordered position, default Skill identity, configured flag, workflow version | A stage without a valid default Skill cannot be runnable. |
| `workflow_edges` | `board_id`, source stage, target stage, workflow version | Validator permits exactly one path: one start/end, at most one inbound/outbound edge, no cycle. |
| `cards` | `card_id`, board/stage identity, title, description, provider/model/effort, optional Skill override, runnable flag, execution status, version | Workflow Stage and Execution Status are separate; running and needs-attention cards are stage-locked. |
| `card_worktrees` | `card_id`, repository identity, worktree path, branch, baseline, lifecycle | One managed worktree and branch persist across the card's attempts. |
| `attempts` | `attempt_id`, card identity, generation, state, start/terminal timestamps, active prompt state, next sequence | A new attempt has a fresh ACP session; interrupted after restart is terminal, not resumed. |
| `run_contexts` | attempt identity, card snapshot, workflow version, effective Skill snapshot, provider/model/effort, repository and review evidence | Immutable once stored. |
| `attempt_events` | event ID, attempt/card/board identity, monotonic sequence, actor, kind, timestamp, validated payload | Append-only; unique event ID and attempt sequence prevent duplicate updates. |
| `attention_blockers` | blocker ID, attempt identity, structured form, active/terminal outcome, notification state | At most one active blocker per attempt; outcome appends before resumption. |
| `queued_follow_ups` | queue ID, attempt identity, text, state, created/confirmed timestamps | FIFO; active turn settlement moves head to `awaiting_confirmation`, never sends automatically. |
| `skill_catalog_entries` | catalog identity, canonical path, root class, digest, display metadata, validity diagnostics | Project roots precede user roots; canonical-path dedupe and collision disclosure are mandatory. |
| `review_dispositions` | card identity, reviewer action, timestamp, evidence reference | Only explicit operator completion changes `ready_for_review` to `completed`. |

Each command validates current board/card/attempt/workflow versions, appends one or more immutable events, updates all affected projections, and emits the committed projection delta in the same host operation. A projection rebuild from the journal must produce the same current state as the persisted projections.

### Typed Desktop RPC

The application exposes no HTTP API in V1. It uses one shared Electrobun RPC schema with request/response commands for durable mutations and host-to-renderer messages for committed projection changes.

| RPC surface | Operations | Contract |
| --- | --- | --- |
| Bootstrap and queries | `getDesktopSnapshot`, `getBoard`, `getCardInspector`, `getCatalog`, `getSettings` | Returns projections only; no ACP, filesystem, or SQLite handles cross the boundary. |
| Board and stage commands | `bindRepository`, `createStage`, `updateStage`, `connectStages`, `reorderStages`, `assignStageSkill` | Host validates single-path workflow and catalog identity before event append. |
| Card commands | `createCard`, `updateCard`, `moveCard`, `startAttempt`, `cancelAttempt`, `reviewCard` | Host enforces runnable validation, stage lock, concurrency, transition version, and human review. |
| Composer and attention commands | `queueFollowUp`, `removeQueuedFollowUp`, `confirmQueuedFollowUp`, `answerAttention` | Queue does not cancel an active turn; outstanding blocker takes priority. |
| Settings commands | `updatePreferences`, `updateProfileDefaults`, `updateCatalogRoots`, `setExecutionLimit` | Defaults seed future cards only; immutable Run Contexts never change. |
| Host messages | `projectionCommitted`, `attemptActivity`, `attentionRaised`, `notificationResult` | Message payloads contain stable IDs and content-minimized summaries; renderer refetches or applies ordered deltas. |

Every mutating request carries the caller's expected projection/version where stale writes are possible. The host returns a typed conflict result rather than silently applying a stale move or completion event.

## Integration Points

| Integration | Use | Boundary and failure handling |
| --- | --- | --- |
| Electrobun | Creates the desktop window and typed Bun/renderer RPC. | Define the shared schema once; handle requests only in Bun and publish projection messages after commit. Renderer teardown drops stale RPC handlers. |
| Direct ACP profiles | Starts one certified provider session per Run Attempt. | Extract only protocol-free adapter/readiness contracts into `engine`; profile failure marks the card `needs_attention` without crashing other cards. |
| Scoped `ask_user` bridge | Routes structured agent questions to the desktop operator. | Reuse strict form/outcome and authenticated local-capability patterns; map each route to `(attemptId, generation)`, persist the outcome, and reject stale routes. |
| Git managed worktrees | Isolates one card's branch and worktree under its trusted repository. | Desktop owns provisioning, baseline verification, reconciliation, and cleanup; never rely on an arbitrary external path. |
| Local Skill roots | Discovers validated `SKILL.md` files from configured project and user roots. | Canonicalize, deduplicate, validate, diagnose collisions, and snapshot the chosen content at attempt start. |
| macOS notifications | Calls the user back to a card in `needs_attention`. | Emit idempotently for an active blocker only; use minimal card/action copy and no provider, path, prompt, or code content. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| Root `package.json`, lockfile, scripts, CI/release/install paths | Modified | Becomes private Bun workspace; Cockpit publication behavior can regress. | Establish workspace and prove Cockpit compatibility before desktop work. |
| `packages/tui` | New/moved | Receives the existing root Cockpit application without lifecycle redesign. | Relocate through dependency-ordered compatibility-gated slices, then remove temporary bridges. |
| `packages/engine` | New | Holds only small, UI-free shared ACP/readiness/clarification contracts. | Extract deliberately; do not move Cockpit store/controller/persistence. |
| `packages/desktop` Bun host | New | Owns all board, attempt, persistence, worktree, catalog, and notification authority. | Implement typed RPC, journal, coordinator, and shutdown/recovery lifecycle. |
| `packages/desktop` renderer | New | React desktop UI replaces no existing Cockpit view. | Consume RPC projections through narrow Zustand selectors and query invalidation. |
| `src/agent/agentConnection.ts` and translation tests | Extract/adapter reuse | Useful ACP semantics but coupled to Cockpit types. | Extract only contracts and tests that remain protocol-free; keep ACP wire types adapter-local. |
| `src/app/kittenMcpBridge.ts`, `src/agent/askUserMcp.ts` | Selective reuse | Strong scoped-question protocol but current lifecycle is session-based. | Rebind capability ownership to attempt generation; add durable attention events. |
| `src/app/managedWorktree.ts` | Desktop-specific reimplementation | Existing safety behavior is relevant, but desktop must own card worktrees. | Preserve safety invariants without moving board/worktree ownership into engine. |
| `src/persistence/runWriter.ts` and run-store tests | Not reused as authority | JSON summary persistence lacks transcript history. | Retain for TUI only; create SQLite migration, journal, and projection tests. |
| Existing `src/notify/` pattern | Selective reuse | Current notifications are session-level and may include broader context. | Use injected best-effort interface with card-safe idempotent notifications. |

## Testing Approach

### Unit Tests

- Test pure workflow validation: single-path edges, stage configuration, version-fenced moves, Stage Lock, final review transition, and no automatic publication.
- Test the event reducer/projection builder against ordered and duplicate event streams; rebuilding from events must equal live projections.
- Test SQLite migration, transaction rollback, unique event identity, monotonic attempt sequence, stale-version rejection, and restart conversion of live attempts to interrupted.
- Test Skill Catalog root precedence, symlink canonicalization, digest changes, collision diagnostics, invalid `SKILL.md`, and immutable Run Context snapshots.
- Test coordinator state: one live prompt, one active blocker, queued draft FIFO, required answer priority, explicit follow-up confirmation, removal, cancellation, and recovery.
- Test renderer stores with narrow selector subscriptions and explicit accessibility state, never requiring a host resource directly.

### Integration Tests

- Use existing in-memory ACP transport and mock-agent seams to run a Direct ACP attempt through normalized events, journal persistence, transcript projection, terminal success/failure/cancellation, and exactly-one-stage advancement.
- Run the authenticated scoped `ask_user` path against an attempt-scoped bridge; verify submitted, skipped, timed-out, cancelled, stale-generation, duplicate-call, and single-blocker behavior.
- Exercise typed host RPC with a fake desktop window and a temporary SQLite database: bootstrap, board/stage/card mutation, projection message delivery, conflict results, and renderer cache refresh.
- Exercise managed worktree provisioning and reconciliation in a temporary Git repository. Prove one card retains one branch/worktree across fresh attempts and no review action auto-pushes or removes it.
- Add a macOS desktop smoke workflow that creates a blank board, configures a stage Skill, starts a fixture attempt, raises Attention Blocker, confirms an idle follow-up, reaches Ready for Review, and records explicit completion.

The mandatory gate is layered: domain/projection, SQLite, RPC, ACP/`ask_user`, worktree, and desktop smoke evidence all pass after a change that touches their boundary. Cockpit typecheck, test, self-check, and build remain required for the packages-first relocation.

## Development Sequencing

### Build Order

1. Convert the root to the private Bun workspace and establish `packages/tui` boundaries without introducing a second application lifecycle; prove root-level workspace compatibility. No dependencies.
2. Relocate Cockpit source/test and public-delivery surfaces through dependency-ordered compatibility-gated slices, removing each temporary bridge when its successor owns the surface; depends on step 1.
3. Add the minimal `packages/engine` protocol-free contracts and package dependency boundaries; depends on step 2.
4. Scaffold `packages/desktop` with Electrobun host, shared typed RPC schema, renderer bootstrap, and package-local test harness; depends on steps 1 and 3.
5. Implement SQLite migrations, append-only journal, projection rebuild, and repository/board/stage/card read models; depends on step 4.
6. Add Skill Catalog root configuration, validation, canonicalization, collision diagnostics, and per-attempt snapshot contracts; depends on step 5.
7. Add card-owned managed worktree lifecycle, profile readiness projection, runnable validation, global concurrency scheduler, immutable Run Context, and fresh Direct ACP attempt startup; depends on steps 3, 5, and 6.
8. Add normalized attempt event ingestion, inspector projections, transcript persistence, explicit follow-up queue, and user-confirmed post-turn dispatch; depends on steps 5 and 7.
9. Bind the scoped `ask_user` bridge to attempts, implement Attention Blocker journal/projection/notification behavior, and enforce Stage Lock; depends on steps 7 and 8.
10. Implement linear canvas, card inspector, composer, settings, and accessible attention UX using typed RPC and narrow renderer state; depends on steps 4, 6, 8, and 9.
11. Add end-to-end recovery, audit, review, and desktop smoke gates; depends on steps 1 through 10.

### Technical Dependencies

- A successful staged packages-first Cockpit relocation is a hard prerequisite for desktop implementation.
- Electrobun, React, Zustand, TanStack Query, HeroUI, and Tailwind versions must be reviewed and exact-pinned under the existing minimum-release-age policy before addition.
- At least one certified Direct ACP profile and the scoped `ask_user` bridge must be available for the first integration gate.
- macOS host and packaging support are required for the desktop smoke and notification evidence.
- The current issue-40 decision defers the Compozy execution route for this V1; ADR-0015's dual-route promise requires a later supersession or phase record before implementation starts.

## Monitoring and Observability

- Persist content-free lifecycle counts for attempt start/terminal reason, queue created/removed/confirmed, attention raised/outcome, stale-event rejection, projection conflict, catalog validation result, notification delivery result, and review disposition.
- Keep event payload content out of telemetry. Prompts, code, transcript text, Skill bodies, repository paths, provider credentials, and question answers remain only in local desktop evidence where needed.
- Report host faults through structured local diagnostics with stable error category, board/card/attempt opaque IDs, generation, and event ID; never include raw content.
- Surface local operator recovery states: interrupted attempt, stale command conflict, unavailable profile, invalid Skill, worktree unavailable, and notification delivery failure.
- Treat duplicate event acceptance, projection rebuild mismatch, more than one active blocker, stage movement while locked, and automatic publication as fail-closed correctness violations in tests and diagnostics.

## Technical Considerations

### Key Decisions

- **Packages-first migration:** make ADR-0023 real through compatibility-gated relocation slices, keeping the Cockpit lifecycle in `packages/tui` and the desktop lifecycle in `packages/desktop`.
- **Host ownership:** use typed Electrobun RPC as the renderer boundary; privileged resources stay in the Bun host.
- **Durable history:** use SQLite immutable events plus transactional projections, not Cockpit's JSON summaries or mutable snapshot authority.
- **Attempt lifecycle:** start fresh ACP sessions per attempt and mark unfinished attempts interrupted after restart; do not present session restoration as truth.
- **Follow-ups and attention:** queue ordinary active-run drafts but require post-turn operator confirmation; make one scoped Attention Blocker answer-first and durable.
- **Skill provenance:** resolve from project then user local roots with canonical identity and immutable per-attempt content snapshot.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Workspace migration breaks a published Cockpit path | Medium | Gate desktop work on fresh Cockpit contract, build, installer, and release evidence after relocation. |
| ACP events arrive duplicated, stale, or out of order | High | Generation, event ID, monotonic sequence, transactional version checks, and replay tests. |
| Journal projections drift from immutable history | Medium | Keep append/projection in one transaction and test deterministic rebuild equality. |
| An active attempt is lost on desktop restart | Medium | Persist terminal interruption with exact prior evidence; require a fresh attempt rather than false resume. |
| Skill root changes or symlink aliases undermine provenance | Medium | Canonicalize, digest, surface collisions, and snapshot chosen content before launch. |
| Notification or attention UX hides a required question | Medium | One active blocker, idempotent card-scoped notification, visible board label, keyboard route, and end-to-end blocker gate. |
| New desktop dependencies weaken supply-chain discipline | Medium | Exact pins, minimum-release-age policy, reviewed allow-list changes, and package-local verification. |

## Architecture Decision Records

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — defines the linear canvas, stage locks, and non-cancelling composer baseline.
- [ADR-002: Make Attention Blockers the V1 supervision priority](adrs/adr-002.md) — makes one highlighted, notified, answer-first blocker the core supervision state.
- [ADR-003: Establish the packages-only workspace before desktop delivery](adrs/adr-003.md) — requires Cockpit relocation into `packages/tui` before desktop feature work.
- [ADR-004: Persist desktop work as an append-only SQLite journal with projections](adrs/adr-004.md) — makes immutable events and transactional projections the desktop authority.
- [ADR-005: Own queued follow-ups and Attention Blockers in the desktop attempt coordinator](adrs/adr-005.md) — keeps ordinary follow-ups confirmable and non-cancelling while prioritizing one scoped blocker.
- [ADR-006: Resolve Workflow Skills from deterministic project and user catalog roots](adrs/adr-006.md) — defines catalog precedence, collision handling, and immutable Skill provenance.
- [ADR-007: Stage the Cockpit workspace relocation behind compatibility gates](adrs/adr-007.md) — supersedes the atomic delivery detail with reviewable migration slices.
