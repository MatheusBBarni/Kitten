# PRD: Kitten - Cross-Agent Hand-off Cockpit

## Overview

Kitten is an open-source terminal application that runs two AI coding agents, Claude Code and Codex, in one keyboard-driven interface and lets a developer hand a live task from one agent to the other without re-explaining the project.

The target user is the multi-agent power developer who already runs both agents and switches between them by task.
Today that switch is expensive: they copy the transcript, re-attach the files, summarize what changed, and restate their intent every time, so most people either avoid switching or accept the context loss.

Kitten's value is a one-keystroke hand-off that assembles the relevant context (a transcript excerpt, the files the agent touched, and the pending diffs), lets the developer review and edit it, and delivers it to the second agent so it continues where the first stopped.
V1 is deliberately narrow: it exists to prove that developers will adopt cross-agent hand-off before Kitten invests in automated curation.

## Goals

- Prove the core hypothesis: multi-agent developers will adopt a one-keystroke, human-curated hand-off between two agents.
- Eliminate the context tax on an agent switch, measured by whether the developer has to re-state context to the receiving agent.
- Reach a clear kill-or-scale decision against pre-registered thresholds within the first weeks of public use.
- Establish Kitten as the terminal tool that owns cross-agent hand-off, on a permissive license and a TypeScript/Bun stack.
- Milestone target: 1,000 GitHub stars within 90 days of launch.

## User Stories

**Primary persona - The Agent Juggler** (senior/staff engineer running Claude Code and Codex, switching by task):

- As a multi-agent developer, I want to run Claude Code and Codex in one terminal, so that I stop juggling separate windows and configs.
- As a developer whose agent stalled, I want to hand the task to the other agent with the context already assembled, so that I do not re-explain the project.
- As a developer, I want to review and edit the hand-off bundle before it is sent, so that I do not poison the receiving agent with dead-ends or leak secrets.
- As a developer, I want to hand a task back to the original agent, so that I can move work in both directions during a session.

**Secondary persona - The Evaluator** (wants the second agent to take over when the first is weaker at the task):

- As a developer, I want to approve or reject the changes an agent proposes, so that I stay in control of what touches my code.
- As a privacy-conscious developer, I want any usage measurement to be opt-in and free of my prompt and code content, so that my work stays private.

## Core Features

| # | Feature | Priority | What it does and why it matters |
| --- | --- | --- | --- |
| F1 | Two-agent terminal cockpit | Critical | Runs Claude Code and Codex together over ACP in one TUI, with a focused full-width conversation pane, a keystroke to switch focus, and a status strip showing each agent's state (idle / working / waiting for approval). This is the substrate the hand-off stands on. |
| F2 | Live conversation with streaming and approvals | Critical | Shows each agent's response as streamed, readable Markdown, surfaces tool calls (reads, edits, commands), and lets the developer approve or reject a proposed change at the turn level. Table stakes for talking to an agent at all. |
| F3 | Continue hand-off with preview-and-edit | Critical | One keystroke assembles a context bundle (transcript excerpt, referenced file set, pending diffs), shows it in an editable preview, and on send delivers it to the other agent, which continues the task in a live session. This is the product. |
| F4 | Live resumable sessions and hand-back | High | Both agent sessions stay alive and addressable within a run, so a task can be handed off and later handed back, rather than fired one way into a dead session. |
| F5 | Secret redaction in the bundle | High | Detects and strips obvious secrets (API keys, tokens) from the bundle before the preview, so a hand-off does not forward credentials to the second agent. |
| F6 | Opt-in, content-free usage measurement | High | Local-first, opt-in counters for the honest metrics (hand-off adoption, repeat use, re-explanation eliminated, edit volume), capturing no prompt or code content. This is how the kill-or-scale decision gets made. |
| F7 | First-run setup and agent readiness | Medium | Guides the developer to configure the two agents and their keys, shows a clear ready / not-ready state per agent, and assumes the current directory is the project, so the two-agent setup cannot silently half-fail. |

## User Experience

**Primary flow:**

1. The developer runs Kitten from inside a project directory.
2. Both agents show a ready state in the status strip; if one is not configured, Kitten says exactly what is missing.
3. The developer works with Claude Code in the focused pane, watching streamed responses and approving or rejecting its edits.
4. Claude Code stalls, or the developer decides Codex is better suited to the next step.
5. The developer presses the hand-off key. Kitten assembles the bundle: a transcript excerpt, the files Claude Code touched, and its pending diffs, with detected secrets stripped.
6. The bundle opens in an editable preview. The developer trims irrelevant turns, drops a dead-end, or fixes the framing, then confirms.
7. Focus switches to Codex, which receives the bundle and continues the task. The status strip shows Claude Code as idle.
8. If needed, the developer hands the task back to Claude Code the same way.

**UX considerations:**

- Rendering must be flicker-free and survive terminal resize, since flicker and garbled resize are the top complaints about existing terminal agents.
- Keyboard conventions follow what power users already expect: Enter submits, Shift+Enter inserts a newline, Esc interrupts a running agent.
- The interface is keyboard-first, with a discoverable help panel and an always-visible strip of the keys that matter in the current context.
- Text selection and copy must stay clean, without line numbers or box-drawing characters bleeding into the copy.
- The hand-off preview is the emotional core of the product and must feel fast and legible: what is being carried, what was stripped, and what the developer can change.

**Onboarding:**

- Install, configure the two agent commands and their keys, and run inside a repo.
- Kitten validates each agent up front and shows per-agent readiness, so first-run problems are obvious rather than silent.

## High-Level Technical Constraints

- Kitten integrates with agents exclusively over the Agent Client Protocol (ACP); V1 targets the Claude Code and Codex adapters.
- Local-first: Kitten runs on the developer's machine against their own agent subscriptions and keys, with no Kitten-hosted backend.
- Privacy: usage measurement is opt-in and must never capture prompt or code content; secrets are redacted from bundles before they are sent.
- Performance from the user's perspective: flicker-free rendering, a hand-off preview that assembles within a couple of seconds, and time-to-first-agent-response under 60 seconds from a clean install.
- The project ships under a permissive open-source license (MIT or Apache-2.0), a deliberate contrast to toad's AGPL.

## Non-Goals (Out of Scope)

- **Full text editor / code editing outside the agent flow** - Kitten is not competing with neovim; deferred beyond V1.
- **Embedded persistent shell** - toad's existing strength, not needed to test the hand-off; deferred.
- **File explorer panel** - referenced files appear inside the hand-off context, not as a standalone browser.
- **LLM-powered automatic curation** (source-agent summary, dead-end dropping, auto file selection) - the human curates in the preview for V1; automation is Phase 2.
- **Hunk-level diff review** - V1 approves or rejects at the turn level; granular hunk review is Phase 2.
- **Second-opinion / review intent** - V1 ships a single "continue" intent; other intents are Phase 3.
- **More than two agents and any plugin registry** - V1 is exactly two agents.
- **Parallel multi-agent orchestration (the conductor)** - depends on the context spine and is a later bet.
- **Durable or cross-machine session persistence** - in-memory resumable state within a run is enough for V1.
- **Per-agent endpoint or model remapping** - a real demand, but not thesis-critical for V1.

## Phased Rollout Plan

### MVP (Phase 1)

- Features F1 through F7: the two-agent cockpit, streaming and turn-level approvals, the continue hand-off with preview-and-edit and deterministic bundle assembly, hand-back, secret redaction, opt-in measurement, and first-run readiness.
- **Success criteria to proceed:** hand-off invoked in more than 40% of multi-agent sessions, more than 25% of first-time hand-off users repeat within 7 days, and re-explanation eliminated in at least 60% of hand-offs. Below these, kill or pivot.

### Phase 2

- Smart curation: the source agent produces a curated brief with dead-ends dropped and the relevant file subset selected automatically, reducing how much the developer edits in the preview.
- Hunk-level accept/reject diff review.
- **Success criteria to proceed:** curated-brief acceptance above 50% and a measurable drop in preview edit volume versus the deterministic MVP baseline.

### Phase 3

- Second hand-off intent ("second opinion / review this diff") that shapes the bundle differently.
- Additional agents beyond the first two (e.g. Cursor), and the start of the parallel-agent conductor exploration.
- **Long-term success criteria:** sustained multi-agent retention and a credible path to extracting the cross-agent context layer as a reusable primitive.

## Success Metrics

| Metric | Target | Perspective |
| --- | --- | --- |
| Hand-off adoption | > 40% of multi-agent sessions invoke a hand-off | Core thesis |
| Hand-off repeat use | > 25% of first-time hand-off users repeat within 7 days | Retention of the behavior |
| Re-explanation eliminated | >= 60% of hand-offs need no manual context restatement before the receiving agent acts | Pain solved |
| Curated-brief acceptance | > 50% of hand-off continuations are not immediately undone | Quality |
| Time-to-first-agent-response | < 60s from clean install | Onboarding health |
| Bundle edit volume | Tracked (signal, no fixed target) | Whether Phase 2 curation is needed |
| Community traction | 1,000 GitHub stars within 90 days | Adoption |

## Risks and Mitigations

- **Demand is unvalidated** (documented pain, unproven feature) - ship the thin validation slice, pre-register the thresholds and metric definitions before launch, and honor the kill decision.
- **Small, unsized addressable market** (multi-agent users are a minority within a minority) - keep V1 cheap so the bet is affordable, and validate before scaling.
- **Competitive and platform pressure** - toad can relicense and Zed/JetBrains own the protocol and distribution; mitigate by owning the hand-off layer they leave open, shipping permissively, and staying terminal-native.
- **A rough deterministic bundle undersells the wedge** - invest in an accurate referenced-file set and clean pending diffs, and make the preview fast to edit; treat heavy editing as the signal that earns Phase 2.
- **Two-agent setup friction deters adoption** - per-agent readiness checks and a minimal first-run flow so failures are legible.
- **Privacy concerns suppress measurement opt-in** - keep telemetry opt-in, content-free, local-first, and transparent about exactly what is counted.
- **External dependency on the agent adapters** - V1 relies on Claude Code and Codex keeping working ACP adapters; track adapter health and design the hand-off so a single agent breaking degrades gracefully rather than taking down the app.

## Architecture Decision Records

- [ADR-001: V1 Scope - Cross-Agent Hand-off Wedge, Not a Generic Multi-Agent Switcher](adrs/adr-001.md) - V1 commits to the hand-off wedge over a generic switcher.
- [ADR-002: Validation-First Thin Slice for V1](adrs/adr-002.md) - V1 uses a human-curated hand-off and defers the LLM curation engine behind a validation gate.

## Open Questions

- How good can the deterministic bundle (referenced files plus pending diffs, no LLM) actually be? This needs an early prototype, since a weak bundle undersells the wedge.
- What are the exact kill-or-scale threshold definitions and the measurement window (how many active users and how many weeks make the signal meaningful)?
- How is "re-explanation eliminated" detected without capturing content? A candidate heuristic is whether the developer sends a long, context-like message to the receiving agent before it takes its first action.
- Is the hand-off symmetric in both directions at launch, or is there a designated source and target to start?
- License choice: MIT versus Apache-2.0 (the latter adds a patent grant).
- What is the launch and distribution plan that makes the traction metric achievable, and does it affect the validation window?
