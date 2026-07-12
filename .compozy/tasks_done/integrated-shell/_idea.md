# Integrated Shell - A Persistent Terminal That Feeds the Hand-off

## Overview

Kitten runs two AI coding agents side by side and lets a developer hand a live task between them.
Today it has no terminal of its own, so the moment a developer wants to run `bun test` or `git diff` to check what an agent just did, they leave Kitten for a separate terminal window and lose their place.

This idea adds a real, persistent shell to the cockpit: one long-lived `$SHELL` in a PTY, where `cd` and `export` stick, colors render, tab completion works, and output scrolls.
The point is not to match Toad, which already ships a shell.
The point is that a real shell produces trustworthy working state (cwd, recent commands, their exit codes), and Kitten can attach that state to the hand-off so the receiving agent inherits not just the conversation but where the work actually was.

V1 is a strategic bet, sized deliberately.
It ships the real shell (the "never leave the cockpit" goal) and a curated hand-off snapshot built from it (the differentiator), while deferring the hard parts (in-pane interactive apps, agents sharing the human's shell) to later.

## Summary / Differentiator

A plain integrated shell is parity with Toad (single-agent, Python/Textual, AGPL) and adds nothing Warp or a VS Code terminal do not already do better.
Kitten's only defensible angle is the one no competitor's architecture allows: a persistent real shell whose state two different agents hand back and forth.
Toad has the shell but one agent at a time.
Warp has multiple agents and a real terminal but no portable hand-off between them.
The rest of the agent CLIs have neither.
So the claim Kitten should make is narrow and true: the only open, agent-first cockpit where a persistent real shell becomes shared context for a cross-agent hand-off.

## Problem

A developer supervising two agents lives in a tight loop: read what an agent proposed, verify it, decide whether to accept or redirect.
Verification is almost always a shell command.
Run the tests. Check `git status`. Re-run the build. Look at what a script printed.
Right now every one of those means alt-tabbing to another terminal, which is a different window with a different working directory and no connection to the agent that prompted the check.

The existing workaround in most agent tools is a `!`-prefix passthrough that spawns a fresh subshell per command.
It looks like a shell and fails as one: `cd` evaporates on the next command, environment variables do not persist, colored output garbles, and anything interactive breaks the interface.
It is close enough to a terminal to be tempting and far enough to be untrustworthy, so developers keep a real terminal open anyway.

There is a second, sharper problem that only Kitten has.
When a task is handed from one agent to the other, the receiving agent gets the conversation and the touched files but not the environment: it does not know the current directory, that the last build failed, or what the last test run actually printed.
The human ends up re-explaining state that a terminal already knows.
A passthrough cannot fix this, because it cannot report a reliable cwd or exit code in the first place.
A real shell can.

### Market Data

- Gloria Mark's research at UC Irvine puts the cost of returning to a task after an interruption at 23 minutes 15 seconds.
This is the primary, well-established number behind "reduced context-switching," though it measures interruption in general, not terminal-switching specifically.
- Roughly 85% of VS Code users use the integrated terminal, second only to the editor itself.
This comes from a secondary stats aggregator, not a primary survey, so treat it as directional.
- Warp reached 500,000+ users and about $16M in revenue by late 2025, which shows real willingness to pay for an AI-terminal cockpit.
- Bun v1.3.5 (December 17, 2025) shipped native PTY support (`Bun.Terminal`), and `ghostty-opentui` already renders ANSI/VT with color and scrollback into OpenTUI.
Three weeks before this was written, the backend was the feature's biggest risk; now it is a first-party API.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Persistent PTY shell | Critical | One long-lived interactive `$SHELL` in a `Bun.Terminal` PTY. cwd and env persist across commands, output is full-color, tab completion and history come from the real shell, scrollback is navigable. |
| F2 | Pane focus and interrupt model | Critical | Replace the agent-only focus field with a pane union (`agent \| shell`). When the shell is focused, `Ctrl+C` interrupts the foreground command instead of quitting Kitten. |
| F3 | Curated hand-off environment snapshot | Critical | At hand-off, the user can attach cwd plus a bounded set of recent command records (command, output, exit code). Opt-in, curated in the existing preview, redacted, env excluded. |
| F4 | Graceful degradation for interactive apps | High | Detect the alt-screen escape at the VT-parser boundary and decline full-screen apps (vim, htop, lazygit) cleanly, forwarding SIGINT and reaping the child, rather than half-rendering. |
| F5 | Shell output secret guard | High | Run captured output through the existing redactor with added shell-specific patterns (`export KEY=`, cloud key shapes, `.env` dumps). Treat shell output as untrusted input that could inject into the receiving agent. |
| F6 | Context-switch instrumentation | Medium | Content-free counters for shell activation, snapshot attach, and an in-cockpit "run externally" action, so the effect on context-switching is measurable through Kitten rather than unobservable OS window changes. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Shell activation rate | > 50% of sessions within 2 weeks of use | Content-free counter: sessions where the shell ran at least one command / total sessions |
| Hand-off snapshot attach rate | > 30% of hand-offs | Counter on the snapshot-attach action / total hand-offs |
| Re-explanation reduction (moat) | > 20% fewer receiving-agent clarifying turns | Compare content-free counts of clarifying turns after hand-offs with vs without an attached snapshot; optional randomized holdout among opted-in users |
| Quick-check fidelity | > 95% commands render correctly; < 50 ms input latency | QA matrix (color, exit code, no garble) plus a runtime render-error counter |
| External-run proxy decline | > 40% drop over first 3 sessions | Counter on the in-cockpit "run externally" action, as a Kitten-observable stand-in for leaving for another terminal |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong (as a hand-off feeder; a plain shell alone would be Maybe) |
| **Defensibility** | Is this easy to copy or does it compound over time? | Strong (compounds through the hand-off pairing; the shell alone is commodity) |
| **Feasibility** | Can we actually build this? | Strong (Bun native PTY + ghostty-opentui removed the main risk) |

Leverage type: Strategic Bet.

## Council Insights

- **Recommended approach:** Build the real PTY shell and wire a minimal, opt-in, curated hand-off snapshot in V1, not "architected for later." A seam nobody consumes proves nothing, and running the moat test is the only thing that justifies reversing the prior decision to defer the shell.
- **Key trade-offs:**
  - A stateless passthrough cannot produce trustworthy cwd or exit codes, so testing the moat on a passthrough would feed the hand-off guesses and poison the result. The real shell is the prerequisite for a clean test, not a detour.
  - The class of hand-off fields matters: command, output, and exit code can be trusted from a captured child, but cwd and env require the persistent shell. If the snapshot advertises cwd, the real shell must land first.
  - Interactive-app support splits cleanly at the alt-screen escape, so graceful degradation is a real boundary rather than a hack.
- **Risks identified:**
  - Shell output is the densest source of secrets, flowing through a redactor deliberately biased toward false negatives, into a second vendor's context. Mitigation: opt-in and curated attach, env excluded, redactor plus mandatory preview, shell-specific patterns.
  - `Ctrl+C` currently quits the app, which is a rage-quit bug waiting to happen. Mitigation: fix focus and interrupt first, as a ship-blocker.
  - "Reduced context-switching" is hard to prove with content-free, opt-in telemetry and no visibility into OS window switches. Mitigation: measure Kitten-mediated proxies and consider a randomized holdout; do not overclaim.
  - Bun PTY is POSIX-only. Mitigation: document the Windows gap.
- **Dissent preserved:** The Product Mind and the Devil's Advocate hold that this reverses a prior decision that was correct, and that graceful degradation still forces a context switch during the take-the-wheel moment where users reach for vim or lazygit. Their condition for full agreement is either evidence that interactive apps are a minority of interventions, or a full-window PTY takeover instead of a refusal.
- **Stretch goal (V2+):** The shared substrate, where the human's shell commands and the agents' executions live in one persistent, cwd-shared timeline that both agents continuously see. Nearer-term V2 steps: full-window PTY takeover for interactive apps, then in-pane VT emulation, and an LLM bundle assembler that reasons over shell context.

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| `AgentConnection` / `TransportFactory` (`src/agent`) | The shell process mirrors this runtime pattern: an imperative child owned and disposed by the `SessionController`, reusing the ~16 ms frame-coalescing scheduler for output. |
| App store and reducers (`src/store`, `src/core/sessionReducer.ts`) | A pure `shellReducer` and a `shell` slice hold cwd, a bounded command ring, and scrollback, fed by shell domain events, with memoized selectors. |
| Hand-off bundle (`src/core/bundleAssembler.ts`, `src/app/handoff.ts`, `HandoffPreview`) | An optional `shell` field on `HandoffBundle`, populated and redacted in the assembler, composed into a prompt block, and shown as a droppable section in the preview. |
| Secret redactor (`src/core/secretRedactor.ts`) | Reused as-is on captured output; it already redacts arbitrary text. Shell-specific patterns are added to it. |
| Telemetry (`src/telemetry/recorder.ts`) | New content-free event types for shell activation, snapshot attach, and external-run proxy. |

## Out of Scope (V1)

- **In-pane full-screen interactive apps (vim, htop, lazygit)** - deferred to V2; V1 declines them gracefully. Full alt-screen VT emulation is the hard problem in this space and out of proportion for a first release.
- **Environment variables in the hand-off snapshot** - excluded; the snapshot carries cwd and command records only. Env is a dense secret reservoir crossing a trust boundary into a second vendor.
- **Agents executing in the human's shell (shared substrate)** - deferred to V2. ACP agents run their own tool-calls, so unifying execution into one shell is a large architectural change, not a first-release feature.
- **Auto-attaching shell output to hand-offs** - excluded; attach is always opt-in and human-curated. The redactor is biased toward false negatives, so a human gate is required before secrets can ride to another agent.
- **Windows support** - Bun PTY is POSIX-only for now, so V1 targets macOS and Linux.

## Architecture Decision Records

- [ADR-001: V1 Integrated Shell Is a Real PTY That Feeds the Hand-off](adrs/adr-001.md) - Build the real PTY shell plus a curated hand-off snapshot in V1; defer in-pane interactive apps and the shared substrate.

## Open Questions

- Intervention gap: does V1 decline interactive apps with a redirect message, or ship a full-window PTY takeover (suspend the split, hand the whole window to vim or lazygit, restore on exit)? The Devil's Advocate concedes only on the takeover or on evidence that interventions rarely need alt-screen apps.
- Moat measurement: can re-explanation reduction be measured content-free at acceptable fidelity, and is a randomized holdout among opted-in users worth the build?
- Snapshot shape: how many command records, what output-truncation limit, and whether to include a `git status` or last-test-result probe.
- Shell selection: use the user's `$SHELL` as-is, or a controlled login shell, and what config surface (scrollback size, enable flag) to expose.
- Reversal check: if early signal on the moat metric is weak, do we keep the shell as a standalone convenience or roll it back? This is where the preserved dissent gets resolved by data.
