# PRD: Managed Child Worktrees

## Overview

Kitten will give each host-spawned child agent its own managed Git workspace before that child begins work. The feature protects the developer's active checkout from parallel edits, keeps each child workspace visibly attributable, and retains completed work for a deliberate in-Kitten review and resolution loop.

The target user is a developer who delegates independent coding work to multiple child agents from one active task. The value is trustworthy parallelism: the developer can start children confidently, know where each child worked, review the retained result, and decide what to do next without manual recovery or hidden Git actions.

Market research supports this product posture. Codex, Cursor, and RepoPrompt pair isolated agent workspaces with visible review and deliberate promotion; Git itself treats branch/path identity and explicit clean removal as core safety signals. [Codex](https://openai.com/index/introducing-the-codex-app/), [Cursor](https://forum.cursor.com/t/cursor-3-worktrees-best-of-n/156507), [RepoPrompt](https://github.com/repoprompt/repoprompt-ce/blob/main/docs/worktrees.md), [Git](https://git-scm.com/docs/git-worktree)

## Goals

- Let a developer delegate parallel child work without child edits colliding in the parent checkout.
- Make the child workspace, branch, and starting point clear before and after work begins.
- Make in-Kitten review the default completion loop for a child workspace.
- Let developers safely resolve every retained child workspace without manually searching for paths or branches.
- Preserve developer control: no automatic merge, promotion, deletion, or silent fallback to the parent checkout.

## User Stories

### Delegating developer

- As a developer delegating two independent coding tasks, I want each child to work separately so that their changes cannot overwrite one another or my active checkout.
- As a developer starting a child, I want to see that Kitten created a managed workspace from my current committed work so that I understand the child's starting context.
- As a developer with uncommitted work, I want Kitten to make the child's committed starting point clear so that I do not assume unfinished local changes are included.

### Reviewing developer

- As a developer whose child has finished, I want to find its workspace identity and review status in Kitten so that I can decide the next action without reconstructing Git state.
- As a developer comparing several child outcomes, I want every child to remain attributable to its own workspace so that I can inspect work with confidence.

### Returning developer

- As a developer reopening Kitten later, I want a retained child workspace to be clearly available or unavailable so that I never mistake a missing workspace for my parent checkout.
- As a developer cleaning up completed work, I want Kitten to explain why removal is allowed or refused so that I do not lose work accidentally.

## Core Features

### F1. Protected child workspace launch — Critical

When a developer starts a child, Kitten creates and verifies a unique managed workspace for that child before work begins. The child starts only when Kitten can show that its workspace is distinct from the parent checkout; otherwise Kitten presents an actionable launch failure.

### F2. Clear workspace provenance — Critical

Kitten shows that a child is working in a managed workspace, including its branch, path, and committed starting point. The product clearly distinguishes this isolated workspace from the developer's active checkout and does not imply that local uncommitted work was carried over.

### F3. In-Kitten retained-work review — Critical

When a child reaches a terminal state, Kitten retains its workspace as a review artifact. The child session and session overview make its workspace identity, lifecycle state, and review availability visible before the developer chooses any follow-up action.

### F4. Explicit, safe resolution — High

Kitten offers explicit cleanup for a retained managed workspace and explains refusal states in plain language. A finished child is always presented as review-ready, never as automatically merged or promoted.

### F5. Continuity after restart — High

When Kitten restores a prior session, it preserves enough workspace identity for the developer to find the retained work or see that it is unavailable. It does not silently substitute the parent checkout or imply that a child remains actively attached.

## User Experience

### Start a child

The developer uses the existing child-delegation flow. Before work starts, Kitten confirms that the child is receiving a managed workspace and presents the workspace identity alongside the normal child task and desired outcome. If Kitten cannot establish that protected context, the child does not start and the developer receives a clear next step.

### Monitor active work

Tabs and the Sessions overview continue to show child lineage and lifecycle, now paired with a concise managed-workspace cue. A developer can switch between the parent and children without losing track of which workspace each child owns.

### Review finished work

When a child finishes, the developer reviews its managed workspace from Kitten before taking action. Kitten presents the child as review-ready, with its branch, path, starting point, and availability clearly distinguished from the parent checkout. The experience must not rely on color alone; labels and status text remain understandable in compact and assistive terminal contexts.

### Resolve or return later

The developer explicitly requests cleanup when ready. If cleanup is unsafe, Kitten leaves the workspace intact and explains why. On a later visit, the same workspace remains discoverable or is plainly marked unavailable, so the developer never has to guess where child work went.

## High-Level Technical Constraints

- The feature applies only to host-spawned child agents in eligible Git repositories; existing ordinary sessions retain their current workspace behavior.
- The parent checkout must remain protected from child workspace writes.
- A child must not start when Kitten cannot establish and verify its distinct workspace identity.
- A restored unavailable workspace must be shown as unavailable, never silently treated as the parent checkout.
- Workspace lifecycle signals must respect Kitten's opt-in, local, content-free telemetry policy.
- Automatic merging, promotion, deletion, and forceful removal are prohibited in the MVP.

## Non-Goals (Out of Scope)

- **Binding arbitrary existing worktrees** — Kitten will first validate the trust model for workspaces it creates and can identify clearly.
- **Shared parent-checkout child work** — It directly contradicts the collision-prevention goal.
- **Copying uncommitted or ignored parent files into a child workspace** — It would obscure the child's starting context and review provenance.
- **Automatic merge, promotion, or deletion** — The developer keeps final control over Git-state changes.
- **Advanced in-app diff comparison and editor automation** — The MVP prioritizes clear review context over a broad review environment.
- **Submodule workspace support** — It needs a separate user-facing lifecycle design.
- **Persistent live parent-child ownership after restart** — Restored work remains reviewable without claiming a live delegation relationship.

## Phased Rollout Plan

### MVP (Phase 1)

- Protected managed workspaces for host-spawned child agents.
- Clear workspace provenance in child session and overview surfaces.
- Retained in-Kitten review state, explicit safe cleanup, and clear unavailable-state recovery.
- Success criteria: eligible parallel children never share the parent checkout; usability participants can locate and understand every finished child workspace without manual recovery; unsafe cleanup never proceeds.

### Phase 2

- Richer review affordances, such as direct external-editor handoff and clearer branch-status summaries.
- Guided cleanup attention for retained workspaces that need a developer decision.
- Success criteria: developers can complete the review-to-resolution loop with less context switching and no loss of provenance.

### Phase 3

- Carefully scoped support for prepared user-owned workspaces where Kitten can clearly communicate reduced ownership guarantees.
- A delegated-work review lane for comparing, handing off, and promoting several child outcomes.
- Success criteria: the expanded workflow increases useful parallel delegation without weakening explicit control or reviewability.

## Success Metrics

| Metric | Target | Measurement |
| --- | ---: | --- |
| Protected child launches | 100% | Every eligible parallel-child scenario uses a distinct workspace from the parent checkout. |
| Review-path findability | >=90% | In usability evaluation, participants locate a finished child's workspace identity and status within two actions. |
| Manual workspace recovery | 0 | Dogfood users do not need to search outside Kitten to identify a retained child workspace or branch. |
| Unsafe cleanup success | 0 | No cleanup proceeds when Kitten reports that retained work needs protection. |
| Launch reliability | >=95% | Eligible child-launch requests complete with a reviewable managed workspace during dogfooding or opt-in local telemetry. |
| Completion-state comprehension | >=90% | Usability participants correctly identify that a finished child is review-ready rather than automatically merged. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers perceive retained workspaces as clutter | Make workspace status and explicit safe cleanup easy to find, while preserving work until the developer acts. |
| Developers assume a finished child was merged | Use consistent “review-ready” language and show workspace provenance before any resolution action. |
| Developers expect dirty parent work to appear for the child | Clearly disclose the child's committed starting point during launch and review. |
| The review surface is overlooked | Reuse familiar child tabs and Sessions overview with concise, non-color-only managed-workspace cues. |
| AI-output trust concerns reduce adoption | Emphasize attributable work, preserved review artifacts, and explicit developer control; this aligns with survey findings that accuracy and privacy remain key concerns. [Stack Overflow 2025](https://survey.stackoverflow.co/2025/ai) |

## Architecture Decision Records

- [ADR-001: Create managed worktrees only for spawned child sessions](adrs/adr-001.md) — Limits V1 to one verified, Kitten-managed creation path with explicit cleanup.
- [ADR-002: Make in-Kitten review the primary child-workspace completion loop](adrs/adr-002.md) — Prioritizes retained-work review and safe resolution over automatic editor handoff or summary-only completion.

## Open Questions

- What wording most clearly communicates that a child starts from committed work and not from the developer's dirty local state?
- Should Kitten draw attention to long-retained workspaces, and if so, after what user-visible interval?
- Which review status detail is most valuable in the MVP: a short branch summary, a changed-file count, or both?
- When richer review arrives, should external-editor handoff be a visible default action or an optional secondary action?
