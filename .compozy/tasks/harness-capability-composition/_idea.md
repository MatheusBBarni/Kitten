# Harness Capability Composition

## Overview

Kitten will compose the hidden harness for each fresh ACP session from the stable #18 base contract plus only the static guidance fragments supported by confirmed, protocol-free session facts. It serves developers running multiple coding agents through Kitten: the agent starts with concise, accurate instructions, while the developer never has to compensate for a host that advertises unavailable tools, roles, worktrees, steering, or handoff behavior.

V1 is a compounding foundation: a closed capability vocabulary, deterministic static catalog, one independently confirmed active capability slice, and safe base-only fallback. It does not turn the harness into an authorization system, a dynamic prompt platform, or an ACP transport feature.

### Summary / Differentiator

Most coding-agent products centralize persistent instructions or configure agent-specific tools and roles. Kitten’s differentiator is a provider-neutral, per-fresh-session *truthful harness*: a reviewable prompt composition result derived solely from runtime facts the host has confirmed, with deterministic fragment IDs and content-free diagnostics.

## Problem

A static harness gives every ACP session the same host guidance. That either omits useful direction when Kitten has confirmed a session-specific capability, or falsely claims a tool, role, isolated worktree, steering behavior, or handoff operation that does not exist in the active runtime. The latter is a trust failure: agents may plan work around host controls that are absent, stale, or owned by another layer.

ACP does not give a host a universal per-session control plane. GitHub’s ACP documentation notes that `session/new` carries only limited parameters such as working directory and MCP servers, while other settings may be fixed when the server starts. Kitten therefore must use its own confirmed session facts—not provider-name guesses—to decide what guidance is true. [GitHub ACP documentation](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)

The current architecture already separates concerns: #18 owns the bounded, static base contract; #19 owns fresh-generation delivery and provider encoding. #20 must compose a capability snapshot at those seams without mutating loaded sessions, leaking content, or absorbing delivery, permission, or transport ownership.

### Market Data

| Signal | Evidence | Product implication |
| --- | --- | --- |
| Scoped agent context is a market norm | [GitHub Copilot custom agents](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents) make prompts, tools, MCP servers, and skills explicit per agent. | Capability-aware guidance is expected; Kitten must remain provider-neutral. |
| Lean, relevant context outperforms exhaustive instruction blobs | [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) recommends curated context and tool sets to avoid context rot. | Enforce small, static fragments with strict size and conflict rules. |
| Agent harnesses coordinate instructions, tools, and runtime controls | [Cursor](https://cursor.com/blog/agent-best-practices) describes a harness as instructions, tools, and model orchestration. | Treat composition as a product boundary, not a string-concatenation utility. |

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Closed truthful capability context | Critical | Represent only bounded, protocol-free facts with explicit `confirmed`, `absent`, and `unknown` states; unknown and conflict never activate guidance. |
| F2 | Deterministic fragment catalog | Critical | Map confirmed facts to reviewed static fragments with stable IDs, declared ownership, deterministic ordering, mutual-exclusion rules, and the existing #18 bounds. |
| F3 | Fresh-generation snapshot semantics | Critical | Compose only for new, fallback, and replacement sessions; loaded sessions remain unchanged. Revalidate an optional fact before first delivery and safely omit it if confirmation is lost. |
| F4 | One proven capability slice | Critical | Activate one independently confirmed Kitten MCP bridge/child-control fragment end to end; all other families remain inactive until their authoritative source exists. |
| F5 | Matrix evidence and safe diagnostics | High | Add golden tests for representative combinations and emit only contract version, fragment IDs, selected count, and base-only fallback status. |
| F6 | Staged integration contract | High | Let clarification, roles, managed worktrees, steering, and future capability sources register only reviewed static metadata after they earn authoritative confirmation. |

### Integration with Existing Features

| Integration point | How |
| --- | --- |
| #18 harness prompt contract | Supplies the immutable base and bounded extension-block renderer; #20 selects valid static blocks without changing base wording. |
| #19 harness delivery | Consumes one composed snapshot for an eligible fresh generation; it retains sole ownership of delivery timing, retry, recovery, and ACP encoding. |
| Kitten MCP bridge | Supplies the first confirmed V1 vertical slice without exposing bridge endpoints, capability tokens, or MCP environment values. |
| Future capability cards #10–#15 | Supply facts and source-specific wording ownership as they gain confirmation evidence; they do not become active merely because a provider is named. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Unconfirmed capability claims | 0 per supported matrix | Golden and contract assertions that `unknown`, `absent`, stale, and conflicting facts select no matching fragment. |
| Deterministic composition | 100% equivalent results | Permutation tests: equivalent contexts always yield the same ordered fragment IDs and rendered output. |
| Safe base-only fallback | 100% of no-optional-capability cases | Unit and controller tests for custom, minimally capable, and invalidated contexts. |
| V1 vertical-slice accuracy | 100% of bridge active/inactive cases | Lifecycle tests bind evidence to the current fresh generation and assert inclusion only while it remains confirmed. |
| Prompt-budget compliance | 100% of outputs; ≤8 extensions and ≤800 extension tokens | Composer and renderer bound assertions, including overflow and conflict cases. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What percentage of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Must do |
| **Differentiation** | Does this set us apart or match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound? | Strong |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Compounding Feature**.

## Council Insights

- **Recommended approach:** a protocol-free, default-deny composer that proves one generation-valid capability slice and stages the rest.
- **Key trade-offs:** broad immediate coverage would be more visible, but would couple #20 to incomplete features and encourage unsafe inference. A base-only framework would be safer, but would not prove end-to-end selection.
- **Risks identified:** stale confirmation, contradictory facts, prompt drift, and content leakage.
- **Mitigations:** bind evidence to a live generation; revalidate before first delivery; make unknown/conflict base-only; freeze the harness after delivery; require deterministic matrix goldens and content-free diagnostics.
- **Stretch goal (V2+):** a lifecycle-wide capability-trust ledger with revocation observability, only after V1 establishes real source contracts.

## Out of Scope (V1)

- **Base harness wording, base-version policy, or extension bounds** — these remain owned by #18.
- **ACP transport, exactly-once delivery, retry, recovery, or provider-specific encoding** — these remain owned by #19 and `src/agent/`.
- **Activating every capability family** — a family activates only after it has authoritative, session-valid source evidence.
- **Live config-watcher redesign** — current reload behavior does not rebuild controller session configuration; a dedicated lifecycle feature would own that change.
- **Permissions, authorization, or security enforcement** — guidance informs agent behavior; Kitten’s existing controls remain authoritative.
- **A user-facing prompt editor or arbitrary dynamic prompt content** — this would weaken the static, reviewable trust boundary.

## Architecture Decision Records

- [ADR-001: Compose Fresh Harnesses from Confirmed Capability Snapshots](adrs/adr-001.md) — adopts a default-deny, generation-valid snapshot with a staged catalog and one real V1 slice.

## Open Questions

- Which proof artifact certifies the first bridge/child-control fragment as session-valid, and which upstream feature owns each sentence of its guidance?
- Should a semantic fragment revision receive its own stable ID version independently of the base harness version? Draft recommendation: **yes**—fragment IDs carry their own semantic version while the base contract’s version policy remains unchanged.
- What catalog-review checklist will prevent import cycles and wording duplication with tool schemas or role prompts? Draft recommendation: one catalog owner, declarative fragment metadata, and source-feature review for every activation.
