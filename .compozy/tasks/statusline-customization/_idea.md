# Idea: Conversational Statusline Customization (`/statusline`)

## Overview

Kitten's status strip already exposes valuable workspace and agent context, but its order and density are fixed. An individual developer cannot express "show the shortened branch, model, effort, and a compact help hint" without a bespoke product change.

`/statusline` lets the developer describe that outcome in natural language. Kitten returns a safe, declarative proposal, renders the exact statusline preview and config diff, and persists it only after explicit confirmation. V1 is a focused personal-customization feature, not a general scripting platform.

The layout uses an ordered line such as:

```json
{
  "statusline": {
    "separator": " · ",
    "line": ["FOLDER", "ELLIPSIS_BRANCH", "PROVIDER", "MODEL", "EFFORT", "HELP_TEXT"]
  }
}
```

## Problem

A fixed status line forces every developer into the same information hierarchy, despite different workflows: some need the full path to distinguish worktrees, others need a shortened branch, and some value model and effort visibility over persistent help text. Manual configuration syntax would solve only part of the problem because users must translate intent into the product's data model.

Existing tools validate the expectation. Claude Code offers natural-language `/statusline` customization, but its command-backed design can generate a script that runs during rendering. [Claude Code statusline docs](https://code.claude.com/docs/en/statusline) Kitten should preserve the conversational convenience while avoiding arbitrary executable output.

### Market Data

- [Codex's configuration schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json) uses an ordered set of built-in status items, showing that declarative composition is a viable safe baseline.
- [Gemini CLI settings](https://geminicli.com/docs/cli/settings/) expose footer visibility controls for current directory, model, sandbox state, and context information.
- Claude Code's flexible script approach confirms demand, but also highlights the differentiation: Kitten can make every proposed change bounded, previewable, and non-executable.

## Summary / Differentiator

Kitten combines intent-first configuration with deterministic output: the LLM interprets the request, while Kitten alone validates, previews, renders, and saves the result. A developer can say what they want without receiving an opaque script or trusting an automatic change.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Conversational `/statusline` | Critical | A dedicated flow accepts a natural-language request for the developer's personal statusline. |
| F2 | Declarative field layout | Critical | Support only `FOLDER`, `FULL_PATH`, `BRANCH`, `ELLIPSIS_BRANCH(maxChars)`, `PROVIDER`, `MODEL`, `EFFORT`, and `HELP_TEXT`, plus a printable separator. |
| F3 | Exact preview and confirmation | Critical | Render the proposed line at real terminal width, show the exact config diff and destination, then require explicit Save or Cancel. |
| F4 | Safe persistence and privacy | Critical | Persist only the validated layout; never persist the request, raw LLM response, or resolved runtime values. No scripts, commands, ANSI, or statusline telemetry in V1. |
| F5 | Preset recovery path | High | Offer three fixed layouts using the same schema when the LLM is unavailable, the request cannot be satisfied, or the user prefers a fast choice. |
| F6 | Honest unavailable-state handling | High | Explain unsupported requests, absent values, validation failures, and whether saving takes effect on the next launch. |

### Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Status strip | Render from the approved ordered layout instead of a hard-coded sequence. |
| Slash-command registry | Add `/statusline` as a Kitten action that opens the dedicated request/review flow. |
| User `config.json` | Add a strict `statusline` block and preserve unrelated configuration during save. |
| Existing preview patterns | Reuse Kitten's explicit-review philosophy without coupling this feature to hand-off safety behavior. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| First-creation completion | ≥9 of 12 usability-study participants save a layout unaided | Moderated pre-release usability study |
| Time to satisfactory layout | Median ≤90 seconds | Time from `/statusline` invocation to confirmed save |
| Preview comprehension | ≥10 of 12 participants correctly predict the saved line before confirmation | Ask participants to identify the expected result from the preview |
| Explicit-consent integrity | 100% of writes follow a visible confirmation | Acceptance tests and usability observation |
| Safety boundary | 0 executable outputs or retained request/model-response content | Schema, persistence, and privacy acceptance tests |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make Kitten? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Must do |
| **Differentiation** | Does this set Kitten apart? | Strong |
| **Defensibility** | Does value compound? | Maybe |
| **Feasibility** | Can Kitten deliver it credibly? | Strong |

Leverage type: **Quick Win with a compounding interaction pattern**

## Council Insights

- **Recommended approach:** Conversational creation is the primary V1 path; it compiles intent into a closed declarative layout, then previews and explicitly saves it.
- **Key trade-offs:** Include three schema-native presets as a fallback, but do not build a visual editor or a second configuration system.
- **Risks identified:** Prompt injection, terminal-control characters, preview/save drift, unsafe config writes, narrow-terminal overflow, and unclear off-device processing.
- **Mitigations:** Strict allowlist, one canonical renderer for preview and runtime, explicit data-use disclosure, atomic symlink-safe save, no content retention, and deterministic omission/truncation.
- **Stretch goal (V2+):** Generalize the proven "describe → validate → preview → save" pattern to other bounded personal settings.

## Out of Scope (V1)

- **Shell scripts, arbitrary templates, ANSI, timers, and dynamic commands** — these turn statusline configuration into an execution platform.
- **Multiline layouts and a visual drag-and-drop editor** — they broaden presentation complexity before the core request/review loop is validated.
- **Project, team, or repository-specific profiles** — precedence and sharing rules are separate product decisions.
- **Cost, rate-limit, and arbitrary external data fields** — availability and refresh semantics are not yet dependable.
- **General conversational settings management** — the pattern must prove value for statuslines first.

## Architecture Decision Records

- [ADR-001: Constrain V1 to declarative conversational statusline configuration](adrs/adr-001.md) — use an LLM only to interpret intent; persist a bounded, validated, non-executable layout.

## Open Questions

- Which LLM/agent processes the request, and how will Kitten disclose any off-device processing before submission?
- Should an approved layout apply only after restart in V1, or should it change the active session immediately?
- What three presets best cover the initial fallback path?
- What separator characters are permitted beyond printable single-line text?
- Should repeated fields be rejected, deduplicated, or allowed deliberately?
