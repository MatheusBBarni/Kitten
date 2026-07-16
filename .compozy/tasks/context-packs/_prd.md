## Overview

Context Packs give a Kitten cockpit developer a deliberate way to prepare focused, task-specific context for the next agent. Instead of asking a receiving agent to rediscover a repository from a broad transcript or an unstructured set of files, the operator can direct one eligible Context Build to curate a draft, inspect exactly what the recipient would receive, seal the reviewed package, and explicitly choose how to use it.

The first product outcome is a trusted focused handoff. The feature serves developers who coordinate live Kitten sessions on complex work and need to preserve task intent, relevant source material, relationships, and important uncertainty without granting a context-building child authority to implement or deliver work on its own.

Context Packs differentiate Kitten from ordinary file attachment and agent reports by preserving operator custody: a pack is visible, reviewable, freshness-aware, recipient-aware, and never sent automatically. The complete V1 outcome includes durable reuse, eligible recipients, Send Here, Start Child, handoff attachment, and operator-confirmed Markdown export. It launches first as a verified-provider pilot and expands only after demonstrated trust.

## Goals

- Enable an eligible cockpit developer to prepare and explicitly deliver a high-signal context package for a complex handoff without manual source rediscovery.
- Make trusted completion the leading product outcome: operators can review and seal useful packs with no unexpected delivery or integrity surprise.
- Make the scope, freshness, budget status, and recipient eligibility of every pack understandable before an operator commits it.
- Reduce median operator context-preparation time by at least 50% in moderated complex-task trials compared with the current manual process.
- Achieve a build-to-seal completion rate of at least 60% among eligible pilot builds in a 30-day measurement window.
- Preserve Kitten's privacy posture: opt-in measurement records outcomes and counts only, never task content, source material, pack text, or delivery destinations.

## User Stories

### Cockpit developer — focused handoff

- As a cockpit developer, I want to ask an eligible Context Build to assemble relevant task context so that the receiving agent can begin with less rediscovery.
- As a cockpit developer, I want to see why each selected item belongs in a pack so that I can correct a biased or incomplete selection before delivery.
- As a cockpit developer, I want to inspect the exact reviewed payload, its freshness, and its budget status so that sealing is a meaningful decision rather than a label.
- As a cockpit developer, I want delivery to require my explicit confirmation so that no context reaches another agent by surprise.

### Cockpit developer — reuse and control

- As a cockpit developer, I want a sealed pack to remain available after the builder exits so that a useful handoff can survive an interrupted session.
- As a cockpit developer, I want an unavailable, stale, or ineligible destination explained clearly so that I know what needs attention without being offered an unsafe workaround.
- As a cockpit developer, I want to start from an existing sealed pack when refining context for a related task so that I retain useful work while creating a new reviewed version.

### Receiving-workflow operator

- As a cockpit developer coordinating multiple agents, I want to attach a whole sealed pack to a handoff or start an eligible child with it so that the task context remains consistent across my chosen workflow.
- As a cockpit developer, I want a confirmed Markdown export of the reviewed payload so that I can use the exact same context in an operator-controlled external workflow.

## Core Features

### Critical — Context Pack workspace

Each session presents one current Draft Context Pack and one current Sealed Context Pack. A draft captures the operator's task intent, selected task material, a fixed Context Brief, a visible Pack Budget, a revision, and a freshness state. Starting fresh is explicit. Refining a sealed pack begins a new draft and never silently changes the older sealed version.

### Critical — Explicit Context Build

The operator can choose **Build Context** from the Context Pack surface or File Explorer only when the current session is eligible. The build is visibly separate from ordinary Explore: it curates context, then stops at a review-ready draft. It does not start planning, implementation, handoff, delivery, or export on the operator's behalf.

### Critical — Curated material and Context Brief

The operator can review a draft that combines complete files, clearly described file slices, and relevant current diffs. Each non-full selection explains its relevance and relationship to the task. The Context Brief consistently presents Architecture, Selected Context, Relationships, Ambiguities, and Budget Omissions so that a recipient receives observed context and uncertainty rather than a hidden implementation plan.

### Critical — Exact review and sealing

**Review Context Pack** presents the exact candidate package with its instructions, brief, selected material, rationales, full/slice/diff modes, redactions, serialized size, Pack Estimate, budget pressure, and freshness. The operator can revise the draft or seal it. A stale, missing, ineligible, oversized, or over-budget selection blocks sealing and explains the required next action. Sealing creates an immutable, redacted version that remains inspectable.

### Critical — Explicit focused handoff

For an eligible pilot workflow, the operator can explicitly choose **Send Here** after reviewing a sealed pack. Delivery rechecks recipient eligibility at the decision point, never silently trims or substitutes the reviewed material, and retains the existing preview-and-confirm expectation. The operator sees a clear blocked state when delivery cannot proceed.

### High — Durable reuse and freshness awareness

The product retains the current Draft Manifest and reviewed Sealed Pack across restarts. A restored draft requires fresh review before sealing; a restored sealed pack remains inspectable but must pass a new recipient check before use. Source changes mark affected material stale and direct the operator to refresh or reselect rather than silently rewriting the pack.

### High — Recipient choices and fit visibility

After sealing, the operator can choose among eligible destinations: Send Here, Start Child, or Attach to Hand-off. The product explains which choices are currently available, why a choice is blocked, and whether the recipient can accept the full reviewed package. It never treats a generic Pack Estimate as a promise that every recipient can use it.

### High — Handoff attachment and Markdown export

An operator can attach at most one sealed pack to a handoff and review the combined context once before confirmation. The product retains the sealed pack as a whole rather than exposing its content as an untracked editable attachment. Markdown export is an operator-confirmed copy of the exact sealed payload with compact provenance; it never auto-exports or overwrites a previous export without confirmation.

### Medium — Discoverability and attention

`/context` opens the current session's Context Pack surface. File Explorer displays pack membership and quick add/remove actions. A completed background build marks its owning session as needing attention but never steals focus or automatically opens review. All status states remain usable by keyboard and understandable without relying on color alone.

### Medium — Content-free product measurement

When telemetry is enabled, Context Packs reports only fixed outcome categories and counts such as started, review-ready, sealed, stale, blocked, and delivered. The feature must not record task text, file paths, item content, model output, recipient names, provider details, or free-form errors.

## User Experience

### Primary journey: create a focused handoff

1. The developer opens `/context` for the active task session and sees the current Draft or Sealed Pack state, eligibility, budget, freshness, and available next actions.
2. The developer starts a new draft or refines an existing sealed pack, chooses **Build Context**, and keeps working while the session is marked as building.
3. When the build finishes, Kitten marks that session as needing attention without changing focus or opening a modal.
4. The developer opens review, inspects the Context Brief and every selected item, removes or adds material as needed, and sees clear warnings for stale, oversized, or over-budget items.
5. The developer seals the exact reviewed payload only when all blocking conditions are clear.
6. The developer chooses an available recipient action, reviews any combined handoff context when relevant, and explicitly confirms delivery or export.
7. If any source or recipient status changed, Kitten preserves the pack for inspection, blocks the consequential action, and guides the developer to refresh, refine, or choose another eligible destination.

### Interaction principles

- Keep the session conversation-first; Context Packs are a focused surface, not a new global workflow.
- Use plain status language such as **Ready for review**, **Stale — refresh required**, **Over budget**, and **Recipient unavailable**.
- Show why material was selected and what important context was omitted so the operator can make an informed trade-off.
- Make review, sealing, delivery, attachment, and export distinct confirmations; no single shortcut may bypass them.
- Preserve keyboard operation, visible focus, readable labels, and non-color state indicators across the build, review, blocked, and confirmation states.

## High-Level Technical Constraints

- Context Packs extend the existing session and handoff experience; they must not replace its explicit preview and confirmation boundary.
- Ordinary Explore remains report-only. Context Build is available only when Kitten can verify the product's stated eligibility and scope restrictions for that session.
- A pack is provider-neutral during curation, while every recipient decision uses current recipient-specific eligibility rather than assuming a generic estimate is sufficient.
- The reviewed sealed payload is redacted before it is displayed, retained, exported, or delivered. The product never retains raw source material merely to make a pack reusable.
- Source material must remain inside the session workspace, and source changes must be visible to the operator before a pack can be sealed or used.
- Telemetry remains opt-in, local, and content-free. The product must retain no live builder authority after a session restart.

## Non-Goals (Out of Scope)

- **Codemaps, syntax caches, selection graphs, and automatic dependency selection** — The V1 job is deliberate high-signal curation, not a repository-intelligence platform.
- **Automatic source rebasing or background freshness repair** — A reviewed pack must not silently change after the operator sees it.
- **Multiple concurrent builds, named pack history, or workspace-wide pack libraries** — One draft and one current sealed pack per session keep the first product understandable.
- **Custom Context Brief schemas or context-builder meta-prompts** — The fixed brief keeps review predictable and keeps the build focused on observed context.
- **Automatic planning, review, questioning, implementation, handoff, sending, or export** — Context Build prepares a review-ready draft; the operator owns each consequential next step.
- **Agent authority to seal, consume, export, approve, or deliver a pack** — These are human decisions.
- **General repository control, external service access, or cross-session control for Context Build** — The feature must not expand the builder beyond its stated curated-context job.
- **Warning-only recipient overrides or public machine-readable exports** — When a recipient is not eligible, the product blocks rather than offering a best-effort bypass.

## Phased Rollout Plan

### MVP (Phase 1) — Trusted focused handoff pilot

- Offer `/context`, explicit Context Build, curated draft review, fixed Context Brief, visible budget and freshness state, sealing, and an explicit Send Here journey to eligible pilot users.
- Preserve clear unavailable states for sessions that do not meet pilot eligibility; do not surface a misleading degraded version.
- Record opt-in content-free pilot outcomes and collect moderated feedback on review clarity, preparation time, and receiving-agent readiness.

**Success criteria to proceed to Phase 2:** At least 60% of eligible started builds reach sealing over 30 days; no unconfirmed delivery or integrity incident is accepted; pilot operators can identify pack freshness and delivery status in moderated usability checks; and median preparation time trends toward a 50% reduction.

### Phase 2 — Durable reuse and cross-session handoff

- Retain Draft and Sealed Packs across restarts with clear restored, fresh, and stale states.
- Add recipient-fit visibility for existing eligible sessions and allow an operator to attach one sealed pack to the existing handoff journey.
- Expand the pilot only to users who can receive the same review-first, eligibility-aware experience.

**Success criteria to proceed to Phase 3:** Restored packs retain operator trust in usability sessions; all attempted deliveries show a current eligibility verdict; no blocked delivery can bypass confirmation; and pilot feedback demonstrates that reusable packs solve a real repeated-handoff problem rather than a one-time attachment need.

### Phase 3 — Complete V1 recipient and export choices

- Add explicit Start Child for eligible recipients and operator-confirmed Markdown export.
- Complete the full V1 recipient choice: Send Here, Start Child, Attach to Hand-off, and Export Markdown.
- Keep every path behind the same visible review, freshness, and recipient-eligibility expectations.

**Long-term success criteria:** The complete V1 meets all success metrics below, operators can choose the appropriate eligible recipient without confusion, and later workspace libraries or automated selection remain separate product proposals rather than implicit scope expansion.

## Success Metrics

| Metric | Target | Measurement |
|---|---:|---|
| Eligible build-to-seal completion | ≥60% in a 30-day pilot | Opt-in, content-free counts of eligible builds started, review-ready, sealed, stale, over-budget, and blocked. |
| Trusted delivery | 100% explicitly confirmed | Product-flow and usability evidence show no pack reaches a recipient without an operator-visible confirmation. |
| Integrity and scope surprises | 0 accepted incidents | Track verified reports of unexpected source changes, unexpected delivery, or retained unreviewed material. |
| Operator preparation time | ≥50% median reduction | Compare timed manual preparation with Context Build plus review on representative complex tasks. |
| Recipient eligibility clarity | ≥90% comprehension in moderated checks | Participants correctly identify whether a recipient is ready, unavailable, or needs a fresh review within 10 seconds. |
| Privacy posture | 0 content-bearing telemetry or retention violations | Schema review and audit of opt-in product records against the documented allowlist. |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Pilot availability is too limited for useful feedback | Recruit design-partner operators with eligible session configurations and publish clear availability criteria. |
| Operators perceive review as extra ceremony | Keep the first flow focused on high-signal material, show rationale and budget pressure, and measure time saved alongside trust. |
| Users treat a sealed pack as permanently current | Show freshness status at review and every recipient decision; require explicit refresh or refinement after source drift. |
| A receiving agent still needs more context | Present Budget Omissions and Ambiguities clearly so the operator understands the pack is a focused starting point, not the entire repository. |
| Broad recipient choices create confusion | Phase choices gradually and use plain availability explanations rather than hidden or disabled-looking controls. |
| Context material contains unsafe instructions or sensitive information | Apply least-context-by-default, visible scope and redaction indicators, and explicit confirmation before any delivery or export. |
| The full V1 expands beyond the focused-handoff job | Treat libraries, automated selection, codemaps, and shared collaboration as separate future proposals. |

## Architecture Decision Records

- [ADR-001: Plan the full Context Packs contract with evidence-gated vertical delivery](adrs/adr-001.md) — Preserve the full product destination while activating each capability only after its trust requirements are satisfied.
- [ADR-002: Launch Context Packs as a verified-provider pilot for trusted focused handoffs](adrs/adr-002.md) — Start with an eligibility-aware pilot whose leading success signal is trusted completion.

## Open Questions

- Which eligible pilot configurations will provide a sufficiently diverse design-partner cohort without weakening the product promise?
- What representative complex tasks should define the moderated baseline for operator context-preparation time?
- What wording best distinguishes a sealed pack that is inspectable from one that is currently eligible for a chosen recipient?
- How should the product explain a blocked recipient choice to minimize support burden while avoiding unsafe workarounds?
- What evidence should be required before Phase 2 expands from focused Send Here to durable cross-session handoff for more operators?
