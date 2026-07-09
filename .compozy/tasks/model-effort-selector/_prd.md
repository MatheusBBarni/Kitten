# PRD: Kitten - In-App Model & Reasoning-Effort Selector

## Overview

Kitten runs two AI coding agents side by side and lets a developer hand a live task from one to the other.
Each pane runs whatever model and reasoning effort its agent started with, and the only way to change either is to edit a config file and relaunch, which discards the running session.

This feature lets a developer change a pane's model and reasoning effort from inside the cockpit, on the live session, with no restart and no lost context.
It is for the developer who already runs more than one agent and switches between them by task, and who wants to right-size the model and the effort to the work in front of them without breaking flow.
The value is a switch that costs a keystroke instead of a config edit and a relaunch, and a hand-off that can carry a chosen effort to the other agent, which is a move no single-agent tool can make.

## Goals

- Let a developer change a pane's model and reasoning effort mid-session, from the cockpit, without a restart and without losing the transcript, files, or diffs.
- Make reasoning effort a first-class, visible control, and let it ride along with a hand-off so escalating to the other agent at a chosen effort is one move.
- Keep the cockpit honest: it shows only the model and effort the agent confirms are live, never a setting it cannot verify.
- Measure success on reliability and real use: at least 98% of switches confirmed applied, more than 60% of effort changes kept through the next turn, and more than 20% of hand-offs paired with a model or effort change.
- Ship the differentiated whole as the first release, so Kitten does not launch as a parity dropdown.

## User Stories

Primary persona - the multi-agent developer:
- As a developer running two agents, I want to change a pane's model and effort without leaving the cockpit, so I can match the agent to the task without losing my session.
- As a developer, I want the change to take effect on my next prompt while the current turn finishes undisturbed, so a switch never throws away work in flight.
- As a developer changing model or effort in the middle of a conversation, I want a clear warning that the session was optimized for the current model and effort and that switching may reduce quality, so I decide to proceed with eyes open.

Cost-conscious developer:
- As a cost-conscious developer, I want to drop to a cheaper model or a lower effort for routine work and raise both for hard problems, so I control cost and quality per task.

Hand-off user:
- As a developer handing a task to the other agent, I want to set the target's model and effort in the hand-off preview, so I can escalate ("hand this over at high effort") in a single confirm-and-send.

Secondary and edge cases:
- As a developer, I want the cockpit to show only the setting the agent confirms is live, so I am never misled about which model or effort is actually running.
- As a developer whose agent offers no model or effort choices, I want the selector to say there is nothing to change rather than show me an empty control.
- As a safety-conscious developer, I want the selector to never expose a control that could turn off Kitten's approval prompts.

## Core Features

Listed by priority.

- **Live model and effort selector (Critical).** A keyboard-driven overlay, opened per pane, that lists the models and effort levels the pane's agent offers and applies the choice to the live session. The change takes effect on the next prompt; the current turn finishes on its existing setting. When the change happens mid-conversation, the overlay warns that the session was optimized for the current model and effort and that switching may reduce quality, and asks the developer to confirm before applying. The warning mirrors the standard model-switch caution developers already see in agent tools, and it is skipped on a fresh session with no prior context.
- **Verified, honest state (Critical).** The overlay and the cockpit show the setting the agent confirms is applied, never the requested value. If a switch cannot be confirmed or errors, the pane shows an unverified state and keeps the last confirmed value.
- **Safe by default (Critical).** The selector exposes only model and reasoning effort. It never surfaces controls that could disable Kitten's approval prompts or other agent modes, even if the agent offers them.
- **Effort-tagged hand-off (High).** The hand-off preview gains a model and effort control drawn from the target agent's own options, so a developer can hand a task to the other agent at a chosen effort as part of the same confirm-and-send flow.
- **Always-visible current setting (High).** Each pane's live model and effort are shown in the status strip, so the current configuration is visible at a glance and the selector is discoverable by seeing its state.
- **Opt-in switch insights (Medium).** Content-free counters record confirmed switches, kept effort changes, and effort-linked hand-offs, so the success metrics can be measured. Off by default, consistent with Kitten's existing privacy stance.

## User Experience

Personas and their goals are covered in User Stories: the multi-agent developer wants a fast, safe switch; the cost-conscious developer wants per-task control of cost and quality; the hand-off user wants to escalate to the other agent at a chosen effort.

Primary flow - change a pane's model or effort:
1. The developer presses the selector keybinding for the focused pane.
2. An overlay lists the models and effort levels that pane's agent offers, with the current values marked. Effort is shown only when the selected model supports it.
3. The developer picks a model, an effort, or both, and confirms. Escape cancels and changes nothing.
4. If the switch happens inside an established conversation, the overlay warns that the session was optimized for the current model and effort and that switching may reduce quality, and asks the developer to confirm. On a fresh session with no prior context, the warning is skipped.
5. The current turn, if any, finishes on its existing setting. The new values take effect on the next prompt.
6. The status strip updates to the setting the agent confirms is live.

Primary flow - hand off at a chosen effort:
1. The developer starts a hand-off from the focused pane.
2. The preview shows the bundle to be sent plus a model and effort control for the target agent.
3. The developer optionally raises or lowers the target's model or effort, then sends. The task moves to the other agent at the chosen setting.

UI and UX considerations:
- Keyboard-first, mirroring the existing approval and hand-off overlays. The selector is listed in the help panel.
- When a pane's agent offers no choices, the selector says so rather than showing an empty list.
- The unverified state is shown plainly so the developer knows a switch was not confirmed, without alarming them on ordinary switches.

Onboarding and discoverability:
- The status strip shows each pane's current model and effort at all times, so the control is discoverable by seeing state.
- The selector keybinding appears in the help panel alongside the other cockpit actions.

## High-Level Technical Constraints

These are product boundaries, not implementation choices.

- The selector must list only what each agent offers at runtime. Kitten ships no fixed model list, so the choices stay current as models change.
- The cockpit must show only agent-confirmed live state and must never assert a setting it cannot verify.
- The selector must never expose a control that bypasses Kitten's approval prompts.
- Changing model or effort must not restart or tear down the session; the transcript, files, and diffs are preserved.
- Switch telemetry must stay opt-in and content-free, matching Kitten's existing privacy posture.
- The feature must add no new external services or dependencies.

## Non-Goals (Out of Scope)

- **Provider or agent swap** - changing which agent a pane runs (for example Claude Code to Codex). It reshapes the two-agent layout and carries its own problems; it is deferred to Phase 2.
- **Effort-aware advisor** - Kitten suggesting when to change effort or hand off. It is the Phase 3 stretch, not part of this effort.
- **Permission-mode or fast-mode controls** - any agent control beyond model and effort. Excluded on safety grounds.
- **Custom or user-defined model lists** - a registry of models or providers. The selector is driven entirely by what agents offer, so it never goes stale.
- **Cross-pane compare view** - a side-by-side model comparison screen. It adds surface without repeat value and is not the point of this feature.

## Phased Rollout Plan

### MVP (Phase 1)

All six core features: the live selector, verified honest state, safe-by-default exposure, the effort-tagged hand-off, the always-visible current setting, and opt-in switch insights.

Success criteria to proceed:
- At least 98% of switches confirmed applied, with no reported case of the cockpit showing a setting the agent was not running.
- Selector adoption above 40% of sessions.
- Both agents' model and effort choices are surfaced correctly in a live handshake.

### Phase 2

Provider and agent swap: let a pane change which agent it runs, built on the same selector.

Success criteria to proceed:
- Users adopt the effort-tagged hand-off, shown by more than 20% of hand-offs paired with a model or effort change.
- The swap keeps or knowingly carries context, with no silent loss.

### Phase 3

Effort-aware advisor: Kitten watches signals only a two-pane cockpit can see, such as a pane stalling or burning tokens without converging, and suggests bumping effort or handing off at a chosen effort, one keystroke to accept, with verified apply.

Long-term success:
- A meaningful share of suggested switches are accepted and kept, and users report the advisor helps them get unstuck.

## Success Metrics

- **Switch confirmed-applied rate** above 98%: the reliability floor that protects the hand-off's promise.
- **Kept effort-change rate** above 60%: effort changes that are not reverted before the pane's next turn.
- **Effort-linked hand-offs** above 20%: hand-offs paired with a model or effort change.
- **Time-to-switch** under 5 seconds median, against a config-edit-and-relaunch baseline of roughly one to two minutes.
- **Selector adoption** above 40% of sessions within 60 days, as a secondary signal.
- **Zero-restart continuity** at 100% for agents that support live switching: no session is torn down by a switch.

## Risks and Mitigations

- **Adoption risk - developers do not discover the selector.** Mitigated by the always-visible status-strip display and the help-panel entry, and tracked by the adoption metric.
- **Positioning risk - the feature reads as a me-too dropdown.** Mitigated by leading on reasoning effort and the effort-tagged hand-off in the docs and README, and by shipping the composed whole rather than a bare selector.
- **Trust risk - a switch that misreports state would discredit the hand-off.** Mitigated by showing only agent-confirmed state, an explicit unverified state, and the confirmed-applied metric as a release gate.
- **Dependency risk - an agent offers no choices or confirms a switch it did not apply.** Mitigated by hiding the selector when nothing is offered and by verifying applied state; a live-handshake confirmation for both agents is owed before build.
- **Scope risk - the composed MVP is larger than a selector alone.** Mitigated by reusing the existing overlay, hand-off, and telemetry patterns rather than building new ones, and by an internal build order that lands the trusted switch before the hand-off composes on top.

## Architecture Decision Records

- [ADR-001: V1 scope for the in-app model & reasoning-effort selector](adrs/adr-001.md) - Model and effort only, a narrow rendered surface over a generic capability, strict allowlist, verified state, effort composed with hand-off; provider swap and the advisor deferred.
- [ADR-002: V1 rollout as a compose-complete MVP](adrs/adr-002.md) - Ship the selector and the effort-tagged hand-off together as one MVP so the first release is differentiated and every KPI is measurable.

## Open Questions

- What window defines a "kept" effort change for the metric: surviving the pane's very next turn, or a fixed number of turns?
- When the target agent's model and effort options differ from the source pane's, how are they presented in the hand-off preview, and how do effort levels map across two different agents?
- How is the unverified state shown so it is clear on a genuine failure without alarming users on ordinary switches?
- If one pane's agent offers choices and the other does not, how is that asymmetry shown without implying the second pane is broken?
- What is the exact wording of the mid-conversation switch warning, and does it read the same for both agents or vary by agent?
- Confirmation is still owed that both shipped agents surface their model and effort choices in a live handshake, not only in their published source.
