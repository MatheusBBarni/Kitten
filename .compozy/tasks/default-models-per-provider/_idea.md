## Overview

Kitten should let an individual developer define a default model and reasoning effort for each provider in their personal `config.json`. When they intentionally move to a session for another provider through `/model`, Kitten applies that provider’s saved preference and shows the agent-confirmed result.

V1 is a focused workflow improvement: remove repetitive configuration without changing provider ownership, writing user config, or making hidden runtime changes.

### Summary / Differentiator

Unlike a global default, Kitten makes a multi-agent workspace predictable: each provider session returns to the developer’s chosen model-and-effort profile when they deliberately select it. It remains truthful when a saved value is stale or unsupported.

## Problem

Developers working across Claude Code and Codex repeatedly configure model and reasoning effort after changing the active provider. This adds friction precisely where Kitten should make switching agents feel seamless. A model-only preference is incomplete because reasoning effort materially affects speed, cost, and output quality.

Persisted model preferences are a familiar pattern in coding-agent tools, but Kitten needs to preserve its defining reliability property: it must display only values the live agent has confirmed. A saved default cannot become an optimistic UI claim, nor can it silently alter a session because a config file changed.

### Market Data

- JetBrains’ 2026 AI Pulse survey reports that 90% of surveyed professional developers regularly use AI for development and 74% use specialized developer-AI tools. [Source](https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/)
- Research across 129,134 GitHub projects estimated coding-agent adoption at 15.85–22.60% in early 2025. [Source](https://arxiv.org/abs/2601.18341)
- Claude Code and GitHub Copilot CLI both support persistent model-related preferences; Aider demonstrates the importance of capability-aware reasoning controls. [Claude Code](https://code.claude.com/docs/en/model-config), [Copilot CLI](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference), [Aider](https://aider.chat/docs/config/reasoning.html)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Per-provider defaults | Critical | Personal `config.json` may declare an optional default model and reasoning effort for each known provider. |
| F2 | Intentional automatic application | Critical | When the user selects a provider-backed session through `/model`, Kitten attempts that provider’s configured default without another confirmation step. |
| F3 | Capability-aware effort resolution | Critical | Kitten applies the model first and applies reasoning effort only when the refreshed agent-advertised options support it. |
| F4 | Confirmed-result feedback | High | The selector and status UI show the actual agent-confirmed model and effort, including when a configured default was unavailable or only partly applied. |
| F5 | User-owned preferences | High | Manual model or effort changes remain session-local; Kitten never rewrites `config.json`, and config reloads do not alter active sessions. |

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Config loading and validation | Extend the strict personal configuration with optional per-provider defaults. |
| `/model` selector | Apply defaults only after the user deliberately selects another provider-backed session. |
| Agent-confirmed configuration state | Continue treating the live agent response as the sole source of truth for the displayed model and effort. |
| Status strip | Make the resulting provider, model, and effort legible after selection. |
| Config watching | Use the latest valid defaults on a future `/model` selection; never mutate a live session merely because the file changed. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Confirmed default application | ≥95% of eligible default applications confirm both values | Opt-in, content-free local counters for requested and confirmed model/effort defaults |
| Unsupported-default safety | 100% preserve verified state and show an honest result | Automated configuration, controller, and UI regression tests |
| Switching friction | 0 extra confirmation steps after the user selects a provider with a valid default | End-to-end `/model` interaction test |
| Configuration integrity | 0 application-originated config writes | Integration test plus filesystem seam assertions |
| Strict validation | 100% malformed or unknown default fields fail loudly | Schema and boot-path tests |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What percentage of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Must do |

Leverage type: **Quick Win**

## Council Insights

- **Recommended approach:** Honor the user’s intentional provider/session selection in `/model` by applying that provider’s saved model-and-effort default, while displaying only confirmed runtime state.
- **Key trade-offs:** Automatic application eliminates repeated setup but can surprise users if it overwrites an established manual choice. Limit it to explicit `/model` provider/session selections and never to config reloads or passive focus changes.
- **Risks identified:** A model change can change the available effort choices. The resulting UX must describe the actual confirmed outcome rather than claim the saved pair succeeded.
- **Stretch goal (V2+):** Context-aware routing that recommends or selects a provider/model/effort based on the workspace or task.

## Out of Scope (V1)

- **Settings UI for editing defaults** — `config.json` remains the personal source of truth in V1.
- **Writing manual selections back to config** — avoids hidden persistence and preserves user-authored configuration.
- **Applying defaults after config reload** — prevents unexpected changes to live agent sessions.
- **Provider replacement or agent respawning** — `/model` selects among existing live sessions; this feature does not change that boundary.
- **Context-aware recommendations or routing** — defer intelligence and automation beyond explicit user selection.
- **Permission, mode, or other agent options** — defaults cover model and reasoning effort only.

## Architecture Decision Records

- [ADR-001: Apply per-provider defaults on intentional model-session selection](adrs/adr-001.md) — preserve the requested automatic behavior while keeping confirmed runtime state authoritative.

## Open Questions

- What exact user-facing wording should distinguish “default applied,” “effort unavailable,” and “default rejected”?
- If the model is confirmed but its saved effort is unavailable, should Kitten describe this as a partial application or as a skipped default?
- Should a later version offer a guided command or settings view that generates the user’s config entry without directly mutating it?
