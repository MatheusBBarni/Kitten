# Agent Usage Gauge

## Overview

Kitten runs two AI coding agents (Claude Code + Codex) side by side and hands a live task between them.
The hard part of that workflow, in the words of people already doing it, is "a context management problem": knowing when a session is filling up and which agent still has room to take the task.

This feature gives Kitten an honest, always-on **context-headroom signal per agent**, placed exactly where the handoff decision is made - on each agent's chip in the status strip, and on the target agent inside the `Ctrl+T` handoff preview.
It is for the developer driving the cockpit, and it is valuable because it turns handoff timing from a gut feel into a glanceable cue: "Claude at 12% headroom, Codex has room - hand off now," before context rot or a hard limit forces a messy compaction.

V1 is a **Quick Win** scoped tightly to context fill only, built on an ACP signal Kitten already receives and currently discards. It is deliberately ambient rather than a summoned overlay, and honest about missing data rather than fabricating it.

## Problem

Developers increasingly run more than one coding agent at once and move work between them, but the tooling gives them no view of how full each agent's context window is.
Today in Kitten the decision to hand off is pure instinct: the user notices the current agent getting slower or vaguer and guesses it is time to switch. By then the window is often near full, the recent context has degraded ("context rot"), and the handoff carries less useful signal than it would have a few turns earlier.

The information to do better already exists but is thrown away. ACP emits a `usage_update` notification carrying the tokens currently in context and the total window size, and Kitten drops it at `src/agent/acpTranslate.ts:57`. So the cockpit that exists to move a task between two agents cannot tell the user which agent has room - the one comparison that would make the handoff a decision instead of a reflex.

The original framing was an on-demand `/usage` command. But a signal whose job is *timing* fails if the user has to remember to summon it: by the time you think to check, you already suspect the answer. The value only lands if the signal is ambient and sits at the decision point.

### Market Data

- **Adoption is near-universal, trust is falling.** 80% of developers use AI tools; trust in accuracy dropped 40% -> 29% year over year (Stack Overflow 2025 Developer Survey).
- **"Almost right" rework is the top frustration** - cited by 45%; 66% say they spend more time fixing almost-right AI code. Emptying/handing off *before* the window fills is a quality lever, not just a cost one.
- **Missing context is a named, measured problem.** ~65% of developers say AI misses relevant context; the #1 requested fix is "improved contextual understanding" (Qodo 2025 State of AI Code Quality).
- **Multi-agent is token-expensive** - 4-220x more tokens than single-agent (UIUC study); Anthropic reports ~15x for its own multi-agent system. Per-agent visibility directly addresses this surprise.
- **The comparison lane is open.** Every single-agent tool shows one agent's fill (Claude Code `/context`, Codex `/status`, aider `/tokens`, Cline, Roo Code, opencode, Continue). None compare two agents side by side as a handoff aid; Zed - the reference ACP host - does not even show usage for a single external ACP agent (open, unanswered request).
- **Reliability caveat.** ACP `usage_update` is optional and only stabilized 2026-06-05; real adapters lag (Zed's Codex ACP adapter emits none today), so V1 must handle absent data honestly.

## Summary / Differentiator

Kitten can own a lane no single-agent tool structurally can: a side-by-side, two-agent context-headroom signal that turns "when do I hand off?" from a gut feel into a glance.
The differentiator to lead with: *"Kitten is the only coding cockpit that shows both agents' context headroom side by side, right where you hand the task over, so you switch before context rot or a hard limit forces a messy compaction."*

## Core Features

| #  | Feature | Priority | Description |
| -- | ------- | -------- | ----------- |
| F1 | ACP usage ingestion | Critical | Translate the ACP `usage_update` (`used`/`size`) - currently dropped at `acpTranslate.ts:57` - into an absence-aware domain value derived once in the reducer/selector: `{status:'unknown'} \| {status:'known', used, size, percent}`. Instrument-first: confirm both adapters emit it. |
| F2 | Ambient per-agent headroom in status strip | Critical | Always-on headroom % + bar on each agent chip in `StatusStrip`, both agents shown honestly side by side. Selector projects a primitive so a tick for one agent never re-renders the other. |
| F3 | Headroom at the handoff moment | High | Show the target agent's headroom inside the existing `Ctrl+T` handoff preview, so custody and available room sit together at the decision point. |
| F4 | Honest absence handling | High | Unknown/absent data renders as a dash or an explicitly-approximate raw token count - never a fabricated percentage or a fake 0%. |
| F5 | Headroom framing and thresholds | Medium | Present as "headroom" with color bands tuned to the handoff decision (e.g., amber "consider handoff," red "hand off now"); optionally a segmented bar (used vs reserved) as the data allows, to avoid false precision. |

## KPIs

| KPI | Target | How to Measure |
| --- | ------ | -------------- |
| Context-aware handoff direction | > 70% of hand-offs where both agents report usage move work from the lower-headroom to the higher-headroom agent | Compare per-agent headroom at handoff time via the telemetry recorder |
| Earlier handoffs | Median focused-agent headroom remaining at hand-off > 20% (users switch before near-full) | Distribution of focused-agent headroom at `hand-off` events |
| Usage-data availability (Claude) | >= 90% of sessions surface Claude headroom within 3 turns | Presence of a `usage` event per session |
| Signal honesty | 100% - absent data is never rendered as a numeric percentage | Reducer/selector test + render assertion (dash or "approx" only for `unknown`) |
| Re-render isolation | 100% - a usage tick for one agent never re-renders the other agent's chip | Store/selector test asserting the untouched agent's slice keeps identity |

## Feature Assessment

| Criteria            | Question                                            | Score    |
| ------------------- | --------------------------------------------------- | -------- |
| **Impact**          | How much more valuable does this make the product?  | Strong   |
| **Reach**           | What % of users would this affect?                  | Must do  |
| **Frequency**       | How often would users encounter this value?         | Strong   |
| **Differentiation** | Does this set us apart or just match competitors?   | Strong   |
| **Defensibility**   | Is this easy to copy or does it compound over time? | Strong   |
| **Feasibility**     | Can we actually build this?                         | Strong   |

Leverage type: Quick Win, with a path to Compounding Feature (the ambient gauge becomes the substrate for an active custody advisor).

## Council Insights

- **Recommended approach:** Derive usage once as an honest, absence-aware domain value, then render it in two already-mounted leaves - a headroom segment on each status-strip chip and the target agent's headroom in the `Ctrl+T` handoff preview. Context only for V1; no overlay, no slash command, no token breakdown. Instrument-first.
- **Key trade-offs:** Ambient placement changes behavior but is unforgiving (a persistent "unknown" is more visible than a hidden overlay); the two-agent differentiator is strongest but depends on adapters that may not emit usage yet; the token breakdown and cost add plumbing without a V1 consumer.
- **Risks identified:** (1) Kitten does not own the denominator - reported window size may not equal the effective limit under auto-compaction/reserved headroom, so a raw % can mislead; mitigate with "headroom" framing and a segmented bar. (2) Neither adapter is confirmed to emit `usage_update`; mitigate with an instrument-first spike and honest "unknown." (3) Selecting the raw usage object breaks re-render isolation; mitigate by projecting a primitive.
- **Stretch goal (V2+):** An active **custody-advisor nudge** - Kitten proactively suggests the handoff when the focused agent crosses a headroom threshold and the other has room, with cost and task-fit as future inputs.

## Integration with Existing Features

| Integration Point | How |
| ----------------- | --- |
| `src/agent/acpTranslate.ts` | Translate `usage_update` into a new domain event instead of returning `null` |
| `src/core/types.ts`, `src/core/sessionReducer.ts` | New `DomainSessionEvent` kind + absence-aware `usage` field on `SessionState`; reducer case (forced by `assertNever`) |
| `src/store/selectors.ts` | Memoized per-agent `selectSessionUsage(sessionId)` returning a primitive/discriminant |
| `src/ui/StatusStrip.tsx` (`AgentStatusChip`) | Add the always-on headroom segment, reusing the existing per-agent subscription |
| `src/ui/HandoffPreview.tsx` | Show the target agent's headroom at the handoff decision |
| `src/telemetry` (recorder) | Log usage arrivals and correlate with `hand-off` events for the KPIs |

## Out of Scope (V1)

- **On-demand `/usage` overlay** - Deferred to V2 as a detailed drill-down; ambient placement supersedes it for the timing job, and it would need Kitten's first slash-command parser plus modal machinery for the least-seen surface.
- **Per-turn token breakdown (input/output/cache)** - A different, experimental ACP source (`PromptResponse.usage`) with no V1 consumer now that cost is out; shaped to slot in additively later.
- **Cost / spend display** - ACP `cost` is optional and unevenly reported; deferred until the usage pipeline and cost semantics are proven.
- **Slash-command parser / registry** - Not needed for an ambient V1; introduce a single named parse seam only when a real command is wanted.
- **Local token-count estimation of Codex fill** - Rejected: an undercounted numerator over a guessed denominator is a fabricated percentage that violates Kitten's under-report-never-fabricate invariant.
- **Active handoff recommendation / nudge** - The V2+ stretch; premature on data whose trustworthiness is not yet validated.

## Architecture Decision Records

- [ADR-001: Ambient per-agent headroom gauge over an on-demand `/usage` overlay](adrs/adr-001.md) - V1 places context headroom as an always-on signal in the status strip and handoff preview, context-only and absence-aware, instead of a summoned overlay.

## Open Questions

- Does Claude Code's ACP adapter actually emit `usage_update`? Does Codex's? (Resolve with the instrument-first spike before UI work.)
- Does the reported `size` reflect the *effective* limit after internal auto-compaction and reserved output headroom? If not, how do we present headroom without false precision - a segmented bar (used vs reserved)?
- Should the gauge read "% remaining" (headroom) or "% used"? The council leaned toward headroom framing; confirm the exact wording and thresholds.
- What are the amber ("consider handoff") and red ("hand off now") threshold values? They need tuning against real sessions.
- Does the telemetry recorder already emit correlatable `hand-off` and usage events, or are new events required for the KPIs?
