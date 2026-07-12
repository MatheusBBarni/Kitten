# PRD: Claude Code-Style TUI Reskin

## Overview

Kitten is a two-agent terminal cockpit that runs Claude Code and Codex side by side and hands a live coding task between them with one keystroke.
Its interface today is functionally complete but visually bare: launch shows a blank screen during the agent handshake, then a bordered empty pane titled with the focused agent's name and a single muted line.
The status strip shows only each agent's name and one state word, and the product's signature action - the hand-off - is invisible unless the user opens the help panel.

This reskin gives Kitten a first impression and an operational cockpit that match the polish of the leading coding-agent CLIs while staying unmistakably Kitten.
It is for two people: the daily operator who needs to know, at a glance, which agent has the task, on which model, in which branch, with how much context left; and the first-time evaluator who decides in thirty seconds whether the tool looks trustworthy.
The layout, the hand-off flow, and the interactions are unchanged - this is chrome, delivered chrome-first and data-additive so polish ships now and clarity grows honestly.

## Goals

- Give Kitten a branded launch experience that fills the currently-blank boot wait and reads as finished, without becoming the every-launch noise heavy users resent.
- Make the two-agent cockpit legible at a glance: which agent has focus, each agent's run-state, its model, the shared branch, and its context headroom.
- Make the hand-off - Kitten's one differentiating action - discoverable and honest, always visible rather than hidden in help.
- Warn the operator before a context-window cliff, so they can hand off or compact on their own terms.
- Ship without regressing any existing interaction (hand-off, switch, approval, help) and without blocking on features Kitten does not yet own.

## User Stories

**Primary persona - the dual-agent operator.**
- As an operator, I want to see which agent my input goes to and what each agent is doing (working, waiting on me, idle, unavailable) so I never type into the wrong agent or miss one that needs me.
- As an operator, I want each agent's active model and the current git branch always visible so I know what I'm running and where I'm about to commit, without a separate command.
- As an operator, I want each agent's context-window usage shown with an early-warning color so I can hand off or compact before the agent is blindsided by auto-compaction.
- As an operator, I want the hand-off key and its direction always on screen, and a clear reason when it can't run yet, so the core action is never a silent dead end.

**Secondary persona - the first-time evaluator.**
- As a newcomer, I want the launch to show me I'm in Kitten - not a blank screen or a competitor's name - so I immediately understand what I'm using.
- As a newcomer, I want the opening screen to tell me a second agent exists and how to hand work between them, so the product's premise is obvious from the first moment.
- As a returning user, I want the welcome to quiet down after the first run so it stops costing me vertical space on every launch.

## Core Features

| # | Feature | Priority | What it does |
| --- | --- | --- | --- |
| CF1 | Warm-accent palette + prompt restyle | Critical | Kitten's own warm accent, rounded borders, generous spacing, and a chevron prompt, applied through the theme so it stays legible in dark, light, and no-truecolor terminals. Foundational look-and-feel. |
| CF2 | Branded launch experience | Critical | A welcome banner (kitten mascot + greeting + model/account/cwd summary) that renders immediately on launch as a loading state - agents shown as "connecting..." - filling the blank handshake wait, then remains as the idle screen until the first prompt. Auto-quiets to a one-line greeting after the first run, is disable-able, and never redraws on resize or clear. |
| CF3 | Dual-agent status bar | Critical | An always-on bottom bar with a lozenge per agent carrying two orthogonal signals - focus (which agent input goes to) and run-state (working / waiting-on-you / idle / unavailable) - plus the agent's model when reported, and a shared branch + cwd segment. Renders only signals it can stand behind (hide-when-absent) and collapses by declared priority as width tightens. |
| CF4 | Always-visible, honest hand-off | High | The status bar always shows the hand-off key and its direction (e.g. "^T hand off -> Codex"); when the hand-off cannot run (target not ready, or nothing to hand off yet) it shows the reason instead of silently doing nothing. |
| CF5 | Context-headroom indicator | High | Per-agent context-window used-%, always-on, color-coded green -> amber (~70%) -> red (~85%) so the operator is warned before the cliff. Appears in a pre-built slot that lights up when the context-usage data is available; hidden until then. |

## User Experience

**Launch to first use.**
1. The user runs Kitten; the branded banner appears at once, with both agents shown as "connecting..." - the blank handshake wait is now a first impression.
2. When at least one agent is ready, the banner settles into the idle screen: greeting, the two agents named, a one-line "type to start, ^T to hand off" on-ramp, and the working directory.
3. The user types a prompt; the transcript takes over the conversation region, and the status bar below shows both agents - the focused one marked, each with its run-state, model, and (when available) context headroom - alongside the shared branch and the always-visible hand-off key.
4. While an agent works, its run-state reads "working"; when it needs a decision, it reads "waiting on you" in the loudest color, so attention routing is obvious even at 80 columns.
5. The user presses the hand-off key it can now see; the existing hand-off preview flow runs unchanged.
6. On the next launch, the welcome is a single quiet line, not the full banner.

**Accessibility and robustness.**
- Focus and run-state are conveyed by glyph and label in addition to color, so the bar is not color-dependent.
- Color is reserved strictly for actionable states (context near-full, an agent awaiting input), never decoration.
- The banner and bar degrade gracefully: a one-line greeting and a priority-collapsed bar on narrow terminals, and an ANSI-safe rendering with no-truecolor fallback.
- The mascot renders as deterministic character-cell art with a one-line fallback where it can't render cleanly.

**Onboarding and discoverability.**
- The idle screen names the second agent and the hand-off, closing today's biggest gap (a new user currently cannot tell a second agent or the hand-off exists).
- The hand-off key is always on the bar, and attempting it early yields a reason, not silence.

## High-Level Technical Constraints

- Must remain legible across the terminal range Kitten already supports: dark, light, and no-truecolor terminals, down to an 80-column width.
- The mascot cannot be a real image (terminals in scope have no image protocol); it must be character-cell art with a text fallback.
- The reskin consumes existing seams for its data - agent model/effort and context-usage are sourced from the same protocol Kitten already speaks - and must not require the operator to configure anything to get value.
- The status bar must not degrade rendering performance or introduce flicker on repaint.

## Non-Goals (Out of Scope)

- **Tips / What's-new panel** in the banner - deselected; adds complexity without serving polish or clarity.
- **Elaborate or animated mascot** - deferred to a later iteration once the simple version proves stable across terminals; animation is disproportionately expensive.
- **Hand-off HUD / interaction redesign** - the layout, hand-off flow, and keybindings are unchanged; the richer hand-off visualization is a V2 stretch.
- **Near-exact Claude Code clone** - Kitten keeps its own identity; its accent and wording are its own.
- **Building the model+effort and context-usage data features** - owned by their own efforts; this reskin consumes their output and hides the signal until it exists.
- **In-app setup wizard / rewiring boot diagnostics** - surfacing setup failures inside the TUI (today they print to stderr) is a separate concern, not this reskin.

## Phased Rollout Plan

### MVP (Phase 1) - Visual layer
- CF1 (palette + prompt restyle) and CF2 (branded launch experience, including the boot-loading banner, auto-quiet, and disable control).
- **Success criteria to proceed:** first-time viewers rate the launch as "looks finished" >= 4/5; the banner never re-renders on resize or clear; repeat launches show the quiet greeting; no regression in existing UI tests.

### Phase 2 - Dual-agent status bar
- CF3 (status bar with focus, run-state, model-when-present, branch, cwd; hide-when-absent; 80-column priority-collapse) and CF4 (always-visible, honest hand-off).
- **Success criteria to proceed:** in testing, users identify the focused agent and each agent's run-state in < 2s and never mis-direct input; the hand-off is discovered without opening help; the bar fits 80 columns with both agents at their longest state.

### Phase 3 - Additive clarity
- CF5 (context-headroom with color thresholds) and per-agent model + effort lighting up in their slots as the usage and model-effort seams land.
- **Long-term success criteria:** users act on the amber threshold rather than hitting 100%; near-zero "surprised by context exhaustion" reports; the full bar reads at a glance without a separate command.

## Success Metrics

- **Glance-test orientation:** >= 90% of testers identify the focused agent, its model, and its context headroom in < 3s.
- **Attention routing:** users identify the agent that needs input in < 2s, with zero mis-directed prompts in testing.
- **Context safety:** in usage, operators act at the amber (~70%) threshold rather than at 100%; no "silent context cliff" reports.
- **First-impression polish:** >= 80% rate the launch screen "looks finished/professional" >= 4/5.
- **Banner acceptance:** zero complaints about the banner re-rendering or occupying space on repeat launches; suppression is discoverable.
- **Legibility matrix:** 100% legible across dark, light, and no-truecolor terminals and down to 80 columns.
- **Zero regression:** all existing interactions (hand-off, switch, approval, help) unaffected; no flicker on repaint.

## Risks and Mitigations

- **Banner becomes every-launch noise (adoption risk).** Mitigation: auto-quiet to a one-line greeting after first run, plus an explicit disable control; never redraw on resize/clear.
- **Reads as a lesser Claude Code clone (competitive risk).** Mitigation: keep Kitten's own identity and lead with the dual-agent bar and hand-off - surfaces no competitor styles.
- **Flagship context-% depends on features Kitten doesn't yet own (dependency risk).** Mitigation: hide-when-absent design means the bar ships honest and partial, and the signal snaps into a pre-built slot when ready; Phases 1-2 stand alone.
- **Mascot renders inconsistently across terminals (adoption/quality risk).** Mitigation: simple deterministic ANSI-safe cell art, capability-gated, with a one-line greeting fallback; defer any elaborate art.
- **Pending seams stall, delaying Phase 3 (timeline risk).** Mitigation: Phases 1-2 already beat today's experience and don't depend on them; confirm the two seams are prioritized next.

## Architecture Decision Records

- [ADR-001: V1 Scope for the Claude Code-Style TUI Reskin](adrs/adr-001.md) — Ship palette/prompt + simple banner + restructured dual-agent status bar, sequenced, with hide-when-absent honesty and an 80-column budget.
- [ADR-002: Chrome-First, Data-Additive Rollout for the TUI Reskin](adrs/adr-002.md) — Three phases: visual layer, then real-signal status bar, then additive context/model-effort clarity; never block on pending data features.

## Open Questions

- Are the `agent-usage-gauge` and `model-effort-selector` efforts confirmed as the next work after this reskin? Phase 3 depends on them.
- What exactly triggers auto-quiet after "first run," and should suppression also expose a CLI flag and env var (as leading tools do) or just a persisted setting?
- How should the run-state vocabulary (working / waiting-on-you / idle / unavailable) map onto Kitten's existing agent statuses, and what are the git-branch edge-case labels (detached HEAD, non-repo directory)?
- Do we want density presets (full / minimal) for the status bar in V1, or defer them?
- Should the idle-screen on-ramp copy be static, or adapt to whether both agents came up?
