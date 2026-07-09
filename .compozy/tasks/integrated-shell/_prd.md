# PRD: Integrated Shell

## Overview

Kitten runs two AI coding agents side by side and lets a developer hand a live task between them.
It has no terminal of its own today, so verifying an agent's work means leaving Kitten for a separate terminal and losing your place.

This feature adds a real, persistent shell to the cockpit.
It is a full-width pane the user toggles into: `cd` and `export` persist, output is full-color, tab completion works, and scrollback is navigable.
When a user runs a full-screen tool like `vim` or `lazygit`, Kitten hands the whole window to it and restores the cockpit on exit, so even hands-on interventions never require another terminal.

The shell is not only a convenience.
At hand-off, the user can attach a curated snapshot of what they just did in the shell (the working directory and recent command outputs), so the receiving agent inherits the environment instead of making the human re-explain it.
That pairing, a real shell whose state two agents hand back and forth, is the thing no competitor's architecture offers.

## Goals

- Let a developer run their verification and intervention commands inside Kitten so they stop dropping out to a separate terminal.
- Make the shell feel real enough to trust: persistent state, correct color, working tab completion, clean interactive-app handling.
- Turn shell activity into shared hand-off context, so hand-offs carry the working directory and recent output and the receiving agent needs less re-explanation.
- Ship the shell and the hand-off snapshot together in one release, so the differentiator is validated from day one rather than deferred.
- Measure the effect through Kitten-observable signals, since OS-level window switching cannot be observed directly.

## User Stories

**Astra - the agent supervisor (primary)**
- As an agent supervisor, I want to run tests and git commands inside Kitten, so I stay in flow while checking what an agent just produced.
- As an agent supervisor, I want `cd` and environment variables to persist across commands, so a sequence of checks behaves like a real terminal.
- As an agent supervisor, I want to run `vim` or `lazygit` when I take over from a stuck agent, so I can fix things by hand without opening another terminal.
- As an agent supervisor, when I hand the task to the other agent, I want to attach the working directory and the outputs I just saw, so the receiving agent does not make me re-explain the environment.
- As an agent supervisor, I want to drop any command output that printed a secret before it rides along, so I never leak a credential into the other agent's context.

**Ravi - the terminal-tool evaluator (secondary)**
- As someone comparing Kitten to Toad and Warp, I want the shell to render color, complete on `Tab`, and resize correctly, so I trust it as a real terminal.
- As an evaluator, I want to discover the shell and the attach action without reading docs, so I find the value in the first session.

**Edge cases**
- As a user, when I press `Ctrl+C` on a runaway command, I want it to stop the command, not quit Kitten.
- As a user, when I finish in a full-screen app, I want to land back in the cockpit exactly where I left it, with no corrupted display.

## Core Features

**Persistent shell pane (Critical)**
A full-width pane, toggled with a keybind, backed by one long-lived shell.
State persists across commands, output is full-color, tab completion and history come from the real shell, and scrollback is navigable.
The shell keeps running while hidden.

**Pane focus and interrupt model (Critical)**
Focus moves between the agent view and the shell with an unambiguous indication of which one receives keystrokes.
When the shell is focused, `Ctrl+C` interrupts the running command; it never quits Kitten.

**Full-window interactive takeover (Critical)**
When a full-screen interactive app starts, Kitten hands the entire window to it and restores the cockpit cleanly when the app exits.
This keeps the "never leave the cockpit" promise for the take-the-wheel moment.

**Curated hand-off snapshot (Critical)**
At hand-off, the preview pre-fills a "Shell context" section with the working directory and recent command records.
The user drops anything they do not want with `Space`, the same gesture already used for files and diffs.
The snapshot is redacted before sending and never includes environment variables.

**Shell output secret guard (High)**
Captured output is redacted before it can ride along, with attention to the shapes that leak from shells (`export KEY=`, cloud keys, `.env` dumps).
Shell output is treated as untrusted, since it could carry text that manipulates the receiving agent.

**Discovery affordances (Medium)**
The status strip shows the toggle-shell keybind, and the F1 help panel documents the shell and the attach flow.

**Context-switch instrumentation (Medium)**
Content-free counters record shell activation, snapshot attach, and an in-cockpit "run externally" action, so the feature's effect on context-switching is measurable without reading any command content.

## User Experience

**Primary flow - quick check between turns.**
Astra reads an agent's proposed change, toggles into the shell, runs `bun test`, sees colored pass/fail output, toggles back, and prompts the agent.
The working directory she left is still there next time she toggles in.

**Take-the-wheel flow.**
An agent gets a rebase wrong.
Astra toggles into the shell and runs `lazygit`.
Kitten hands the whole window to `lazygit`; she resolves the conflict, quits, and lands back in the cockpit unchanged.
She then resumes the agent.

**Hand-off with shell context.**
After a run of commands, Astra hands the task to the other agent.
The preview opens with a "Shell context" section already populated with her working directory and the last few command records.
One line printed a token, so she drops it with `Space`, then sends.
The receiving agent starts already knowing where the work is and what the last commands showed.

**Discovery.**
On any session the status strip shows the keybind to open the shell.
Pressing F1 explains the shell, the takeover behavior, and how to attach shell context to a hand-off.

**Accessibility and interaction.**
The interface stays keyboard-first.
Focus is shown clearly so the user always knows whether the agent or the shell has the keyboard.
Color is never the only signal for state; exit status and errors are also conveyed in text.

## High-Level Technical Constraints

- V1 runs on macOS and Linux only; Windows is out of scope for this release.
- Shell context never leaves for the other agent without passing the redactor and the human preview, and environment variables are never included in the snapshot.
- Telemetry stays content-free and opt-in; no command text or output is ever recorded.
- The shell runs the user's own shell and inherits their environment; Kitten does not manage their shell configuration or credentials.

## Non-Goals (Out of Scope)

- In-pane rendering of interactive apps: they take over the full window instead, and V1 does not draw `vim`/`htop` inside the shell pane.
- Agents executing in the human's shell (the shared-substrate vision): deferred to a later phase.
- Environment variables in the hand-off snapshot: excluded for secret safety.
- Auto-attaching shell output to a hand-off without the user curating it.
- A general-purpose terminal replacement with multiple tabs, panes, or split layouts.
- Windows support.

## Phased Rollout Plan

### MVP (Phase 1)
- Persistent shell pane, pane focus and fixed `Ctrl+C`, full-window interactive takeover, curated hand-off snapshot, shell output secret guard, discovery affordances, and instrumentation.
- Success criteria to proceed: shell activation above 50% of sessions, quick-check fidelity above 95%, snapshot attach above 30% of hand-offs, and zero reports of `Ctrl+C` quitting the app.

### Phase 2
- Deeper measurement of the moat (a randomized holdout to test re-explanation reduction), in-pane rendering of interactive apps so they no longer need a full-window takeover, a richer snapshot (optional `git status` or last-test-result probe), and a shell configuration surface.
- Success criteria to proceed: evidence that attached shell context measurably reduces re-explanation.

### Phase 3
- The shared substrate: the human's shell commands and the agents' executions live in one persistent, shared timeline both agents can see, plus a smarter hand-off assembler that reasons over shell context.

## Success Metrics

| Metric | Target | How to Measure |
| --- | --- | --- |
| Shell activation rate | > 50% of sessions within 2 weeks of use | Content-free counter: sessions with at least one shell command / total sessions |
| Hand-off snapshot attach rate | > 30% of hand-offs | Counter on the snapshot-attach action / total hand-offs |
| Re-explanation reduction (moat) | > 20% fewer receiving-agent clarifying turns | Compare clarifying-turn counts after hand-offs with vs without a snapshot; optional randomized holdout |
| Quick-check fidelity | > 95% commands render correctly; < 50 ms input latency | QA matrix (color, exit code, no garble) plus a render-error counter |
| External-run proxy decline | > 40% drop over first 3 sessions | Counter on the in-cockpit "run externally" action, as a Kitten-observable stand-in for leaving |

## Risks and Mitigations

- **Users keep their external-terminal habit.** The feature exists but people alt-tab out of muscle memory. Mitigation: persistent discovery affordance, takeover so nothing forces them out, and the external-run proxy metric to catch it.
- **The differentiator is hard to prove.** "Reduced context-switching" resists clean measurement with content-free, opt-in telemetry. Mitigation: measure Kitten-observable proxies and the re-explanation signal, consider a holdout, and report honestly rather than overclaiming.
- **Secret-leak fear slows adoption.** Users worry the shell will leak credentials into the other agent. Mitigation: opt-in curation, env excluded, redaction plus mandatory preview, and clear messaging that nothing rides along uncurated.
- **Competitors iterate.** Toad and Warp keep moving. Mitigation: lead on the shared-hand-off-context story their architectures do not support, and on a permissive, embeddable stack.
- **Platform gap.** No Windows support at launch. Mitigation: scope V1 to macOS and Linux and state it plainly.
- **Large MVP could slip.** Everything ships at once. Mitigation: sequence the work internally (focus and interrupt first, then the shell, then takeover, then the snapshot) even though it releases together.

## Architecture Decision Records

- [ADR-001: V1 Integrated Shell Is a Real PTY That Feeds the Hand-off](adrs/adr-001.md) - Build the real shell plus a curated hand-off snapshot; defer in-pane interactive apps and the shared substrate.
- [ADR-002: Ship the Full Cockpit Shell in One Release, With Interactive-App Takeover in the MVP](adrs/adr-002.md) - Approach A; pulls full-window takeover into the MVP, amending ADR-001 on that point.

## Open Questions

- Snapshot shape: how many command records to suggest by default, how far to truncate long output, and whether to add a `git status` or last-test-result probe (candidate for Phase 2).
- Moat measurement: can re-explanation reduction be measured content-free at acceptable fidelity, and is a randomized holdout among opted-in users worth building?
- Takeover interaction: does handing the window to an interactive app need any confirmation, or should it be seamless?
- Shell selection and configuration: use the user's `$SHELL` as-is, and what settings (scrollback size, enable flag) to expose.
- Layout validation: the toggle-pane and status-strip choices deserve dedicated UX validation, since the fresh UX research pass for this PRD did not complete.
