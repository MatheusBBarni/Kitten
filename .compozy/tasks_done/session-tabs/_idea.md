# Session Tabs

## Overview

Session Tabs lets every Kitten user manage multiple live agent conversations in one cockpit without losing context. Each tab represents one conversation and supports creation, renaming, mouse selection, previous/next navigation, explicit close behavior, and restoration of the tab workspace.

V1 is a **Strategic Bet**: complete enough to make parallel supervision safe and useful, but deliberately smaller than a workspace manager. `Ctrl+H` and `Ctrl+L` navigate left/right when the terminal can report them safely; a discoverable fallback protects normal editing on legacy terminals.

## Summary / Differentiator

Kitten will not compete on tabs alone. Its differentiator is a terminal-native, provider-agnostic supervision surface: users can identify the active conversation, discover approvals and errors in background tabs, and manage lifecycle without silently cancelling live work.

## Problem

Kitten already runs multiple independent agent sessions, but exposes one conversation at a time. A user supervising parallel work must rely on a session overview or blind focus changes, which interrupts flow and makes it easy to overlook a finished turn, approval request, or error.

This becomes more costly as agent tasks run longer. Users need to name work clearly, move to the right conversation immediately, and retain confidence that switching does not interrupt work. A visual tab strip without attention signals or safe close behavior would make the problem worse by hiding consequential background state.

The V1 should solve the complete daily workflow—create a conversation, identify it, switch quickly, notice urgent work, and close it safely—without prematurely becoming a worktree or project-management system.

### Market Data

| Signal | Relevance |
|---|---|
| OpenAI’s Codex app organizes parallel agents into separate threads and lets users switch without losing context. | Validates parallel-conversation supervision as a primary coding-agent workflow. [OpenAI](https://openai.com/index/introducing-the-codex-app/) |
| Warp supports simultaneous agent conversations across windows, tabs, and panes, and confirms an exit that would cancel active work. | Establishes tabbed conversations and non-destructive lifecycle safeguards as user expectations. [Warp](https://docs.warp.dev/agent-platform/local-agents/interacting-with-agents) |
| 84% of Stack Overflow’s 2025 respondents use or plan to use AI tools; 52% report a positive productivity effect. | Supports investment in workflows that help developers supervise AI-assisted work. [Stack Overflow](https://survey.stackoverflow.co/2025/ai) |
| W3C tab guidance calls for clear active state, keyboard navigation, and logical focus after closing a tab. | Informs accessible, predictable interaction behavior. [W3C](https://w3c.github.io/wai-website/ARIA/apg/patterns/tabs/) |

## Core Features

| # | Feature | Priority | Description |
|---|---|---|---|
| F1 | Live Conversation Tabs | Critical | Display each live agent conversation as one named tab; let users create a new conversation tab. |
| F2 | Fast Tab Navigation | Critical | Select tabs by mouse and navigate left/right with `Ctrl+H`/`Ctrl+L` when safe, with a documented fallback for incompatible terminals. |
| F3 | User-Controlled Names | High | Let users rename tabs while retaining a stable identity and disambiguating duplicate names. |
| F4 | Attention-Safe Supervision | Critical | Show active, approval, error, and activity state; provide aggregate/off-screen attention visibility and a deterministic jump to the next session needing action. |
| F5 | Explicit Safe Close | Critical | Make close behavior explicit and non-destructive; never silently cancel or terminate an agent with active work. |
| F6 | Restore and Overflow Reachability | High | Restore the minimum tab workspace metadata and ensure every tab remains reachable on narrow terminals. |

## Integration with Existing Features

| Integration Point | How |
|---|---|
| Multi-session model | Tabs present the existing ordered live-session collection and focused conversation in a clearer primary workflow. |
| Conversation view | The selected tab determines the visible conversation while other conversations remain live. |
| Session overview and notifications | Existing attention signals become visible at tab level and support direct routing to urgent work. |
| Run restore | Saved runs retain tab identity, user name, order, focus, and recoverable attention state. |

## KPIs

| KPI | Target | How to Measure |
|---|---:|---|
| Multi-tab adoption | ≥30% of eligible opt-in runs create a second tab within 90 days | Local telemetry event for a second created tab; eligible run has at least one ready conversation. |
| Repeat use | ≥40% of adopters use tabs in a later run within 7 days | Cohort analysis of local opt-in tab-use events. |
| Switch responsiveness | ≥95% of tab switches settle visually in <200 ms | Timestamp input/click and focused-tab render completion. |
| Navigation use | ≥80% of multi-tab runs use mouse or keyboard tab selection | Count successful selection events by input method. |
| Lifecycle safety | 0 unconfirmed active-agent cancellations caused by close | Audit close, cancel, and termination event paths. |
| Attention response | ≥70% of approval/error tabs visited within 5 minutes | Measure time from attention state to selected-tab event. |

## Feature Assessment

| Criteria | Question | Score |
|---|---|---|
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Maybe |

Leverage type: **Strategic Bet**

## Council Insights

- **Recommended approach:** Ship a bounded, complete tab lifecycle combined with minimal attention-inbox behavior.
- **Key trade-offs:** A read-only switcher would validate demand faster, but would not satisfy the requested workflow; a full workspace manager would overreach before demand is proven.
- **Risks identified:** hidden approvals/errors, unsafe close semantics, shared-checkout conflicts, ambiguous labels, narrow-terminal overflow, and legacy-key compatibility.
- **Risk mitigations:** distinguish close from cancellation, retain aggregate attention visibility, make all tabs deterministically reachable, disambiguate names, provide a shortcut fallback, and surface shared-workspace context.
- **Stretch goal (V2+):** Agent workspaces with per-tab worktree ownership, conflict awareness, and richer organization.

## Out of Scope (V1)

- **Reordering, pinning, grouping, and detachable panes** — organization features do not prove the core supervision value.
- **Multi-row layouts and advanced customization** — deterministic overflow reachability is sufficient for V1.
- **Automatic title generation** — user-controlled names are more predictable while naming expectations are learned.
- **Automatic workspace/worktree isolation** — valuable, but it expands tabs into a workspace-management product.
- **Silent agent termination** — conflicts with the safety requirement for long-running work.

## Architecture Decision Records

- [ADR-001: Ship a Bounded, Attention-Safe Session-Tab Lifecycle](adrs/adr-001.md) — Defines V1 scope, lifecycle safety, attention visibility, and exclusions.

## Open Questions

- What exact user-facing choices should “close” offer for idle, working, approval-blocked, and final remaining tabs?
- Which fallback shortcut and/or user-configurable behavior best preserves the `Ctrl+H`/`Ctrl+L` intent on legacy terminals?
- What tab count or terminal-width threshold should trigger overflow behavior?
- Which metadata should survive a restored run versus a fresh cockpit run?
- How prominently should Kitten surface that multiple tabs share one working tree?
