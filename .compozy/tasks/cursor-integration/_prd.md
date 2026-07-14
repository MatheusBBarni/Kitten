# Cursor Integration

## Overview

Cursor integration makes Cursor a dependable third live agent in Kitten, beside Claude Code and Codex. It serves developers who already use Cursor and want one local cockpit for selecting, monitoring, and handing work among their coding agents.

The product removes the manual context reconstruction required when Cursor lives outside Kitten. It preserves Kitten's defining safety boundary: a handoff is redacted, shown to the developer, curated, and explicitly confirmed before another agent receives it.

## Goals

- Make Cursor available by default as an equal third session on a zero-configuration launch.
- Keep Claude Code and Codex fully usable if Cursor is missing, unauthenticated, or incompatible.
- Let developers select Cursor in the same session and handoff workflows they already use.
- Preserve human control and content privacy in every Cursor-directed transfer.
- Prove dependable Cursor availability before judging the feature on adoption or handoff volume.

## User Stories

### Existing Cursor user

- As a developer who uses Cursor, I want it to appear beside Claude Code and Codex when I launch Kitten so that I can work from one cockpit.
- As a developer with several active agents, I want to select Cursor like any other live session so that I can follow the work that needs me.
- As a developer moving a task, I want to choose Cursor as a handoff target and review the context before sending it so that I keep control of what it receives.

### Developer resolving setup

- As a developer whose Cursor session is unavailable, I want a clear explanation and recovery action so that I can fix Cursor without losing access to ready agents.
- As a developer without Cursor installed, I want Kitten to remain useful immediately so that trying the new integration does not interrupt my work.

### Safety-conscious developer

- As a developer who works with sensitive repositories, I want Cursor handoffs to use the same redaction, preview, curation, and confirmation safeguards as every other handoff so that adding an agent does not weaken my control.

## Core Features

### F1. Default third live session

Kitten includes Cursor beside Claude Code and Codex on a zero-configuration launch. A ready Cursor session is a peer: it is selectable, visible in normal status and navigation surfaces, and remains live while the developer works elsewhere.

### F2. Independent availability and recovery

Kitten reports Cursor's own availability state and gives an actionable recovery message for a missing installation, sign-in need, or compatibility problem. Cursor's status never prevents ready sibling sessions from opening or accepting work.

### F3. Consistent session experience

Developers can focus, inspect status, and switch to Cursor through the same keyboard-first flows used for the other agents. Cursor should never feel like an external or second-class integration once it is ready.

### F4. Reviewed Cursor handoffs

Developers can choose Cursor as the recipient of a handoff, or hand work back from Cursor to another ready session. Every transfer retains the current target choice, redacted preview, curation controls, and explicit confirmation; nothing is sent automatically.

### F5. Honest capability boundary

The product does not advertise Cursor-specific interactions until they are proven dependable. When a capability is unavailable, the user receives a clear boundary rather than an implied or unreliable feature.

### F6. Cursor-aware onboarding and documentation

First-run guidance and product documentation describe Cursor as a third local session, its readiness behavior, and the reviewed handoff flow. They distinguish the local session experience from Cursor's separate cloud or background products.

## User Experience

1. A developer starts Kitten with no configuration. Claude Code, Codex, and Cursor each show an independent availability state.
2. When Cursor is ready, it appears as an equal live session. The developer can move to it with the normal session controls and see its activity alongside the other agents.
3. When Cursor is not ready, Kitten identifies the Cursor-specific issue and a clear recovery action. The developer can continue working with the ready sessions without dismissing or repairing Cursor first.
4. When handing work off from any session, the developer chooses the recipient if more than one is ready. Choosing Cursor opens the same redacted preview used for every other target.
5. The developer edits or removes context as needed, then explicitly confirms the handoff. Cancelling leaves focus and all agent sessions unchanged.

The experience remains keyboard-first, legible in a terminal, and explicit about unavailable status. Status and recovery language must be understandable without exposing credentials, prompts, code, or private repository content.

## High-Level Technical Constraints

- Cursor is a local agent session; cloud and background-agent products are outside this release.
- Cursor availability must be evaluated independently from the other two agents.
- Every handoff must retain the existing human review, redaction, curation, and explicit-confirmation boundary.
- Telemetry remains opt-in, local, and content-free; it must not collect prompt, source-code, credential, or repository-content data.
- The product supports only a documented, certified Cursor experience and must communicate incompatibility honestly.

## Non-Goals (Out of Scope)

- **Generic provider marketplace or arbitrary custom-agent setup** - V1 delivers a dependable Cursor experience, not a platform for every agent.
- **Cursor cloud or background agents** - Remote execution, asynchronous task management, and cloud repository workflows require a separate product decision.
- **Automatic routing, fan-out, or auto-sending between agents** - Developers remain in control of target selection and confirmation.
- **New Cursor-specific clarification, restoration, or model-management promises** - These wait for proven user value and dependable behavior.
- **Replacing Kitten's existing handoff experience** - The target picker and review flow are extended to Cursor, not redesigned.
- **Measuring user prompt or source-code content** - Product measurement stays content-free and opt-in.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver F1 through F6: a default local Cursor session, independent availability guidance, equal session interaction, reviewed handoffs, honest capability boundaries, and updated onboarding/documentation.
- **Success criteria to proceed:** Cursor is available in at least 95% of certified eligible launches, and 100% of Cursor-directed handoffs show the review-and-confirm step before send.

### Phase 2

- Add user-requested Cursor parity improvements only after they are proven dependable and useful.
- Improve first-run recovery guidance using opt-in, content-free availability data.
- **Success criteria to proceed:** At least 25% of opt-in multi-agent runs include Cursor within 60 days, without a regression in availability or safe-handoff compliance.

### Phase 3

- Consider a broader, provider-neutral expansion only when several first-class integrations demonstrate sustained demand.
- Consider developer-directed routing assistance without removing explicit target selection or confirmation.
- **Long-term success criteria:** Kitten maintains reliable multi-agent usage across supported providers while developers continue to use reviewed handoffs rather than duplicating context manually.

## Success Metrics

| Metric | Target | Perspective |
| --- | --- | --- |
| Certified eligible Cursor availability | >=95% of launches | Primary V1 reliability outcome |
| Safe Cursor handoffs | 100% show review before send | Product safety invariant |
| Sibling-session continuity | 100% of observed Cursor availability failures leave ready siblings usable | Degraded-experience quality |
| Cursor inclusion | >=25% of opt-in multi-agent runs within 60 days | Adoption signal after reliability |
| Repeat cross-agent workflow | >=20% of first-time Cursor-handoff users make another reviewed handoff within 7 days | Evidence that the workflow saves manual context reconstruction |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Cursor changes its local experience or availability expectations | Support a documented certified experience, show clear status, and avoid promises beyond verified behavior. |
| Users without Cursor perceive the third session as clutter | Keep status concise, make recovery actionable, and ensure ready sessions remain immediately usable. |
| Three active agents increase attention or local-resource load | Preserve focused-session navigation and make degraded or inactive state unmistakable. |
| Users over-trust AI-transferred context | Retain redaction, editable preview, and explicit confirmation for every handoff. |
| Adoption is low despite reliable availability | Use opt-in, content-free signals and direct user feedback before widening scope. |

## Architecture Decision Records

- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) - Cursor is a first-class, certified local session with reviewed handoffs.
- [ADR-002: Launch Cursor by Default as an Independently Available Third Session](adrs/adr-002.md) - Zero-config launches include Cursor, and its availability never blocks ready siblings.

## Open Questions

- Which exact user-facing recovery wording produces the clearest first-run path for developers without Cursor?
- After initial reliability is established, which Cursor parity improvement has the highest user demand?
- Should a future provider-neutral expansion remain limited to explicit first-class integrations or introduce user-managed custom profiles?
