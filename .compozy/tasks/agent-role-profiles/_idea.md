## Overview

Kitten will add one operator-facing child-agent role: `explore`. It lets a developer delegate investigation only when Kitten can prove that the child is constrained at runtime. The child is read-only, cannot spawn grandchildren, has no external MCP or agent-control access, and consumes bounded child capacity.

V1 is intentionally a production-safety gate for the orchestration registry and agent-control surface, not a general role-profile platform. If Kitten cannot verify the required boundary for a selected runtime, it refuses the launch and explains why.

## Summary / Differentiator

Kitten’s differentiator is a visible, enforceable terminal contract: `explore` means “read-only, non-recursive, capability-bounded, and verified”—or it does not launch. This avoids the false reassurance of a restricted-looking label backed only by prompts or hidden tools.

## Problem

Delegated child agents currently risk inheriting the parent’s provider configuration and authority. An exploratory task can therefore gain write access, reach connected services, consume unbounded capacity, or create further agents despite the operator’s intent. This turns ordinary delegation into an authority and cost-multiplication path.

The risk becomes material once agent-facing control is production-enabled. A UI label, prompt instruction, or hidden tool does not prevent a direct invocation or an adapter that never asks for permission. Operators need the system to refuse unsafe launches rather than silently approximate restrictions.

### Market Data

- Claude Code documents tool-restricted, non-recursive subagents; its safe-researcher pattern limits a child to read/search capabilities. [Source](https://code.claude.com/docs/en/sub-agents)
- GitHub Copilot documents restricted agent sessions and cautions against broad default permissions. [Source](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools)
- Microsoft’s delegation guidance recommends that child scope only narrows from its parent and records delegation depth. [Source](https://microsoft.github.io/agent-governance-toolkit/tutorials/23-delegation-chains/)
- Stack Overflow’s 2025 AI survey reports that 84% of workplace agent users employ agents for software development. [Source](https://survey.stackoverflow.co/2025/ai)
- A March 2026 Cloud Security Alliance survey reported 85% production-agent use among respondents, while 68% could not clearly distinguish agent actions from human actions. [Source](https://cloudsecurityalliance.org/press-releases/2026/03/24/more-than-two-thirds-of-organizations-cannot-clearly-distinguish-ai-agent-from-human-actions)

## Core Features

| # | Feature | Priority | Description |
|---|---|---|---|
| F1 | Fixed `explore` role | Critical | Offer one host-owned, non-editable exploratory child role with an explicit safety promise. |
| F2 | Verified, fail-closed launch | Critical | Launch only when the selected runtime proves the required restrictions; otherwise deny the request with a clear reason. |
| F3 | Enforced capability boundary | Critical | Ensure the child cannot write, recurse, invoke external MCP or agent-control capabilities, or bypass a hidden capability through direct invocation. |
| F4 | Bounded child capacity | High | Enforce finite per-parent and global child limits under concurrent launch attempts. |
| F5 | Effective-policy visibility | High | Show the operator the semantic role and verified effective policy, including runtime availability, before and after launch. |
| F6 | Content-free policy telemetry | Medium | When telemetry is opt-in, record only allowlisted policy outcomes and counters—never task content, paths, recipes, or error text. |

## Integration with Existing Features

| Integration Point | How |
|---|---|
| Delegation registry | Treat the host-owned child lifecycle as the source of truth for role ownership, capacity reservation, and terminal release. |
| Agent-control surface | Filter capabilities before advertisement and re-check policy when a handler executes. |
| Provider/session configuration | Replace inherited authority with an explicit, verified `explore` eligibility decision. |
| Child snapshots and UI | Present the role and effective verified boundary alongside the delegated child. |
| Local telemetry | Preserve the existing opt-in, content-free telemetry posture. |

## KPIs

| KPI | Target | How to Measure |
|---|---:|---|
| Unsafe `explore` launches | 0 | Negative acceptance tests show every launch without current runtime proof is denied. |
| Prohibited child operations | 0 successful calls | Adversarial tests directly invoke forbidden write, recursive-spawn, external-MCP, and agent-control paths. |
| Capacity-bound violations | 0 across 1,000 concurrent launch simulations | Race-focused tests verify live children never exceed configured per-parent or global limits. |
| Effective-policy disclosure | ≥90% comprehension in moderated operator tests | Participants identify the role’s availability and restrictions within 10 seconds. |
| Content leakage in policy telemetry | 0 schema violations | Automated schema tests reject task content, IDs, paths, recipes, and free-form error fields. |

## Feature Assessment

| Criteria | Question | Score |
|---|---|---|
| **Impact** | How much more valuable does this make Kitten? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set Kitten apart? | Strong |
| **Defensibility** | Does value compound over time? | Maybe |
| **Feasibility** | Can Kitten build this credibly? | Maybe |

Leverage type: **Strategic Bet**

## Council Insights

- **Recommended approach:** Ship one fixed `explore` profile on a fail-closed runtime capability allowlist. Define a small explicit capability manifest now, but do not wait for a generalized multi-provider policy platform.
- **Key trade-offs:** Safe availability on a proven runtime subset versus universal support; immediate operator value versus abstraction before interoperability evidence; strict denial versus pressure to introduce unsafe overrides.
- **Risks identified:** Stale runtime proof, configuration drift, capacity races, misleading UI claims, and operator workaround pressure.
- **Mitigation:** Revalidate proof on relevant changes, pin tested compatibility, test direct forbidden actions and concurrent limits, expose runtime-scoped denials plainly, and keep decision telemetry content-free.
- **Stretch goal (V2+):** Versioned, portable capability attestations supporting additional roles only after each role has an equally verifiable enforcement contract.

## Out of Scope (V1)

- **`engineer`, `pair`, and `design` roles** — They broaden authority combinations before the `explore` boundary is validated.
- **Workspace-editable role profiles** — Customization would create multiple policy owners and unsafe combinations too early.
- **Warning-only or best-effort launches** — A visibly restricted but unverified child would be safety theater.
- **Universal provider parity** — V1 may support only runtimes that can prove the boundary; unsupported runtimes must deny safely.
- **A general organization-wide policy platform** — Central administration is valuable, but beyond the operator-first Minimal MVP.

## Architecture Decision Records

- [ADR-001: Fail Closed with an Attestable Fixed Explore Profile](adrs/adr-001.md) — V1 supports one verified, runtime-scoped `explore` profile and denies all unproven launches.

## Open Questions

- Which initially supported runtime(s) can provide a durable, testable proof of read-only execution?
- What initial per-parent and global child limits balance useful investigation with predictable resource consumption?
- What denial wording best explains unavailable safe delegation without implying a bypass?
- What compatibility change requires revalidation before Kitten permits another `explore` launch?
