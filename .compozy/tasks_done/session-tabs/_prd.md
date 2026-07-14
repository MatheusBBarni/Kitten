# Product Requirements Document: Session Tabs

## Overview

Session Tabs gives Kitten users a single, fast workspace for supervising several live agent conversations without losing task context. Each visible tab represents one conversation; background-running conversations remain reachable through the workspace summary. Users can start a fresh conversation, name it, switch by keyboard or mouse, see background work that needs attention, and control its lifecycle safely.

V1 targets a solo developer coordinating two to four agent conversations. Its primary value is immediate context switching, with explicit safeguards for approvals, errors, finished work, and active conversations. Returning users restore the same tab workspace instead of rebuilding it.

## Goals

- Make switching among two to four live conversations feel immediate, predictable, and accessible.
- Let users identify conversations by meaningful names rather than provider or creation order alone.
- Prevent an ordinary tab-management action from silently cancelling active agent work.
- Keep approvals, errors, and finished work discoverable even when their tabs are not selected or visible.
- Restore the user’s tab workspace across saved-run return flows.
- Validate that session tabs increase repeat multi-conversation use without degrading trust or navigation clarity.

No delivery date is committed in this PRD; progression is governed by the success metrics below.

## User Stories

### Primary persona: solo developer coordinating parallel work

- As a solo developer, I want each active conversation represented by a visible tab or reachable background-work entry so that I can keep multiple tasks in one Kitten run.
- As a solo developer, I want to start a fresh conversation in a new tab so that unrelated work begins with a clean context.
- As a solo developer, I want to rename tabs so that I can recognize each task at a glance.
- As a solo developer, I want to move left or right between tabs with `Ctrl+H` and `Ctrl+L`, or select one with the mouse, so that I can switch context without interrupting my flow.
- As a solo developer whose terminal cannot safely use those chords, I want a clearly documented alternative so that I am never blocked from navigating tabs.
- As a solo developer, I want background-running conversations to surface approvals, errors, finished work, and activity so that urgent work is not hidden.

### Lifecycle and return-flow stories

- As a developer, I want an active-work close action to state the consequence and offer clear choices so that I do not accidentally lose work.
- As a developer, I want to keep an active conversation running in the background, cancel it deliberately, or leave it visible so that tab cleanup reflects my intent.
- As a returning developer, I want a saved run to restore my visible and background-running workspace state, names, order, selected tab, and retained conversation context so that I can resume where I stopped.
- As a developer using a narrow terminal, I want every tab and every urgent state to remain reachable so that space constraints do not hide work.

## Core Features

### P0 — Conversation tab workspace

- Treat every conversation as one of three user-visible lifecycle states: **Visible**, **Background-running**, or **Closed**.
- Show one tab for each **Visible** live agent conversation in the current Kitten run.
- Make the selected tab unambiguous and show only its conversation as the primary workspace.
- Keep every **Background-running** conversation reachable through a background-work summary and include its urgent state in the attention summary.
- Remove a **Closed** conversation from the workspace; it has no continuing live work and is not restored later.
- Allow users to open a fresh conversation tab for a distinct task without copying the prior task’s conversation history.
- Preserve the existing live conversations while the user changes the selected tab.

### P0 — Fast, accessible navigation

- Select a tab by mouse click.
- Move to the previous or next tab with `Ctrl+H` and `Ctrl+L` when the terminal can distinguish those inputs safely.
- Provide a clearly discoverable keyboard fallback when either requested chord would conflict with normal terminal behavior.
- Use deterministic, cyclic adjacent navigation and predictable focus after a tab is removed.
- Ensure all tabs remain reachable when the strip cannot show them all.

### P0 — Attention-safe supervision

- Surface selected, working, awaiting-approval, finished, and error state in the tab workspace.
- Treat **awaiting approval**, **error**, and **finished** as attention-queue states, ranked in that order for direct next-attention routing; treat **working** as a visible activity state, not an attention-queue state.
- Make approval, error, and finished states visible without relying on color alone.
- Provide an aggregate or off-screen indication when a visible or background-running conversation needs attention.
- Offer a deterministic action to move directly to the next conversation in the attention queue.
- Opening a conversation marks its attention as seen, but an approval remains actionable until the user decides and an error or finished status remains visible until the conversation state changes.
- Preserve the originating conversation’s identity when an approval or error asks for action.

### P1 — User-controlled tab identity

- Let users rename each tab at any time.
- Keep names meaningful after a saved run is restored.
- Disambiguate duplicate user-entered names so that users can still choose the intended conversation.
- Do not require automatic naming, task inference, pinning, or grouping in V1.

### P1 — Shared-workspace awareness

- When two or more visible or background-running conversations share the same workspace, show a non-blocking shared-workspace cue in the tab workspace and selected-conversation context.
- Keep the cue informative rather than prohibitive; V1 does not isolate workspaces or prevent parallel work.

### P0 — Explicit active-work close flow

- For an idle tab, let users close it with a stated consequence: it becomes **Closed**, has no continuing live work, and is removed from future restoration.
- For a tab whose agent is working or needs attention, show three explicit choices:
  1. **Keep running in background** — move it to **Background-running**, remove it from the immediate tab strip, and keep its work and attention state reachable.
  2. **Cancel deliberately** — stop the current work only after the user confirms that consequence, then make the conversation **Closed**.
  3. **Keep tab open** — leave the conversation **Visible** and unchanged.
- Never interpret a close action as silent cancellation.
- When the final visible tab becomes background-running or closed, keep Kitten open on an empty workspace with a primary **New conversation** action and any reachable background-work summary; do not exit the run automatically.

### P1 — Restored tab workspace

- Restore visible and background-running conversation state, user names, order, selected tab, and retained conversation context when a user returns to a saved run.
- Do not restore conversations that the user explicitly closed.
- Explain clearly when a previously restored conversation is unavailable and provide a coherent next action.
- Preserve user orientation during restore rather than forcing a generic default view.

## User Experience

### First use

1. A developer starts Kitten and sees the normal live conversations represented as tabs.
2. The selected tab is visibly distinct; each tab carries a concise name and state cue.
3. The developer can discover the navigation chords, mouse selection, fallback, new-tab action, rename action, and attention jump without leaving the workflow.

### Daily parallel-work flow

1. The developer opens a fresh tab for a separate task.
2. They rename it to identify the work.
3. They move among two to four tabs by requested shortcuts, their fallback, or mouse selection.
4. Background state cues reveal when another conversation is working, waiting for approval, finished, or failed.
5. The developer jumps directly to urgent work rather than cycling blindly.

### Active-work close flow

1. The developer attempts to close a working or attention-bearing tab.
2. The product states that work is active and presents the three choices: keep running in background, cancel deliberately, or keep tab open.
3. Keeping work running moves it to the reachable background-work summary; cancelling makes the consequence explicit before the conversation becomes closed; keeping it open leaves it visible.
4. If no visible tab remains, the developer sees an empty workspace with a primary new-conversation action and any background-work summary.

### Return flow

1. The developer selects a saved run.
2. Kitten restores the user’s visible and background-running workspace state, names, order, and selected context.
3. Explicitly closed conversations do not return.
4. If something cannot be restored, the product explains the state in user terms and guides the developer to the next appropriate action.

### Accessibility and discoverability

- Keyboard and mouse workflows must be equally supported.
- State must use text or symbols in addition to color.
- Focus after selection, close, overflow access, and restore must be predictable.
- Documentation and in-product help must explain the shortcut fallback and active-work close choices.

## High-Level Technical Constraints

- The feature must coexist with Kitten’s live agent conversations and saved-run return experience without interrupting unrelated work.
- The `Ctrl+H`/`Ctrl+L` navigation promise applies when the terminal can safely distinguish those chords; an accessible fallback is required otherwise.
- A user-directed tab switch must appear complete in under 200 ms for at least 95% of measured switches.
- Product measurements remain opt-in and local, consistent with Kitten’s existing privacy posture.
- The feature must preserve clear attribution for approvals, errors, and finished work.
- When conversations share a workspace, the product must expose that shared context without blocking the user’s workflow.

## Non-Goals (Out of Scope)

- Worktree or workspace isolation for parallel agents.
- Tab reordering, pinning, grouping, detachable panes, multi-row layouts, and broad appearance customization.
- Automatic task naming, title generation, or inferred organization.
- Team collaboration, shared tab workspaces, and cross-user presence.
- Silent agent termination or any close behavior that skips an explicit consequence.
- A general project-management dashboard or broad agent-workspace platform.

## Phased Rollout Plan

### MVP (Phase 1)

Deliver the complete small-fleet workflow:
- live conversation tabs;
- fresh-tab creation;
- user renaming;
- keyboard, fallback, and mouse navigation;
- background attention signals and direct attention routing;
- explicit active-work close choices;
- restored visible/background-running state, names, order, selected tab, and retained context;
- deterministic overflow reachability.

**Success criteria to proceed:** during the first 30 days after release and after at least 100 eligible opt-in runs, at least 20% create a second tab, at least 90% of measured switches settle under 200 ms, and no unconfirmed active-work cancellations are observed.

### Phase 2

Refine based on observed use:
- improve overflow and duplicate-name clarity;
- refine shortcut fallback discoverability;
- improve background-work visibility and restore messaging;
- evaluate whether repeat usage and attention response targets are met.

**Success criteria to proceed:** during the first 90 days after release and after at least 100 eligible opt-in runs, at least 30% achieve multi-tab adoption, at least 40% of adopters return to tab use within seven days, and at least 70% of attention-queue conversations are visited within five minutes.

### Phase 3

Consider higher-leverage extensions only if V1 has durable repeat use:
- agent workspaces with clearer ownership and conflict awareness;
- richer organization;
- optional workspace isolation.

**Long-term success criteria:** users can reliably supervise more parallel work without an increase in missed urgent actions, accidental cancellations, or confusion about conversation identity.

## Success Metrics

| Metric | Target | Measurement |
|---|---:|---|
| Multi-tab adoption | ≥30% of eligible opt-in runs create a second tab within 90 days | Count eligible runs with a second-tab creation event. |
| Seven-day repeat use | ≥40% of adopters use tabs in a later run within 7 days | Cohort analysis of local opt-in tab-use events. |
| Switch responsiveness | ≥95% of user-directed tab switches appear complete in <200 ms | Measure from user selection to settled selected conversation. |
| Navigation engagement | ≥80% of multi-tab runs use mouse or keyboard tab selection | Count successful selection events by input method. |
| Lifecycle safety | 0 unconfirmed active-work cancellations caused by close | Audit close and cancellation outcomes. |
| Attention response | ≥70% of approval/error/finished conversations are visited within 5 minutes | Measure time from attention state to selected-tab event. |

### Measurement Definitions

- **Eligible opt-in run:** a local-telemetry-enabled run that reaches the tab workspace with at least one ready conversation.
- **Adopter:** an eligible run in which the user creates a second tab and selects a tab at least once.
- **Tab use:** a mouse or keyboard selection made while at least two visible or background-running conversations exist.
- **Settled switch:** the selected conversation and its prompt-ready workspace are visibly updated after a user-directed tab selection.
- **Attention response:** a visit to an awaiting-approval, error, or finished conversation after it enters the attention queue; visiting marks it seen, while underlying status remains until it changes.
- **Evaluation guardrail:** do not advance a phase solely on a percentage until its stated minimum sample and evaluation window are both met.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Users view a close action as harmless and lose active work. | State consequences plainly and offer keep-running, deliberate-cancel, and keep-open choices. |
| Tabs obscure approvals, errors, or finished work. | Make urgent state visible outside the selected tab and provide direct next-attention routing. |
| Small terminal windows make tabs hard to distinguish or reach. | Guarantee deterministic overflow access, text-based state cues, and duplicate-name disambiguation. |
| Requested shortcuts are unavailable or conflict with normal editing. | Offer a discoverable keyboard fallback and retain mouse access. |
| Users do not adopt tabs or use them only once. | Measure opt-in adoption and repeat use; keep V1 narrow and reassess before expanding scope. |
| Users misunderstand background work after hiding its tab. | Keep background work reachable and visibly count or signal any attention it needs. |
| Parallel work creates user confusion about shared context. | Show a non-blocking shared-workspace cue in the tab workspace and selected conversation; defer workspace isolation to a later phase. |

## Architecture Decision Records

- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — Defines the original V1 scope, safety guarantees, attention visibility, and exclusions.
- [ADR-002: Prioritize a Restorable, Fast-Switching Conversation Tab Workspace](adrs/adr-002.md) — Records the PRD direction for solo developers, explicit close choices, and full workspace restoration.

## Open Questions

- What exact fallback shortcut should be the default when `Ctrl+H` or `Ctrl+L` cannot be safely used?
- What visual treatment should make background-running conversations easy to distinguish from closed conversations?
- What maximum visible-tab count should trigger the overflow experience?
- What user-facing outcome should appear when a previously restored conversation is no longer available?
- Should users be able to configure the shortcut fallback in a future release?
