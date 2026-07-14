# Cursor Integration

## Overview

Add Cursor as Kitten's third first-class local coding agent beside Claude Code and Codex. It gives existing Kitten users who already use Cursor a persistent session they can select, monitor, and hand work to without reconstructing context manually.

V1 is deliberately narrow: a certified Cursor ACP profile, independent readiness, and participation in the existing multi-session handoff flow. It is not a generic provider platform or a cloud-agent integration.

## Problem

Kitten's multi-agent workflow currently excludes developers whose daily coding-agent tool is Cursor. Moving work between Cursor and Kitten's existing agents requires manually copying context, restarting a separate tool, and losing the safety and continuity of Kitten's redacted, human-confirmed handoff.

Cursor now provides a local ACP server through `agent acp`, making a native local session possible. Kitten's current session model already supports more than two agents and opens an explicit target picker when several recipients are available, so the user-facing workflow can stay coherent while Cursor becomes a peer.

### Market Data

- Cursor supports local ACP over stdio for custom clients. [Cursor ACP docs](https://cursor.com/docs/cli/acp)
- Cursor promotes parallel-agent and human-review workflows, which aligns with Kitten's cockpit model. [Cursor best practices](https://cursor.com/blog/agent-best-practices)
- An independent 2026 analysis estimates coding-agent adoption across GitHub projects at 15.85-22.60%. [Study](https://arxiv.org/abs/2601.18341)

## Summary / Differentiator

Kitten becomes a neutral local cockpit for the three tools its users already use, while preserving the safety advantage other parallel-agent flows often lack: every transfer is redacted, previewed, curated, and explicitly confirmed by the developer.

## Core Features

| # | Feature | Priority | Description |
|---|---|---|---|
| F1 | Certified Cursor provider | Critical | Cursor appears as a first-class local provider with a pinned, verified ACP launch profile. |
| F2 | Independent Cursor readiness | Critical | Missing installation, authentication, handshake, or version failure leaves Cursor visibly unavailable without affecting Claude Code or Codex. |
| F3 | Persistent third session | Critical | Cursor remains live alongside the other configured sessions and participates in normal focus and status behavior. |
| F4 | Explicit Cursor handoffs | High | Developers may choose Cursor as a handoff recipient or source through the existing target picker, redacted preview, and confirmation flow. |
| F5 | Clear setup and recovery guidance | High | Startup identifies the actionable Cursor readiness problem without exposing credentials or content. |
| F6 | Fail-closed optional capabilities | High | Cursor-specific extensions remain unavailable until proven against the exact certified profile. |

## KPIs

| KPI | Target | How to Measure |
|---|---:|---|
| Certified-profile readiness | 100% of release recipes pass credentialed ACP validation | Release contract result for the pinned version/configuration |
| Live workflow success | >=90% across 20 release-candidate scenarios | Start, prompt, handoff, hand-back, and shutdown checks |
| Safe-handoff compliance | 100% | All Cursor-targeted handoffs invoke the preview before sending |
| Failure isolation | 0 sibling failures in 50 injected Cursor failures | Controller integration scenarios |
| Cursor adoption | >=25% of opt-in multi-agent runs include Cursor within 60 days | Local, content-free telemetry only |

## Feature Assessment

| Criteria | Question | Score |
|---|---|---|
| **Impact** | How much more valuable does this make Kitten? | Strong |
| **Reach** | What percentage of users does this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set Kitten apart or match competitors? | Strong |
| **Defensibility** | Does the value compound over time? | Maybe |
| **Feasibility** | Can Kitten build it safely? | Strong |

Leverage type: **Strategic Bet**, bounded to a clean provider addition.

## Council Insights

- **Recommended approach:** The user selected a first-class, certified local Cursor session.
- **Key trade-offs:** A dependable profile over generic custom-provider flexibility; a focused integration over a provider marketplace.
- **Risks identified:** Cursor CLI/ACP drift, authentication failures, unverified optional behavior, and added local resource use.
- **Council note:** No council debate was held at the user's explicit direction.
- **Stretch goal (V2+):** Provider-neutral routing based on developer-selected intent, not automatic routing.

## Out of Scope (V1)

- **Generic provider platform or marketplace** - Broadens the work beyond the requested clean integration.
- **Cursor cloud/background agents** - Introduces remote execution, repository, and security concerns outside Kitten's local model.
- **Automatic agent routing or sending** - The developer must always choose a target and explicitly confirm transfer.
- **Cursor-specific clarification or restore behavior** - Unavailable until credentialed contract evidence validates it.
- **New handoff UX** - The existing target picker, redaction, preview, and confirmation contracts remain authoritative.

## Architecture Decision Records

- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) - Cursor is a pinned, independently readiness-gated local ACP provider.

## Open Questions

- Which exact Cursor CLI release and launch packaging should become the initial certified profile?
- Should zero-config startup launch Cursor automatically when installed, or should users opt in through config?
- What should the first-run guidance say when Cursor is authenticated in its own terminal but unavailable to Kitten?
