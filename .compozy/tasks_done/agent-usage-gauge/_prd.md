# PRD: Agent Usage Gauge

## Overview

Kitten runs two AI coding agents (Claude Code and Codex) side by side and hands a live task between them.
The moment that decides whether a hand-off helps is *timing*: switch while the current agent still has room and fresh context, and the receiving agent inherits a clean slate; switch too late and you hand over a nearly full, degraded window.
Today Kitten gives the user nothing to judge that by - the decision is pure instinct.

This feature adds an always-on, per-agent **context-headroom** signal, shown where the hand-off decision is made: on each agent's chip in the status strip, and on the target agent inside the `Ctrl+T` hand-off preview.
It is for the developer driving the cockpit. It is valuable because it turns hand-off timing from a guess into a glance - "Claude is nearly full, Codex has room" - and because no competing tool shows two agents' context side by side as a decision aid.

The signal is built on data ACP already sends and Kitten currently discards. The MVP is deliberately honest and neutral: it shows what it can measure, marks the rest as "unknown," and never fabricates a number.

## Goals

- Give the user a reliable, at-a-glance read of each agent's remaining context, positioned at the hand-off decision point.
- Prove the underlying data path: confirm the agents actually report usage, and render it honestly.
- Establish the side-by-side, two-agent headroom comparison as a differentiator no single-agent tool offers.
- Lay an additive foundation for later phases (calibrated thresholds, behavior-change measurement, an active hand-off recommendation) without over-building the first release.

Success is measured first by availability and honesty (see Success Metrics), then, in Phase 2, by whether users hand off earlier and in the right direction.

## User Stories

**Primary persona - the cockpit driver** (a developer running Claude Code and Codex in Kitten on one task):

- As a cockpit driver, I want to see how full each agent's context is at a glance, so I can decide when to hand the task over before quality degrades.
- As a cockpit driver, at the moment I press `Ctrl+T`, I want to see how much room the receiving agent has, so I don't hand a large task into an agent that is itself nearly full.
- As a cockpit driver, when an agent does not report its usage, I want that shown honestly as "unknown" rather than as a misleading number, so I keep trusting the numbers that *are* shown.
- As a cockpit driver, I want the gauge to never fabricate or estimate a percentage, so a reading I act on reflects something the agent actually reported.

**Secondary flows and edge cases:**

- As a cockpit driver on a narrow terminal, I want the gauge to stay readable and never push the existing status or hand-off information off screen.
- As a new user, I want to understand what the headroom number means without documentation, so the signal is self-explanatory the first time I see it.

## Core Features

Grouped by priority for the MVP.

**1. Per-agent context-headroom signal (Critical).**
Surface each agent's remaining context as a percent plus a compact bar, derived from the usage the agent reports.
Behavior: updates as the agent works; reflects the agent's own reported context window; shows both agents so they can be compared directly.

**2. Headroom at the hand-off moment (Critical).**
Inside the `Ctrl+T` hand-off preview, show the target agent's headroom next to the existing source→target heading, so the room the task is landing in is visible before the user confirms.
Behavior: reads the same signal as the status strip; appears at the top of the preview alongside the redaction notice.

**3. Honest absence handling (Critical).**
When an agent reports no usage, render an explicit "unknown" (a dash, or an explicitly-approximate raw count with no percentage) instead of a number.
Behavior: absence is visibly distinct from "0% headroom"; the feature never presents an estimated or fabricated percentage as if measured.

**4. Neutral, self-explanatory presentation (High).**
Present headroom with a single neutral treatment and clear labeling, no "hand off now" verdict in the MVP.
Behavior: the number and bar read the same regardless of level; a user understands "headroom" on first sight; the gauge fits the existing status-strip and preview layouts on standard and narrow terminals.

**5. Emission validation (High, non-user-facing).**
Confirm through logging that at least one agent adapter actually emits usage before the release relies on it.
Behavior: if neither adapter emits, the gauge still shows honest "unknown" and the gap is surfaced to the team rather than hidden.

Feature interaction: features 1-4 all read one derived headroom value per agent; the status strip and the hand-off preview are two views of the same value, so they always agree.

## User Experience

**Persona and goal:** the cockpit driver wants to hold a task with the right agent and switch at the right time, with minimal interruption to their flow.

**Primary flow - ambient awareness:**
1. The user works with the focused agent as usual.
2. The status strip, already always on screen, now shows each agent's headroom beside its name and state (e.g., `▸ Claude: working · headroom 38%` with a short bar; `Codex: idle · headroom —`).
3. As the focused agent fills its context, its headroom falls; the user absorbs this peripherally without taking any action to see it.

**Primary flow - decision moment:**
1. The user presses `Ctrl+T`; the hand-off preview opens as it does today.
2. The preview header now shows the target agent's headroom next to the `Claude → Codex` direction.
3. The user curates the bundle and confirms, now aware of the room the task is landing in.

**UI/UX considerations:**
- The gauge lives inside existing surfaces (status strip, hand-off preview); it introduces no new screen to open or command to remember.
- "unknown" is always legible as a data gap, not an error or a zero.
- Readability holds on a standard 80×24 terminal and degrades gracefully on narrower widths, never displacing existing status, keymap hints, or the hand-off preview's send action.
- Wording is chosen so "headroom" is self-explanatory; a short in-context label carries the meaning.

**Onboarding and discoverability:** the signal is passive and always visible, so discovery is automatic - no setup, no toggle. Its meaning is conveyed by the label and the bar rather than a tutorial.

## High-Level Technical Constraints

Boundaries that shape the product without prescribing implementation:

- **Depends on agent-reported usage.** The signal reflects only what each agent reports over its connection; Kitten does not measure or estimate context on the agent's behalf. Coverage therefore depends on the agents, and the product must remain correct and useful when one agent reports nothing.
- **Honesty over coverage.** Absent or untrustworthy data is shown as "unknown," never as a fabricated or estimated percentage. This is a hard product rule, consistent with Kitten's existing bias to under-report rather than mislead.
- **No new interruption surface.** The feature must fit within the existing always-on status strip and the existing hand-off preview; it must not add a modal, a command, or a step to the user's flow in the MVP.
- **Terminal rendering limits.** The gauge must stay readable within terminal width constraints and must never push existing information (status, keymap hint, hand-off send action) off screen.
- **Reported size may not equal effective limit.** Because agents may compact internally or reserve output headroom, the raw percentage is treated as an approximate read; the MVP avoids asserting a precise "hand off now" threshold.

## Non-Goals (Out of Scope)

- **On-demand `/usage` overlay** - deferred; the always-on placement serves the timing job, and a summoned overlay is a later drill-down (Phase 3), not part of the MVP.
- **Per-turn token breakdown (input/output/cache)** - a different, experimental data source with no consumer in the MVP now that cost is excluded; deferred to Phase 3.
- **Cost / spend display** - agent-reported cost is optional and uneven; excluded until the usage signal and cost semantics are proven.
- **Estimating a missing agent's fill** - Kitten will not compute a substitute percentage for an agent that reports nothing; doing so would fabricate a denominator it cannot know.
- **Active hand-off recommendation or nudge** - Kitten will not tell the user when to hand off in the MVP; that is the Phase 3 stretch, gated on trustworthy thresholds.
- **Threshold color verdicts** - deferred to Phase 2, calibrated against real sessions rather than guessed.

## Phased Rollout Plan

### MVP (Phase 1)

- Emission validation (confirm at least one adapter reports usage).
- Per-agent headroom in the status strip (percent + bar), both agents.
- Target-agent headroom in the `Ctrl+T` hand-off preview.
- Honest "unknown" for absent data; neutral presentation, no verdict.
- **Success criteria to proceed:** usage is confirmed to arrive for at least the primary agent and renders correctly and honestly across sessions; the gauge holds up on standard and narrow terminals; no regression to status-strip or hand-off-preview behavior.

### Phase 2

- Calibrated headroom thresholds with a "consider hand-off" / "hand off now" treatment, tuned against observed sessions.
- Behavior-change telemetry: correlate usage with hand-off events to measure whether users hand off earlier and toward the agent with more room.
- Refined presentation (e.g., distinguishing used vs reserved headroom) if the data supports it.
- **Success criteria to proceed:** measurable movement toward earlier, correctly-directed hand-offs; thresholds validated as trustworthy rather than misleading.

### Phase 3

- On-demand detail view (the deferred `/usage` overlay) with the per-turn token breakdown.
- Optional cost display, once semantics are proven.
- Active custody-advisor nudge that proactively suggests a hand-off when the focused agent is low on room and the other has capacity.
- **Long-term success:** the usage signal becomes a trusted, routine input to the hand-off decision, and the active advisor measurably improves hand-off timing without eroding trust.

## Success Metrics

**MVP (availability and honesty):**
- Usage-data availability: the primary agent surfaces headroom within the first few turns in the large majority of sessions (target ≥ 90%).
- Signal honesty: absent data is never rendered as a numeric percentage (target 100%; verified in acceptance tests).
- Non-disruption: no regression in status-strip or hand-off-preview behavior; the gauge remains readable on an 80×24 terminal.
- Comprehension: a first-time user can state what the headroom number means without documentation (validated qualitatively).

**Phase 2 (behavior change):**
- Correct-direction hand-offs: among hand-offs where both agents report usage, the large majority move the task toward the agent with more headroom (target > 70%).
- Earlier hand-offs: the median remaining headroom of the focused agent at hand-off time rises (users switch before near-full; target median > 20% remaining).

## Risks and Mitigations

- **Adoption / perceived value.** A neutral gauge may feel under-baked to users who want to be told when to switch. Mitigation: ship the honest signal first, then add calibrated verdicts in Phase 2; communicate the neutral framing as a deliberate trust choice.
- **Data availability.** One or both agents may report no usage, leaving a persistent "unknown." Mitigation: validate emission before relying on it; render honestly; the focused agent's own headroom is still useful even without a comparison; escalate gaps to adapter owners.
- **Trust erosion from a misleading number.** A percentage that does not reflect the agent's effective limit could prompt a premature, costly hand-off. Mitigation: neutral framing with no verdict in the MVP; frame as "headroom"; defer thresholds until calibrated against real behavior.
- **Competitive.** Single-agent tools continue to add richer context displays. Mitigation: lean into the two-agent, side-by-side comparison at the hand-off moment - the lane none of them occupy.
- **Dependency.** The feature depends on an optional, recently-stabilized part of the agent protocol whose adapter support is uneven. Mitigation: treat coverage as agent-dependent, keep the product correct under partial data, and avoid coupling launch messaging to a comparison that may be one-sided at first.

## Architecture Decision Records

- [ADR-001: Ambient per-agent headroom gauge over an on-demand `/usage` overlay](adrs/adr-001.md) - V1 places context headroom as an always-on signal in the status strip and hand-off preview, context-only and absence-aware, instead of a summoned overlay.
- [ADR-002: Validation-gated honest MVP for the agent usage gauge](adrs/adr-002.md) - the MVP confirms usage emission, ships both surfaces with a neutral honest gauge, and defers thresholds and behavior telemetry to Phase 2.

## Open Questions

- Do the Claude Code and Codex adapters actually emit context usage today? (Resolved by the MVP's emission-validation step.)
- Does the reported context size reflect the *effective* limit after internal compaction and reserved output headroom? If not, how should Phase 2 present headroom to stay honest (e.g., distinguishing used vs reserved)?
- Final wording and threshold values for Phase 2's "consider hand-off" / "hand off now" treatment, to be calibrated against observed sessions.
- Does the existing telemetry already capture correlatable hand-off and usage events, or does Phase 2 require new ones?
- Should headroom be phrased consistently as "remaining," and is a short label sufficient for first-time comprehension, or is a one-time hint needed?
