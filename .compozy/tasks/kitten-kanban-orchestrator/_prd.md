# Product Requirements Document: Local-first governed Workflow Board

## Overview

Kitten Orchestrator is a macOS-first, local-first Workflow Board for individual developers who want coding-agent work to progress through a visible, governed process. A board is bound to one trusted repository. Users create and arrange Workflow Stages, assign a default local Workflow Skill after each stage is created, create cards, and follow each card's work from launch through human review.

The product's primary V1 value is active supervision. Every card exposes its conversation, attempt history, and prompt composer at every workflow stage. When an agent needs a user decision, the board makes that blocker impossible to miss: it highlights the card, sends a desktop notification, and requires a recorded answer before the agent can continue. Users gain the confidence to let work progress without losing context, control, or review authority.

## Goals

- Let a user configure a clear, editable linear workflow that supplies the right local Workflow Skill at each stage.
- Let a user supervise any active or past card without reconstructing its context from separate tools.
- Ensure every agent Attention Blocker is visible, actionable, and recorded before execution resumes.
- Preserve an explicit human review boundary: no automated publishing, pull-request creation, merge, deployment, or final completion.
- Validate the MVP through local, content-free indicators: at least 90% of stages configured with a valid default Skill before first run, 100% of terminal attempts retaining a complete history, and zero accepted missed-blocker scenarios in the supervision acceptance suite.

## User Stories

### Individual Developer

- As an individual developer, I want to create a board for one trusted repository so that my agent work has a clear local operating context.
- As an individual developer, I want to add a stage and then assign its default Workflow Skill so that a card uses the right process without me re-explaining it every time.
- As an individual developer, I want to drag stages and connect them with arrows into a single visible path so that my workflow matches how I actually take work from backlog to review.
- As an individual developer, I want to open a card at any stage and see its live conversation, prior attempts, and outcomes so that I can understand its exact state quickly.

### Supervising Developer

- As a supervising developer, I want an agent question to highlight the card and notify my desktop so that blocked work does not disappear in a queue.
- As a supervising developer, I want the required question to be clearly prioritized while my card history and composer remain visible so that I can answer safely without losing context.
- As a supervising developer, I want to send a follow-up from the same card after the blocker is settled or the attempt is complete so that I can continue work without starting an unrelated conversation.

### Reviewing Developer

- As a reviewing developer, I want final-stage success to stop at Ready for Review with the complete work history available so that I retain authority over whether the work is completed or published.

## Core Features

### Critical: Blank Board, Trusted Repository, and Linear Workflow Canvas

The first launch presents a blank Workflow Board. The user binds it to one trusted repository, then creates stages on a canvas. The user may drag stage columns and connect each stage to an immediate successor with visible arrows. The canvas validates one ordered path: one start, one end, and no branching, joining, or cycles.

The product offers `Backlog → To-do → Refinement → Ready → Doing → Finished → Closed` as an editable starter template. It never silently imposes that sequence on an existing board.

### Critical: Default Workflow Skill After Stage Creation

Creating a stage immediately presents the local Skill Catalog and asks the user to select its default Workflow Skill. A new stage remains visibly unconfigured and cannot start work until its default Skill is valid. A card may declare an optional Skill override; otherwise, starting a new attempt uses the stage's current default.

### Critical: Card Setup and Runnable Work

Users create cards with a title, description, Workflow Stage, provider, model, effort, optional Skill override, and a runnable choice. The board clearly explains whether a card is ready to start and what needs attention when it is not. A Workflow Stage remains separate from the card's system-managed Execution Status.

### Critical: Persistent Card Inspector and Composer

Selecting a card opens a persistent inspector with its chronological Orchestrated Work History. The newest Run Transcript is expanded and shows its Run Context, conversation, activity, user questions, operator messages, and outcome. The composer remains visible for every selected-card state.

When no attempt is active, a composer submission starts a fresh attempt in the card's current stage. During an active attempt, an ordinary follow-up is visibly queued as the next message; it must never silently interrupt, cancel, fork, or duplicate work. After an attempt ends, the composer remains available for a new follow-up attempt.

### Critical: Attention Blockers and Desktop Notification

When an agent asks a scoped question, the card enters `needs_attention`, keeps its workflow stage, is highlighted on the board, and triggers a desktop notification. The required answer receives primary focus. The user may inspect all context and keep the composer visible, but ordinary follow-up submission waits until the blocker reaches a submitted, skipped, timed-out, or cancelled outcome. The same attempt receives that outcome and only then may continue.

### High: Governed Progression and Human Review

Users may manually move settled cards through the valid workflow path. While a card is running or needs attention, it is stage-locked. A successful attempt advances a card exactly one stage; failed, cancelled, and attention-blocked attempts do not advance it. Final-stage success enters `ready_for_review`. The user explicitly reviews and marks the card complete; the product never publishes or completes work automatically.

### High: Local Settings and Bounded Execution

Settings let users manage theme preference, Agent Profile readiness and defaults for new cards, local Skill Catalog visibility, and the global automatic-execution limit. A fresh installation starts with one automatically active card across all boards. Changing defaults affects future cards only and never rewrites an existing card or its history.

## User Experience

1. A developer opens Kitten Orchestrator and sees a blank board.
2. The developer binds the board to one trusted repository, creates stages on the canvas, connects them into a single path, and assigns each stage's default Workflow Skill. They may begin with the editable conventional starter path.
3. The developer creates a card, confirms its selected workflow, and starts it when it is runnable.
4. The card inspector immediately shows the active conversation, complete attempt context, and a persistent composer. The card's Workflow Stage and Execution Status remain visually distinct.
5. If the agent needs input, the card becomes visually prominent, the desktop sends a notification, and the inspector foregrounds the structured question. The developer answers it first; the answer outcome is added to the same history before work resumes.
6. The developer can return to the card at any point, read the chronological history, and send an idle follow-up or queue an active-run follow-up with a clear delivery state.
7. Successful work progresses exactly one stage. Final-stage success reaches Ready for Review, where the developer reviews the complete history and explicitly completes the card if satisfied.

Every attention state must have a text label and keyboard-accessible route in addition to visual highlighting. Notifications must name the card and the required action without exposing unnecessary task content outside the trusted local experience.

## High-Level Technical Constraints

- The desktop product is macOS-first and local-first; board history and agent-work context remain under the user's local control.
- A board is bound to exactly one trusted repository, and a card's work remains attributable to that repository.
- V1 starts work only through certified Direct ACP profiles; other execution routes are deferred.
- Workflow Skills must resolve from the configured local Skill Catalog, never from a free-text agent instruction name.
- Each attempt must present a stable, reviewable Run Context and retain an append-only Run Transcript.
- The global automatic-execution limit defaults to one active card; all automatic behavior remains review-governed.
- Accessibility and privacy are product requirements: attention states must be keyboard reachable, and usage measurement must remain opt-in and content-free.

## Non-Goals (Out of Scope)

- Branching, joining, cyclic, or conditional workflow graphs.
- Universal real-time message injection into an active agent turn.
- Execution through Compozy or other non-Direct-ACP routes.
- Cloud sync, shared team boards, collaboration permissions, or a general board API.
- Automatic push, pull-request creation, merge, deployment, or final completion.
- Free-text Workflow Skill names, automatic agent Skill selection, or unvalidated Skills.
- Recovering a live agent session after a desktop restart as though it never stopped.
- A first-launch predecessor-data import flow; the first V1 experience begins with a blank board.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver the blank local board, trusted-repository binding, editable single-path canvas, stage-default local Skills, cards, Direct ACP attempts, bounded automatic execution, persistent inspector/composer, Attention Blocker notification, and Ready for Review boundary.
- Proceed when representative users can configure a stage Skill, supervise a running card, notice and resolve every injected blocker, and reach Ready for Review without an automatic publication action.

### Phase 2

- Add provider-certified active-turn steering where its user contract can be stated and observed clearly.
- Add richer Skill Catalog discovery and board templates based on observed stage-configuration patterns.
- Proceed when queued composer use, blocker resolution, and stage reconfiguration show sustained repeat usage without missed-attention or workflow-confusion signals.

### Phase 3

- Evaluate non-linear workflow routing, optional predecessor import, and additional local collaboration or cross-app workflows only when research shows they improve the governed task-to-review outcome.
- Do not expand beyond the human review boundary without separately validated user trust and safety evidence.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Configured-stage activation | At least 90% | Created stages that receive a valid local default Skill before their first run. |
| Attention visibility | 100% | Injected scoped agent questions produce a highlighted card, desktop notification, and accessible action path. |
| Blocker outcome record | 100% | Attention Blockers retain one submitted, skipped, timed-out, or cancelled outcome in the same attempt history. |
| Persistent supervision | 100% | Selected cards retain a visible history and composer in every lifecycle state. |
| Review boundary | 0 automatic actions | No automatic push, pull request, merge, deployment, or final completion. |
| Attempt-to-review conversion | At least 50% | Runnable cards reaching Ready for Review within 14 days in an opt-in early-user cohort. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users ignore repeated desktop notifications | Use one clear attention state per card, concise action-focused notification copy, and a board highlight with an accessible route back to the card. |
| Users confuse a workflow stage with an execution status | Label and present the two concepts separately throughout the board and inspector. |
| Users feel blocked by a required agent question | Show the full context, explain why the answer is required, and return control to the same visible attempt when it is resolved. |
| Users expect an arbitrary workflow graph from the canvas metaphor | Make the single-path rule and its benefits clear during setup; defer richer routing until it solves verified user demand. |
| Competitors normalize generic agent boards | Emphasize local control, complete attempt history, validated stage Skills, and human-owned review rather than undifferentiated automation. |
| Local privacy expectations are violated by measurement | Keep measurement opt-in, content-free, and visibly described in settings. |

## Architecture Decision Records

- [ADR-001: Constrain V1 to a linear governed workflow with queued active-run input](adrs/adr-001.md) — establishes the editable single-path canvas, governed progression, and safe active-run composer contract.
- [ADR-002: Make Attention Blockers the V1 supervision priority](adrs/adr-002.md) — prioritizes highlighted, notified, answer-first agent questions with a recorded outcome.

## Open Questions

- Which starter Workflow Skills should be suggested for the conventional seven-stage template?
- Which user-facing signal should distinguish an agent question that timed out from one the user intentionally skipped?
- When should a later optional predecessor import become discoverable after the blank-board first launch?
- Which providers should be the first candidates for a separately certified active-turn steering experience?
