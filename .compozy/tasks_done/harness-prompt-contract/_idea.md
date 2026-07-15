# Versioned Kitten Harness Prompt Contract

## Overview

Kitten will own one concise, versioned, provider-neutral harness prompt contract for fresh ACP sessions. It gives maintainers a single reviewable source of truth for stable host guidance; developers benefit later when #19 delivers it.

V1 is a small, independent foundation: a static base contract, pure deterministic rendering, strict change policy, and a bounded static extension seam for #20. It does not change ACP lifecycle behavior or agent permissions.

## Summary / Differentiator

Most instruction systems concatenate context with uncertain ordering. Kitten’s differentiator is a deliberately small, deterministic contract: stable IDs, exact golden output, semantic-review policy, and no dynamic content in the base. It is guidance—not authorization.

## Problem

An ACP host can improve agent behavior by stating stable operational facts instead of acting as a context-free transport. Today, Kitten has no canonical contract for such guidance. Any future wording risks being scattered through transport code, coupled to providers, or silently changing without review.

This matters because maintainers need to distinguish a harmless formatting edit from a behavioral change, while users need agents to report outcomes honestly and verify work before claiming success. The contract must never claim tools, permissions, or workflows that Kitten has not exposed.

### Market Data

ACP explicitly separates the host/client from the agent, keeping host-controlled permission and UX policy outside the agent transport. Existing tools also normalize repository guidance, but VS Code notes that multiple instruction files have no guaranteed combination order. Kitten can improve on that with deterministic composition and visible contract diffs. [ACP architecture](https://agentclientprotocol.com/get-started/architecture), [VS Code custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions)

Trust is also a product concern: Stack Overflow’s 2025 survey reports 46% of developers distrust AI-output accuracy. A concise verification-oriented contract reinforces accountability without pretending that prompt text is a security control. [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/ai)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Canonical base `v1` contract | Critical | One static, provider-neutral contract owned in a pure Kitten domain module. It is capped at 150 tokens and contains no user, repository, environment, provider, or transcript content. |
| F2 | Deterministic pure renderer | Critical | Render the base first in a fixed tagged envelope, then zero or more bounded extension blocks in lexical stable-ID order. Use LF-only whitespace and deterministic escaping; the core imports no ACP types. |
| F3 | Version and change policy | High | Expose immutable versions such as `v1`. A directive, guarantee, or behavioral-meaning change creates a new version; spelling, grammar, or layout-only corrections retain the version but require an explicit review classification and golden diff. |
| F4 | Narrow extension seam | High | Define stable lowercase dot-separated block IDs such as `base.v1` and `capability.<name>.v1`. Reject malformed or duplicate IDs, permit at most 8 extension blocks and 800 extension tokens, and ship V1 with no optional blocks. |
| F5 | Review and safety evidence | High | Add exact base-only golden tests plus semantic assertions, invalid-input tests, and a source-boundary test that proves the module has no ACP/adapter imports. Diagnostics, if later added, may contain only version, static block IDs, count, and fixed outcome code. |

Proposed base wording:

```text
<kitten_harness version="v1">
Kitten is the host; ACP is the execution boundary.
Follow repository instructions and the user's request according to their normal precedence.
Report outcomes accurately and perform appropriate verification before claiming success.
Kitten's runtime permission and confirmation controls remain authoritative for consequential actions.
Use only tools and capabilities exposed to this session.
</kitten_harness>
```

The tags are deterministic text delimiters only. They grant no authority, are not a parser contract, and do not defend against prompt injection. Extension content must reject control characters and escape delimiter-relevant text; V1 itself accepts no dynamic inputs.

## Integration with Existing Features

| Integration point | How |
| --- | --- |
| `src/core/` | Owns the canonical wording, versions, validated block model, and pure renderer. |
| #19 delivery card | Consumes rendered text and owns ACP encoding, fresh-session timing, retries, and transcript visibility. |
| #20 composition card | Selects only confirmed capability fragments through the sealed block seam; it does not change the base wording. |
| Existing test conventions | Colocated pure tests provide exact output, semantic checks, and layering evidence. |

## KPIs

| KPI | Target | How to Measure |
| --- | ---: | --- |
| Base-contract size | <=150 tokens | Token-count assertion against the canonical base body. |
| Reviewable supported versions | 100% | Every supported version has an exact base-only golden fixture. |
| Fail-closed invalid rendering | 100% of defined invalid cases | Tests cover unknown version, malformed/duplicate ID, bounds, whitespace, and escaping failures. |
| ACP transport dependencies in the contract module | 0 | Source-boundary test rejects ACP SDK and adapter imports. |
| Classified contract changes | 100% | Each wording change declares semantic-version impact and produces a visible golden diff. |
| Dynamic/sensitive content in the base or diagnostics | 0 fields | Fixture and diagnostic-shape tests allow only reviewed static text and content-free metadata. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Must do |

Leverage type: **Quick Win** — a constrained enabling feature that unlocks #19 and #20 without entangling their concerns.

## Council Insights

- **Recommended approach:** Ship a small, static, ACP-free `v1` contract with deterministic tagged rendering and a sealed static extension seam.
- **Key trade-offs:** A base-only string would be simpler, but fails the required #20 boundary; a generic fragment platform creates premature abstraction and an unsafe dynamic-content path.
- **Risks identified:** Tags could be mistaken for enforcement; the extension seam could expand into a prompt platform; wording drift could change behavior silently.
- **Mitigations:** State that runtime controls are authoritative; ship no optional V1 fragments; enforce strict bounds and fail-closed validation; require exact goldens and semantic change classification.
- **Stretch goal (V2+):** A governed catalog of capability fragments selected from confirmed runtime facts, owned by #20.

## Out of Scope (V1)

- **ACP delivery, exactly-once state, retry, resume, or transcript behavior** — #19 owns lifecycle and transport semantics.
- **Capability inference, fragment registry, or runtime selection** — #20 owns confirmed capability composition.
- **Provider-specific message encoding** — provider adaptation remains in `src/agent/`, outside the domain contract.
- **User-facing prompt editing or arbitrary configuration text** — would break the reviewed-static-content boundary.
- **Authorization, permission grants, or injection defense by prompt text** — Kitten runtime controls remain authoritative.
- **RepoPrompt prompt copying or repository-context injection** — only its architectural lesson is relevant.

## Architecture Decision Records

- [ADR-001: Keep the Harness Contract Static, Deterministic, and Narrowly Extensible](adrs/adr-001.md) — selects a static base and bounded extension seam while excluding a generic prompt platform.

## Open Questions

No unresolved product-scope questions remain for V1. The TechSpec must turn this contract into exact types and tests, but must preserve the decisions above.
