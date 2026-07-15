# Product Requirements Document: Harness Delivery for Fresh Conversations

## Overview

Kitten needs a reliable, invisible baseline for every genuinely new agent conversation. The versioned guidance defined in #18 must accompany a fresh or replacement conversation exactly once, while an existing restored conversation must remain a true continuation of its prior context.

This feature serves daily Kitten developers who create new conversations, recover from unavailable history, hand off work, and resume saved runs. Its product promise is simple: normal new and replacement conversations start consistently without extra UI; if Kitten cannot establish that condition, it stops the initial task and helps the user move to a safe fresh conversation. The product must never present host guidance as if the user wrote it.

## Goals

- Give every eligible new or replacement conversation a consistent baseline before its first real task.
- Preserve continuity for restored conversations by never adding new baseline guidance to existing context.
- Keep normal work quiet: successful initialization requires no badge, modal, or recurring status.
- Give users a concise, actionable recovery path when a fresh conversation cannot start safely.
- Preserve user intent and keep all visible conversation artifacts limited to intentional user-visible content.

## User Stories

### Daily developer starting a conversation

- As a developer, I want a new Kitten conversation to begin with reliable host guidance so that I can start work without manually establishing the same expectations every time.
- As a developer, I want the normal start to remain quiet so that I can focus on my task instead of system status.

### Developer continuing prior work

- As a developer, I want a restored conversation to remain a continuation of its existing context so that I do not receive unexpected new guidance midway through work.
- As a developer recovering unavailable history, I want Kitten to clearly distinguish a replacement conversation from a resumed one so that I understand the state of my work.

### Developer handing work to another agent

- As a developer, I want a reviewed handoff to remain the first visible content for its recipient so that the handoff keeps its explicit human-control promise.
- As a developer, I want hidden host guidance excluded from later handoffs so that only relevant work context moves between agents.

### Developer recovering from an unsafe start

- As a developer, I want Kitten to stop an initial task when it cannot establish the baseline and offer a safe fresh conversation so that I do not unknowingly continue under degraded conditions.
- As a developer, I want my original task to remain recoverable during that transition so that safety does not cost me work.

## Core Features

### Critical: Predictable fresh-conversation start

Every eligible new or replacement conversation receives Kitten's approved baseline exactly once before its first real user task. This includes normal starts, fresh recovery after unavailable history, replacement conversations, and handoff-first conversations.

### Critical: Continuity protection

Existing restored conversations continue without new baseline guidance. Kitten clearly preserves the difference between continued context and a genuinely fresh conversation.

### Critical: Safe recovery instead of degraded continuation

If Kitten cannot establish the baseline for a fresh or replacement conversation, it does not send the initial task under uncertain conditions. It explains the state in concise, actionable language and offers a safe fresh-conversation path with the user's task recoverable.

### Critical: Clean visible conversation record

The transcript, prompt history, saved runs, handoff material, and user-facing diagnostics contain only intentional user-visible content. Host guidance remains internal and is never displayed as user-authored text.

### High: Silent successful initialization

Successful baseline initialization adds no routine status indicator. Only recovery-relevant failures produce a notice, and that notice explains the next safe action without exposing the hidden guidance.

### High: Handoff parity

The normal handoff preview and confirmation experience remains intact. A fresh recipient receives its baseline without altering the reviewed handoff content or copying hidden guidance into future handoffs.

## User Experience

1. A developer opens a new Kitten conversation, replaces an unavailable one, or confirms a handoff to a fresh recipient.
2. Kitten establishes the baseline behind the scenes and presents the normal conversation experience without extra status text.
3. The developer sees and manages only their own task, agent responses, and reviewed handoff content.
4. When the developer resumes an existing conversation, Kitten continues its known context without adding a new baseline or showing a routine state notice.
5. If a new or replacement conversation cannot start safely, Kitten does not send the task. It presents a short accessible notice that names the recovery state, preserves the task, and offers a safe fresh conversation.
6. After recovery, the developer resumes work through the normal quiet experience.

The failure notice must work with keyboard-only interaction, avoid jargon, and make the safe next action unambiguous. It must never reveal hidden guidance, provider internals, or private task content.

## High-Level Technical Constraints

- The feature depends on the approved, versioned base guidance contract from #18.
- New, replacement, and continued conversations must retain distinct user-facing meaning.
- Handoff preview and confirmation remain the required human-control point for moving visible work between agents.
- No hidden guidance or private task content may appear in visible conversation records, saved runs, handoffs, or diagnostics.
- Eligibility may expand only when Kitten can uphold the same fresh-conversation and recovery promise for the user.

## Non-Goals (Out of Scope)

- Writing or editing the baseline guidance itself; #18 owns its wording and version policy.
- Selecting capability-specific guidance; #20 owns that product area.
- Showing a success badge for every conversation or prompt.
- Continuing an initial task with a warning when the fresh-conversation baseline is unavailable.
- Exposing a user editor for hidden host guidance.
- Treating host guidance as authorization or a substitute for Kitten's existing user controls.
- Copying hidden guidance into handoff previews, history, saved runs, or diagnostics.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver the selected user promise for eligible new, replacement, recovered, and handoff-first conversations.
- Preserve continuity for restored conversations without routine status noise.
- Stop unsafe initial tasks, retain user intent, and route users to a safe fresh conversation.
- Keep all visible conversation artifacts clean of hidden guidance.

Success criteria to proceed to Phase 2:

- All defined user journeys meet the fresh-versus-continuation promise.
- No duplicate or hidden host content appears in user-visible artifacts.
- Every unsafe-start state presents a safe, understandable recovery action.

### Phase 2

- Expand eligibility to additional supported agent environments only after validating the same user promise.
- Refine recovery copy and discoverability from observed user feedback.
- Establish content-free product health reporting for the feature.

Success criteria to proceed to Phase 3:

- At least 95% of eligible fresh and replacement conversations proceed without requiring recovery during the monitored rollout.
- Recovery feedback shows that users understand the next safe action.

### Phase 3

- Evaluate optional, user-requested visibility controls only if evidence shows the silent default leaves users uncertain.
- Consider an adapter-compatibility assurance experience for maintainers without exposing hidden guidance to daily users.

Long-term success criteria:

- The feature remains a trusted, low-noise baseline across supported agent environments.
- User feedback confirms that new, replaced, and continued conversations have understandable boundaries.

## Success Metrics

| Metric | Target | Measurement |
| --- | ---: | --- |
| Eligible fresh and replacement conversations that proceed normally | >= 95% during monitored rollout | Content-free lifecycle outcome reporting |
| Visible artifacts containing hidden guidance | 0 | Release-readiness review and content-boundary checks |
| Duplicate initial-task incidents attributable to recovery | 0 | Product incident review and user reports |
| Unsafe starts with an actionable safe-conversation route | 100% | Defined user-journey review |
| Users who recover their original task without re-entering it | >= 95% | Content-free recovery completion measurement |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users assume a replacement conversation continues previous work | Clearly distinguish replacement from continuation when recovery is needed and preserve the original task. |
| A safe stop feels disruptive | Keep successful starts silent, make failure notices concise, and route directly to a safe fresh conversation. |
| Hidden guidance reduces user trust if it feels opaque | Never expose it as user text; explain only the user-relevant state and next action. |
| Eligibility differs across agent environments | Expand coverage only after the same fresh-conversation promise can be upheld. |
| The prerequisite contract is delayed or changes | Keep delivery dependent on the reviewed #18 contract and defer unsupported guidance variations. |

## Architecture Decision Records

- [ADR-001: Scope harness delivery by live ACP session generation](adrs/adr-001.md) — Defines the complete lifecycle safety boundary and fail-closed ambiguity handling.
- [ADR-002: Keep baseline guidance silent by default and recovery-oriented on failure](adrs/adr-002.md) — Defines the user-facing normal and recovery experiences.

## Open Questions

- Which agent environments are eligible for the initial monitored rollout?
- What exact failure wording best helps a developer recognize a safe fresh-conversation path without adding routine status noise?
- What evidence threshold should expand eligibility beyond the initial supported environments?
