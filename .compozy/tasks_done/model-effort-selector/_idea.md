# Kitten - In-App Model & Reasoning-Effort Selector

## Overview

Kitten runs two AI coding agents side by side and lets a developer hand a live task from one to the other.
Each pane currently runs whatever model and reasoning effort its spawned adapter defaults to.
Changing either means editing `~/.config/kitten/config.json` and relaunching, which throws away the running session.

This feature adds an in-app, keyboard-driven selector that changes a pane's model and reasoning effort on the live session, with no restart and no lost context.
It is for the multi-agent developer who already switches agents by task and wants to right-size the model and effort to the work in front of them without breaking flow.
The value is a switch that costs a keystroke instead of a config edit and a relaunch, and that keeps the transcript, files, and diffs intact.

V1 is a focused Quick Win that also seeds a larger bet.
It ships the selector for the two existing agents and wires the chosen model and effort into Kitten's hand-off, so "hand this over, bumped to high effort" becomes one move.
Swapping the agent a pane runs and an effort-aware advisor that suggests the switch for you are deferred to V2.

## Problem

A developer running more than one agent pays a small tax every time the pane is on the wrong setting.
The model that is fast and cheap enough for boilerplate is not the model you want for an ambiguous refactor, and the reasoning effort that is worth its latency on a hard bug is waste on a rename.
Today Kitten pins model and effort at spawn time through the adapter's own defaults, so correcting a mismatch means leaving the cockpit, editing a JSON file, and relaunching the agent, which discards the session you were in the middle of.

The friction is high enough that people just don't correct the mismatch.
They overpay for simple work or under-power hard work, because the cost of switching is a restart and a re-prime.
That is the exact opposite of what the selector should feel like, which is a cheap, reversible knob you reach for several times in a session.

The terminal tools that solve half of this solve the wrong half.
aider, OpenCode, and Charm Crush all switch models mid-session with context preserved, so a model picker on its own is table stakes rather than a differentiator.
Reasoning effort, the cheapest lever a developer has for trading cost against quality, is rarely exposed as a first-class control in the terminal at all; it tends to be buried or GUI-only.
None of these tools run two heterogeneous agents at once, so none of them can make effort part of a hand-off.

### Market Data

- 84% of developers use or plan to use AI tools, and 51% of professional developers use them daily (Stack Overflow 2025 Developer Survey, n approximately 49k).
- Trust is low even as usage is high: only 33% trust the accuracy of AI output versus 46% who distrust it, and 66% cite output that is "almost right, but not quite" as their top frustration.
- Effort is a real lever, not a cosmetic one: at medium effort a current Claude tier matched the prior tier's SWE-bench Verified score using about 76% fewer output tokens.
- No published figure exists for the share of developers who switch models by task, so demand for the switch itself is inferred from the cost/quality evidence rather than measured directly. This is a known gap.

## Summary / Differentiator

Model switching is parity; effort switching, composed with hand-off, is the angle.
Kitten is the only terminal tool that can carry a reasoning-effort choice across two branded agents, so the move "Codex stalled at high effort, I handed it to Claude at high effort and it landed" is native to the cockpit and impossible in a single-agent tool.
The selector reads entirely from what each adapter advertises at runtime and reflects only the state the agent confirms, so it stays honest about which model and effort are actually live, which is the same fidelity promise the hand-off depends on.

## Core Features

| #   | Feature | Priority | Description |
| --- | ------- | -------- | ----------- |
| F1  | Live model & effort selector | Critical | Keyboard-driven overlay, per pane, that changes the model and reasoning effort on the live ACP session with no restart, keeping the transcript, files, and diffs. Mirrors the existing approval/hand-off overlay pattern. |
| F2  | Confirmed-state, verify-applied | Critical | The overlay shows the agent-confirmed applied value read back from the session, never the optimistic requested value. On an unconfirmable or errored switch it shows an `unverified` state and keeps the prior confirmed value (fail closed). |
| F3  | Strict capability allowlist | Critical | Only the `model` and `thought_level` (effort) categories are surfaced. Permission modes (including `bypassPermissions`), Fast mode, and any other category are excluded by a code-level allowlist. If an adapter advertises nothing, no picker is shown for that pane. |
| F4  | Effort-tagged hand-off | High | The chosen model and effort are carried into the hand-off bundle, so a developer can hand a task to the other agent at a specified effort in one move. Ties the selector to Kitten's moat rather than to parity. |
| F5  | Current setting in the status strip | High | Each pane's live model and effort are shown inline in the status strip, so the current configuration is always visible without opening the overlay. |
| F6  | Content-free switch telemetry | Medium | Opt-in, content-free counters for confirmed-applied switches, kept effort changes, and effort-linked hand-offs, reusing the existing telemetry recorder. Feeds the KPIs below. |

## KPIs

| KPI | Target | How to Measure |
| --- | ------ | -------------- |
| Switch confirmed-applied rate | > 98% | Compare the requested value against the `currentValue` in the returned `configOptions` after each switch |
| Kept effort-change rate | > 60% | Share of effort changes not reverted before the pane's next turn |
| Effort-linked hand-offs | > 20% | Share of hand-offs paired with a model/effort change within the surrounding turns |
| Time-to-switch | < 5s median (vs ~60-120s config-edit-and-relaunch baseline) | Instrument overlay-open to applied-and-confirmed |
| Selector adoption (secondary) | > 40% of sessions within 60 days | Content-free counter on overlay open |
| Zero-restart continuity | 100% for capable adapters | Count session teardowns triggered by a switch; target is zero |

## Feature Assessment

| Criteria | Question | Score |
| -------- | -------- | ----- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong (via effort + compose-with-hand-off; the model picker alone is parity) |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe (the selector is copyable; the moat is the cockpit and the V2 advisor the rails seed) |
| **Feasibility** | Can we actually build this? | Must do (verified supported by the pinned SDK and both pinned adapters; additive greenfield work) |

Leverage type: Quick Win that seeds a Compounding Feature. The generic config channel and effort-tagged hand-off are the rails the V2 advisor builds on.

## Council Insights

- **Recommended approach:** Ship the model + effort selector with a generic config-option data model in the domain core, render only model and effort, enforce a strict allowlist, and show only agent-confirmed applied state. Position effort as the wedge and wire it into the hand-off, which is what turns the feature from parity into a moat-amplifier.
- **Key trade-offs:** Model switching alone is table stakes, so the feature has to be positioned on effort and hand-off composition. A generic data model with a narrow rendered surface is more faithful to the protocol and cheaper over time than a model-and-effort-specific design that gets rewritten for V2.
- **Risks identified:** ack-not-applied (agents that acknowledge a switch without applying it) is mitigated by confirmed-state-only UI and fail-closed behavior, tracked as a KPI. The shared config surface exposes `bypassPermissions`, mitigated by the code-level allowlist. An adapter may advertise no options, handled by hiding the picker. Adoption-as-clicks is demoted to a secondary signal in favor of reliability and behavioral value metrics.
- **Stretch goal (V2+):** An effort-aware advisor that watches signals only a two-pane cockpit can see (a pane stalling, retrying, or burning tokens without converging) and suggests "bump effort" or "hand off at high effort," one keystroke to accept, with verified apply. This is the version competitors cannot copy, and V1's rails are built to reach it.

## Integration with Existing Features

| Integration Point | How |
| ----------------- | --- |
| ACP session lifecycle (`agentConnection.ts`) | Capture the `configOptions`/`modes` from `session/new` that are currently discarded |
| ACP translation (`acpTranslate.ts`) | Translate the currently-dropped `config_option_update` notifications into a new domain event; the reducer replaces the option set wholesale |
| Domain core & store (`core/types.ts`, `store`) | Hold the generic config channel on `SessionState`, keyed by opaque category ids, with selectors mirroring `selectAgentStatus` |
| Overlay pattern (`ApprovalPrompt.tsx`, `HandoffPreview.tsx`) | New selector overlay reusing the store-slot plus keyboard-capture plus Enter/Esc pattern |
| Keymap (`keymap.ts`) | Register a new binding to open the selector |
| Status strip (`StatusStrip.tsx`) | Show each pane's current model and effort |
| Hand-off bundle (`bundleAssembler.ts`, `handoff.ts`) | Carry the chosen model/effort into the bundle for effort-tagged hand-off |
| Telemetry recorder (`telemetry/recorder.ts`) | Content-free counters for the KPIs |

## Out of Scope (V1)

- **Provider/agent swap** - changing which agent a pane runs (Claude Code to Codex, later Cursor). It reshapes the fixed two-agent layout and carries its own hard problems (session identity, transcript compatibility); deferred to V2 on the same config-channel rails.
- **Effort-aware advisor** - signal-watching suggestions to bump effort or hand off. It is a quarter of work, not a Quick Win; it is the V2 stretch that V1's rails are built toward.
- **Permission-mode and Fast-mode controls** - `mode` (including `bypassPermissions`) and `model_config`. Surfacing them from the same config list is a safety footgun; excluded by the allowlist.
- **Custom or user-defined model lists** - a static registry of models or providers. The picker is driven entirely by adapter-advertised options so it never goes stale against fast-moving model releases.
- **Cross-pane compare view** - a side-by-side model comparison. It impresses once and gets closed; it is not the wedge and adds surface without repeat value.

## Architecture Decision Records

- [ADR-001: V1 scope for the in-app model & reasoning-effort selector](adrs/adr-001.md) - Model + effort only, generic config channel with a narrow rendered surface, strict allowlist, verify-applied confirmed-state UI, effort composed with hand-off; provider swap and the advisor deferred to V2.

## Open Questions

- What precise window defines a "kept" effort change for the KPI - does it count as kept if it survives the pane's very next turn, or a fixed number of turns?
- Should a switch requested while the agent is mid-generation be applied immediately, queued until idle, or blocked? ACP permits mid-generation changes; the UX choice is open.
- How is the effort-tagged hand-off represented in the redacted preview, and is the effort applied before the bundle is sent or as part of it? A TechSpec-level design detail.
- If only one of the two panes' adapters advertises options, how is that asymmetry surfaced without implying the other pane is broken?
- Runtime confirmation is still owed that `claude-agent-acp@0.57.0` and `codex-acp@1.1.0` advertise `model` and `thought_level` in a live handshake; research verified this in their source, but it has not been observed end to end in Kitten.
