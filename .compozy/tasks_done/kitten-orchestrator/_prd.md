## Overview

Kitten will grow into a two-application product: Cockpit for live,
developer-led agent sessions and Orchestrator for governed unattended coding
work. The first release serves existing Cockpit users. It preserves their
current install, launch, configuration, and reviewed-handoff experience while
establishing the baseline required for later Orchestrator delivery.

Phase 1 is intentionally invisible to users. It does not introduce a desktop
workflow, a continuity preview, or new product-family messaging. Its value is a
trusted promise: an existing Cockpit user can continue working exactly as
before, with the same control over agent handoffs and the same dependable
release experience.

## Goals

- Preserve the complete existing Cockpit experience for current individual
  developers without undocumented behavioral change.
- Make the Phase-1 release credible through the full automated Cockpit contract
  matrix before any later product phase begins.
- Establish a clear, user-trust-first foundation for governed unattended work
  without implying that the future Orchestrator is already available.
- Keep future Cockpit and Orchestrator experiences independently understandable,
  releasable, and accountable to their own users.

## User Stories

### Existing Cockpit Developer

- As an existing Cockpit user, I want my usual install and launch experience to
  remain familiar so that a product transition does not interrupt my work.
- As an existing Cockpit user, I want my saved configuration to keep the same
  meaning so that I do not need to rediscover or reconfigure my agent workflow.
- As an existing Cockpit user, I want reviewed handoffs to remain explicit and
  redacted so that I retain control over what another agent receives.
- As an existing Cockpit user, I want failed readiness or configuration to stay
  clear and actionable so that I can recover without guessing what changed.

### Release Maintainer

- As a release maintainer, I want objective evidence that the published
  Cockpit experience still works so that I do not trade user trust for internal
  product progress.
- As a release maintainer, I want to communicate only what users can actually
  use so that Phase 1 does not create false expectations about Orchestrator.

### Future Orchestrator User

- As a future user of governed unattended work, I want later releases to begin
  from a proven Cockpit baseline so that new autonomy does not weaken the trust
  guarantees I expect.

## Core Features

### Critical: Unchanged Cockpit Experience

Existing users retain the current Cockpit install, command, startup,
configuration, readiness, and live-session workflow. The release must not
introduce a new user journey, change the meaning of existing settings, or alter
the explicit review step in an agent handoff.

### Critical: Evidence-Gated Release Confidence

The release advances only after the complete established automated Cockpit
contract matrix supplies evidence for the published experience. Any inherited
exception is visible and recorded; it is never hidden behind a general claim of
parity.

### High: Accurate Product Expectations

Phase-1 user-facing communication describes Cockpit as it exists today. It
does not advertise a desktop Orchestrator, a Cross-App Handoff, unattended
execution, or a broader product-family experience before users can rely on it.

### High: Preserved Trust Boundaries

The existing Cockpit promise of explicit, reviewed handoff remains intact.
Later unattended-work experiences must continue to stop at human-owned review
and publication decisions, rather than making unchecked autonomy the product
default.

## User Experience

1. An existing user installs or launches Cockpit using their familiar path.
2. Cockpit recognizes the user’s existing configuration and presents the same
   readiness outcomes and recovery guidance.
3. The user starts a live agent session and works in the existing focused
   Cockpit experience.
4. When handing work to another agent, the user sees the familiar reviewed,
   redacted preview and explicitly confirms before anything is sent.
5. The user encounters no new desktop surface, continuity preview, unattended
   task queue, or product-family prompt in Phase 1.

The experience should feel deliberately uneventful. Compatibility, clear
failure messages, keyboard continuity, and the user’s control over handoffs
take precedence over novelty. Any user-facing language must be accurate about
what is available now.

## High-Level Technical Constraints

- Preserve the published Cockpit install and command experience across its
  supported user platforms.
- Preserve strict configuration behavior: valid existing settings continue to
  work, while malformed settings remain clear failures rather than silent
  fallbacks.
- Preserve user control: a handoff stays reviewed and explicitly confirmed;
  a new product phase must not silently transfer or publish user work.
- Preserve privacy and trust boundaries: provider credentials remain provider
  owned, and future product data must not silently cross between experiences.
- Keep product claims tied to fresh evidence; do not present future
  Orchestrator functionality as delivered during Phase 1.

## Non-Goals (Out of Scope)

- A user-facing Kitten Orchestrator desktop application or preview.
- A Cross-App Handoff, shared live session, or automatic continuation between
  Cockpit and another product experience.
- New unattended execution, autonomous child delegation, parallel task
  scheduling, automatic publishing, merge, or deployment behavior.
- A redesign of Cockpit workflows, onboarding, configuration language, or
  handoff interaction.
- User-facing product-family messaging that implies capabilities unavailable in
  this release.
- Retirement, archival, or user migration from the predecessor desktop product.

## Phased Rollout Plan

### MVP (Phase 1): Invisible Cockpit Parity

- Preserve the existing Cockpit user experience and the published release
  promise.
- Release no new Orchestrator or continuity experience.
- Advance only when the full established automated Cockpit contract matrix has
  fresh evidence and every inherited exception is documented.

### Phase 2: Desktop Product Parity

- Introduce Kitten Orchestrator only when it can preserve the predecessor
  product’s trusted onboarding, task review, governed work, and human-owned
  publication experience.
- Make the desktop workflow observable from task intake through review rather
  than presenting unattended work as a black box.
- Advance only after representative users can complete governed work to review
  without losing established trust or recovery behavior.

### Phase 3: Governed Cross-App Value

- Add explicitly reviewed continuity between Cockpit and Orchestrator for users
  who need to move from unattended work to live developer-led assistance.
- Expand certified agent choices only when each retains the same visible
  readiness, boundary, evidence, and review expectations.
- Judge long-term success by reliable task-to-review outcomes, user trust, and
  independently sustainable product releases.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Existing Cockpit contract preservation | 100% of the established automated contract matrix passes, or every inherited exception is explicitly recorded before advancement | Fresh release evidence. |
| Supported release experience | 4 of 4 supported platform artifacts complete the established published-product checks | Release evidence for each supported platform. |
| Published install experience | 5 of 5 published package surfaces remain valid | Published-package and install evidence. |
| Configuration compatibility | 0 undocumented behavior changes across supported configuration precedence scenarios | Compatibility evidence and recorded exceptions. |
| Scope discipline | 0 new user-facing Orchestrator, continuity, or unattended-work entry points in Phase 1 | Release-scope review. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing users lose confidence after an internal product transition | Preserve the current experience and publish only evidence-backed claims. |
| Stakeholders mistake an invisible release for stalled product progress | Treat the parity milestone as an explicit internal unlock with measurable evidence and a clear next-phase decision. |
| Pressure to add a preview expands the release beyond its trust promise | Require a separate product decision and scope record for every new user-facing future-product experience. |
| Competitors create urgency for broader autonomy | Keep the first release narrow, then prioritize governed, observable task-to-review value over feature parity theater. |
| A broad claim of parity masks known limitations | Record inherited exceptions and state their user impact plainly before advancing. |

## Architecture Decision Records

- [ADR-001: Gate the two-app migration on Cockpit workspace parity](adrs/adr-001.md) — establishes Cockpit parity as the formal first migration gate.
- [ADR-002: Make Phase 1 an invisible Cockpit parity release](adrs/adr-002.md) — preserves unchanged Cockpit behavior and excludes all new user-facing future-product experiences.

## Open Questions

- Which predecessor user records and history must be available when the desktop
  product becomes user-ready?
- What representative user outcome will demonstrate that reviewed cross-app
  continuity creates enough value to justify a later phase?
- Which current Cockpit users should participate in the first post-parity
  feedback cycle, and what feedback threshold should pause expansion?
- What public product language should introduce Orchestrator only after its
  user workflow has met the required trust and review evidence?
