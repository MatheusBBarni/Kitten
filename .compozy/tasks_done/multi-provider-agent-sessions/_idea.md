# Kitten - Multi-Session Fleet for the Terminal

## Overview

Kitten runs several independent AI coding agents at once and routes your attention to the one that needs you next.
Each session is its own task in its own working directory, driven by its own ACP agent (Claude Code, Codex, or another ACP adapter).
A Ctrl+S overview shows every running session and surfaces which agent is blocked, waiting, done, or still working, so no agent sits idle because you forgot it was there.

The target user is the same multi-agent power developer Kitten already serves, now running more than one task in parallel across more than one repository.
The value shifts from "hand a single task between two agents" to "keep a fleet of agents productive without losing track of any of them," while the curated hand-off that Kitten is known for still works between any two sessions.

V1 is a strategic bet on the layer beneath the overview, not on the overview itself.
The visible Ctrl+S screen already exists in a shipping competitor, so Kitten does not treat it as the headline.
Instead V1 builds the session model that turns Kitten's two-agent cockpit into an N-session cockpit, keeps the hand-off differentiator center stage, and ships a deliberately thin overview whose job is to route attention rather than to manage a fleet.
Runtime session spawning, grid polish, grouping, and persistence are deferred until real usage shows the fleet workflow is a felt need.

## Problem

A developer who runs one AI coding agent watches it work and answers it when it asks.
A developer who runs three of them, each on a different task in a different repository, cannot watch all three.
Two of them go quiet while the third asks a question, and the two quiet ones are not done, they are blocked and waiting, burning wall-clock while their author is looking at a different terminal.
The bottleneck stops being the agent and becomes the human's attention, and there is no single place that says which agent needs that attention right now.

Kitten today cannot even represent this situation.
It is wired for exactly two agents on one shared task: the session container is a fixed record with one slot for Claude Code and one for Codex, there is no per-session working directory, and there is no way to add a third session or to see several at a glance.
Its one differentiated capability, the curated hand-off, assumes a single "other agent" to hand to.
So the tool that set out to make multi-agent work smoother stops at two agents and one project, which is below where its own users already operate.

The current workarounds are the same ones the broader market uses: a terminal multiplexer with a pane per agent, or a git-worktree-per-agent script, plus a lot of manual scanning to find the agent that is waiting.
These keep the processes alive but do nothing about attention.
The developer still has to walk the panes to discover who is blocked, and nothing tells them that an agent has been sitting on a question for two minutes.
That gap, knowing which agent needs you across a fleet you cannot watch all at once, is the problem V1 attacks, and it is the problem Kitten's hand-off heritage is unusually well placed to own because the answer eventually includes moving context between the sessions, not just listing them.

### Market Data

- AI coding tools are mainstream: 84% of developers use or plan to use them and roughly half use them daily (Stack Overflow 2025 Developer Survey).
- Running several agents in parallel is a real but still-emerging pattern; 2026 how-to content describes worktree-per-agent workflows as "growing but not yet the default," and no reliable survey yet quantifies how many developers run concurrent agent sessions. This is the opportunity and the risk at once.
- The space is crowded and consolidating rather than open. Toad ships a terminal-native, multi-provider, ACP-based frontend whose Ctrl+S screen shows the state of all agents at once. Claude Squad (~8.1k GitHub stars, AGPL, tmux plus git worktrees) manages many agent sessions in isolated workspaces. Warp added a centralized Agent Management Panel that flags which agent is waiting and jumps you to it, and Claude Code added a built-in agent view. Vibe Kanban, the most-starred board tool at ~18.6k stars, shut down in April 2026.
- The overview grid is therefore table stakes, not a differentiator. What competitors do not serve well is a cross-project fleet (most assume N worktrees of one repo), a permissively licensed terminal-native option (the two closest rivals are AGPL), and a curated cross-agent context hand-off between sessions (no surveyed competitor offers one).
- ACP gives Kitten a large, growing pool of providers for free: Claude Code, Codex CLI, Gemini CLI, Cursor, and OpenCode all ship working ACP adapters, and the roster is now 30+ agents.

## Summary / Differentiator

Kitten does not win by adding the overview screen, because Toad and Warp already have one.
It wins by owning the layer under the screen: a session model where independent agents across independent projects can hand curated, redacted context to each other, and an overview whose job is to route your attention to the agent that needs it rather than to render a wall of status.
The permissive license and TypeScript/Bun stack keep the corporate-adoption door open and widen the contributor base against AGPL/Python and Go rivals.
The cross-project framing and the hand-off are the parts competitors structurally miss, and they are the parts that compound: every session that can lend context to another makes the next hand-off more valuable.

## Core Features

| #   | Feature                              | Priority | Description |
| --- | ------------------------------------ | -------- | ----------- |
| F1  | Multi-session model                  | Critical | Replace the fixed two-agent record with a growable collection of sessions. Each session is a descriptor carrying its own instance id, provider kind, working directory, task, and status. |
| F2  | Per-session working directory        | Critical | Each session runs in its own directory or repository, so the fleet spans separate projects rather than branches of one repo. This is what makes cross-project hand-off testable. |
| F3  | Ctrl+S overview with attention-routing | Critical | A full-screen, keyboard-driven list of session cards (title, provider, working directory, status) that surfaces which agent needs you and jumps focus to it on Enter. |
| F4  | Attention-aware status model         | Critical | Extend session status to idle, working, waiting, done, and error, so the overview never shows stale or zombie rows and can rank who needs attention. |
| F5  | Descriptor-addressed hand-off        | High     | Re-express the existing curated, redacted hand-off as a session-to-session action that names an explicit target session. Curation and the redacted preview stay unchanged; only the addressing changes. |
| F6  | Two-pane view as a session view      | High     | Generalize today's focused/side-by-side layout into a view over the session collection (the N=2 case), so nothing that works today regresses. |
| F7  | Safe multi-session approvals         | High     | Every approval prompt and status row is labeled with its session title and working directory, and there is no cross-session auto-approve, so an approval never lands in the wrong repository. |
| F8  | Statically seeded fleet from config  | Medium   | Sessions are seeded at launch from config (provider, working directory, task). No runtime spawn or kill in V1; this is the substrate the validation loop runs on. |

## KPIs

| KPI                       | Target                                                    | How to Measure |
| ------------------------- | --------------------------------------------------------- | -------------- |
| Multi-session adoption    | >= 40% of active runs open >= 3 concurrent sessions       | Opt-in telemetry: max concurrent sessions per run |
| Attention latency         | Median time in `waiting` before the user acts < 30s       | Opt-in telemetry: delta from status-enters-waiting to next user action |
| Idle-fleet avoidance      | < 15% of session-minutes spent blocked and unattended     | Opt-in telemetry: aggregate waiting time on sessions with no focus |
| Overview reliance         | >= 60% of focus switches go through Ctrl+S                 | Opt-in telemetry: switch-via-overview events / total focus switches |
| Hand-off survives scale   | Hand-off invoked in > 25% of runs touching >= 2 sessions  | Opt-in telemetry: hand-off events / runs with two or more live sessions |

## Feature Assessment

| Criteria            | Question                                            | Score  |
| ------------------- | --------------------------------------------------- | ------ |
| **Impact**          | How much more valuable does this make Kitten?       | Strong |
| **Reach**           | What % of users would this affect?                  | Maybe  |
| **Frequency**       | How often would users encounter this value?         | Strong |
| **Differentiation** | Does this set us apart or just match competitors?   | Strong |
| **Defensibility**   | Is this easy to copy or does it compound over time? | Strong |
| **Feasibility**     | Can we actually build this?                         | Strong |

Leverage type: Strategic Bet with compounding potential.
The overview alone would score Pass on differentiation and defensibility; the substrate-plus-hand-off framing is what lifts both to Strong.

## Council Insights

- **Recommended approach:** Build the N-session model as infrastructure beneath the hand-off differentiator, not as a Ctrl+S headline. Introduce a session descriptor that splits instance identity from provider kind, move the working directory onto the per-session descriptor, extend the status model, re-express the hand-off as descriptor-to-descriptor addressing in the same release, and ship a thin overview that routes attention. Seed the fleet statically and validate the attention pain with about ten multi-agent power users before funding lifecycle management.
- **Key trade-offs:** Overview-as-headline versus substrate-under-the-wedge (resolved: substrate, with a deliberately thin overview). Supersede the two-pane layout versus generalize it (resolved: generalize; two-pane is the N=2 view). Validate-first versus prove-the-abstraction (resolved to the same line: the descriptor split, per-session working directory, waiting/done/error states, and descriptor-addressed hand-off are the substrate the validation runs on, while spawn/kill, grid chrome, provider matrix, grouping, and persistence are deferred).
- **Risks identified:** The "agents sit idle" pain is asserted, not observed, so V1 gates on a small-cohort validation before funding lifecycle. Rewiring hand-off addressing during the refactor could regress the one moat, so curation and preview stay untouched and hand-off lands on the descriptor model in the same release, treated as a release blocker if it regresses. Running N live agents across N repositories multiplies permission-context confusion, so every approval and status row is labeled with session and working directory and there is no cross-session auto-approve. Keying the new collection by provider kind as a shortcut would silently cap the fleet at one session per provider and contaminate the validation signal, so it must be keyed by instance id.
- **Stretch goal (V2+):** A triage board ranked by who-needs-you over a shared, curated, redacted cross-agent memory that sessions lend to each other. This is the direction only Kitten's hand-off heritage can own, and the V1 substrate is chosen specifically to make it reachable.

## Out of Scope (V1)

- **Runtime session spawn and kill (and the `terminated` status)** - the fleet is seeded from config at launch; on-the-fly lifecycle waits until usage shows fleet management is a felt need.
- **Grid chrome, grouping, and ranked attention queues beyond a simple needs-you signal** - additive polish, not required to test whether attention-routing changes behavior.
- **Provider-switch UI, a provider matrix, and non-ACP providers** - V1 stays ACP-only; other ACP agents (OpenCode is already ACP) and non-ACP tools plug in later.
- **Durable or cross-restart session persistence** - in-memory sessions within a run are enough to test the hypothesis.
- **Shared cross-agent memory and the conductor (N agents on one task)** - the V2+ destination and a research bet; the substrate makes it reachable but it is not V1.
- **Deleting the two-pane layout** - it is generalized into the N=2 session view, not removed.

## Integration with Existing Features

| Integration Point                 | How |
| --------------------------------- | --- |
| Curated hand-off (Ctrl+T)         | Retargeted from "the other agent" to an explicitly named session; curation and redacted preview unchanged. |
| Focus switch (Ctrl+O) and layout  | Generalized from a two-agent toggle to focus over a session collection; two-pane becomes the N=2 view. |
| Approval overlay                  | Reused as the template for the Ctrl+S overlay and extended to label each prompt with session and working directory. |
| Opt-in telemetry recorder         | Extended with attention-latency and multi-session counters, still content-free. |
| Config loader                     | The fixed two-key `agents` object becomes a collection of provider entries with per-session working directory and task. |

## Sub-Features

- **Session descriptor** - the per-session unit of ownership: instance id, provider kind, working directory, task, and status. Splits instance identity from provider kind so two sessions can share a provider.
- **Attention-routing surface** - the Ctrl+S overlay plus the logic that surfaces the session that needs you and jumps focus to it.
- **Hand-off re-addressing** - the change that makes the existing hand-off name an explicit target session rather than the single "other agent."
- **Seeded-fleet config** - the config shape that provisions the starting sessions and their working directories at launch.

## Architecture Decision Records

- [ADR-001: N-Session Model as Infrastructure Beneath the Hand-off Wedge, Not a Ctrl+S Headline](adrs/adr-001.md) - V1 builds the session model and a thin attention-routing overview while keeping the hand-off differentiator center stage, generalizing rather than deleting the two-pane layout, and deferring spawn/kill and persistence.

## Open Questions

- Is the "agents sit idle waiting" pain frequent enough to reorganize the app around? This is the core assumption and needs the small-cohort validation before lifecycle management is funded.
- What should rank the attention queue: blocked-on-approval, asked-a-question, errored, or idle-with-no-next-task? Which signal matters most to users is unknown.
- Does descriptor-addressed hand-off still get used once there are more than two sessions, or does a larger fleet make hand-off less relevant?
- How should a crashed or exited ACP session be represented distinctly from a finished one, given ACP stop-reason semantics?
- Is per-row working-directory labeling plus no cross-session auto-approve enough to prevent wrong-repo approvals, or is stronger per-session isolation needed?
- What is the privacy model for measuring attention latency without capturing prompt content?

## Cost Estimate

Kitten runs against the user's own agent subscriptions and API keys, so its direct operational cost stays near zero.
The overview and the session model add no server-side component in V1.

| Type              | Volume                            | Estimated Cost |
| ----------------- | --------------------------------- | -------------- |
| Agent tokens      | Borne by each session's own agent | Borne by the user's existing subscriptions (no Kitten-side cost) |
| Hosting / backend | None in V1 (local-first, opt-in telemetry) | ~USD 0 |
