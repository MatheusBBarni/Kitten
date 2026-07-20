# Idea: Statusline Context Headroom Field

## Overview

Add **CONTEXT** as an optional, selectable **/statusline** layout field for Kitten. It renders the focused coding-agent session's existing remaining-context headroom as **ctx <remaining>%** and helps developers in long-running sessions decide when a voluntary handoff may be sensible.

V1 is a deliberately small visibility feature: it uses the existing content-free usage projection, omits itself when unavailable or invalid, and preserves the current declarative statusline model. It does not introduce warnings, handoff policy, new usage collection, or workflow automation.

## Problem

Kitten already exposes useful workspace and agent information through a customizable statusline, but a developer who saves a custom layout may lose the legacy footer's fixed context cue. That is most noticeable in a long-running agent session, when the developer wants a compact signal to decide whether to finish a unit of work or hand it to another live agent.

The information exists, but it is not a first-class field in the closed **/statusline** vocabulary. As a result, users cannot ask the existing statusline flow to include it in a saved layout, and the proposal contract cannot truthfully express that intent.

The need is credible in the wider coding-agent market. Claude Code explicitly positions context-window usage as statusline information and supplies a remaining-percentage value, while also documenting that the value can be absent before a response. That supports Kitten's optional-field and omission behavior. The 2025 Stack Overflow Developer Survey reports that 84% of developers who use AI agents at work use them for software development, making long-running agent-workflow visibility a relevant product problem.

### Market Data

- [Claude Code statusline documentation](https://code.claude.com/docs/en/statusline) supports persistent context-window monitoring and documents missing or null context values early in a session; Kitten can differentiate with a closed, non-executable field model.
- [Claude Code commands](https://code.claude.com/docs/en/commands) exposes both context inspection and statusline configuration, confirming that context visibility is an expected terminal-agent interaction.
- [Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai) reports that 84% of developers using AI agents at work use them for software development.
- Kitten already receives the needed signal through **usage_update -> SessionState.usage -> selectSessionHeadroom**, so the feature has no incremental API, storage, or telemetry cost.

## Summary / Differentiator

Competitors demonstrate demand for visible context, but often allow arbitrary command-backed statuslines. Kitten keeps the useful signal while retaining a strict allowlist, a deterministic renderer, explicit preview behavior, and no executable statusline surface.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | CONTEXT field contract | Critical | Add **CONTEXT** to the strict statusline layout validator and proposal parser as a supported identifier, never as a resolved runtime value in agent instructions. |
| F2 | Focused-session headroom rendering | Critical | Render **ctx <remaining>%** only from the focused session's existing content-free headroom projection. |
| F3 | Conservative unavailable handling | Critical | Omit **CONTEXT** and its adjacent separator until usage is known or when it is invalid; never substitute a false **0%** value. |
| F4 | Canonical preview and width behavior | High | Use the existing renderer for preview and saved layouts so grapheme-budget logic drops trailing fields deterministically on narrow terminals. |
| F5 | Legacy-footer compatibility | High | Preserve the current footer exactly when the user has no saved custom statusline layout. |

### Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Declarative statusline contract | Extend the closed field vocabulary without changing separator validation, duplicate rejection, or proposal parsing rules. |
| Selected-session usage projection | Reuse the existing content-free headroom selector; do not collect, normalize, or persist additional usage data. |
| **/statusline** proposal flow | List **CONTEXT** as an available identifier so a user can request it naturally, without leaking a resolved session value into the prompt contract. |
| Statusline preview and footer | Render custom layouts through the existing canonical renderer and retain the legacy path when no custom layout is saved. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Contract correctness | 100% of CONTEXT validator, parser, rendering, unavailable-state, and narrow-width acceptance tests pass | Automated focused test suite and full regression gate before release. |
| Legacy compatibility | 100% of no-custom-layout snapshots retain the legacy footer | Existing-footer regression tests across supported width fixtures. |
| Customization completion | At least 10 of 12 long-session users save a layout containing CONTEXT without assistance in 90 seconds or less | Moderated task-based usability study; no production telemetry required. |
| Signal comprehension | At least 9 of 12 study participants correctly identify the value as an informational remaining-headroom cue, not a guaranteed handoff countdown | Scripted comprehension check after the configuration task. |
| Handoff usefulness | At least 8 of 12 long-session participants report that the field helped them time a voluntary handoff in a realistic scenario | Moderated scenario debrief and qualitative evidence log. |
| Privacy integrity | 0 new telemetry events or persisted resolved context values | Code and configuration review plus automated persistence assertions. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What percentage of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set Kitten apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can Kitten deliver it credibly? | Strong |

Leverage type: **Quick Win**

## Council Insights

- **Recommended approach:** Ship **CONTEXT** only as an optional, read-only layout field backed by the existing focused-session headroom projection.
- **Key trade-offs:** Persistent visibility reduces interaction cost for long-running sessions, but a percentage can appear more precise or fresh than provider update timing warrants. V1 keeps the neutral field while treating correct selected-session ownership and conservative omission as release prerequisites.
- **Risks identified:** stale or provider-dependent values, user over-trust of a percentage, custom-layout width pressure, and scope creep into handoff policy.
- **Mitigations:** no urgency cues, thresholds, or automation; omit unavailable or invalid values; reuse the canonical renderer and trailing-field truncation; prove ownership and state transitions with focused tests.
- **Dissenting view:** An on-demand readout may be sufficient for occasional handoffs and avoids permanent chrome. The council still recommends the optional field because it reuses an existing layout seam and is reversible.
- **Stretch goal (V2+):** A trustworthy headroom-aware handoff experience, but only after users demonstrate demand and provider semantics can support it.

## Out of Scope (V1)

- **Freshness labels, provider provenance, low-context thresholds, or warnings** — these add semantics and visual policy before the base field proves useful.
- **Handoff recommendations or automation** — remaining context is an informational hint, not a reliable workflow-control signal.
- **New ACP usage collection, telemetry, or persisted resolved values** — reuse the existing content-free projection and preserve the current privacy boundary.
- **New session, isolation, or multi-session coordination flows** — the feature concerns only the focused session's display value.
- **Arbitrary templates, scripts, or dynamic statusline commands** — Kitten remains a closed, non-executable declarative statusline system.

## Architecture Decision Records

- [ADR-001: Keep CONTEXT as a local, optional, field-only headroom indicator](adrs/adr-001.md) — Add a bounded display field and defer policy, provenance UI, and automation.

## Open Questions

- Do all supported providers refresh valid usage data predictably enough after context-changing events for the neutral remaining percentage to be trustworthy?
- Which existing test seam best proves that a focus change cannot render headroom from the previously focused session?
- Should future customer research establish a different compact label, or is **ctx <remaining>%** immediately understandable across the target users?
