## Executive Summary

Implement Context Packs as a session-keyed AppStore slice backed by a new pure domain module. The controller owns all workspace I/O, Context Build launch, bridge registration, materialization, persistence coordination, recipient-fit evidence, and final consumption. A separately attested `explore-v2` child receives a dedicated generation-bound bridge that can read bounded workspace artifacts and mutate only its parent draft through revision-fenced operations. It never receives agent control, shell, general Git, external MCP, sealing, delivery, export, or approval authority.

The primary trade-off is availability for trustworthy custody. The design persists only metadata-only draft manifests and exact redacted sealed payloads, while recipient actions require fresh capacity evidence. This blocks some otherwise desirable destinations until a provider can prove the required `explore-v2` and Recipient Profile evidence, but it preserves the PRD's trusted-handoff and no-surprises goals rather than treating them as best-effort UX.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
|---|---|---|
| `src/core/contextPack.ts` | Defines protocol-free draft/sealed values, selection identities, revisions, deterministic candidate assembly, stale results, and Recipient Fit decisions. | Pure TypeScript; no ACP, filesystem, React, or mutable app state. |
| `src/core/types.ts` | Adds Context Pack, attachment, and recipient-fit types to Kitten's protocol-free vocabulary. | Domain contracts only; ACP types do not escape the adapter/controller boundary. |
| `src/store/appStore.ts` and `selectors.ts` | Own the session-keyed Context Pack slice, atomic transitions, review state, build binding, and narrow UI projections. | AppStore remains the single mutable owner. |
| `src/persistence/runRecord.ts` and `runStore.ts` | Version, validate, atomically store, and restore Draft Manifests and exact redacted Sealed payloads. | Strict allowlisted persistence; never stores live builder authority or raw draft source. |
| `src/app/contextPackMaterializer.ts` | Reads bounded workspace files and diffs, verifies containment/identity/digest, then gives materialized artifacts to pure assembly. | Controller/application I/O; no direct UI or child filesystem access. |
| `src/app/contextPackBridge.ts` | Registers the Context Pack-specific MCP server and enforces parent, child, generation, revision, path, and size authorization on every call. | Same-binary host bridge; does not share the mixed `agent_run` surface. |
| `src/config/contextPackCapability.ts` | Resolves closed, versioned `explore-v2` eligibility and Recipient Profile evidence. | Fail-closed configuration/evidence boundary. |
| `src/app/controller.ts` | Starts/stops Context Builds, owns materialization and persistence effects, recomputes fit, and routes all consumption to the existing explicit-confirmation paths. | Orchestration and ACP/runtime I/O only. |
| `src/app/handoff.ts` and `src/core/bundleAssembler.ts` | Attach at most one immutable sealed pack, deduplicate source-identical blocks, and retain one combined preview/confirm path. | Existing no-auto-send/redaction contract remains authoritative. |
| `src/ui/*` | Adds `/context`, File Explorer membership actions, review, blocked states, and attention indicators through selectors and `ControllerActions`. | Presentation only; no connection, bridge, or workspace access. |
| `src/telemetry/recorder.ts` | Records opt-in fixed outcomes/counts for Context Pack lifecycle and fit decisions. | Content-free allowlist; no text, paths, identities, recipes, destinations, or raw errors. |

### Data Flow

1. `/context` or File Explorer reads `selectContextPack(sessionId)` and asks the controller for current Context Build availability. The result is advisory until launch.
2. **Build Context** rechecks the active parent, `explore-v2` attestation, exclusive-build state, and capacity. The store atomically binds the build to the draft revision before the controller starts the child.
3. The controller registers `contextPackMcpBridge` for that child generation. Each bridge request resolves the parent-owned draft and rejects an invalid parent, child, generation, revision, path, operation, or byte limit.
4. The child reads the workspace tree/artifacts through the bridge and submits revision-fenced mutations. Operator mutations are committed by the store and make any child mutation based on an older revision stale; the operator wins.
5. **Review** asks the controller to materialize every selection. The materializer revalidates workspace containment, source identity, digest, size, and diff bounds; pure assembly orders task, brief, selections, and diffs deterministically and applies the existing redactor before publishing a candidate.
6. **Seal** rechecks candidate revision, source fence, freshness, and hard Pack Budget. It atomically replaces only the current sealed value with the exact redacted serialized payload; refining it always creates a new draft.
7. **Send Here**, **Start Child**, and handoff attachment call the same Recipient Fit service immediately before the existing final confirmation. Missing, stale, or insufficient evidence blocks the action without changing or trimming the sealed bytes. Export copies the exact sealed payload only after operator confirmation and does not claim recipient fit.
8. Run persistence stores a Draft Manifest plus exact sealed bytes. Restoration recreates pack state with no live build binding, revalidates drafts before review, and requires a fresh fit check before any sealed-pack consumption.

## Implementation Design

### Core Interfaces

The following Go-shaped value is specification notation required by the workflow. Production code uses the TypeScript contracts that follow.

```go
type ContextPackState struct {
    Draft       *DraftContextPack
    Sealed      *SealedContextPack
    Review      *ReviewCandidate
    Build       *ContextBuildBinding
    LastOutcome string
}
```

```ts
export interface ContextPackState {
  readonly draft: DraftContextPack | null
  readonly sealed: SealedContextPack | null
  readonly review: ContextPackReviewCandidate | null
  readonly build: ContextBuildBinding | null
}

export interface DraftContextPack {
  readonly revision: number
  readonly instructions: ContextPackInstructions
  readonly budget: ContextPackBudget
  readonly brief: ContextBrief
  readonly selections: readonly ContextSelection[]
  readonly stale: ContextPackStaleState
}
```

```ts
export type RecipientFit =
  | { readonly kind: "fit"; readonly exactCount: number; readonly remaining: number }
  | { readonly kind: "unavailable"; readonly reason: RecipientFitUnavailableReason }
  | { readonly kind: "insufficient"; readonly exactCount: number; readonly remaining: number }

export interface ContextPackControllerActions {
  startContextBuild(input: StartContextBuildInput): Promise<ContextBuildResult>
  reviewContextPack(sessionId: SessionId): Promise<ContextPackReviewResult>
  sealContextPack(sessionId: SessionId): ContextPackSealResult
  assessRecipientFit(input: RecipientFitInput): Promise<RecipientFit>
}
```

```ts
export interface ContextPackCapability {
  readDraft(input: ContextPackCapabilityRoute): DraftContextPackSummary
  readArtifact(input: BoundedArtifactRead): BoundedArtifact | ContextPackCapabilityDenial
  mutateDraft(input: RevisionFencedContextPackMutation): ContextPackMutationResult
}

export interface ContextPackCapabilityRoute {
  readonly parentId: SessionId
  readonly childId: SessionId
  readonly generation: number
}
```

`ContextSelection` is a closed union of `full_file`, `file_slice`, and `diff`. Every selection stores only identity metadata in the draft: workspace-relative path, source kind, byte length, digest, rationale, relationship text, and range where applicable. `ContextPackReviewCandidate` holds the exact redacted serialized payload, candidate revision, source-fence digest set, exact bytes, Pack Estimate, redaction count, and blocking verdict. It is live state only until sealing.

`src/core/contextPack.ts` exports pure functions for `createDraft`, `startFreshFromSealed`, `applyOperatorMutation`, `applyBuilderMutation`, `validateDraft`, `assembleCandidate`, `sealCandidate`, `restoreManifest`, and `assessRecipientFit`. Functions accept already materialized source artifacts or evidence; filesystem, ACP, and telemetry effects stay outside the core. Builder mutations must include the revision read. A mismatch returns a typed stale rejection and never overwrites a newer operator change.

### Data Models

| Model | Owner | Required fields | Persistence / lifecycle |
|---|---|---|---|
| `ContextPackState` | AppStore, keyed by `SessionId` | current draft, sealed value, review candidate, build binding | Created with session state; review/build bindings are live-only. |
| `DraftContextPack` | Core value in AppStore | original instructions, instruction mode, 80k default budget, fixed brief, selections, revision, stale state | Persisted only as `DraftContextPackManifest`; restore requires revalidation. |
| `ContextSelection` | Draft | kind, relative path, source identity/digest, bytes, rationale, relationship, optional range/diff scope | Manifest stores metadata only; no copied unredacted content. |
| `ContextBrief` | Draft | Architecture, Selected Context, Relationships, Ambiguities, Budget Omissions | Mutable only through fenced operator/builder actions. |
| `ContextPackReviewCandidate` | AppStore | draft revision, source-fence identities, exact redacted payload, exact bytes, estimate, redaction count, validation result | Not persisted; invalidated by draft/source change. |
| `SealedContextPack` | AppStore + RunRecord | sealed revision, exact redacted payload, serialized bytes, estimate, source provenance summary, sealed timestamp | Persisted exactly; immutable and recipient-neutral. |
| `ContextBuildBinding` | AppStore | parent id, child id, parent/child generation, draft revision at bind, state | Never persisted; cleared on restoration/terminal cleanup. |
| `RecipientProfile` | Closed config/evidence registry | exact recipe/model, fresh-session capacity, counter version, reserve, evidence version | Current/stale/absent evidence is controller input; not part of pack identity. |
| `RecipientFit` | Pure core decision | fit/unavailable/insufficient, exact count where known, remaining capacity or closed reason | Recomputed immediately before every consumption. |

Persisted RunRecord additions use strict allowlisted schemas:

```ts
export interface PersistedContextPack {
  readonly draft?: PersistedDraftContextPackManifest
  readonly sealed?: PersistedSealedContextPack
}

export interface PersistedSealedContextPack {
  readonly payload: string // exact redacted serialized bytes
  readonly bytes: number
  readonly sealedAt: number
  readonly revision: number
}
```

The serializer rejects excess keys and never accepts raw materialized source, a live candidate, a bridge route, a build child, an attestation, a reservation, or provider error text. The reader restores every draft as `needs_revalidation`; it never recreates a build binding.

### API Endpoints

There are no HTTP endpoints. Context Packs add internal controller actions and a closed same-binary MCP surface.

| Surface | Input | Output | Contract |
|---|---|---|---|
| `ControllerActions.startContextBuild` | parent id, start-fresh/refine choice | started child id or typed denial | Re-attests and binds one build to one draft before spawning; no `explore-v1` fallback. |
| `ControllerActions.reviewContextPack` | owning session id | candidate or typed blocking result | Re-materializes, validates, redacts, accounts, and publishes the exact review candidate. |
| `ControllerActions.sealContextPack` | owning session id, candidate revision | sealed result or typed denial | Rechecks revision/source fence; persists only the exact redacted payload. |
| `ControllerActions.assessRecipientFit` | sealed pack + recipient route | `RecipientFit` | Shared final gate for Send Here, Start Child, and handoff composition. |
| `context_pack.read_draft` | bridge route | bounded draft summary | Returns no raw source or capability outside the bound draft. |
| `context_pack.read_workspace` | bridge route, relative path/range/diff selector | bounded artifact or typed denial | Enforces Session Workspace containment, allowlisted artifact kind, and byte cap. |
| `context_pack.mutate_draft` | bridge route, expected revision, closed mutation | accepted revision or stale/denied result | Allows only selection, brief, and permitted-instruction changes; never seals or delivers. |
| `ask_user` | existing scoped route | submitted/skipped/timed-out/cancelled answer | Retained as the sole non-Context-Pack child capability. |

`contextPackMcpBridge.register` receives the parent id, child id, generation, session workspace root, and controller capability facade. It must authorize again inside every handler. Tool advertisement is not sufficient authorization. The bridge is disposed when the child settles, its parent generation changes, or its launch is denied.

### Integration Points

| Boundary | Integration design | Failure behavior |
|---|---|---|
| Existing Explore policy | Add closed `explore-v2` capability evidence alongside unchanged production-closed `explore-v1`. | Missing/stale/unrecognized evidence makes Context Build unavailable; do not retrofit V1. |
| Existing delegation lifecycle | Reuse parent/child generation and atomic reservation patterns, with one active Context Build per draft. | Parent close, child failure, or generation mismatch clears the build binding and rejects late mutations. |
| Workspace discovery | Reuse realpath containment and binary exclusion from `fileDiscovery.ts`; add bounded content, slice, digest, and per-file diff materialization. | Out-of-workspace, missing, binary, oversized, or changed material becomes a typed blocking/stale result. |
| Secret redactor | Call the existing deterministic line-oriented redactor during candidate assembly before preview or persistence. | A redaction failure blocks review/sealing; never persist an unredacted fallback. |
| Run persistence | Extend strict RunRecord version/schema and owner-only atomic store. | Invalid restoration drops the affected pack projection with bounded diagnostics; live authority is never restored. |
| Handoff | Extend `HandoffBundle` with an optional whole sealed-pack attachment and source-identity metadata for deduplication. | Attachment is excluded on failed fit or stale pack; one combined preview/confirm remains required. |
| Existing session usage | Use reported `{ used, size }` only as current-session headroom evidence, supplemented by certified count/profile evidence. | Missing count/profile yields `unavailable`, never estimate-only authorization. |
| UI command and overlays | Register `/context` in the central keymap/command flow; project store selectors into a modal/surface and File Explorer membership actions. | A completed build sets attention state only; it never changes focus or opens review. |
| Telemetry | Add fixed lifecycle, blocking, and fit enum/count methods to the existing opt-in recorder. | Disabled recorder remains no-op; schemas reject content-bearing fields. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/core/contextPack.ts` | new | Defines immutable artifact/revision/fit rules; high invariant sensitivity. | Add pure values, transitions, and exhaustive tests. |
| `src/core/types.ts` | modified | Adds protocol-free pack, attachment, and recipient vocabulary. | Keep ACP and filesystem types out; update fixtures. |
| `src/store/appStore.ts` | modified | Adds session-keyed mutable pack projection and atomic actions. | Preserve structural sharing and single-owner mutation. |
| `src/store/selectors.ts` | modified | Adds narrow pack/review/build/fit selectors. | Return stable projections and avoid broad session subscriptions. |
| `src/persistence/runRecord.ts`, `runStore.ts`, `runWriter.ts` | modified | Adds strict manifest/sealed persistence and restoration. | Bump version/migrate, preserve 0600 atomic write, prove no raw content. |
| `src/config/contextPackCapability.ts` | new | Defines closed `explore-v2` and Recipient Profile evidence. | Deny absent/stale evidence; no configuration override. |
| `src/app/contextPackMaterializer.ts` | new | Materializes bounded file/slice/diff artifacts and source fences. | Reuse containment; reject changed/oversized/out-of-workspace data. |
| `src/app/contextPackBridge.ts` | new | Enforces bound child capability operations. | Test direct forbidden calls and generation/revision races. |
| `src/app/controller.ts` | modified | Owns build start, cleanup, review I/O, fit evidence, and consumption dispatch. | Keep state mutations in store and ACP details out of core. |
| `src/core/bundleAssembler.ts`, `src/app/handoff.ts` | modified | Composes optional sealed pack and deduplicates source-identical blocks. | Preserve redaction, target selection, preview, and confirm invariants. |
| `src/ui/keymap.ts`, `CockpitApp.tsx`, File Explorer/review components | modified/new | Adds `/context`, state views, membership controls, and blocked explanations. | UI uses selectors/actions only; no global chord or focus theft. |
| `src/telemetry/recorder.ts` | modified | Adds allowlisted Context Pack lifecycle metrics. | Enforce opt-in content-free fields with negative tests. |

## Requirements Traceability

| PRD requirement | Technical component(s) | Verification evidence |
|---|---|---|
| Goals: session-focused, high-signal package | `ContextPackState`, draft selections, fixed brief, bounded materializer | Core/store tests for one draft + one sealed pack and deterministic selection order. |
| Goals: trusted completion and no surprise delivery | review candidate, `sealContextPack`, shared fit gate, handoff confirm path | Controller/UI integration proves stale/over-budget/unavailable blocks and no path auto-sends. |
| Goals: visible freshness, budget, and eligibility | source-fence validation, Pack Estimate, `RecipientFit`, selectors | Materializer/selector/UI tests for every blocking and available state. |
| Goals: restart continuity without raw retention | manifest/sealed RunRecord projection and strict serializer | Persistence tests restore manifest/sealed state, reject raw fields, and clear live binding. |
| User story: eligible Context Build | `explore-v2` evidence, bridge, generation binding | Controller and real-adapter certification test prove allowed tools only. |
| User story: rationale and ambiguity review | `ContextSelection` rationale/relationship plus fixed `ContextBrief` | Core candidate and review UI tests show all selected/omitted material. |
| User story: immutable inspected payload | pure assembly, redactor, sealed value | Deterministic/redaction/exact-byte persistence and export tests. |
| User story: explicit delivery and reusable pack | controller consumption service, Recipient Fit, handoff attachment | Destination matrix integration tests verify fresh fit and final confirmation. |
| User story: clear blocked state | closed stale/capability/fit reason unions and selectors | UI copy/accessibility tests and direct controller denials. |
| PRD privacy metric | RunRecord allowlist and telemetry recorder event union | Serializer/recorder negative tests reject text, paths, identities, and errors. |

## Testing Approach

### Unit Tests

- Add `src/core/contextPack.test.ts` for default budget, fixed brief shape, full/slice/diff selection invariants, deterministic order, revisions, operator-wins stale rejection, candidate invalidation, sealing immutability, source-fence validation, recipient-fit union decisions, and no partial-send result.
- Add `src/core/contextPackPersistence.test.ts` for manifest conversion, sealed exact-byte identity, strict excess-key rejection, and restored draft `needs_revalidation` state.
- Extend `src/core/bundleAssembler.test.ts` for optional sealed-pack source-identity deduplication while preserving ordinary handoff behavior and redaction count.
- Extend `src/config/*Capability*.test.ts` for closed `explore-v2` evidence, stale evidence, profile version/reserve changes, and no safety override.
- Extend `src/telemetry/recorder.test.ts` with allowlisted Context Pack enums/counts and negative tests for all prohibited content fields.

### Integration Tests

- Add store tests for atomic create/refine/build-bind/operator-edit/review/seal transitions, structural sharing, and cleanup after parent/child generation changes.
- Add persistence tests around the real RunStore for owner-only file mode, migration, invalid record handling, exact sealed payload retention, and no restoration of build/bridge authority.
- Add controller tests using injected materializer and bridge fakes for attestation denial, one-build exclusivity, path/size/digest failures, stale child mutations, review/confirm fences, and all Recipient Fit outcomes.
- Add bridge integration tests that directly invoke every forbidden operation: agent control, shell, general Git, external MCP, cross-session access, seal, send, export, approval, stale generation, stale revision, and path escape.
- Add UI tests for `/context`, keyboard focus, current-session selector updates, attention without focus theft, full review details, blocked-state wording, File Explorer membership, and confirmation-only delivery.
- Add handoff integration tests for attach/remove as a whole, exact combined preview, source deduplication, unavailable-fit block, and final-confirm recheck.
- Add an opt-in real-adapter certification probe that proves the exact `explore-v2` bridge tool set and one bounded mutation path for each supported recipe. Keep it separate from process-free default self-check behavior.

## Development Sequencing

### Build Order

1. Add `src/core/contextPack.ts` values, closed enums, pure transitions, source-fence inputs, and `RecipientFit`; no dependencies.
2. Extend `src/core/types.ts`, AppStore, and selectors with the session-keyed `contextPacks` projection and atomic operator/build actions; depends on step 1.
3. Extend strict RunRecord schemas, RunStore, and writer with manifest/sealed persistence plus restoration sanitization; depends on steps 1–2.
4. Add closed `explore-v2` capability and Recipient Profile evidence modules; depends on step 1 and the completed report-only Explore foundation from issue #13.
5. Add bounded `contextPackMaterializer` and controller-owned review/assembly orchestration; depends on steps 1–2 and the existing containment/redactor seams.
6. Add `contextPackMcpBridge`, generation/revision authorization, Context Build start/cleanup, and direct-forbidden-operation tests; depends on steps 2, 4, and 5.
7. Add sealing, shared Recipient Fit consumption, Send Here, and strict final-confirm rechecks; depends on steps 2–6.
8. Extend handoff composition, optional pack attachment, source-identity deduplication, and combined review; depends on steps 3, 5, and 7.
9. Add `/context`, File Explorer membership, review/blocked/attention UI, and accessibility coverage; depends on steps 2, 5, and 7.
10. Add Start Child, Markdown export, content-free telemetry, real-adapter certification, and the final end-to-end matrix; depends on steps 3–9.

### Technical Dependencies

- Issue #13's report-only `explore-v1` foundation must be complete and retain its accepted closed-policy contract before `explore-v2` evidence is introduced.
- At least one provider recipe must offer independently reviewed evidence for the exact Context Pack bridge restrictions before Context Build can launch in a pilot.
- A closed Recipient Profile/counter evidence source is required before Start Child can be enabled; absent evidence keeps the action unavailable.
- Existing RunRecord migrations and owner-only atomic file behavior must remain compatible with previously persisted runs.
- The existing `secretRedactor`, workspace containment, handoff preview, and explicit confirmation contracts are load-bearing dependencies; Context Packs may extend but not weaken them.

## Monitoring and Observability

- Add fixed, opt-in lifecycle outcomes: `context_pack_draft_created`, `build_started`, `build_denied`, `build_settled`, `review_ready`, `review_blocked`, `sealed`, `seal_denied`, `fit_available`, `fit_unavailable`, `fit_insufficient`, `delivery_confirmed`, and `delivery_denied`.
- Allow only closed reason enums, numeric counts, and bounded durations/byte buckets. Do not record instructions, source paths, source identities, selection rationale, payload bytes/content, model output, recipes, recipient ids, export destinations, or provider errors.
- Record redaction count and selection-count buckets only after verifying they cannot reconstruct source content or paths.
- Add diagnostic self-check output for capability/profile availability using only provider labels and closed reason codes; never report a bridge as available based solely on tool advertisement.
- Treat an attempted forbidden bridge operation, a persistence schema rejection, a source-fence mismatch at final confirm, or a delivery without fresh fit evidence as release-blocking test signals rather than telemetry-only events.

## Technical Considerations

### Key Decisions

- **Store-owned state with pure domain helpers:** AppStore owns the live session-keyed projection; pure core functions make revisions, candidate assembly, and fit decisions deterministic. This avoids a controller map or transcript-state coupling.
- **Manifest plus exact sealed persistence:** Drafts persist identity metadata and revalidate; sealed packs persist only exact redacted bytes. The trade-off is fresh materialization work after restart for an honest freshness boundary.
- **Separate `explore-v2` bridge:** A profile-specific bridge exposes only bounded Context Pack operations plus `ask_user`, with execution-time parent/generation/revision enforcement. The trade-off is separate certification work instead of reusing the mixed child bridge.
- **Shared fail-closed Recipient Fit:** One pure decision and controller gate protect every consumption route. The trade-off is that destinations remain unavailable without current recipient evidence.
- **Layered verification:** Pure, store, persistence, controller/bridge, UI, handoff, and real-adapter certification tests each prove a distinct contract. The trade-off is more focused test surfaces, which is required because a single end-to-end path cannot expose all authority and race failures.

### Known Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The current shared bridge exposes `agent_run` | High until separated | Register a distinct Context Pack bridge; test direct invocation of every forbidden route. |
| Operator and child mutate the same draft concurrently | High | Require child read revision on every mutation, reject stale child writes, and atomically commit operator changes. |
| Workspace material changes after review | High | Store identities/digests, revalidate at review and seal, and invalidate the candidate on drift; never auto-rebase. |
| Exact sealed bytes change during persistence/export/handoff | Medium | Serialize once after redaction, persist/consume that exact value, and assert byte identity in tests. |
| Recipient capability evidence is absent or stale | High during rollout | Return unavailable and keep the action disabled; maintain closed profiles with versioned evidence. |
| Persisted data grows or leaks raw content | Medium | Enforce size caps, metadata-only manifests, strict schemas, owner-only files, and negative serializer tests. |
| UI attention or review flow steals focus | Medium | Derive attention from store state; use modal focus rules and explicit open actions only. |
| Handoff pack overlaps ordinary files/diffs | Medium | Deduplicate on source identity before one combined preview, preserving original handoff confirmation. |

## Architecture Decision Records

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md) — Defines the complete destination while activating capability only after its proof obligations are met.
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md) — Limits initial availability to eligibility-aware pilot users and makes trusted completion the leading outcome.
- [ADR-003: Keep Context Packs in a session-keyed AppStore slice with manifest-and-sealed persistence](adrs/adr-003.md) — Separates pure pack lifecycle from mutable store ownership and persists only manifests plus exact redacted sealed bytes.
- [ADR-004: Use a separate generation-bound Context Pack bridge for `explore-v2`](adrs/adr-004.md) — Gives the builder a closed, parent-bound capability instead of extending the mixed child bridge.
- [ADR-005: Gate every Context Pack consumption on a shared fail-closed Recipient Fit decision](adrs/adr-005.md) — Requires fresh recipient evidence for Send Here, Start Child, and handoff attachment with no trim or override.
