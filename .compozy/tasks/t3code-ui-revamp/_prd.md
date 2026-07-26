# Product Requirements Document: T3 Code-Inspired Desktop Supervision Loop

## Overview

Kitten's desktop supervision loop helps an individual developer oversee several agent-driven tasks across repositories without maintaining a separate mental ledger. The experience combines a cross-project Work Inbox, the existing Kanban board, a focused card workbench, a conversation-first attempt history, a persistent composer, and trustworthy changed-file review.

T3 Code provides the interaction and visual reference: repository-grouped navigation, compact status-aware rows, one dominant work surface, contextual review, keyboard navigation, and restrained desktop chrome. Kitten retains its own product model. Repositories contain boards, boards contain workflow stages and cards, cards retain immutable attempts, and explicit human review governs completion.

The primary outcome is a shorter, clearer path from detecting work that needs intervention to making a confident review decision. The primary release gate is trust: Kitten must never accept a review decision against stale, incomplete, or ambiguous change evidence.

### Market and Product Context

The 2025 Stack Overflow Developer Survey found that 69% of AI-agent users reported increased productivity, while 46% of developers distrusted AI output accuracy and 66% cited "almost right" results as their largest frustration. Kitten must therefore improve supervision speed without weakening human verification. [Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai)

Agent desktop products are converging on the same operating problem. Claude Code's 2026 redesign emphasizes parallel repository sessions, status filtering, and integrated diffs, while the Codex app presents itself as a command center for moving among agents and reviewing changes without losing context. Kitten differentiates through durable workflow stages, immutable attempts, explicit attention states, and evidence-bound review rather than session management alone. [Claude Code desktop redesign](https://claude.com/blog/claude-code-desktop-redesign) [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)

## Goals

- Reduce the median time from launching Kitten to opening an actionable card to 10 seconds or less.
- Make at least 90% of `needs_attention` and `ready_for_review` cards reachable within two interactions.
- Reduce navigation interactions across the repository-to-review loop by at least 35% compared with the current desktop experience.
- Enable at least 80% of early-user review loops to finish inside Kitten without switching applications.
- Bind 100% of accepted review decisions to trustworthy, current change evidence and accept zero stale review decisions.
- Let users complete at least 95% of the critical supervision path using only the keyboard.
- Preserve a local-first, content-free measurement boundary while validating the new workflow.

## User Stories

### Individual Developer

- As an individual developer, I want to see actionable work across my repositories so that I do not have to open every board to find the next intervention.
- As an individual developer, I want blocked live work to appear before settled work so that agents do not remain idle while waiting for me.
- As an individual developer, I want to open a card without losing my board position so that I can inspect work and resume portfolio supervision without reconstructing context.
- As an individual developer, I want consistent status language across the Work Inbox, board, and card workbench so that I can trust what each surface tells me.

### Supervising Developer

- As a supervising developer, I want the latest attempt to read like a conversation so that agent reasoning and outcomes remain prominent while tool detail stays available on demand.
- As a supervising developer, I want a persistent composer attached to the selected card so that I can steer work without changing contexts.
- As a supervising developer, I want Enter to send my message directly and Shift+Enter to add a newline so that everyday prompting remains fast and predictable.
- As a supervising developer, I want a blocked composer to explain the action required before sending so that I never mistake an unavailable action for a broken interface.

### Reviewing Developer

- As a reviewing developer, I want changed files connected to the attempt that produced them so that I can understand why each change exists.
- As a reviewing developer, I want review actions to remain unavailable when the evidence is stale or incomplete so that I never approve an ambiguous change set.
- As a reviewing developer, I want Approve to complete the existing card only after a trustworthy review so that human authority remains explicit.
- As a reviewing developer, I want Request changes to open an editable draft so that I can explain the correction before anything is sent.
- As a reviewing developer, I want an explicitly sent change request to resume the same card in its current stage with a new attempt so that history and workflow identity remain intact.

### Keyboard and Assistive-Technology User

- As a keyboard user, I want visible commands for finding work, moving between cards, focusing the composer, opening review, and returning to the board so that pointer input is optional.
- As a screen-reader user, I want status changes, unavailable actions, focus movement, and review outcomes announced in text so that visual emphasis is never the only signal.
- As a reduced-motion user, I want the workbench and navigation transitions to preserve orientation without unnecessary animation.

## Core Features

### Critical: Cross-project Work Inbox

The Work Inbox groups boards and cards under their repository context and exposes clear counts for work that is blocked, ready for review, failed, running, or otherwise settled. Search and repository scoping remain immediately available.

The default order is:

1. `needs_attention`
2. `ready_for_review`
3. failed work
4. running work
5. other settled work

Blocked live work appears first because it cannot progress without the developer. The ordering remains stable and predictable; V1 does not infer priority with AI. Users can open any group directly, including Ready for Review, without clearing higher-priority items first.

### Critical: Board-preserving Card Workbench

The Kanban board remains the primary workflow view. Selecting a card opens a stable workbench beside the board on desktop. The workbench contains the card's current status, conversation, prior attempts, composer, changed files, and review actions.

Closing the workbench restores the same repository, board, scroll position, stage context, and card selection. On narrow windows, Kitten presents one focused surface at a time and provides an explicit route back to the preserved board context.

### Critical: Conversation-first Attempt History

The newest attempt opens as a chronological conversation. User messages and agent responses form the primary reading path. Related tool activity is grouped and collapsed by default, while outcomes and changed-file summaries remain visible at the point where they became relevant.

The attempt's fixed context and evidence remain available through progressive disclosure. Older attempts stay immutable, appear in chronological order, and remain collapsed until selected. Users can distinguish the current attempt from historical attempts at a glance.

### Critical: Persistent Card Composer

The composer remains visible while the user navigates between the selected card's conversation and review surfaces. Drafts belong to the card and survive incidental navigation.

Enter sends directly; Shift+Enter inserts a newline. Sending does not require a separate queue-confirmation step. When ordinary input cannot be accepted because the card needs a required answer, lacks an active context, or is otherwise unavailable, the composer displays the blocking reason and the next valid action.

Selecting a review action never sends a message automatically.

### Critical: Trustworthy Changed-file Review

Changed-file summaries attach to the attempt that produced them and open a focused diff experience. The review surface clearly identifies the card, attempt, repository context, and currentness of the evidence.

Approve and Request changes remain disabled unless Kitten can prove that the displayed evidence represents the exact current change set. If the evidence becomes stale or incomplete, the product fails closed, explains why review is unavailable, and offers a clear way to refresh or return to the workbench.

Approve records the explicit human decision and completes the existing card. The product does not publish, push, open a pull request, merge, deploy, or perform another external delivery action.

Request changes opens an editable, prefilled composer draft. The card remains `ready_for_review` while the draft is edited or discarded. After the reviewer explicitly sends the message, the same card returns to active work in its current workflow stage and begins a new attempt.

### High: T3 Code-inspired Visual Language

The touched desktop surfaces use a cohesive, restrained visual system:

- quiet near-black and neutral hierarchy;
- sparse primary accent;
- semantic colors for blocked, review, failure, running, and success states;
- compact application chrome and status rows;
- restrained borders and depth;
- readable proportional text with clear code and path treatment;
- selective emphasis around the composer and current human action.

Kitten does not reproduce T3 Code branding or replace Kanban semantics with thread semantics. Status labels and interaction meaning take precedence over screenshot-level imitation.

### High: Critical-path Commands and Accessibility

Kitten provides context-aware commands for:

- search and repository scope;
- next actionable card;
- next and previous card;
- focus composer;
- open changed-file review;
- close the workbench and return to the board;
- open Settings;
- display available shortcuts.

Commands remain discoverable through visible labels and a consolidated shortcut reference. Text entry keeps precedence inside the composer. Every actionable status has a text label, logical focus order, visible focus treatment, and screen-reader announcement.

### Medium: Integrated Settings Navigation

Settings becomes part of normal application navigation instead of a separate floating mode. Categories use compact label, description, value, and reset patterns. Returning from Settings restores the prior repository, board, selected card, and workbench context.

Existing settings continue to affect only the scope stated by their labels. Changing a default must not imply that existing cards or past attempts were rewritten.

### Medium: Content-free Workflow Measurement

Opt-in local measurement records only bounded workflow outcomes needed to evaluate the PRD:

- time to actionable work;
- number of navigation interactions;
- selected Work Inbox group;
- review availability;
- stale-review rejection;
- review completion;
- change-request draft abandonment or successful dispatch;
- keyboard-only workflow completion.

Measurement never records prompts, responses, card titles, code, diffs, paths, repository names, branch names, model output, tool arguments, or raw errors.

## User Experience

1. The developer opens Kitten and sees repository-grouped work with `needs_attention` first, followed by Ready for Review, failures, running work, and other settled cards.
2. The developer searches or scopes a repository, then opens an actionable card within two interactions.
3. The Kanban remains visible while a desktop workbench opens beside it. The developer retains clear repository, board, stage, and card orientation.
4. The latest attempt appears as a readable conversation. Tool activity and fixed attempt context stay collapsed until needed.
5. The developer resolves a required question or writes direction in the persistent composer. Enter sends directly; Shift+Enter inserts a newline.
6. When the card reaches `ready_for_review`, the developer opens the changed-file summary associated with the relevant attempt.
7. Kitten either presents trustworthy current evidence or explains why review is unavailable. It never offers a warning-only approval path.
8. If satisfied, the developer chooses Approve and completes the card without triggering an external delivery action.
9. If changes are needed, the developer chooses Request changes, edits the prefilled draft, and sends it explicitly. The same card resumes active work in its current stage with a new attempt.
10. The developer returns to the preserved board position or jumps directly to the next actionable card.

### Discoverability

- First use highlights the relationship between Work Inbox groups, board cards, and the card workbench.
- Empty groups explain what qualifies a card for that state.
- Disabled review actions state which evidence is missing or stale and what the user can do next.
- Shortcut labels appear beside their primary actions, with a consolidated shortcut reference available from application chrome.
- The workbench uses progressive disclosure so that trust evidence remains available without overwhelming the conversation.

### Responsive Behavior

- Wide layouts show repository navigation, the Kanban, and the selected-card workbench as a coherent hierarchy.
- Narrow layouts show one focused surface at a time, using explicit back navigation rather than stacking navigation above the board.
- Resizing preserves the selected repository, board, card, attempt, draft, and review context.

## High-Level Technical Constraints

- The product remains macOS-first and local-first.
- Repository, board, card, workflow-stage, attempt, attention, and review identities remain consistent across every surface.
- Each card remains attributable to one trusted repository, and every attempt remains attributable to its card.
- Review decisions require current, reproducible evidence for the exact change set shown to the reviewer.
- Stale or incomplete review evidence must disable state-changing review actions.
- A Request changes draft must not alter workflow state until the reviewer explicitly sends it.
- Prompts, transcripts, code, diffs, paths, repository identities, and raw errors remain outside usage measurement.
- Every critical workflow must support keyboard navigation, visible focus, text labels, and reduced-motion preferences.
- The interface must preserve user orientation and drafts when switching repositories, boards, cards, Settings, and responsive layouts.

## Non-Goals (Out of Scope)

- T3 Code thread or session identity, settle/snooze behavior, or copied lifecycle semantics.
- AI-ranked card priority or automatic interpretation of business urgency.
- User-configurable Work Inbox ordering in V1.
- Terminal, browser, preview, general file explorer, or full source editor.
- Customizable pane grids or user-authored workspace layouts.
- Full rich-composer capabilities such as attachments, images, or plugin-driven editing.
- Inline comments attached to individual diff lines.
- Cloud sync, team workspaces, shared review, or collaboration permissions.
- Automatic push, pull-request creation, merge, deployment, release, or publication.
- Automatic agent messages when the user selects Request changes.
- A separate follow-up card for requested changes.
- Replacing Kitten's Kanban board with a conversation-only interface.

## Phased Rollout Plan

### MVP (Phase 1): Trustworthy Supervision Spine

- Deliver the cross-project Work Inbox with `needs_attention` first and direct access to every state group.
- Deliver the board-preserving card workbench.
- Present the newest attempt as a conversation with progressive disclosure.
- Preserve the persistent composer with direct Enter sending and explicit blocked states.
- Deliver changed-file summaries and trustworthy review evidence.
- Enable Approve and editable Request changes only when the evidence release gate passes.
- Apply the cohesive T3 Code-inspired visual language across every Phase 1 surface.
- Preserve keyboard access and explicit narrow-layout navigation for the complete repository-to-review loop.

Proceed when representative users can find a blocked card, resolve it, inspect a ready-for-review card, review trustworthy evidence, approve or request changes, and return to the preserved board context. Phase 1 must accept zero stale review decisions.

### Phase 2: Navigation and Daily-use Polish

- Integrate Settings into stable application navigation with return-context restoration.
- Expand shortcut discoverability and next-action navigation.
- Refine grouped activity, changed-file summaries, empty states, and status copy using Phase 1 usability evidence.
- Improve responsive transitions and high-density repository scanning.

Proceed when the median time to actionable work is 10 seconds or less, at least 90% of actionable cards are reachable within two interactions, and keyboard-only task completion reaches at least 95%.

### Phase 3: Evidence-led Extensions

- Evaluate user-configurable inbox ordering if repeat users demonstrate materially different supervision priorities.
- Evaluate inline diff comments if editable Request changes drafts do not provide enough precision.
- Evaluate configurable supervision views only if the fixed workflow produces recurring navigation friction.
- Consider additional local review or editor integrations without weakening Kitten's human review boundary.

Proceed only when observed demand shows that an extension improves the repository-to-review outcome without adding a competing workflow model.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Time to actionable work | Median ≤10 seconds | Time from application readiness to opening a `needs_attention` or `ready_for_review` card. |
| Action reachability | At least 90% within two interactions | Interaction count from the Work Inbox to the selected actionable card. |
| Navigation reduction | At least 35% | Comparison of interactions required for identical repository-to-review tasks before and after the revamp. |
| In-app review completion | At least 80% | Early-user review loops completed without switching applications. |
| Review evidence integrity | 100% bound; 0 stale accepted | Accepted review decisions associated with trustworthy current evidence and stale decisions rejected. |
| Request-changes intent | 0 automatic sends | Selecting Request changes never sends a message or changes card state before explicit submission. |
| Keyboard workflow completion | At least 95% | Critical-path usability tasks completed without pointer input. |
| Context restoration | 100% in acceptance scenarios | Repository, board, card, draft, and workbench context preserved across supported navigation and layout changes. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| A large blocked-work group hides cards ready for review | Show clear group counts and keep Ready for Review directly accessible without resolving blocked cards first. |
| Users interpret the familiar T3 Code visual language as copied session semantics | Preserve explicit repository, board, stage, card, and attempt labels throughout the experience. |
| Trustworthy review requirements make review feel unavailable or slow | Explain exactly why an action is unavailable, preserve the user's location, and provide a clear evidence-refresh path. |
| Dense status and review information overwhelms occasional users | Keep the conversation primary and reveal tool activity, fixed context, and detailed evidence progressively. |
| Users expect a full desktop IDE after the visual revamp | Communicate the focused supervision boundary and keep excluded editor, terminal, and browser actions out of the primary chrome. |
| Keyboard shortcuts conflict with composer input | Give text entry clear precedence and show contextual shortcut availability. |
| Request changes feels slower than an immediate action | Prefill a concise editable draft, focus it immediately, and preserve direct Enter submission. |
| Opt-in measurement produces a weak baseline | Combine content-free aggregates with controlled usability tasks using the same representative workflows. |
| Visual polish ships without meaningful workflow improvement | Gate rollout on time-to-action, interaction reduction, in-app review completion, and review-evidence integrity. |

## Architecture Decision Records

- [ADR-001: Adopt a T3 Code-inspired supervision loop without replacing Kitten's workflow model](adrs/adr-001.md) — adopts T3 Code's interaction vocabulary while preserving Kitten's repository, board, card, attempt, and review model.
- [ADR-002: Prioritize blocked work and require evidence-bound review](adrs/adr-002.md) — places `needs_attention` first, makes trustworthy review evidence a release gate, and defines the explicit Request changes lifecycle.

## Open Questions

- Which representative early-user cohort will establish the current navigation and review baseline?
- Which exact T3 Code screenshots and Kitten lifecycle states will form the native visual acceptance matrix?
- What user-facing copy best explains why review evidence is stale or incomplete?
- What default workbench width best balances board awareness with conversation and diff readability?
- Which cards qualify as "failed work" when several terminal outcomes require different user responses?
