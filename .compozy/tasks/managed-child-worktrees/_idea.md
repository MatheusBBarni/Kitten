# Managed Child Worktrees

## Overview

Kitten will isolate every host-spawned child agent in a newly created, Kitten-managed Git worktree. Each child begins from the parent branch's committed `HEAD`, receives a unique branch and workspace identity before ACP starts, and retains that workspace for explicit review and cleanup.

This makes parallel delegation safe and legible without changing ordinary sessions, ACP adapters, or the developer's parent checkout.

### Summary / Differentiator

Unlike a generic Git wrapper, Kitten connects each isolated workspace to the child session that created it: users can see where the child worked, what branch it owns, whether the binding remains available, and when it is safe to remove.

## Problem

Parallel child agents currently share the parent session's working directory. If two children edit the same relative file, they can overwrite one another, invalidate each other's builds, and leave the developer unable to attribute a diff to a particular child. A warning cannot prevent the collision; isolation must exist before the child process starts.

The completed orchestration registry gives Kitten provider-neutral child lifecycle and visibility, but it deliberately does not own Git workspaces. Without managed bindings, the product's parallel-work promise remains unsafe for the code-changing tasks where it is most valuable.

### Market Data

RepoPrompt CE, Codex, and Cursor all use isolated workspaces or branches for parallel agent work, coupled with deliberate review and promotion rather than hidden merging. Git itself provides safe worktree primitives and refuses normal removal of dirty worktrees. [RepoPrompt](https://github.com/repoprompt/repoprompt-ce/blob/main/docs/worktrees.md), [Codex](https://openai.com/index/introducing-the-codex-app/), [Git](https://git-scm.com/docs/git-worktree)

AI-agent use is growing but trust remains constrained: Stack Overflow's 2025 survey reports 30.9% workplace agent use at least monthly, while 87% cite accuracy concerns and 81% cite security/privacy concerns. Visible provenance and fail-closed actions are therefore part of the product value, not implementation detail. [Survey](https://survey.stackoverflow.co/2025/ai)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Verified managed launch | Critical | A spawned child gets a unique managed worktree and branch before ACP session creation; launch fails visibly if the binding cannot be verified. |
| F2 | Committed-base disclosure | Critical | The child starts from the parent branch's committed `HEAD`; Kitten shows the base SHA, branch, path, and managed provenance so dirty parent files are never implied. |
| F3 | Workspace identity in sessions | High | Child tabs and the Sessions overview show the managed-worktree and branch identity alongside existing child lineage and lifecycle status. |
| F4 | Retained review artifact | High | A finished, failed, or restored child binding remains discoverable for review; an unavailable restored path is clearly marked and never replaced with the parent checkout. |
| F5 | Explicit safe cleanup | High | Users explicitly request cleanup. Kitten refuses dirty, unmerged, external, live-owned, or unverifiable worktrees with an actionable reason. |

### Integration with Existing Features

| Integration point | Product behavior |
| --- | --- |
| Delegated child launch | Managed binding is a prerequisite to starting a spawned child. |
| Workspace tabs and Sessions overview | Both show the same child-to-worktree-and-branch identity. |
| Existing branch and file views | They naturally operate on the child's resolved workspace. |
| Session restore | Restores review metadata and availability, but never fabricates live parent-child ownership. |

## KPIs

| KPI | Target | How to Measure |
| --- | ---: | --- |
| Isolated concurrent launches | 100% | Integration scenarios launch two children with distinct branch, path, and ACP cwd. |
| Wrong-checkout starts | 0 | Creation and restore tests prove an unavailable binding never uses the parent cwd. |
| Unsafe cleanup success | 0 | Tests and opt-in, content-free local counters record refusal of dirty, unmerged, external, or live-owned cleanup. |
| Managed-launch reliability | >=95% | Opt-in, content-free local lifecycle counters: verified successful bindings divided by requested bindings. |
| Retained review availability | 100% | Terminal managed child bindings remain discoverable until explicit cleanup succeeds. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Strategic Bet**

## Council Insights

- **Recommended approach:** Create only Kitten-managed worktrees for spawned children in V1; defer general binding of user-owned existing worktrees.
- **Key trade-offs:** Narrower flexibility buys a clear ownership and cleanup contract. Retained worktrees add branch/path clutter but preserve reviewability.
- **Risks identified:** collision-safe reservation, partial-startup rollback, stale restored metadata, destructive cleanup, and submodule behavior.
- **Required mitigations:** Start from committed `HEAD`, verify the resolved binding before dispatch, persist only content-free workspace metadata, fail closed on ambiguity, and prohibit automatic merge/delete.
- **Stretch goal (V2+):** A dedicated delegated-work review lane with diff, provenance, handoff, promotion, and cleanup controls.

## Out of Scope (V1)

- **Binding arbitrary existing worktrees** — Kitten cannot safely own their provenance, rollback, or cleanup contract yet.
- **Inheriting the shared parent checkout** — It reintroduces the collision problem this feature solves.
- **Copying dirty parent changes into child worktrees** — It blurs review provenance and makes isolation unreliable.
- **Automatic merge, promotion, or deletion** — Developers must explicitly review and control Git-state changes.
- **Submodule-managed worktrees** — Git lifecycle support is too nuanced to include without a dedicated design.
- **Per-session integrated-shell worktrees** — The current shell is global-cwd scoped, not child-session scoped.

## Architecture Decision Records

- [ADR-001: Create managed worktrees only for spawned child sessions](adrs/adr-001.md) — V1 uses one verified, managed creation path with retained review artifacts and fail-closed cleanup.

## Open Questions

- What managed-root location and retention policy best balance discoverability with avoiding repository clutter?
- Which user-facing review action should ship first: open the workspace path, inspect branch status, or both?
- How should Kitten explain unsupported detached-HEAD and submodule repositories at launch?
- What exact user confirmation is appropriate before clean-only removal of a retained worktree?
