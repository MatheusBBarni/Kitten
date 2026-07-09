# PRD: Kitten Multi-Session Fleet

## Overview

Kitten today runs two AI coding agents on one shared task.
This feature turns it into a cockpit for a fleet of independent agent sessions, each working its own task in its own project directory, and routes the developer's attention to whichever agent needs them next.

The user is the multi-agent power developer Kitten already serves, now running more than one task in parallel across more than one repository.
Their problem shifts from re-explaining context when they switch agents to losing track of which running agent is blocked and waiting while they look at a different terminal.
The value is a single place that shows the whole fleet, tells the developer which agent needs them, and gets them there, so no agent sits idle because it was forgotten.
Kitten's curated hand-off still works, now between any two sessions in the fleet.

## Goals

- Keep a fleet of agents productive by cutting the time an agent waits, blocked, before its developer responds.
- Make running three or more concurrent sessions a normal, legible workflow rather than a juggling act across terminals.
- Preserve the curated hand-off as the differentiator and make it work session-to-session, so nothing that works today regresses.
- Reach an away developer at the operating-system level, not only inside the terminal, when an agent needs them.
- Ship the whole slice as one coherent V1, then validate the "agents sit idle" assumption with a small cohort before building runtime fleet management.

## User Stories

Primary persona: the fleet developer, running several independent coding tasks at once across different repositories.

- As a fleet developer, I want to see every running session and its state in one place, so I stop scanning separate terminals to find the one that needs me.
- As a fleet developer, I want one action that jumps me to the next session that needs me, so I respond without hunting.
- As a fleet developer working in another window, I want a desktop notification when an agent needs me, so I do not leave it blocked for twenty minutes.
- As a fleet developer, I want every approval to show which session and directory it belongs to, so I never approve a command in the wrong repository.
- As a fleet developer, I want to hand a task from one session to a specific other session, so the curated hand-off works across my whole fleet, not just between two fixed agents.
- As a fleet developer, I want to declare my recurring sessions once and launch them together, so starting a working session is fast.

Secondary persona: the lead running parallel experiments across repositories, who wants one keyboard-first place to see and triage them all.

## Core Features

- **Multi-session fleet.** Kitten runs a growable set of independent sessions instead of a fixed pair. Each session has its own agent, its own project directory, its own task, and its own state. Two sessions may use the same provider (two Claude Code sessions on two projects), which the current two-agent model cannot express.
- **Pre-declared fleet startup.** The developer declares their recurring sessions once, each as an agent plus a project directory plus an optional first task, and launches them together. The starting set is fixed for the run; adding and removing sessions at runtime is a later phase.
- **Ctrl+S sessions overview.** A full-screen, keyboard-driven list of session cards showing title, provider, working directory, and current state. It surfaces which agents need the developer and offers a single action to jump focus to the next one that does. Navigation matches Kitten's existing overlays: up and down to move, Enter to jump, Esc to dismiss, with a persistent key hint.
- **Attention-aware states.** Each session shows a specific state: working, awaiting approval, finished, or errored. Awaiting-approval, errored, and finished-and-waiting count as needs-you; working and idle do not. The state is what makes the overview a triage surface rather than a plain list.
- **Layered attention nudges.** When a session newly needs the developer while Kitten is not the focused window, Kitten signals on three levels: the always-visible status strip, a terminal bell, and a native desktop notification naming the session and its directory. The notification channel is chosen by operating-system detection, with the bell as the fallback where no native channel exists. Nudges fire on the transition into a needs-you state, never repeatedly, and carry no prompt content.
- **Session-addressed hand-off.** The existing curated, redacted hand-off is retargeted from "the other agent" to an explicitly named target session. The curation, the keep-or-drop of files and diffs, and the redacted preview stay exactly as they are today; only the choice of who receives the bundle changes.
- **Safe multi-session approvals.** Every approval prompt and every status row is labeled with its session title and working directory, and there is no cross-session auto-approve, so a permission decision can never land in the wrong repository.
- **Two-pane view as a fleet view.** Today's focused side-by-side layout becomes the two-session case of the fleet, so existing single-task, two-agent work is unchanged.

## User Experience

The developer sets up a fleet once by declaring the sessions they return to, each pointing at a project directory with an optional starting task.
On launch, Kitten runs the same readiness check it does today, now per session: it reports any session that cannot start with a specific, actionable reason rather than dropping the developer into a cockpit where something silently does not respond, and it holds to the existing under-sixty-seconds time-to-first-response budget.
A session whose agent fails to come up is shown as not ready with its reason, and the rest of the fleet stays usable.

In normal use the developer works inside one focused session, sending prompts, watching the transcript stream, and answering approvals, exactly as in Kitten today.
The persistent status strip now shows the whole fleet at a glance, each session as a chip reading its name and state, with the focused session marked.
When an agent elsewhere in the fleet needs attention, the strip reflects it, the terminal bell rings, and a desktop notification appears if Kitten is not focused.

Pressing Ctrl+S opens the sessions overview: a card per session with title, provider, directory, and state, the needs-you sessions called out.
The developer moves with the arrow keys, presses Enter to jump straight into a session, or takes the single jump-to-next-needy action to land on the most urgent one, and Esc returns them to where they were.
Approvals carry their session and directory in the prompt, so acting across several repositories never becomes a guess about which one is asking.
Handing off works as before, with one added step: the developer picks which session receives the bundle before the redacted preview.
Ctrl+S joins the F1 help panel and the status-strip hint alongside the existing bindings, so the new capability is discoverable without documentation.

## High-Level Technical Constraints

- Providers are ACP agents only in V1 (Claude Code, Codex, and other ACP adapters); non-ACP tools are out of scope.
- Kitten is a keyboard-first terminal UI and must run across macOS, Linux, and Windows terminals; the OS-level notification must degrade gracefully where a native channel is unavailable.
- Each session's working directory is expected to be a project directory (a git repository), consistent with today's requirement that Kitten runs inside a repository.
- Telemetry stays local-first, opt-in, and content-free; attention measurements must not capture prompt or transcript content.
- Kitten runs against the developer's own agent subscriptions and keys and adds no server-side component.

## Non-Goals (Out of Scope)

- Adding or removing sessions at runtime (spawn and kill); the fleet is fixed at launch for V1.
- Session grouping, and any ranked triage queue beyond a single needs-you signal.
- A live transcript preview on the overview cards; cards show metadata and state, not streaming content.
- Durable or cross-restart session persistence; sessions live within a run.
- Non-ACP providers and a provider-switch UI.
- User-configurable notification rules, notification history, and Do-Not-Disturb scheduling.
- A shared cross-agent memory or a conductor that runs several agents on one task; that is the later stretch this V1 is built to reach.
- Removing the two-pane view; it is generalized into the fleet, not deleted.

## Phased Rollout Plan

### MVP (Phase 1)

- The full attention cockpit: the multi-session fleet with per-session directories, pre-declared startup, the Ctrl+S overview with states and jump-to-next, layered attention nudges with OS-level notification, session-addressed hand-off, safe multi-session approvals, and the two-pane view as the two-session case.
- Success criteria to proceed: with a cohort of about ten multi-agent developers, attention latency and idle-fleet time move in the right direction, the hand-off is still used at fleet scale, and no wrong-repository approval incidents are reported.

### Phase 2

- Runtime session lifecycle: add and remove sessions without restarting, informed by where the seeded fleet felt constraining.
- Richer triage (ordering by urgency), more ACP providers surfaced, and session persistence across restarts.
- Success criteria to proceed: sustained multi-session adoption and demand signals for on-the-fly fleet management.

### Phase 3

- The shared cross-agent memory and the conductor: sessions that lend each other curated context, and running several agents on one task, built on the V1 substrate.
- Long-term success: Kitten owns the cross-agent context layer competitors leave siloed.

## Success Metrics

- Multi-session adoption: at least 40 percent of active runs open three or more concurrent sessions (opt-in telemetry: max concurrent sessions per run).
- Attention latency: median time a session spends in a needs-you state before the developer acts is under 30 seconds (opt-in telemetry: transition-to-action delta).
- Idle-fleet avoidance: less than 15 percent of session-minutes are spent blocked and unattended (opt-in telemetry: waiting time on unfocused sessions).
- Overview reliance: at least 60 percent of focus switches go through the Ctrl+S overview rather than blind cycling (opt-in telemetry: switch-via-overview share).
- Hand-off survives scale: the hand-off is invoked in more than 25 percent of runs that touch two or more live sessions (opt-in telemetry: hand-off events over multi-session runs).

## Risks and Mitigations

- The "agents sit idle" pain is assumed, not yet observed. Mitigation: instrument attention latency from day one and gate any runtime fleet-management work on the small-cohort validation.
- The overview screen is not novel; Toad and Warp already ship fleet views. Mitigation: compete on what they miss, a cross-project fleet, the curated cross-provider hand-off, and a permissive license, and keep the overview deliberately thin rather than racing on breadth.
- Juggling several agents across repositories invites wrong-repository actions. Mitigation: label every approval and status row with its session and directory, and allow no cross-session auto-approve.
- Notifications can become noise and erode trust. Mitigation: fire only on the transition into a needs-you state, deduplicated per session, with no repeat nagging.
- The market is consolidating and fast-moving. Mitigation: ship one coherent, differentiated slice quickly and validate, rather than chasing feature parity.
- Attention notifications depend on per-platform behavior outside Kitten's control. Mitigation: detect the OS, use the native channel when present, and always keep the terminal bell as a universal fallback.

## Architecture Decision Records

- [ADR-001: N-Session Model as Infrastructure Beneath the Hand-off Wedge, Not a Ctrl+S Headline](adrs/adr-001.md) - the session model is infrastructure under the hand-off differentiator, and the overview is deliberately thin.
- [ADR-002: Ship the Full Attention Cockpit as a Single V1](adrs/adr-002.md) - the whole slice ships in one coherent release so the hand-off never regresses, with validation after.
- [ADR-003: Native OS-Level Attention Notifications in V1](adrs/adr-003.md) - attention nudges layer the status strip, a terminal bell, and a native desktop notification chosen by OS detection.

## Open Questions

- When more than one session needs the developer at once, what should the single jump-to-next action prioritize: an approval-blocked session, an errored one, or the one waiting longest?
- How reliably can a crashed or exited session be distinguished from a cleanly finished one, and how should each read on its card?
- How should each session be titled in the overview: a name the developer gives it, or one derived from its directory or task?
- Does the current "must be inside a git repository" gate apply to every session, and how should a session pointed at a non-repository directory behave?
- What is the privacy model for measuring attention latency without capturing any prompt or transcript content?
- Which native notification channels are reliable enough per platform to depend on, and where must Kitten fall back to the bell?
