# TechSpec: Managed Child Worktrees

## Executive Summary

Implement managed child worktrees as one app/controller-owned Git lifecycle service. `startDelegatedChild()` must provision and verify a child-specific worktree before it creates a child session, registers an ACP runtime, or sends a prompt. The resulting immutable binding becomes the child session's `cwd`, drives existing file and branch surfaces, and is persisted as review metadata without restoring live delegation ownership.

The primary trade-off is deliberate: V1 adds a strict Git lifecycle and repository-local `.kitten/worktrees` container instead of reusing the parent checkout or supporting arbitrary existing worktrees. This adds provisioning, reconciliation, and cleanup states, but prevents wrong-checkout execution and gives retained child work a safe review path. Git I/O stays in `src/app`; `src/core` remains protocol-free and the store holds only immutable controller-produced state.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/app/managedWorktree.ts` | Inspect a parent repository, reserve/create/verify a managed worktree, reconcile persisted bindings, and perform safe cleanup. | New app-owned I/O service; the only Git-worktree lifecycle owner. |
| `src/app/controller.ts` | Call provisioning before child registration, use the verified worktree `cwd`, reconcile restored bindings, and expose cleanup through actions. | Owns runtimes, session lifecycle, and all service side effects. |
| `src/core/types.ts` | Define immutable, protocol-free binding and availability values on session seeds/state. | No Git I/O, ACP types, or mutable runtime references. |
| `src/store/appStore.ts` and `src/store/selectors.ts` | Store binding state and project one render-ready workspace presentation. | Receives controller-produced facts only; never shells out. |
| `src/persistence/runRecord.ts` and `src/persistence/runWriter.ts` | Add a strict V4 optional binding schema and serialize content-free local review metadata. | Must preserve V1–V3 readability and never serialize delegation ownership. |
| `src/ui/DelegationDialog.tsx`, `TabWorkspace.tsx`, `SessionsOverlay.tsx`, `StatusStrip.tsx` | Disclose the committed base, managed identity, terminal review state, and bounded cleanup outcome. | Consume selectors/actions only; no direct Git access. |

### Launch and restore data flow

1. `startDelegatedChild()` validates the parent runtime as it does today.
2. `ManagedWorktreeService.provision()` resolves the parent repository, attached branch, committed `HEAD`, and repository-local managed root; it reserves, creates, and verifies one binding.
3. Only after provisioning succeeds, the controller creates a child `SessionSeed` whose `cwd` is the verified worktree path and atomically calls `addDelegatedSession()`.
4. `startSession()` receives that verified `cwd`, opens ACP, and dispatches the child task through the existing lifecycle. An ACP or prompt failure retains the terminal child and its review binding; a pre-registration provisioning failure creates no child/runtime and rolls back only its newly-created Git artifacts.
5. The run writer persists optional binding metadata with the conversation. On restore, ordinary conversations are rebuilt first and delegation remains empty. The controller reconciles each binding against Git and publishes `available` or a bounded unavailable/cleanup-refusal state.

### PRD traceability

| PRD goal or user story | Technical component(s) |
| --- | --- |
| Protected child launch | `ManagedWorktreeService.provision`, controller pre-registration transaction, `SessionSeed.cwd`. |
| Clear workspace provenance | `ManagedWorktreeBinding`, selector presentation, delegation dialog, tabs, sessions overview, compact status cue. |
| In-Kitten retained-work review | V4 run record, restore reconciliation, terminal child presentation. |
| Explicit safe resolution | `cleanupManagedWorktree`, terminal-review action, bounded cleanup result, service safety checks. |
| Continuity after restart | strict V4 migration, controller reconciliation, unavailable state with no parent-cwd fallback. |

## Implementation Design

### Core Interfaces

Kitten is a TypeScript application, so its primary contracts use TypeScript interfaces rather than introducing a foreign-language abstraction.

```ts
export type ManagedWorktreeAvailability = "unverified" | "available" | "unavailable" | "cleanup_refused"

export interface ManagedWorktreeBinding {
  readonly kind: "managed"
  readonly id: string
  readonly repoRoot: string
  readonly worktreePath: string
  readonly branch: string
  readonly baseBranch: string
  readonly baseSha: string
  readonly ownerSessionId: SessionId
  readonly availability: ManagedWorktreeAvailability
  readonly reason?: ManagedWorktreeReason
}
```

```ts
export interface ManagedWorktreeService {
  provision(input: ProvisionManagedWorktreeInput): Promise<ProvisionResult>
  reconcile(binding: ManagedWorktreeBinding): Promise<ReconcileResult>
  cleanup(input: CleanupManagedWorktreeInput): Promise<CleanupResult>
}

export interface CleanupResult {
  readonly kind: "removed" | "refused" | "failed"
  readonly reason?: ManagedWorktreeReason
}
```

`ManagedWorktreeReason` is a bounded union: `not_git_repository`, `detached_head`, `submodules_unsupported`, `root_conflict`, `collision`, `verification_failed`, `missing`, `external`, `dirty`, `unmerged`, `live_owned`, `not_managed`, or `git_failed`. It must never contain a path, branch, SHA, task, command output, or unbounded error text.

The controller action surface gains:

```ts
export interface ControllerActions {
  startDelegatedChild(input: StartDelegatedChildInput): Promise<SessionId | null>
  cleanupManagedWorktree(childId: SessionId): Promise<CleanupResult>
}
```

`cleanupManagedWorktree` is callable only from terminal child-review presentation. `closeConversation` remains a session operation and never removes a managed worktree.

### Data Models

Add `worktreeBinding?: ManagedWorktreeBinding` to `SessionSeed` and the normalized session state that selectors consume. It is immutable and protocol-free. The controller may replace the binding only with a reconciliation or cleanup result; core reducers do not discover Git state.

Add `PersistedManagedWorktreeBinding` to a new strict V4 persisted-conversation schema. It persists `id`, `repoRoot`, `worktreePath`, `branch`, `baseBranch`, `baseSha`, and the owning session id. It omits transient availability/reason and all delegation, runtime, task, prompt, transcript, command, and telemetry content. V1–V3 records parse unchanged and restore with no binding.

On restore, persisted bindings enter state as `unverified`. The controller must reconcile each one through `ManagedWorktreeService` before exposing it as `available` or allowing cleanup. Reconciliation preserves ordinary restored conversations but leaves `DelegationState` empty, as required by the existing restore contract.

### API Endpoints

Kitten exposes no HTTP endpoints for this feature. Its internal API surface is the narrow `ControllerActions` contract above: delegated child launch, terminal-child cleanup, and controller-private restore reconciliation. UI views call actions; ACP adapters receive only the verified child `cwd` and never managed-worktree lifecycle types.

### Git lifecycle

`ManagedWorktreeService` owns an injected `GitWorktreeSpawn` and small path/filesystem seam. It follows the existing injected Git-command style in `src/config/gitBranch.ts` and `src/app/fileDiscovery.ts`, but does not reuse their display-oriented success/failure handling for lifecycle verification.

| Operation | Required behavior |
| --- | --- |
| Parent inspection | Resolve canonical repo root, require an attached parent branch, resolve committed `HEAD`, and reject repositories with submodules. |
| Root preparation | Use `<repo-root>/.kitten/worktrees`; create it only if it is unambiguous and private local workspace state. Ensure a local Git exclusion prevents it from appearing as tracked project work without editing tracked files. |
| Reservation | Generate a bounded opaque binding id; reserve it in-process and reject or retry only verified branch/path collisions. Never derive identifiers from task text. |
| Provision | Create the branch/worktree from the parent committed SHA under the managed root, then verify path, branch, root, and base against Git's worktree listing. |
| Pre-launch rollback | Remove only clean artifacts positively created by the current failed attempt. If identity is uncertain, stop and surface failure rather than deleting. |
| Reconciliation | Confirm the persisted path remains under the managed root and maps to the persisted repo/branch/base; otherwise return bounded unavailable state. |
| Cleanup | Require managed provenance, terminal non-live owner, clean worktree, merged child branch, and verified Git identity; use normal non-force worktree removal followed by safe branch deletion. |

No HTTP API is introduced. The integration surface is `ControllerActions`, existing controller startup/restore flows, and the local Git CLI. ACP receives only the verified child `cwd`; adapters do not receive binding lifecycle types.

## Integration Points

| Boundary | Integration | Error behavior |
| --- | --- | --- |
| Git CLI | Local Git commands create, inspect, reconcile, and remove worktrees. | Map failures to bounded reasons; never pass raw command output into UI or telemetry. |
| ACP startup | Controller passes verified binding path as `newSession` cwd. | Provisioning failure returns before ACP runtime/session creation. |
| Existing branch/file discovery | Existing per-session cwd-based branch refresh and file discovery use the child path automatically. | Display reads remain fail-soft and are not treated as verification. |
| Run persistence | V4 optional binding data restores review identity without delegation. | Older records restore normally; unverifiable bindings become unavailable. |
| Local telemetry | Emit allowlisted lifecycle and refusal categories only when opt-in telemetry is enabled. | Never emit path, branch, SHA, task, prompt, or command output. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/app/managedWorktree.ts` | new | High-risk Git lifecycle boundary. | Add injected command/path seams and exhaustive result codes. |
| `src/app/controller.ts` | modified | High-risk launch ordering, restore, runtime ownership, cleanup action. | Provision before registration; reconcile after restore; retain terminal binding on ACP failure. |
| `src/app/actions.ts` | modified | New controller cleanup action. | Expose only the narrow action; preserve existing failure/no-op behavior. |
| `src/core/types.ts` | modified | Adds immutable protocol-free binding values. | Keep no Git/ACP/runtime imports. |
| `src/store/appStore.ts` and `selectors.ts` | modified | Binding state and selector-derived presentation. | Add controller-only transitions and one shared view model. |
| `src/persistence/runRecord.ts` and `runWriter.ts` | modified | Strict V4 binding persistence/migration. | Preserve V1–V3 parsing; omit ephemeral delegation and telemetry content. |
| `src/ui/DelegationDialog.tsx` | modified | Base disclosure and provisioning failure. | Explain committed-base semantics before work begins. |
| `src/ui/TabWorkspace.tsx`, `SessionsOverlay.tsx`, `StatusStrip.tsx` | modified | Managed, available, unavailable, and review cues. | Use shared selectors; avoid path/branch bloat in compact status. |
| Existing tests plus new service tests | modified/new | Lifecycle race and data-loss regression risk. | Cover injection and real-Git behavior in two layers. |

## Testing Approach

### Unit Tests

- `src/app/managedWorktree.test.ts`: attached-branch and base resolution, detached/submodule rejection, repository-local root conflicts, id collisions, command ordering, verification mismatch, partial-create rollback, reconciliation results, dirty/unmerged/external/live-owned cleanup refusal, normal non-force removal, and telemetry-safe reason mapping.
- `src/app/controller.test.ts`: provisioning precedes `addDelegatedSession`, runtime registration, `newSession`, prompt dispatch, and launch-success telemetry; successful siblings receive distinct `newSession` cwd values; provisioning failure leaves no child/runtime; ACP startup failure retains the verified terminal review binding; cleanup cannot run for a live or non-terminal child.
- `src/core/types.test.ts`, `src/store/appStore.test.ts`, and `src/store/selectors.test.ts`: immutable binding shape, structural sharing, no delegation reconstruction, selector labels, and unavailable/cleanup-refusal projection.
- `src/persistence/runRecord.test.ts` and `src/persistence/runWriter.test.ts`: V4 strict validation, V1–V3 compatibility, binding round-trip, rejection of unexpected fields, and exclusion of task/transcript/runtime/delegation content.
- UI tests for `DelegationDialog`, `TabWorkspace`, `SessionsOverlay`, and `StatusStrip`: committed-base disclosure, managed/available/unavailable text, terminal-only cleanup affordance, refusal copy, narrow status cue, and non-color-only accessibility.

### Integration Tests

- Use temporary real Git repositories to prove two concurrent child provisions receive distinct worktrees and branches while the parent checkout remains untouched.
- Prove Git refuses or the service reports detached, submodule, dirty, unmerged, external, and path-collision cases without deleting pre-existing artifacts.
- Extend `test/sessionRestore.integration.test.ts` for V4 bindings: available reconciliation, missing/unavailable reconciliation, no parent-cwd fallback, and no restored delegation ownership.
- Exercise normal clean-and-merged cleanup plus post-cleanup persistence/restart behavior with actual Git worktree commands.

## Development Sequencing

### Build Order

1. Define binding types, bounded reason codes, and service test fakes in `src/core/types.ts` and the new app-service test file — no dependencies.
2. Implement `ManagedWorktreeService` inspection, root preparation, provision, verification, and rollback with injected seams — depends on step 1.
3. Integrate pre-registration provisioning into `startDelegatedChild` and add the terminal-only cleanup controller action — depends on steps 1–2.
4. Add binding state transitions and selector presentation, then update child launch/review UI surfaces — depends on steps 1 and 3.
5. Add V4 persistence, migration, restore descriptors, and controller reconciliation — depends on steps 1–3.
6. Add unit, UI, persistence, and temporary-repository integration coverage for the complete lifecycle — depends on steps 2–5.
7. Add opt-in, content-free lifecycle metrics and run the full repository verification gate — depends on steps 3–6.

### Technical Dependencies

- The closed multi-agent orchestration registry and its controller child-launch path are required integration points.
- Local Git must be available to the Kitten process; there is no network or cloud dependency.
- The existing run-record migration style must support V4 while preserving V1–V3 restore behavior.
- Repository-local managed roots require local ignore handling that does not alter tracked project files.

## Monitoring and Observability

When opt-in local telemetry is enabled, emit only allowlisted counters/events: `managed_worktree_requested`, `managed_worktree_provisioned`, `managed_worktree_provision_failed`, `managed_worktree_reconciled`, `managed_worktree_cleanup_refused`, and `managed_worktree_cleaned`.

Each event may include a bounded lifecycle or refusal category, provider kind, and success/failure count. It must exclude repository paths, branches, base SHAs, child ids, prompts, tasks, transcript text, command arguments, command output, and raw errors. Disabled telemetry remains a true no-op.

## Technical Considerations

### Key Decisions

- **Pre-registration provisioning:** A child cannot exist outside a verified worktree. This prevents wrong-cwd startup but requires a distinct prelaunch rollback path.
- **Repository-local managed root:** `.kitten/worktrees` keeps retained artifacts discoverable with their repository. Local exclusion handling avoids tracked-file pollution; unknown roots fail closed.
- **Versioned session binding:** V4 preserves review identity across restarts without rebuilding live delegation. This adds reconciliation states but prevents fabricated ownership.
- **Terminal-only cleanup:** Cleanup is context-bound, explicit, non-force, and separate from session closure. This limits convenience but protects review artifacts.
- **Layered Git tests:** Injected unit tests make lifecycle transitions deterministic; temporary real repositories prove Git semantics.

### Known Risks

| Risk | Mitigation |
| --- | --- |
| Git commands disagree with assumed branch/worktree state | Verify every created or restored binding against authoritative Git worktree state before use. |
| Parent worktree has uncommitted changes | Resolve only attached branch + committed `HEAD`; disclose the base and never copy dirty/ignored files. |
| Repository-local root conflicts with existing user data | Refuse unknown, non-empty, tracked, or externally managed roots; never delete them. |
| Restored binding points to missing or moved workspace | Mark unavailable with a bounded reason and prohibit parent-cwd fallback or cleanup. |
| Terminal child is closed before review | Keep cleanup distinct from session closure and retain persisted binding metadata for later reconciliation. |
| Telemetry leaks workspace details | Allowlist category-only events and test disabled-recorder no-op behavior. |

## Architecture Decision Records

- [ADR-001: Create managed worktrees only for spawned child sessions](adrs/adr-001.md) — Defines the managed-only V1 product boundary and explicit review lifecycle.
- [ADR-002: Make in-Kitten review the primary child-workspace completion loop](adrs/adr-002.md) — Prioritizes retained review over automatic editor handoff or merge.
- [ADR-003: Persist managed bindings in versioned session records and reconcile on restore](adrs/adr-003.md) — Keeps review identity across restarts without restoring live delegation.
- [ADR-004: Allocate verified worktrees in a repository-local managed container before child registration](adrs/adr-004.md) — Makes verified isolation a precondition of child startup.
- [ADR-005: Restrict cleanup to terminal child review and verify Git lifecycle in two layers](adrs/adr-005.md) — Makes cleanup explicit and validates it with injected and real-Git tests.
