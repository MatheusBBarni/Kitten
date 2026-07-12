# @ File Selector

## Overview

Kitten should let any user type `@` while composing a prompt, find one repository file for the focused session, and insert a visible repository-relative file reference without leaving the keyboard.

The feature solves prompt-composition friction for developers who know a file is relevant but do not want to recall, type, or copy its exact path. V1 is intentionally narrow: it validates whether fast, explicit file references become habitual before Kitten invests in provider-specific attachment semantics or richer context controls.

### Summary / Differentiator

The differentiator is not a broader `@` menu. It is **provider-neutral, one-keystroke file grounding**: the same clear, keyboard-first file-reference flow works regardless of the active agent, while staying honest about what the reference guarantees.

## Problem

Developers frequently need to direct an agent to a known file: explain `src/app/controller.ts`, update a test, or review the config. Today, they must remember and manually enter a path, copy it from another tool, or write an ambiguous filename. Each workaround interrupts composition and invites errors, especially in repositories with duplicate filenames or unfamiliar directory structures.

Kitten already supports prompt-local command completion, but it does not provide repository file discovery. The absence is more visible because Kitten is a terminal cockpit for multiple agents: users should not have to learn or depend on provider-specific file-reference syntax. The selected item must be presented as an explicit file reference rather than implying guaranteed file-content attachment across every provider.

### Market Data

- Cursor documents `@Files` search, path previews for disambiguation, and keyboard selection—strong evidence that developers already understand the interaction. [Cursor @Files](https://docs.cursor.com/context/%40-symbols/%40-files)
- GitHub Copilot CLI supports `@` followed by a relative path, shows matching paths, and lets users navigate suggestions from the prompt. [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview)
- Aider advises adding only relevant files because broad context can distract the model and increase token cost; that supports a deliberate single-file V1. [Aider FAQ](https://aider.chat/docs/faq.html)
- GitHub reported a 55% speed improvement for a broader Copilot coding experiment, but that is directional evidence for reducing workflow friction—not a claim about file selection specifically. [GitHub research](https://github.blog/news-insights/research/research-quantifying-github-copilots-impact-on-developer-productivity-and-happiness/)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | `@` trigger and single-file selection | Critical | Typing `@` in a prompt opens a selector for one repository-relative file associated with the focused session. |
| F2 | Keyboard-first search and acceptance | Critical | Typed characters filter candidate paths; arrows move the active option, Enter accepts it without sending the prompt, and Escape dismisses it unchanged. |
| F3 | Session-scoped, bounded discovery | Critical | Candidates come from the focused session’s repository context, respect the intended file boundary, and remain bounded so a large repository cannot block composition. |
| F4 | Honest visible file reference | High | Selection inserts a clear, inspectable file reference into the prompt; it does not claim that the file is universally attached as agent context. |
| F5 | Resilient empty and failure states | High | No matches, slow discovery, or discovery failure leave ordinary typing available and give a legible result instead of disrupting the prompt. |

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Prompt editor | Extend its existing prompt-local completion interaction with an `@` mode that remains mutually exclusive with command completion. |
| Keyboard conventions | Reuse the existing navigation, confirmation, and dismissal behavior so the selector does not change prompt-submission expectations. |
| Focused session model | Scope candidate files to the active session’s working directory rather than assuming one global repository. |
| Prompt sending | Send the selected reference as visible prompt content; do not change the established tool-derived file-reference history. |
| Handoff and multi-agent workflow | Preserve a consistent file-reference interaction across active providers without introducing provider-specific UI syntax. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Eligible-session adoption | ≥20% within 30 days of release | Share of ready prompt sessions with at least one accepted `@` selection. |
| Selection speed | Median ≤2.0 seconds | Time from `@` invocation to accepted file reference. |
| Selector completion | ≥70% | Accepted selections divided by initiated non-empty `@` queries. |
| Wrong-file correction | <5% | Accepted references removed or replaced before prompt submission. |
| Warm result latency | p95 ≤100 ms | Time from query change to rendered candidate results after the repository source is available. |
| Prompt-friction reduction | ≥30% lower median time | Compare a usability baseline for manually adding a known path with the selector flow. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set us apart or just match competitors? | Maybe |
| **Defensibility** | Is this easy to copy or does it compound over time? | Pass |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Quick Win**

## Council Insights

- **Recommended approach:** ship an honest, provider-neutral single-file reference experiment. Use a real but bounded, on-demand source for the focused session; do not build durable indexing or attachment infrastructure first.
- **Key trade-offs:** a useful selector requires real discovery, but persistent indexing would overbuild V1; familiar `@` UX improves adoption, but it can imply attachment semantics that are not guaranteed across providers.
- **Risks identified:** misleading context expectations, session-working-directory mistakes, large-repository latency, stale/noisy candidates, and accidental `@` activation. Mitigate with explicit file-reference language, provider behavior validation, bounded discovery, normal typing on failure, and keyboard-driven explicit acceptance.
- **Stretch goal (V2+):** a provider-aware context composer that shows whether the selected file is truly included as agent context and offers a visible context ledger.

## Out of Scope (V1)

- **Guaranteed provider-specific file attachment** — requires a cross-provider contract that is too expensive to build before demand is validated.
- **Multiple file, folder, or symbol selection** — broadens token, relevance, and interaction complexity beyond the single-file hypothesis.
- **Persistent index, watcher, or cross-session cache** — turns a composition feature into long-lived repository infrastructure and increases stale-state risk.
- **User configuration and personalization** — filters, scopes, and ranking preferences should wait for real adoption data.
- **Changing agent-observed file history** — the existing file-reference state must remain derived from actual agent tool activity.
- **Search outside the session repository boundary** — avoids unclear scope, privacy, and trust expectations.

## Architecture Decision Records

- [ADR-001: Keep @ File Selection as an Honest, On-Demand Single-File Reference](adrs/adr-001.md) — Defines the narrow V1, semantic boundary, and explicit exclusions.

## Open Questions

- What exact inline wording best communicates file reference inserted without confusing users about provider-specific context behavior?
- Which repository-file policy should define candidates in V1, including untracked, ignored, generated, binary, symlinked, and nested-repository files?
- What baseline task and opt-in telemetry design should be used to measure the promised reduction in prompt-composition time?
- What provider-specific behavior must be verified before release to ensure the selector is not misleading?
