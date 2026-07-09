# Kitten - Cross-Agent Hand-off Cockpit for the Terminal

## Overview

Kitten is an open-source terminal UI that lets a developer run two AI coding agents side by side and hand a live task from one to the other without re-explaining the project.
It is built with Bun, TypeScript, and OpenTUI, and it drives agents over the Agent Client Protocol (ACP).

The target user is the multi-agent power developer who already runs Claude Code, Codex, or Cursor and switches between them by task.
Today that switch is expensive: you copy the transcript, re-attach the files, summarize what changed, and re-establish intent every time.
Kitten's value is a one-keystroke, curated hand-off that carries that context for you, so the second agent starts where the first stopped.

V1 is a focused strategic bet, not an all-in-one workspace.
The concept of "many agents in one terminal" is already shipped by toad, so Kitten commits instead to the layer ACP leaves undefined: portable context across agents.
The editor, shell, and full file explorer from the original vision are deferred so V1 can validate the one assumption that decides whether Kitten deserves to exist next to toad.

## Problem

A developer who uses more than one coding agent pays a context tax on every switch.
Claude Code holds its session state, its compacted history, and its own `CLAUDE.md`.
Codex and Cursor hold their own.
None of them can read the others.
When you move a task from one to another because the first got stuck or because the second is better at this kind of work, you rebuild the context by hand: paste the relevant transcript, re-list the files, describe the pending change, and restate what you were trying to do.

This is slow and error-prone, and the friction is high enough that most people just don't switch, or they eat the context loss.
The pain is well documented: developers cope today by maintaining parallel instruction files (`CLAUDE.md`, `.cursorrules`, `AGENTS.md`) and MCP memory servers, and the most-cited complaint about the current tooling is having to re-explain your project to each tool.
Will McGugan, who built the toad frontend, frames the underlying situation as "like building a browser for a single website."

The existing tools do not close this gap.
Single-agent multi-model tools (OpenCode, Crush, aider) let you swap the model, not the agent, so there is nothing to hand off.
The GUI multi-agent clients (Zed, JetBrains) live outside the terminal.
toad, the one terminal-native multi-agent frontend, unifies the view but still leaves each agent's memory siloed.
The switch is smoother; the context loss remains.

Kitten treats the context loss as the actual problem and the unified view as table stakes underneath it.

### Market Data

- AI coding tools are mainstream: 84% of developers use or plan to use them, and 47% use them daily (Stack Overflow 2025 Developer Survey, n approximately 49k).
- Agentic use is still early: only about 31% of developers use AI agents at all, so the multi-agent power user is an early-adopter minority within that group. This is both the opportunity and the risk.
- Claude Code alone reaches 40.8% usage, a signal that terminal-native agentic tools have crossed into the mainstream.
- The AI code-tools market is estimated at roughly USD 7-10B in 2025-2026 with a 24-28% CAGR across vendor forecasts, and the agentic segment is projected to grow faster than the whole (directional, vendor-sourced).
- ACP is real and backed: created by Zed, developed jointly with JetBrains, with a reference production agent in Google's Gemini CLI. Claude Code, Codex CLI, and Cursor all ship working ACP adapters, so Kitten's V1 targets are technically reachable.
- Direct competition is narrow but strong: toad is the only shipping terminal-native, multi-agent, ACP-based frontend, and it is AGPL-3.0 (dual-licensed) on a Python/Textual stack.

## Summary / Differentiator

Kitten does not try to be the first unified ACP TUI, because toad already is.
Its wedge is the cross-agent context hand-off that no shipping tool solves, delivered on a permissive license and a TypeScript/Bun stack rather than toad's AGPL and Python.
The permissive license removes the corporate-adoption blocker and opens contribution to the JS/TS ecosystem; the hand-off feature plants a flag on the memory layer ACP deliberately leaves open.
Owning that layer is orthogonal to toad's agent-count breadth: more agents in toad's view does not dissolve the silos between them.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | ACP client, two agents | Critical | Connect to and drive exactly two ACP agents (e.g. Claude Code + Codex) via the official TypeScript SDK, configured through a simple two-entry config. |
| F2 | Conversation view with streaming and approvals | Critical | One scrollable transcript per agent session, ACP-native token streaming, and structured diff approval/rejection through the ACP flow. |
| F3 | Curated context hand-off | Critical | A one-keystroke "hand off to `<agent>`" action that forwards a normalized bundle: a source-agent summary with failed/dead-end turns dropped, the referenced file set, and pending diffs carried as structured ACP objects. |
| F4 | Live resumable sessions and hand-back | High | Both agent sessions stay alive and addressable within a run, so a task can be handed off and handed back rather than fired one way into a dead session. |
| F5 | Opt-in hand-off telemetry | High | Local-first, opt-in counters for the two honest metrics: re-explanation eliminated and hand-off frequency/repeat, with no prompt content captured. |
| F6 | Keyboard-first navigation | Medium | Keybind-driven session focus, the hand-off action, and a minimal command surface, tuned for a fast terminal workflow. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Hand-off adoption | Hand-off invoked in > 40% of multi-agent sessions | Opt-in telemetry: hand-off events / sessions touching 2 agents |
| Hand-off repeat use | > 25% of first-time hand-off users repeat within 7 days | Opt-in telemetry: cohort of first-use, return within 7 days |
| Re-explanation eliminated | In >= 60% of hand-offs, no manual context-restating message before the receiving agent's first useful action | Opt-in telemetry: detect user follow-up context messages in the first N turns post-hand-off |
| Curated-brief acceptance | Receiving agent's first continuation not immediately corrected/undone in > 50% of hand-offs | Opt-in telemetry: undo/correction within N turns after hand-off |
| Community traction | 1,000 GitHub stars within 90 days of launch | GitHub (toad reference point: approximately 3.3k) |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the workflow? | Strong |
| **Reach** | What % of users would this affect? | Maybe (high within the target, small in absolute terms) |
| **Frequency** | How often would users hit this value? | Strong (a daily-driver moment) |
| **Differentiation** | Does this set us apart or match competitors? | Strong (owns the undefined memory layer; permissive + TS) |
| **Defensibility** | Easy to copy or compounds over time? | Strong (owned context layer + community compound) |
| **Feasibility** | Can we build it? | Strong (SDK + adapters exist; gated on validation and pre-1.0 deps) |

Leverage type: Strategic Bet with compounding potential.

## Council Insights

- **Recommended approach:** Build the hand-off cockpit. The two-agent client is the unavoidable substrate; the product weight goes on a one-keystroke curated hand-off between live resumable sessions. Validate demand with a fake-door plus Wizard-of-Oz test and pre-registered kill thresholds before building the curation engine.
- **Key trade-offs:** Switcher-as-substrate vs. product-weight-on-hand-off (resolved: same substrate, different center of gravity). Curated brief vs. raw transcript forwarding (resolved: curation is the product). Ship-fast vs. prove-demand-first (resolved: cheap validation gate first).
- **Risks identified:** Feature demand is unvalidated even though the pain is documented; carrying a failed agent's transcript can poison the receiving agent, so the brief must drop dead-ends and beat a human's two-sentence summary; a client-side layer can only reach agents through prompt and files, not their internal state; two pre-1.0 dependencies (ACP SDK, OpenTUI) sit on the critical path; toad can relicense and Zed/JetBrains own the protocol and distribution; the addressable market is small and unsized.
- **Stretch goal (V2+):** The conductor - run N agents on one task in parallel and diff/compare/merge, built on the same context spine. Longer term, extract the cross-agent memory layer as a standalone primitive other tools can embed.

## Sub-Features

- **Hand-off bundle** - the normalized payload the hand-off forwards: source-agent summary (dead-ends dropped), referenced file set, and pending diffs as structured ACP objects.
- **Anti-corruption layer** - a thin internal boundary that maps each agent's file/diff representations into one owned bundle type, isolating ACP capability negotiation to a single seam.
- **Validation harness** - the fake-door affordance plus opt-in instrumentation used to test hand-off demand against the pre-registered kill thresholds.

## Out of Scope (V1)

- **Full text editor** - competes with mature editors like neovim and is not needed to test the hand-off thesis; deferred to V2.
- **Embedded shell** - it is toad's existing strength and adds surface without moving the hand-off metric; deferred.
- **File explorer panel** - a whole panel of state that does not move the hand-off metric; the referenced file set is captured inside the hand-off bundle instead.
- **Concurrent/parallel multi-agent orchestration (conductor)** - heavier and only works once the shared-context spine exists; sequenced as the V2 stretch.
- **More than two agents / plugin registry** - premature generality; build for two concrete agents and generalize when a real third one shows where the abstraction is wrong.
- **Custom summarization pipeline or bundle DSL** - use the source agent's own summary in V1 to avoid model-pipeline risk.
- **Durable or cross-machine session persistence** - in-memory resumable state within a run is enough to test the hypothesis.
- **Per-agent BYO endpoint/model remapping** - a real, stated demand, but not thesis-critical for V1; deferred to V2.

## Architecture Decision Records

- [ADR-001: V1 Scope - Cross-Agent Hand-off Wedge, Not a Generic Multi-Agent Switcher](adrs/adr-001.md) - V1 is a hand-off cockpit, not a generic switcher, differentiated by a permissive TS/Bun stack and ownership of the cross-agent context layer.

## Cost Estimate

Kitten runs against the user's own agent subscriptions and API keys, so its direct operational cost is close to zero.
The curated summary is produced by the source agent itself, which means the incremental token cost is borne by the user's existing agent, not by Kitten.

| Type | Volume | Estimated Cost |
| --- | --- | --- |
| Hand-off summarization tokens | 1 short summary per hand-off | Borne by user's existing agent subscription (no Kitten-side cost) |
| Hosting / backend | None in V1 (local-first, opt-in telemetry) | ~USD 0 |

## Open Questions

- Can a client-side, source-agent-produced brief reliably beat both the raw transcript and a human's two-sentence summary? This is the core assumption and needs a Wizard-of-Oz test before the curation engine is built.
- What fraction of real switches are triggered by "agent A got stuck," where carrying its context verbatim is contraindicated? Instrument the switch trigger before finalizing the curation design.
- Is there an observable workaround market today (gists, extensions, scripts piping context between agents) that signals acute demand?
- Which two agents ship in V1? Claude Code + Codex is the leading candidate given adapter maturity, but this needs confirmation.
- What is the privacy model for measuring "re-explanation eliminated" without capturing prompt content?
- License choice: MIT vs. Apache-2.0 (the latter adds a patent grant).
- Is depending on pre-1.0 OpenTUI plus a Zig build acceptable, or should the render boundary keep an alternative (e.g. Ink) swappable?
