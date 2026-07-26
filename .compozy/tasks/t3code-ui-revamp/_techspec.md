# Technical Specification: T3 Code-Inspired Desktop Supervision Loop

## Executive Summary

This change reshapes Kitten's desktop renderer around a supervision-first workflow inspired by T3 Code while preserving Kitten's packages-first architecture, workflow lifecycle, host-owned SQLite state, typed plain-JSON RPC boundary, ACP execution model, and worktree isolation.

The implementation adds four connected capabilities:

1. A host-derived `SupervisionProjection` that powers a cross-project Work Inbox without duplicating authoritative workflow state.
2. A board-preserving workbench with a conversation-first attempt timeline, locally persisted drafts, and renderer-local navigation state.
3. Evidence-bound review using immutable manifests, canonical patch data, bounded per-file diff reads, and digest revalidation before either approval or a request-changes attempt.
4. A direct prompt-submission contract where Enter authorizes the message immediately; an active attempt persists it in FIFO order and dispatches it at the next safe turn boundary without a second confirmation.

The primary trade-off is deliberate strictness. Review actions become unavailable when evidence is missing, stale, unsafe, or exceeds bounded local limits. Capturing immutable review evidence also consumes additional local storage. In exchange, the UI never presents a review decision against evidence the host cannot reproduce and verify. The Work Inbox remains an on-read projection, avoiding a second mutable source of truth at the cost of an `O(cards + attempts + attention)` local projection pass.

No new runtime package is introduced. The change remains within `packages/desktop` and extends its existing persistence, host, RPC, renderer, and native verification seams.

## System Architecture

### Component Overview

#### 1. Authoritative workflow snapshot

`packages/desktop/src/persistence/eventJournal.ts` remains the authoritative persisted source for boards, cards, attempts, attention, follow-up submissions, and review dispositions. Migration version 9 adds immutable review-evidence tables and upgrades the follow-up submission state machine.

The renderer never receives SQLite handles, worktree paths, ACP sessions, Git process handles, secrets, or other host-only capabilities.

#### 2. Supervision projection

`packages/desktop/src/host/boardRpc.ts` gains a pure `projectSupervision(snapshot)` projection. It derives a cross-project list from the current host snapshot and emits only plain JSON.

The projection groups and orders items as follows:

1. `needs_attention`
2. `ready_for_review`
3. `failed`
4. `running`
5. other settled work

Within a group, items sort by descending actionable timestamp, then stable board and card identifiers. The projection includes review-evidence availability but never embeds patch content.

This projection is computed on read. It is not materialized in a new table and cannot drift independently from the workflow snapshot.

#### 3. Review-evidence service

A new `packages/desktop/src/host/reviewEvidence.ts` service owns:

- canonical file ordering and patch normalization;
- immutable manifest and file-record capture;
- evidence-digest calculation;
- current-worktree revalidation;
- manifest reads;
- bounded per-file patch chunk reads;
- binary, oversized, and unsafe-change classification.

Evidence capture occurs when the final-stage attempt is admitted to `ready_for_review`. The service reads the worktree through host-only Git operations, builds canonical evidence, and then persists the evidence rows and journal reference in the same SQLite transaction guarded by the card version.

If capture or persistence fails, the card does not become reviewable. The host exposes a typed evidence-unavailable reason and a retryable recovery action.

#### 4. Review disposition coordinator

`packages/desktop/src/host/reviewDisposition.ts` expands from approval-only handling to evidence-bound dispositions:

- `approved`: revalidate evidence, append the disposition, and complete the card;
- `changes_requested`: revalidate evidence, append the disposition, and admit a new attempt on the same card and current stage using the explicitly submitted draft.

Selecting **Request changes** in the renderer does not mutate host state. It opens and seeds an editable local draft. Only explicit submission invokes the host.

Every disposition uses optimistic preconditions for card version, attempt identity, generation, worktree binding, evidence identity, and evidence digest. A stale result is rejected rather than silently applied to newer state.

#### 5. Unified prompt submission

`packages/desktop/src/attempts/attemptCoordinator.ts` exposes one prompt-admission path, `submitCardPrompt`, for initial prompts, normal composer follow-ups, and request-changes prompts.

- When no attempt is active, the host admits a new attempt.
- When an attempt is active, the host durably appends the explicitly submitted message to a FIFO queue.
- At the next safe ACP turn boundary, the host marks the head item `dispatching`, sends it once, and records `dispatched`.
- An ambiguous crash or restart state becomes `interrupted` and is never automatically retried.

The existing `queueFollowUp` and `confirmQueuedFollowUp` RPC flow is removed after call sites and persisted states are migrated. Enter is the authorization boundary; Shift+Enter inserts a newline.

#### 6. Typed RPC boundary

`packages/desktop/src/shared/rpc.ts` remains the single shared contract surface. New queries and commands use narrow plain-JSON schemas, stable error codes, and existing privileged-key rejection.

Large patch data never travels inside a board, supervision, or inspector response. The renderer first requests a small evidence manifest and then requests bounded chunks for a selected file.

#### 7. Renderer state and queries

`packages/desktop/src/renderer/state/desktopViewStore.ts` owns ephemeral navigation and workbench state:

- route;
- active board;
- selected card and attempt;
- board/workbench mode;
- prior board anchor for restoration;
- collapsed project sections.

Prompt and request-changes drafts are persisted locally using namespaced keys. Workflow lifecycle and review truth remain host-owned.

TanStack Query bindings in `packages/desktop/src/renderer/query/desktopQueries.ts` and `packages/desktop/src/renderer/client.ts` refresh projections by host revision. Mutations invalidate the smallest relevant query set rather than cloning workflow state into the renderer store.

#### 8. Desktop shell and workbench

The existing shell is reorganized into:

- a project sidebar with the cross-project Work Inbox;
- a board surface that keeps its filter and scroll context;
- a card workbench that opens from a card or inbox item;
- a conversation-first attempt timeline;
- an evidence review panel with manifest-first, file-on-demand diff loading;
- a persistent composer with direct Enter submission;
- a responsive narrow-layout navigation path.

Opening the workbench records the source board anchor. Closing it restores the prior board, mode, filters, and scroll target when those entities still exist.

#### 9. Native verification harness

The existing Electrobun acceptance and capture infrastructure gains a lifecycle-state fixture matrix. It must exercise the packaged app with seeded local data for inbox ordering, board-to-workbench restoration, attention, running submission, failed work, ready review, stale evidence, request changes, responsive layout, and settings reachability.

A browser-only screenshot is supplementary and cannot satisfy this gate.

### Data Flows

#### Supervision read

1. The renderer calls `getSupervision`.
2. The host reads the current event-journal snapshot.
3. `projectSupervision` derives ordered groups and evidence summaries.
4. The RPC layer validates the result as plain JSON.
5. TanStack Query stores the response keyed by revision.
6. The sidebar renders the inbox without adopting lifecycle ownership.

#### Review-evidence capture

1. A final-stage attempt reaches the successful terminal boundary.
2. The coordinator verifies the card, attempt, generation, and worktree binding.
3. `reviewEvidence` captures Git metadata, canonical file records, and canonical patch bytes.
4. The service rejects unsafe paths, unsupported repository state, or configured size limits.
5. A SQLite transaction rechecks the card version, inserts immutable evidence rows, appends the evidence reference, and marks the card `ready_for_review`.
6. The host publishes the new workflow revision.

#### Review disposition

1. The renderer reads the manifest and selected file chunks.
2. The user explicitly approves or submits an edited request-changes draft.
3. The command includes the last observed card and evidence preconditions.
4. The host recomputes the current evidence digest from the bound worktree.
5. A transaction rechecks the workflow preconditions and appends the disposition.
6. Approval completes the card; request changes admits a new attempt on the same card and stage.
7. The renderer invalidates supervision, board, inspector, and evidence queries.

#### Prompt submission

1. Enter invokes `submitCardPrompt`; Shift+Enter remains a newline.
2. The host validates non-empty content, command identity, card version, blocker state, and source.
3. For settled work, it admits a new attempt.
4. For active work, it durably queues the message in FIFO order and returns `queued`.
5. The coordinator dispatches the head item at the next safe turn boundary.
6. Recovery converts ambiguous in-flight delivery to `interrupted` and requires an explicit user retry.

## Implementation Design

### Core Interfaces

The implementation language remains TypeScript. The following Go structure is a language-neutral wire-contract illustration required by the planning workflow; it is not a new Go runtime dependency.

```go
type SupervisionItem struct {
	BoardID       string `json:"boardId"`
	CardID        string `json:"cardId"`
	CardVersion   int    `json:"cardVersion"`
	Status        string `json:"status"`
	Priority      int    `json:"priority"`
	EvidenceState string `json:"evidenceState"`
	UpdatedAt     int64  `json:"updatedAt"`
}
```

The actual shared contract is TypeScript:

```ts
export interface SupervisionProjection {
  revision: number
  generatedAt: number
  groups: SupervisionGroup[]
  counts: Record<SupervisionStatus, number>
}

export interface SupervisionGroup {
  status: SupervisionStatus
  items: SupervisionItem[]
}
```

```ts
export interface ReviewEvidenceManifest {
  evidenceId: string
  cardId: string
  attemptId: string
  generation: number
  worktreeBindingId: string
  digest: string
  files: ReviewEvidenceFileSummary[]
  availability: ReviewEvidenceAvailability
}
```

```ts
export interface ReviewDiffChunk {
  evidenceId: string
  fileId: string
  offset: number
  nextOffset: number | null
  content: string
  encoding: "utf8"
}
```

```ts
export interface SubmitCardPromptInput {
  commandId: string
  boardId: string
  cardId: string
  expectedCardVersion: number
  content: string
  source: "initial" | "composer" | "request_changes"
  evidence?: ReviewEvidencePrecondition
}
```

```ts
export interface ReviewDispositionInput {
  commandId: string
  boardId: string
  cardId: string
  expectedCardVersion: number
  disposition: "approved"
  evidence: ReviewEvidencePrecondition
}
```

`ReviewEvidencePrecondition` contains the evidence ID and digest plus the bound attempt ID, generation, and worktree binding ID. It is shared by approval and request-changes submission.

### Supervision Ordering

`projectSupervision` is a pure projection with no I/O. Each item receives a fixed numeric priority:

| Status | Priority | Actionable timestamp |
|---|---:|---|
| `needs_attention` | 0 | attention creation/update |
| `ready_for_review` | 1 | evidence creation |
| `failed` | 2 | attempt terminal timestamp |
| `running` | 3 | latest attempt activity |
| other settled | 4 | card update |

The comparator is:

1. ascending priority;
2. descending actionable timestamp;
3. ascending board ID;
4. ascending card ID.

This produces deterministic output across refreshes and makes ordering independently testable. The projection includes only the latest relevant attempt and latest valid review evidence summary for a card.

### Review-Evidence Canonicalization

The evidence digest is calculated over a versioned canonical envelope containing:

- policy version;
- board and card IDs;
- attempt ID and generation;
- worktree binding ID;
- base and head commit IDs;
- ordered file metadata;
- per-file patch or binary content digests.

File records sort by normalized new path, normalized old path, and stable file ID. Text patches normalize line endings to LF before hashing and storage. File modes, rename/copy status, deleted paths, and the final-newline marker are preserved. Binary content is never transported as text; its metadata and content digest remain reviewable.

The host rejects:

- paths escaping the bound worktree;
- symlink or submodule transitions not representable by the policy;
- an unavailable base commit;
- a worktree binding mismatch;
- more than 2,000 changed files;
- more than 8 MiB of patch content for one file;
- more than 64 MiB of total patch content.

Patch reads use a maximum decoded payload of 64 KiB per RPC response. Reaching a limit yields an explicit unavailable state and disables disposition. The UI never truncates evidence while leaving approval enabled.

### Data Models

#### Migration version 9: `review_evidence`

| Column | Type | Constraint / meaning |
|---|---|---|
| `evidence_id` | TEXT | Primary key |
| `board_id` | TEXT | Required board identity |
| `card_id` | TEXT | Required card identity |
| `attempt_id` | TEXT | Bound final-stage attempt |
| `generation` | INTEGER | Bound attempt generation |
| `worktree_binding_id` | TEXT | Host worktree identity, not a path |
| `base_commit` | TEXT | Canonical comparison base |
| `head_commit` | TEXT | Captured head or working-tree anchor |
| `policy_version` | INTEGER | Canonicalization policy |
| `evidence_digest` | TEXT | Unique immutable digest |
| `file_count` | INTEGER | Validated non-negative count |
| `patch_bytes` | INTEGER | Validated total stored bytes |
| `created_at` | INTEGER | Host timestamp |

A unique constraint covers `(card_id, attempt_id, generation, evidence_digest)`. Update and delete triggers reject mutation during normal operation. Retention cleanup, if later required, must be a separate explicit maintenance design.

#### Migration version 9: `review_evidence_files`

| Column | Type | Constraint / meaning |
|---|---|---|
| `evidence_id` | TEXT | Foreign key to manifest |
| `file_index` | INTEGER | Canonical ordering component |
| `file_id` | TEXT | Stable identifier within evidence |
| `status` | TEXT | added, modified, deleted, renamed, copied, binary |
| `old_path` | TEXT | Nullable normalized path |
| `new_path` | TEXT | Nullable normalized path |
| `old_mode` / `new_mode` | TEXT | Nullable Git modes |
| `is_binary` | INTEGER | Boolean constraint |
| `additions` / `deletions` | INTEGER | Nullable for binary/unknown |
| `patch_size` | INTEGER | Stored byte count |
| `patch_digest` | TEXT | Digest of canonical patch bytes |
| `content_digest` | TEXT | Binary or resulting content digest |
| `patch_blob` | BLOB | Nullable for binary records |

The primary key is `(evidence_id, file_index)`, with unique `(evidence_id, file_id)`. Update and delete triggers enforce immutability.

#### Journal projection additions

The in-memory snapshot gains:

- `reviewEvidenceByCard`, containing only manifest summaries and availability;
- `reviewDispositions` with `approved | changes_requested`, evidence identity, reviewed card version, and timestamps;
- follow-up submission schema version 2.

Patch blobs never enter the journal snapshot or RPC revision broadcast.

#### Follow-up submission schema version 2

Allowed states become:

- `queued`
- `dispatching`
- `dispatched`
- `removed`
- `interrupted`

Migration rules:

- legacy `queued` and `awaiting_confirmation` become `queued` because both originated from an explicit Enter submission;
- legacy `dispatched` and `removed` retain their meanings;
- legacy `confirmed` or any ambiguous in-flight delivery becomes `interrupted`;
- no migrated `interrupted` entry is automatically sent.

FIFO ordering uses the durable sequence already owned by the host. `commandId` provides idempotency for duplicate renderer delivery.

### API Endpoints

All endpoints are Electrobun typed RPC calls defined in `shared/rpc.ts`.

| Endpoint | Type | Purpose | Result limits |
|---|---|---|---|
| `getSupervision` | query | Derive ordered cross-project work | No patch content |
| `getBoard` | query | Existing board projection, extended with workbench summaries | Existing bounded projection |
| `getCardInspector` | query | Existing card/attempt conversation projection | Evidence summary only |
| `getReviewManifest` | query | Read immutable evidence metadata and file summaries | Maximum 2,000 summaries |
| `getReviewDiffChunk` | query | Read one bounded text-patch chunk | Maximum 64 KiB |
| `submitCardPrompt` | command | Admit or queue an explicitly submitted prompt | Content size uses current prompt limit |
| `reviewCard` | command | Approve only after evidence revalidation | No patch input |

`queueFollowUp` and `confirmQueuedFollowUp` are removed after migration. Existing prompt-start call sites move to `submitCardPrompt`; stop-attempt and answer-attention commands remain separate because they express different lifecycle transitions.

Stable command errors include:

- `stale_projection`
- `evidence_missing`
- `evidence_stale`
- `evidence_oversized`
- `evidence_unsafe`
- `worktree_binding_mismatch`
- `attempt_active`
- `blocker_active`
- `submission_interrupted`
- `invalid_prompt`

Errors include only identifiers, versions, enums, and recovery hints. They do not echo prompt or patch content.

### Renderer Interaction Contracts

#### Work Inbox

The sidebar renders group counts and compact actionable items. Selecting an item:

1. records the current board route, mode, and scroll anchor;
2. selects the item's board and card;
3. opens the workbench;
4. preserves the originating board context for return.

Inbox refresh must not forcibly close a workbench. If the selected entity disappears, the renderer returns to the nearest valid board context and announces the change through accessible status text.

#### Workbench

The workbench uses one selected card and one selected attempt. It presents:

- card identity and lifecycle status;
- conversation-first timeline;
- attention and failure notices inline;
- review evidence when available;
- disposition actions only when evidence is valid;
- persistent composer.

Desktop layout may place the board and workbench side by side. Narrow layout uses a full-width workbench route with a clear Back action that restores context.

#### Conversation-first timeline

Timeline order remains chronological, but visual emphasis changes:

- user and agent messages are primary;
- tool calls, lifecycle events, and metadata are compact secondary rows;
- changed-file summaries link into the review panel;
- the selected attempt remains stable across revision refreshes when it still exists.

No content is duplicated into telemetry or renderer-local workflow state.

#### Direct submission

- Enter submits non-empty content.
- Shift+Enter inserts a newline.
- Composition events never submit.
- Repeated keydown or duplicate RPC delivery is deduplicated by `commandId`.
- A successful active-attempt response displays a queued state immediately.
- An `interrupted` response retains the draft or offers an explicit retry; it does not auto-send.

#### Request changes

Selecting **Request changes**:

1. opens an editable draft seeded with a concise template;
2. focuses the draft;
3. sends nothing.

Explicit submission includes the current evidence precondition. The host revalidates it before recording `changes_requested` and admitting the new attempt. If revalidation fails, the draft remains intact and the UI reloads the manifest.

### Integration Points

#### Event journal and SQLite

Evidence inserts, evidence references, dispositions, and lifecycle transitions must use the same SQLite transactional boundary as the event journal. If the current journal abstraction cannot enlist additional tables, extend it narrowly with a transaction callback rather than creating a second database connection or out-of-band commit.

#### Git and worktree bindings

Only the host invokes Git. Evidence capture resolves a worktree by its existing binding ID and verifies the resulting path remains inside the registered project root. RPC responses expose the binding ID, never the absolute path.

No network access is required. Unsupported Git states fail closed with a typed recovery reason.

#### ACP attempt runtime

The attempt coordinator owns safe-turn-boundary dispatch. The renderer cannot infer a safe boundary from streamed events. Runtime send acknowledgment advances `dispatching` to `dispatched`; an ambiguous process failure advances it to `interrupted`.

Request-changes attempts reuse the same card and stage while receiving a new attempt ID and generation. Existing worktree isolation and lifecycle guards continue to apply.

#### Electrobun renderer bridge

New RPC messages pass through the existing desktop bridge and plain-JSON validation. Privileged-key checks receive contract tests for all new payloads.

#### TanStack Query and Zustand

TanStack Query owns remote projections and invalidation. Zustand owns view navigation and local drafts only. Neither layer recreates the host lifecycle state machine.

## Impact Analysis

### Files to Modify

| Area | File | Intended change |
|---|---|---|
| Persistence | `packages/desktop/src/persistence/migrations.ts` | Add migration version 9 and immutable evidence schema |
| Persistence | `packages/desktop/src/persistence/eventJournal.ts` | Project evidence summaries, disposition variants, and queue v2 |
| Host projection | `packages/desktop/src/host/boardRpc.ts` | Add pure supervision projection and evidence availability |
| Host review | `packages/desktop/src/host/reviewDisposition.ts` | Enforce evidence preconditions and approval transition |
| Attempts | `packages/desktop/src/attempts/followUpQueue.ts` | Replace confirmation states with direct FIFO delivery states |
| Attempts | `packages/desktop/src/attempts/attemptCoordinator.ts` | Implement unified submission, safe-boundary dispatch, and request changes |
| RPC | `packages/desktop/src/shared/rpc.ts` | Add projection, manifest, chunk, submission, and error contracts |
| RPC | `packages/desktop/src/host/desktopRpc.ts` | Bind queries and commands to host services |
| Renderer bridge | `packages/desktop/src/renderer/client.ts` | Add typed calls and revision invalidation |
| Query layer | `packages/desktop/src/renderer/query/desktopQueries.ts` | Add supervision and review-evidence query options |
| View state | `packages/desktop/src/renderer/state/desktopViewStore.ts` | Add workbench selection, return context, and draft persistence |
| Navigation | `packages/desktop/src/renderer/components/ProjectSidebar.tsx` | Render the grouped Work Inbox |
| Board | `packages/desktop/src/renderer/features/board/WorkflowBoardContainer.tsx` | Preserve board state while opening the workbench |
| Workbench | `packages/desktop/src/renderer/features/inspector/CardInspector.tsx` | Reshape drawer into responsive workbench |
| Timeline | `packages/desktop/src/renderer/features/inspector/AttemptTimeline.tsx` | Make conversation primary and metadata secondary |
| Composer | `packages/desktop/src/renderer/features/inspector/PersistentComposer.tsx` | Use direct submission and queued/interrupted states |
| Commands | `packages/desktop/src/renderer/features/inspector/useInspectorCommands.ts` | Replace queue/confirm actions and add evidence preconditions |
| Shell | `packages/desktop/src/renderer/main.tsx` | Connect inbox, board, workbench, and responsive routing |
| Settings | existing desktop settings component | Keep settings reachable from all shell modes |
| Styling | `packages/desktop/src/renderer/styles.css` | Add T3-inspired tokens, hierarchy, responsive rules, and focus states |

Exact component paths should follow the current feature-folder names when implementation begins; no directory-wide relocation is required for this revamp.

### Files to Add

| File | Responsibility |
|---|---|
| `packages/desktop/src/host/reviewEvidence.ts` | Capture, canonicalize, persist, revalidate, and page immutable evidence |
| `packages/desktop/src/renderer/features/inspector/ReviewPanel.tsx` | Manifest-first review states and disposition controls |
| `packages/desktop/src/renderer/features/inspector/DiffViewer.tsx` | Bounded per-file text diff, binary state, and chunk navigation |

Tests should be colocated with their existing domain, RPC, persistence, renderer, and acceptance suites instead of creating a parallel test architecture.

### Compatibility and Migration

- Existing migration versions remain unchanged; version 9 is append-only.
- Existing cards without evidence remain readable but cannot be approved until the host captures valid evidence.
- Existing awaiting-confirmation messages were already explicitly submitted and migrate to `queued`.
- Ambiguous confirmed/in-flight messages migrate to `interrupted` and require explicit retry.
- Existing renderer draft keys remain readable where possible; new keys include project, board, card, and draft source to prevent cross-card leakage.
- The host accepts only the new command surface after the renderer and stored-state migration ship together as one desktop release.

### Performance Impact

- Supervision projection target: p95 under 50 ms for a local snapshot containing 10,000 cards.
- Manifest query target: p95 under 100 ms for the maximum 2,000 file summaries on supported hardware.
- Diff responses are bounded to 64 KiB decoded content.
- Opening the workbench from an already loaded projection should update visible shell state within 100 ms.
- Patch blobs are excluded from snapshots, revision broadcasts, and supervision payloads to control memory pressure.

## Testing Approach

### Unit Tests

Add or extend unit tests for:

- supervision group priority, deterministic tie-breaking, and empty projects;
- latest-attempt and evidence-summary selection;
- evidence canonical ordering, LF normalization, mode changes, renames, deletions, final-newline markers, and binary records;
- evidence digest changes for every bound identity and content mutation;
- all file-count and byte limits;
- chunk offsets, UTF-8 boundaries, terminal chunks, and invalid file IDs;
- queue version-2 migration and every allowed state transition;
- FIFO dispatch and `commandId` idempotency;
- ambiguous recovery to `interrupted`;
- direct Enter, Shift+Enter, composition events, and repeated keydown;
- renderer return-context restoration and missing-entity fallback;
- draft namespace isolation and preservation on stale-evidence failure;
- content-free telemetry payload validation.

### Integration Tests

Add integration coverage for:

- migration version 8 to 9 with legacy queue rows;
- transactional evidence insert plus ready-for-review journal transition;
- rollback when card version changes during evidence capture;
- Git fixtures covering text, binary, rename, delete, mode change, unsafe path, unavailable base, and oversized evidence;
- manifest and chunk RPC plain-JSON serialization;
- privileged-key rejection for every new RPC;
- stale card, attempt, generation, worktree, and digest races;
- approval completing only the evidence-bound card version;
- request changes creating a new attempt on the same card and current stage;
- request-changes selection causing no host mutation before submission;
- active-turn submission surviving renderer restart and dispatching at a safe boundary;
- ambiguous runtime failure never causing duplicate automatic delivery;
- query invalidation refreshing supervision, board, inspector, and evidence views;
- narrow-layout Back restoring the originating board context.

### Acceptance and Native Visual Verification

The packaged Electrobun app must be exercised against a deterministic lifecycle matrix:

| State | Required assertion |
|---|---|
| Empty workspace | Clear empty inbox and board guidance |
| Multiple projects | Correct group order and stable project identity |
| Needs attention | Item leads to the blocking interaction |
| Running attempt | Enter queues immediately; no confirmation UI appears |
| Failed attempt | Failure is prominent and recovery remains reachable |
| Ready for review | Manifest loads before disposition is enabled |
| Stale evidence | Disposition is disabled and refresh guidance appears |
| Request changes | Selection opens a draft; explicit send creates a new attempt |
| Board return | Closing workbench restores board mode and position |
| Narrow window | Navigation, workbench, composer, and settings remain reachable |

Required evidence includes native packaged screenshots or recordings for the matrix, the seed/fixture identity, window size, build identity, and capture timestamp. Automated DOM or browser screenshots may supplement this evidence but do not replace it.

If native capture infrastructure is unavailable, the task remains incomplete unless an explicit product-owner waiver records the missing states and reason.

### Regression Gates

Run the desktop package's existing gates after focused tests:

1. `rtk bun --cwd packages/desktop run typecheck`
2. focused persistence, RPC, attempt, and renderer tests
3. `rtk bun --cwd packages/desktop run test:acceptance`
4. `rtk bun --cwd packages/desktop run test:coverage`
5. `rtk bun --cwd packages/desktop run verify`
6. `rtk bun --cwd packages/desktop run build`
7. packaged native lifecycle capture

Record inherited failures separately. A green automated gate does not substitute for the native visual gate, and a visual capture does not waive type, test, or coverage failures.

## Development Sequencing

### Build Order

1. Define the shared supervision, evidence, submission, disposition, and error contracts; add pure fixtures and freeze the migration-v9 schema constants.
2. Implement migration version 9, immutable evidence repositories, snapshot summaries, and queue-v2 migration; this depends on step 1.
3. Implement canonical evidence capture, limits, digest calculation, chunk reads, and worktree revalidation; this depends on steps 1 and 2.
4. Implement the pure supervision projection and deterministic ordering with evidence availability; this depends on steps 1 through 3.
5. Bind supervision, manifest, and chunk queries through the host RPC layer and renderer query client; this depends on steps 3 and 4.
6. Replace follow-up confirmation with unified prompt admission, FIFO safe-boundary dispatch, idempotency, and interrupted recovery; this depends on steps 1, 2, and 5.
7. Extend review disposition and implement evidence-bound request-changes admission on the same card and stage; this depends on steps 3, 5, and 6.
8. Extend the renderer view store and shell navigation for inbox selection, workbench state, return context, and isolated local drafts; this depends on steps 4 through 7.
9. Build the Work Inbox, conversation-first workbench, review panel, diff viewer, and direct composer states; this depends on step 8.
10. Apply the T3-inspired visual hierarchy, responsive behavior, keyboard/focus semantics, and settings reachability; this depends on steps 8 and 9.
11. Complete unit, integration, migration, RPC, recovery, accessibility, performance, and content-free telemetry coverage; this depends on steps 2 through 10.
12. Build the packaged Electrobun app and execute the native lifecycle-state verification matrix; this depends on steps 9 through 11.

### Technical Dependencies

- Existing Electrobun desktop runtime and bridge
- Existing Bun, React, HeroUI, Tailwind, Zustand, and TanStack Query stack
- Existing SQLite event journal
- Existing host Git execution and worktree-binding facilities
- Existing ACP attempt lifecycle and safe-boundary events
- Existing desktop acceptance, coverage, build, and native capture tooling

No new third-party runtime library is required. If canonical Git parsing proves insufficient with existing host utilities, prefer a narrowly scoped parser inside `reviewEvidence.ts` before adding a dependency.

## Monitoring and Observability

### Local Diagnostics

Host diagnostics should record fixed-schema events for:

- supervision projection duration and item count bucket;
- evidence capture outcome, file-count bucket, byte-count bucket, and reason enum;
- evidence revalidation outcome and stale-reason enum;
- manifest and chunk read outcome;
- prompt admission outcome: admitted, queued, duplicate, blocked, interrupted;
- safe-boundary dispatch outcome;
- review disposition outcome;
- packaged verification fixture and state result.

Diagnostics must not contain prompt text, agent output, file paths, patch content, filenames, project names, or secrets. Identifiers should use existing local opaque IDs only where required for correlation.

### Health Signals

Track:

- projection p50/p95 duration;
- evidence capture and stale-rejection counts;
- interrupted submission count;
- manifest/chunk error counts;
- disposition rejection counts by stable reason;
- native lifecycle matrix pass/fail status for the current build.

There is no remote alerting requirement for this local-first change. These signals support local debugging, acceptance reports, and workflow evidence.

### User-Visible Recovery

Every fail-closed state must explain what can be done next:

- stale projection: refresh current card;
- stale evidence: reload and review the new manifest;
- missing evidence: retry capture after the final attempt settles;
- oversized/unsafe evidence: show the precise category and keep disposition disabled;
- interrupted submission: retain or restore the draft and require explicit retry;
- missing selected entity: return to the nearest valid board context.

## Technical Considerations

### Key Decisions

1. Derive the Work Inbox on read from host truth instead of materializing another mutable table.
2. Keep navigation and selection renderer-local while retaining lifecycle authority in the host.
3. Capture immutable evidence at the review boundary and revalidate it before every disposition.
4. Page patch content by file and bounded chunk instead of transporting a full diff through RPC.
5. Treat Enter as final submission authorization and remove the second confirmation step.
6. Fail ambiguous delivery closed as `interrupted` to prevent duplicate messages.
7. Require native packaged Electrobun evidence in addition to automated tests.

### Security and Privacy

- Host-only resources never cross RPC.
- Worktree resolution uses registered bindings, not renderer-supplied paths.
- Path normalization rejects traversal and out-of-root results.
- Evidence limits prevent unbounded memory and transport use.
- Command IDs and optimistic preconditions constrain replay and stale mutations.
- Telemetry and diagnostics are content-free.
- Review disposition fails closed when evidence cannot be reproduced.

### Accessibility

- All groups, cards, tabs, files, and disposition controls are keyboard reachable.
- Enter submission does not fire during IME composition.
- Focus moves predictably when opening or closing the workbench and request-changes draft.
- Status, queued, interrupted, stale, binary, and unavailable states have text equivalents.
- Color is not the only indicator of lifecycle or diff state.
- Narrow layout preserves logical reading order and accessible labels.

### Known Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| Large repositories make evidence capture slow | Delayed review readiness | Capture asynchronously at the host boundary, show progress, enforce hard limits |
| Worktree changes after capture | User reviews stale data | Recompute and compare the digest before every disposition |
| SQLite growth from immutable patches | Local storage pressure | Store only canonical review-bound evidence, expose byte counts, defer retention to an explicit policy |
| Crash during message delivery | Duplicate or lost follow-up | Durable FIFO states, idempotent command IDs, ambiguous recovery to `interrupted` |
| Renderer adopts lifecycle state | Projection drift and invalid commands | Keep Zustand limited to view state and use revisioned queries |
| Responsive redesign hides actions | Supervision loop becomes inaccessible | Native narrow-window matrix and keyboard acceptance checks |
| Native capture tooling is unavailable | Visual regressions go unverified | Keep task incomplete or require an explicit recorded waiver |
| Legacy cards lack evidence | Approval is temporarily unavailable | Explicit missing-evidence state and host retry/capture path |

## Architecture Decision Records

- [ADR-001: Adopt a T3 Code-Inspired Supervision Loop While Preserving Kitten's Workflow Model](./adrs/adr-001.md)
- [ADR-002: Make Blocked Work and Evidence-Bound Review First-Class](./adrs/adr-002.md)
- [ADR-003: Derive Supervision on Read and Keep Navigation Renderer-Local](./adrs/adr-003.md)
- [ADR-004: Persist Immutable Review Evidence and Page Diffs by File](./adrs/adr-004.md)
- [ADR-005: Treat Enter as Prompt Authorization and Dispatch FIFO at Safe Boundaries](./adrs/adr-005.md)
- [ADR-006: Require Native Packaged Lifecycle Verification](./adrs/adr-006.md)
