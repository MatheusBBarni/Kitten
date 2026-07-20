## Overview

Kitten will add session-owned **Context Packs**: an operator can direct one separately certified `explore-v2` child to curate a task-specific context artifact, review the exact redacted payload, seal it immutably, and explicitly deliver it only to an eligible recipient.

The primary user is a cockpit developer coordinating live sessions who needs to give the next agent focused source, relevant diffs, and task intent without forcing it to rediscover the repository. V1 preserves the complete Issue #24 product contract—persistence, recipient-fit, Send Here, Start Child, handoff attachment, and Markdown export—but delivers it through evidence-gated vertical slices. No destination or Context Build becomes usable until its required authority, provenance, freshness, accounting, and recipient evidence is verified.

## Summary / Differentiator

RepoPrompt validates budgeted source curation; Context Packs differentiate Kitten by making that curation a provider-neutral, session-owned custody artifact: draft → exact review → immutable redacted payload → explicit, recipient-fit-gated delivery. It is neither a codemap platform nor an autonomous planning workflow.

## Problem

Complex delegated tasks force a receiving coding agent to reconstruct repository context from scratch. A broad transcript or uncontrolled pile of files is not a reliable substitute: it obscures task intent, hides why each item matters, and can exceed a recipient’s usable context. The cockpit developer needs a deliberate way to curate high-signal implementation material without turning an exploratory child into an implementation or transport authority.

A prose Explore report leaves the operator to manually translate recommendations into context and cannot prove which exact bytes will reach a recipient. Without a reviewed artifact, source drift, omitted diffs, stale selections, secret exposure, or recipient capacity can turn a seemingly useful handoff into an unsafe or ineffective one.

This must not weaken the existing report-only `explore-v1` contract. Context Build requires a separately attested `explore-v2` capability, bounded to one parent session and launch generation. It may curate app-owned draft state but cannot write workspace files, run shell or general Git, use external MCP, control agents, recurse, seal, send, export, or approve a pack.

### Market Data

- RepoPrompt’s Context Builder demonstrates iterative source selection under an adjustable budget; its 60k default and lower direct-paste guidance support visible budget pressure, but are vendor guidance rather than a universal recipient-capacity claim. [Source](https://repoprompt.com/blog/context-over-convenience)
- Anthropic’s context-engineering guidance describes degradation as context accumulates, reinforcing the goal of the smallest high-signal set rather than maximal file inclusion. [Source](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- VS Code’s agent security model includes scoped permissions and content review before model delivery, making exact-payload review a familiar safety expectation. [Source](https://code.visualstudio.com/docs/agents/security)
- GitHub artifact attestations illustrate the value of provenance and verification for immutable artifacts, while also showing that provenance alone is not a complete security guarantee. [Source](https://docs.github.com/en/actions/concepts/security/artifact-attestations)

## Core Features

| # | Feature | Priority | Description |
|---|---|---|---|
| F1 | Session-owned Draft and Sealed Pack state | Critical | Each session owns at most one mutable Draft Context Pack and one current immutable Sealed Context Pack; every draft mutation advances a revision and stale child writes fail closed. |
| F2 | Explicit, separately certified Context Build | Critical | **Build Context** launches one verified `explore-v2` child bound to the parent session’s draft; ordinary `explore-v1` stays report-only, and completion never auto-runs or sends anything. |
| F3 | Curated selections and fixed Context Brief | Critical | A draft holds original task instructions, Preserve/Augment/Rewrite mode, an adjustable 80k Pack Budget, full files, explained slices, bounded diffs, source identities/digests, stale state, and a brief covering Architecture, Selected Context, Relationships, Ambiguities, and Budget Omissions. |
| F4 | Exact review, freshness, and sealing | Critical | Review materializes all selections inside the Session Workspace, revalidates identity/digest and size, deterministically assembles and redacts the candidate, shows exact bytes plus Pack Estimate, and blocks sealing when stale or over budget. |
| F5 | Privacy-safe persistence | High | Persist only the metadata-only Draft Manifest and exact redacted Sealed payload through a strict versioned schema; exclude raw source, live child authority, attestation, reservations, provider errors, and content telemetry. |
| F6 | Recipient Fit and explicit consumption | High | Before Send Here, Start Child, handoff attachment, or export, recheck the immutable payload against current recipient evidence; missing or insufficient evidence blocks without trimming, substitution, or a warning-only override. |
| F7 | Conversation-first curation UI | High | `/context` opens the session surface; File Explorer exposes membership and quick add/remove; Build Context is explicit; review shows instructions, rationale, mode, budget, freshness, redactions, and fit state without stealing focus. |
| F8 | Handoff composition and content-free telemetry | Medium | A handoff carries at most one sealed pack, deduplicates overlapping file/diff blocks by source identity, and uses one combined review; opt-in telemetry records fixed outcomes and counts only. |

## Integration with Existing Features

| Integration Point | How |
|---|---|
| Report-only Explore | Preserve `explore-v1`; add a separately certified `explore-v2` profile and capability bridge bound to the parent and generation. |
| Core, reducer, and external store | Keep values, revisions, selection identity, deterministic assembly, and fit decisions protocol-free; store owns all mutable session-keyed pack state. |
| Safe repository discovery | Reuse containment and binary-exclusion patterns, while adding controller-owned bounded file/slice/diff materialization, source identity, and digest handling. |
| Secret redaction and handoff | Reuse the deterministic, false-negative-biased redactor before preview/persistence; compose an optional whole sealed pack with the existing confirmation-only handoff. |
| Run storage and telemetry | Extend strict, atomic owner-only persistence for manifests/sealed payloads and retain content-free telemetry schemas. |
| Commands and overlays | Add `/context` and store-owned review/attention state; add no global chord. |

## KPIs

| KPI | Target | How to Measure |
|---|---:|---|
| Capability-gate violations | 0 successful operations | Adversarial tests directly invoke write, shell/Git, external MCP, agent-control, recursion, seal, send, export, and cross-session paths from `explore-v2`. |
| Artifact-integrity violations | 0 across 1,000 mutation/materialization race simulations | Property and integration tests cover revision rejection, source drift, out-of-workspace paths, size limits, deterministic assembly, redaction, and exact sealed-byte persistence. |
| Eligible build-to-seal completion | ≥60% of started eligible builds in a 30-day pilot | Opt-in, content-free funnel events count started, review-ready, sealed, stale, over-budget, and blocked outcomes. |
| Operator context-preparation time | ≥50% median reduction in moderated complex-task trials | Compare timed manual preparation against Context Build plus review for the same representative tasks. |
| Recipient-fit enforcement | 100% of sends evaluated; 0 sends without current evidence | Integration tests and content-free outcome counters record each fit decision and reject missing, stale, or insufficient capacity evidence. |
| Telemetry and persistence leakage | 0 schema violations | Strict serializers and negative tests reject raw source, instructions, paths, item text, model output, recipes, identities, destinations, and provider error text. |

## Feature Assessment

| Criteria | Question | Score |
|---|---|---|
| **Impact** | How much more valuable does this make Kitten? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set Kitten apart? | Strong |
| **Defensibility** | Does value compound over time? | Strong |
| **Feasibility** | Can Kitten build this credibly? | Maybe |

Leverage type: **Compounding Feature**

## Council Insights

- **Recommended approach:** Preserve the complete Issue #24 contract as the product destination, but deliver it through verified vertical slices. Define the durable artifact and its gates before enabling every recipient path; never expose a placeholder safety or fit check as usable capability.
- **Key trade-offs:** Full portability and recipient choice versus a larger cross-layer state/authority surface; early persistence foundations versus persistence before capability confinement; one current-session destination versus reusing the existing confirmation-only handoff path.
- **Risks identified:** `explore-v2` cannot safely reuse the current child MCP registration while it exposes `agent_run`; no file/slice/digest or recipient-profile primitive exists; source drift and overly large packs can invalidate review; recipient fit cannot be inferred from a generic estimate.
- **Mitigation:** Add a profile-specific, execution-time-enforced bridge; use strict realpath/size/digest fences and explicit refresh; keep Pack Estimate distinct from recipient fit; preserve redaction and one confirmation boundary; fail closed on every missing proof.
- **Dissenting view:** A permanently narrow session-local Send Here product would be faster to validate, but would forfeit the selected differentiator—portable, reviewed, sealed context—so it is a delivery slice, not the final product scope.
- **Stretch goal (V2+):** Named workspace-level pack libraries, codemaps, automatic dependency selection, and semantic rebasing only after the V1 custody and recipient-fit model proves reliable.

## Out of Scope (V1)

- **Codemaps, parser caches, selection graphs, and automatic dependency selection** — They recreate RepoPrompt-style platform scope before the curated-selection loop is proven.
- **Filesystem watching and semantic slice rebasing** — Silent rebasing would undermine the source-freshness and exact-review contract.
- **Multiple concurrent builds, named pack histories, or workspace pack libraries** — One draft and one current sealed pack keep ownership and recovery comprehensible.
- **Custom brief schemas or context-builder meta-prompts** — The fixed brief protects comparability and prevents the builder from becoming a planning authority.
- **Automatic plan, review, question, chat, implementation, handoff, or send workflows** — Context Build must stop at a review-ready draft.
- **Agent authority to seal, consume, export, or approve a pack** — These remain explicit operator confirmation boundaries.
- **General Git, shell, external MCP, agent control, or cross-session access for the child** — Each would violate the separately attested, scoped capability model.
- **Warning-only recipient-fit overrides and public/machine-readable export** — A pack must block when fit is unavailable, and Markdown remains operator-confirmed only.

## Architecture Decision Records

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md) — Preserve the complete contract while activating each capability only after its supporting proof is verified.

## Open Questions

- Which provider/model recipes can produce independent, durable evidence for the exact `explore-v2` capability boundary?
- What source identity/digest representation remains portable across supported workspaces without persisting raw content?
- What closed Recipient Profile and conservative counting method can credibly establish fresh-child capacity?
- Should the first eligible consumption action be Send Here or handoff attachment once their shared artifact and fit gates are verified?
- What trial task set will provide a trustworthy baseline for the 50% operator-preparation-time target?
