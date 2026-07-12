# Idea: Claude Code-Style TUI Reskin

## Overview

Kitten is a two-agent terminal cockpit that runs Claude Code and Codex side by side over the Agent Client Protocol and hands a live coding task between them.
Its chrome today is functional but plain: a bordered transcript, a prompt box, and a status strip that shows only each agent's name and status.
This idea reskins that chrome in Kitten's own visual language, borrowing the genre grammar that Claude Code, Gemini CLI, Copilot CLI, and Charm's Crush all share - a calm warm-accented palette, a welcome banner, and a rich always-on status line - while keeping Kitten's layout, hand-off flow, and interactions unchanged.

It is for two people: the daily dual-agent operator who must always know which agent, model, branch, and context-headroom is live, and the first-time evaluator who decides in thirty seconds whether the tool looks trustworthy.
The V1 is a disciplined chrome reskin, not a redesign.
Its north star is "make Kitten's dual-agent cockpit feel calm, clear, and unmistakably Kitten" - Claude Code's look is a floor to clear, not a target to clone.

## Problem

Kitten's single most differentiated capability - two agents with a one-keystroke hand-off - is also its least legible one.
The status strip shows a name and a status and nothing else: not which model each agent runs, not the branch you are about to commit into, not how close either agent is to context exhaustion.
In a cockpit whose entire premise is swapping a task between two agents, the operator cannot answer "who has the task right now, on which model, with how much room left" at a glance.
That is the clarity gap, and it is felt on every hand-off.

The first-run experience has the opposite problem.
Launching Kitten drops the user onto a bordered empty pane with a single muted line, "No messages yet. Type a prompt to start the conversation."
Next to Claude Code's branded welcome screen, that reads as unfinished, and first impressions are where a hobby-scale tool earns or loses trust.

### Market Data

The 2025-2026 convention across the top coding-agent CLIs is a filled/gradient ASCII banner plus a persistent status line carrying model, directory, git branch, and context-usage %.
Charm's Crush is the repeated polish benchmark ("the best-looking AI CLI tool"), and its signature is a status bar that always tells you which model you are talking to.
Toad (Will McGugan) is the closest conceptual neighbor - a multi-agent ACP front-end - but it is Python/Textual and not richly styled; no one applies polished, native chrome to a two-agent *hand-off* cockpit.
Two cautions recur: the single most-cited Claude Code complaint is an unskippable, slow splash, and Claude Code's own accent silently moved from orange to blue (v2.0.67, undocumented), so it is a moving imitation target.
The AI coding-assistant space is large and growing roughly 25-30% per year, and the terminal form factor is with the grain of current developer preference.

## Summary / Differentiator

Kitten's angle is the one surface no competitor styles: a dual-agent status bar where both agents' focus, model, and context-headroom sit side by side with the hand-off key always in view, so the chrome itself communicates the cockpit's premise.
The banner earns the install; the dual-agent bar is the surface users live inside for hours and cannot get anywhere else.

## Core Features

| #   | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1  | Dual-agent status bar | Critical | Always-on bottom bar with a lozenge per agent (focus marker, name, live model when reported, status), plus shared cwd and git branch; context-usage % lights up via the usage-gauge seam. Renders only signals it can stand behind (hide-when-absent). |
| F2  | Warm-accent palette + prompt restyle | Critical | Rounded borders, generous spacing, a chevron prompt, and Kitten's branded warm accent registered as a preset on the ADR-005 palette registry; legible in dark, light, and no-truecolor terminals. |
| F3  | Welcome banner + simple mascot | High | Static, non-blocking idle-screen banner: a small ANSI-safe box-drawing kitten, a greeting, and the model/account/cwd summary. Collapses to a one-line greeting under narrow width or limited terminal capability. |
| F4  | 80-column priority-collapse budget | High | Fixed status-bar slots with a declared shed order (branch, then context%, then effort) as width tightens; empty slots collapse to zero width; enforced by an updated `StatusStrip.test`. |
| F5  | Additive signal seams | Medium | The bar consumes model+effort (`ConfigOption[]` on `SessionState`) and context-usage (`usage_update`) through the existing pending seams; git branch is read by a thin provider off the render path. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Glance-test orientation | >= 90% of testers identify focused agent + its model + context headroom in < 3s | 5-user moderated usability test on the reskinned build |
| Operational signal coverage | >= 5 signals visible at >= 80 cols with graceful degradation below | Snapshot render at 80 / 100 / 120 cols |
| First-impression polish | >= 80% rate the launch screen "looks finished/professional" >= 4/5 | Qualitative rating, same cohort |
| Theme + capability correctness | 100% legibility across dark, light, and no-truecolor terminals; accent consistent everywhere | Render matrix across 3 terminal profiles |
| Zero UX regression | 100% of existing UI tests pass; no flicker on repaint; hand-off/switch/approval/help unaffected | `bun test` + manual E2E |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Must do |
| **Frequency** | How often would users encounter this value? | Must do |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: Quick Win for the visual layer, riding a Compounding seam for the dual-agent status bar.

## Council Insights

- **Recommended approach:** Ship all three pieces, sequenced - palette/prompt restyle first (pure, low-risk), then a simple non-blocking banner, then the restructured dual-agent status bar that renders today's real signals and lights up model+effort and context-% additively. Frame it as "unmistakably Kitten," with the hand-off as the signature.
- **Key trade-offs:** Ship honest value now vs coupling the full clarity win to pending data features; brand charm of a mascot vs its cross-terminal render risk; matching genre convention vs importing Claude Code's disliked splash.
- **Risks identified:** Sequencing dependency on `model-effort-selector` + `agent-usage-gauge` (mitigate: confirm they are next; ship the bar honest/additive regardless); 80-column collision (mitigate: fixed slots + priority-collapse + updated test); cross-terminal mascot fragility (mitigate: ANSI-safe fixed grid + capability gating + one-line fallback); splash annoyance (mitigate: static, instant, non-blocking); theme regressions (mitigate: route all color through the palette registry preset).
- **Stretch goal (V2+):** A "hand-off HUD" that visualizes task ownership and enriches the hand-off preview, turning the chrome into a live demonstration of Kitten's unique capability.

## Out of Scope (V1)

- **Tips / What's-new panel** — deselected by the owner; adds banner complexity without serving the core polish or clarity goal.
- **Elaborate or animated mascot** — cross-terminal render risk and authoring cost are disproportionate to a one-time payoff; deferred to V1.1 once the simple version proves stable.
- **Hand-off HUD / interaction redesign** — scoped as chrome only; layout, hand-off, and interactions stay unchanged. Banked as the V2 stretch.
- **Near-exact Claude Code clone** — Kitten keeps its own identity, and Claude Code's accent is a moving, undocumented target not worth chasing.
- **Building the model+effort and context-usage data features** — owned by their own task packets; the reskin consumes their seams, it does not build them.

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| `theme.ts` palette + ADR-005 registry | Register Kitten's warm accent as a named preset; extend palette objects, never inline hex in components |
| `StatusStrip` + ADR-004 narrow subscriptions | Each chip subscribes to its own store slice so one agent's update never repaints the other |
| `model-effort-selector` seam | Status bar reads model+effort from `ConfigOption[]` on `SessionState` |
| `agent-usage-gauge` seam | Status bar reads the translated `usage_update` context-headroom on the same chip it already targets |
| Conversation empty state | The welcome banner replaces today's single `EMPTY_TRANSCRIPT_HINT` line |

## Architecture Decision Records

- [ADR-001: V1 Scope for the Claude Code-Style TUI Reskin](adrs/adr-001.md) — Ship palette/prompt + simple banner + restructured dual-agent status bar, sequenced, with hide-when-absent honesty and 80-column priority-collapse, built on existing palette and status-signal seams.

## Open Questions

- Are `model-effort-selector` and `agent-usage-gauge` genuinely next in the queue? The status bar's full clarity payoff is coupled to them.
- What is the exact git-branch read-model and its fallbacks (detached HEAD, non-repo cwd, submodules, latency)?
- Who authors the ANSI-safe kitten mascot, and what is the precise fallback threshold (columns / color capability)?
- Do we want density presets (full / minimal) in V1, or defer them?
- Should the banner appear on every launch, or quiet down after first run?
