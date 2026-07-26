# T3 Code-Inspired Desktop Supervision Loop

## Originating Prompt

```text
$cy-idea-factory use /Users/matheusbbarni/projects/t3code as your guide the new UI revamp and usage, the prompt should be inside the task
```

## Overview

Revamp Kitten's desktop experience for an individual developer supervising several agent-driven tasks across repositories. The new interface will combine T3 Code's repository-grouped navigation, focused conversation, persistent composer, contextual review, compact chrome, and restrained visual language with Kitten's durable Kanban workflow.

V1 is a thin but complete supervision loop: detect actionable work, focus the correct card, inspect and steer its current attempt, review the exact changed files, record a trustworthy decision, and resume portfolio-level supervision without reconstructing context.

## Problem

Kitten already models the difficult parts of agent orchestration: repositories, boards, stages, cards, immutable attempts, attention states, review states, worktrees, and durable host projections. Its current interface exposes those capabilities as separate surfaces, however. Developers must interpret a project sidebar, scan the Kanban, open a large drawer, navigate metadata-heavy attempt accordions, and leave the natural conversation flow to understand or review work.

This fragmentation becomes costly when several agents are running across repositories. The developer's job shifts from writing every change to detecting which task needs intervention, reconstructing what happened, steering an agent, and verifying its output. The interface must prioritize actionable state and preserve context across that loop.

A visual reskin alone would not solve this problem. Conversely, copying T3 Code's threads, session lifecycle, terminal, browser, editor, and pane system would replace Kitten's differentiated workflow model with a broad IDE surface.

### Market Data

- Stack Overflow's 2025 survey reports that 84% of respondents use or plan to use AI tools, while 69% of agent users report increased productivity. Yet 46% distrust AI output accuracy, and 66% identify "almost right" answers as their largest frustration. This supports pairing faster supervision with explicit review evidence. [Stack Overflow 2025 Developer Survey](https://survey.stackoverflow.co/2025/)
- JetBrains reported in January 2026 that 90% of professional developers regularly used at least one AI tool at work and 74% had adopted specialized developer AI tools. [JetBrains AI coding tool research](https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/)
- Anthropic's April 2026 desktop redesign independently converges on multiple parallel repository sessions, status filtering, integrated diffs, and keyboard navigation. [Claude Code desktop redesign](https://claude.com/blog/claude-code-desktop-redesign)
- DORA's 2025 research describes AI as an amplifier of the surrounding delivery system. A clearer workflow and stronger review boundary therefore matter as much as agent capability. [DORA 2025 report](https://research.google/pubs/dora-2025-state-of-ai-assisted-software-development-report/)

## Summary / Differentiator

T3 Code and Claude primarily organize agent sessions. Kitten will organize durable workflow state: where work belongs, what stage it occupies, which attempt produced an outcome, what needs human attention, and exactly what evidence supports a review decision.

The visual language is familiar; the governed repository → board → card → attempt → review model is Kitten's differentiation.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Cross-project Work Inbox | Critical | Present repository- and board-grouped work with deterministic signals for running, needs-attention, failed, and ready-for-review cards. Every actionable item is reachable within two interactions. |
| F2 | Board-preserving Card Workbench | Critical | Keep the Kanban as the primary workspace while opening the selected card in a stable docked workbench on desktop and a focused sheet on narrow layouts. Closing it returns the developer to the same board position. |
| F3 | Conversation-first Attempt Timeline | Critical | Present the current attempt as a readable chronological conversation. Group and collapse tool activity, attach changed-file summaries to the relevant turn, and move Run Context behind progressive disclosure. Older immutable attempts remain accessible but collapsed. |
| F4 | Persistent Card Composer | Critical | Keep input attached to the selected card across transcript and review navigation. Enter sends directly, Shift+Enter inserts a newline, and blocked states explain the required attention or configuration action. |
| F5 | Provenance-bound Review | Critical | Open changed files in a focused diff and support approve or request-changes only when the host freshly validates the exact card, attempt, worktree, base, head, dirty/untracked policy, and change-set digest. Stale or incomplete evidence fails closed. |
| F6 | T3-inspired Visual System | High | Refresh Kitten's semantic tokens with a quiet near-black hierarchy, restrained borders, sparse primary accent, semantic status colors, compact chrome, readable typography, and selective emphasis around the composer. |
| F7 | Critical-path Commands | High | Provide centralized, context-aware commands for search, next actionable card, next/previous card, focus composer, open review, close workbench, and Settings. Display shortcuts where users encounter the actions. |
| F8 | Integrated Settings Navigation | Medium | Move Settings into stable application chrome with categorized navigation, compact control rows, explicit reset behavior, and a predictable return to the prior workspace. |
| F9 | Content-free Workflow Measurement | Medium | Measure navigation count, action latency, review completion, stale-action rejection, and keyboard-path completion without recording prompts, transcripts, code, paths, repository names, or diff content. |

## T3 Code Reference Patterns

These sources are design references, not dependencies:

| Pattern | T3 Code reference |
| --- | --- |
| Repository-grouped work navigation | `apps/web/src/components/SidebarV2.tsx` |
| Collapsible and responsive workspace shell | `apps/web/src/components/AppSidebarLayout.tsx` |
| Conversation and activity hierarchy | `apps/web/src/components/chat/MessagesTimeline.tsx` |
| Persistent composer and contextual controls | `apps/web/src/components/chat/ChatComposer.tsx` |
| Changed-file and diff review | `apps/web/src/components/chat/ChangedFilesTree.tsx`, `apps/web/src/components/DiffPanel.tsx` |
| Keyboard command model | `apps/web/src/keybindings.ts` |
| Visual tokens and typography | `apps/web/src/index.css` |

## Daily Workflow

1. Search or select a repository.
2. Scan cards by actionable state across boards.
3. Open a card while retaining board context.
4. Read the latest attempt as a conversation.
5. Steer the agent or resolve an attention request through the persistent composer.
6. Open the changed-file summary for the relevant attempt.
7. Review the provenance-bound diff.
8. Approve or request changes.
9. Return to the board or jump directly to the next actionable card.

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Time to actionable work | Median ≤10 seconds from launch to opening an actionable card | Content-free local timestamps across launch, navigation, and card-open events |
| Action reachability | ≥90% of attention and review items reachable within two interactions | Deterministic interaction-path tests and opt-in aggregate navigation counts |
| Navigation reduction | ≥35% fewer interactions per repository-to-review loop than the current UI baseline | Controlled usability comparison using identical tasks |
| In-app review completion | ≥80% of early-user review loops completed without switching applications | Content-free review-open and disposition events |
| Review evidence integrity | 100% of accepted review decisions digest-bound; 0 stale decisions accepted | Host command and stale-projection contract tests |
| Keyboard workflow completion | ≥95% successful completion of the critical path without pointer input | Keyboard-only accessibility task suite |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Must do |
| **Reach** | What percentage of users would this affect? | Must do |
| **Frequency** | How often would users encounter this value? | Must do |
| **Differentiation** | Does this set Kitten apart? | Strong |
| **Defensibility** | Does the value compound beyond visual imitation? | Strong |
| **Feasibility** | Can the existing desktop foundation support it? | Strong |

Leverage type: **Strategic Bet**.

## Council Insights

- **Recommended approach:** Deliver a thin but complete supervision spine—detect, focus, inspect, decide, resume—with T3 Code as interaction vocabulary rather than product model.
- **Key trade-offs:** Complete workflow versus simultaneous redesign breadth; global action visibility versus duplicated workflow state; convenient review actions versus trustworthy diff provenance; compact density versus accessibility.
- **Risks identified:** a second renderer-owned state model, stale navigation badges, approval of drifting bytes, keyboard conflicts inside the composer, responsive layouts that displace the Kanban, and expansion into IDE features.
- **Mitigations:** one host-owned supervision projection, explicit identities and stale rejection, digest-bound review evidence, centralized contextual commands, off-canvas narrow-screen navigation, and explicit V1 exclusions.
- **Stretch goal:** Evolve the deterministic action inbox into a configurable supervisory control center only after V1 proves that users can trust and complete the core loop.

## Out of Scope (V1)

- **T3 Code thread and session identity** — cards and immutable attempts remain authoritative.
- **Settle, snooze, wake, or copied session lifecycle states** — Kitten's workflow stages and execution statuses already own lifecycle meaning.
- **Terminal, browser, preview, or general file explorer** — these materially expand privileged desktop scope without validating the supervision loop.
- **Customizable pane grids** — V1 uses one deliberate workbench layout.
- **Full rich composer** — mentions, attachments, images, and advanced editor plugins are deferred.
- **Inline diff comments** — V1 supports approve or request-changes through the card composer without introducing a second comment system.
- **AI-ranked work priority** — the action inbox uses deterministic status and user-owned ordering.
- **Cloud sync and collaboration** — V1 remains local-first for an individual developer.
- **Replacement of host-owned projections or typed RPC** — the revamp consumes Kitten's authority rather than relocating it into renderer state.
- **Automatic push, PR creation, merge, deployment, or completion** — explicit human review remains a trust boundary.

## Architecture Decision Records

- [ADR-001: Adopt a T3 Code-inspired supervision loop without replacing Kitten's workflow model](adrs/adr-001.md) — adopts the hybrid scope and requires provenance-bound review decisions.

## Integration with Existing Features

| Integration Point | Product relationship |
| --- | --- |
| Project navigation | Evolves existing repository, pinned, board, and archive navigation into the cross-project work inbox. |
| Workflow Board | Remains the primary representation of stages and card movement. |
| Card Inspector | Becomes the stable focused workbench rather than a temporary metadata drawer. |
| Attempt history | Preserves immutable attempts while changing their default presentation to conversation-first. |
| Persistent composer | Retains drafts, model/profile constraints, attention behavior, direct Enter sending, and card ownership. |
| Review commands | Exposes existing review intent through a trustworthy changed-files workflow and deterministic evidence boundary. |
| Settings | Retains host ownership and revision semantics while moving navigation into normal application chrome. |
| Desktop host and RPC | Continue to own projections, worktrees, Git evidence, stale validation, and privileged resources. |

## Open Questions

- Which early-user cohort will establish the current navigation and review baseline?
- Should `needs_attention` or `ready_for_review` appear first when both exist across repositories?
- What default width should the docked workbench use before switching to a focused sheet?
- Which T3 Code screenshot and Kitten state matrix will serve as the visual acceptance references?
- Should request-changes create only a composer draft or submit immediately after explicit confirmation?
