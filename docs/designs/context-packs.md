# Context Packs: RepoPrompt-inspired context engineering for Kitten

## Intent

Kitten will adopt RepoPrompt CE's strongest context-engineering pattern: a scout does not merely return a report. It iteratively curates explicit, budgeted context state, produces a structured handoff brief, and stops before implementation so a separately chosen agent can consume the reviewed result.

Kitten will express that pattern as a session-owned **Context Pack** rather than cloning RepoPrompt's application architecture or codemap platform. The pack remains useful after its builder exits and can be consumed by the parent session, a fresh delegated child, or Kitten's existing cross-agent hand-off.

## What RepoPrompt CE does

The inspected RepoPrompt CE implementation combines several concerns into one stateful workflow:

- A dedicated Discover agent receives an embedded file tree, current prompt, selected context, custom discovery instructions, and a token budget.
- The agent explores with read-only tree, search, structure, file-read, selection, prompt, workspace-context, and Git tools.
- Selection is canonical tab state with three representations: full files, described line slices, and signature-only codemaps.
- Adding implementation files can automatically select related codemaps through a definition/reference graph.
- The agent iterates on selection, checks token totals, and treats full files as the default; slicing is a budget response rather than the starting point.
- Prompt handling is explicit: Rewrite, Augment, or Preserve.
- The generated handoff prompt records task, architecture, selected context, relationships, and ambiguities without implementing the solution.
- Context-only discovery can optionally feed a separate plan, review, or question model and a stateful follow-up chat.
- MCP exposes the same workflow through `context_builder`, `manage_selection`, `workspace_context`, and export tools.
- The production implementation carries substantial machinery for codemap extraction, artifact caching, automatic dependency graphs, source freshness, worktree authority, selection transactions, and token accounting.

The V1 lesson for Kitten is the stateful curated-selection loop, not codemap parity.

## V1 product contract

### Canonical state

Each Kitten session owns at most:

- one mutable **Draft Context Pack**; and
- one current immutable **Sealed Context Pack**.

A draft contains task instructions, an Instruction Mode, an 80k default Pack Budget, a Context Brief, and selected Full File Items, File Slices, and Diff Items. One active Context Build may curate it at a time. The operator may edit it concurrently; every mutation advances a Pack Revision, and a stale child mutation is rejected.

Sealing never mutates a previous sealed pack. Refining a sealed pack copies its manifest and instructions into a new draft. A Handoff Bundle that already embeds an older sealed pack remains self-contained.

### Explicit Context Build

Ordinary `explore` delegation remains report-only. **Build Context** is a distinct explicit intent that launches one verified `explore` child bound to its parent session's current draft.

The build refines current operator curation by default. Start Fresh is explicit. Completion leaves a ready-for-review draft and does not auto-run a plan, review, answer, implementation session, or hand-off.

### Scoped child authority

The verified Explore policy is amended with an exact app-owned Context Pack Capability. It may:

- read the current draft summary, revision, budget, estimate, and stale state;
- add or remove full-file, described-slice, and diff selections;
- update the Context Brief and the mode-permitted discovered instructions;
- list and read size-bounded per-file staged/unstaged patches inside the Session Workspace plus pending diffs already captured by the parent; and
- ask the supervising user through the existing scoped `ask_user` bridge.

Every child mutation includes the Pack Revision it read. The capability cannot write workspace files, execute shell or general Git commands, use external MCP, control agents, recurse, change another session, seal, send, export, or approve a pack.

This authority must be part of the exact provider recipe attestation. The current `agent-role-profiles` contract remains the report-only `explore-v1` foundation; Context Build is enabled only by a separately certified `explore-v2` profile from the follow-on `context-packs` packet.

### Selection doctrine

The Context Build prompt adopts these RepoPrompt-proven rules:

1. Start from the current draft and embedded workspace tree.
2. Explore broadly enough to understand architecture and trace referenced types, callers, callees, tests, configuration, and docs.
3. Add relevant complete files first.
4. Use File Slices only when budget pressure justifies the loss of surrounding context; every slice needs a relevance and relationship explanation.
5. Include bounded Diff Items when the task concerns current changes.
6. Do not assume one solution and curate only for it.
7. Keep implementation-bearing material more prominent than summaries.
8. Record important Budget Omissions rather than pretending excluded material is irrelevant.
9. Recheck the Pack Estimate after every meaningful selection change.
10. Stop after producing the draft and Context Brief; do not implement or send.

V1 deliberately has no codemaps, automatic dependency graph, parser artifact cache, or semantic slice rebase. The child traces dependencies through its read-only exploration tools.

### Instruction authority

Every build has one explicit Instruction Mode:

- **Preserve** keeps the original task byte-for-byte unchanged.
- **Augment** is the default and appends the Context Brief to the original task.
- **Rewrite** replaces the task with synthesized instructions that remain subject to review.

Every Context Brief has fixed Architecture, Selected Context, Relationships, Ambiguities, and Budget Omissions sections. It reports observed structure and uncertainty, never an implementation plan or proposed solution.

### Freshness, materialization, and sealing

Draft persistence stores only a Draft Manifest: paths, ranges, diff identities, relevance explanations, source identities/digests, budget settings, instructions, brief, and revision. It does not cache copied workspace files.

Opening Context Pack Review materializes an exact candidate payload:

1. Resolve every selected item inside the owning Session Workspace.
2. Revalidate its source identity and digest.
3. Reject stale, missing, out-of-workspace, ineligible, or oversized material.
4. Assemble the task, Context Brief, full files, slices, and diffs in deterministic order.
5. Redact with Kitten's existing line-oriented, false-negative-biased redactor before any preview or persistence.
6. Compute exact serialized bytes and the labeled Pack Estimate.
7. Block sealing while stale or over the Pack Budget.

Final confirmation rechecks the draft revision and source fence. Any draft or source change invalidates the candidate and returns to review. Only the review surface can seal the exact redacted payload.

### UI

Kitten remains conversation-first:

- `/context` opens the current session's Context Pack surface.
- The File Explorer shows pack membership and quick add/remove actions.
- Build Context is available from `/context` and the File Explorer.
- Context Pack Review shows instructions, the fixed brief, items and rationales, diff/full/slice modes, exact bytes, Pack Estimate, budget pressure, freshness, and redactions.
- A completed background build marks its session as needing attention but never steals focus or opens review automatically.
- No new global chord is added in V1; Kitten's keymap remains sparse and slash-first.

### Portable accounting and recipient fit

The pack is provider-neutral. During curation, Kitten displays exact serialized bytes and a deterministic, clearly labeled Pack Estimate. The 80k Pack Budget is a hard curation gate against that estimate, not a claim about a particular model tokenizer.

Every consumption performs a fresh Recipient Fit Check:

- Existing sessions require current ACP-reported headroom plus a certified provider/model Recipient Count or conservative upper bound for the exact serialized payload.
- Fresh children require a current closed Recipient Profile tied to the exact recipe/model, usable fresh-session prompt capacity, counter version, and reserve.
- Missing or stale evidence makes fit unavailable; insufficient evidence blocks the send.
- Kitten never silently trims, partially sends, or substitutes material.

ACP runtime usage is useful for live headroom but does not standardize pre-send arbitrary-prompt tokenization. Recipient counters therefore need the same truth-first certification posture as other provider capability claims.

### Consumption and export

After sealing, the operator explicitly chooses one action:

- Send Here to the current live session.
- Start Child using a certified fresh-recipient profile.
- Attach to Hand-off.
- Export Markdown.

The existing Handoff Bundle remains the continuation envelope and may carry at most one sealed pack. It retains transcript summary and optional shell context; the pack retains curated task/workspace context. Assembly deduplicates overlapping envelope file/diff blocks by source identity, never by list index, and reviews the combined exact payload once. Hand-off review may attach or remove the pack as a whole but cannot edit it in place.

Markdown export is an explicit operator-confirmed copy of the exact redacted sealed payload plus compact provenance to a chosen path. Kitten never exports automatically and never overwrites without confirmation.

### Persistence and privacy

Existing run persistence stores the Draft Manifest and current sealed redacted payload with the same strict schema, sanitization, atomic-write, and owner-only permission posture as current records. Restored drafts revalidate before review. Restored sealed packs remain inspectable but must pass a fresh Recipient Fit Check before use.

Never persist or restore the Context Build child, capability attestation, reservation, live builder ownership, raw unredacted material, or provider error text. Opt-in telemetry remains content-free: fixed outcome enums and counts only, with no instructions, paths, item text, model output, recipes, identities, or export destinations.

## Architecture placement

- **Core** owns Context Pack values, Pack Revision, deterministic mutation/rejection, selection identities, lifecycle rules, materialized sealed values, and fit decisions. It remains pure and protocol-free.
- **Store** is the only mutable owner and commits draft edits, review candidates, sealed pointers, and Context Build bindings atomically with structural sharing.
- **Agent adapter/config** owns the same-binary scoped Context Pack MCP bridge and exact provider capability evidence; ACP and MCP wire types never enter core/store/UI.
- **Controller** owns explicit Context Build launch, parent/generation binding, scoped diff reads, materialization I/O, recipient evidence, consumption, export, and cleanup.
- **UI** consumes selectors and ControllerActions only. File Explorer and review are projections of the same store-owned draft.
- **Persistence** adds a strict next-version schema for Draft Manifests and redacted sealed payloads while retaining current rejection and redaction behavior.
- **Handoff** composes an optional sealed pack without weakening preview, redaction, target selection, or explicit confirmation.

## V1 exclusions

- Codemaps, automatic dependency selection, syntax artifact caches, or selection graphs.
- Background filesystem watching or semantic slice rebasing.
- Multiple active Context Builds for one draft.
- Multiple retained sealed packs, named pack history, or a workspace pack library.
- Project-defined Context Brief schemas or context-builder meta-prompts.
- Automatic plan/review/question generation.
- JSON or other public machine-readable export formats.
- Agent authority to seal, consume, export, or approve packs.
- Warning-only fit overrides or unrestricted fallbacks.

## Delivery implications

The active `agent-role-profiles` packet already certifies and implements the stricter report-only `explore-v1` role, with tasks 01-05 complete and only its telemetry/safety-hardening task remaining. Finish that packet unchanged. Context Packs belong in a separate follow-on `context-packs` PRD/TechSpec and task graph that explicitly depends on the completed Explore foundation and introduces a new `explore-v2` attestation. Do not bolt the Context Pack bridge onto `explore-v1` or retroactively weaken its completed evidence.

Recommended delivery order:

1. Finish and verify the report-only `agent-role-profiles` packet.
2. Create the follow-on `context-packs` PRD/TechSpec with `explore-v2` evidence and explicit dependency on `explore-v1`.
3. Add pure Context Pack domain state and revision-fenced mutations.
4. Add store ownership and strict manifest/sealed persistence.
5. Add the scoped app-owned Context Pack bridge and bounded diff artifacts.
6. Add File Explorer membership and `/context` review/curation UI.
7. Add materialization, redaction, sealing, and two-tier accounting.
8. Add recipient profiles and the shared fit gate.
9. Compose hand-off, fresh-child start, Send Here, and Markdown export.
10. Verify with pure, store, controller, persistence, UI, integration, self-check, and compiled-build evidence.
