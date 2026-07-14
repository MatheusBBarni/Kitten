# PRD: Slash-Command Menu (`/`)

## Overview

Kitten's capabilities are reachable today only through control and function-key chords, and the focused agent's own slash commands are received over the Agent Client Protocol and discarded before they reach the user.
The result is a cockpit whose best features - above all the one-keystroke hand-off - stay invisible to anyone who has not memorized a keymap, and a cockpit that offers a Codex or Claude Code user fewer commands than that agent's own CLI does.

This feature adds a `/` command menu to the prompt editor: a searchable, keyboard-driven list that unifies Kitten's own cockpit actions with the focused agent's advertised commands, grouped by source.
It is aimed at discoverability.
Every cockpit row prints its keyboard shortcut, so the menu teaches the faster chords rather than replacing them, and a permanent footer hint makes the marquee Ctrl+T hand-off visible from the first session.
It is for every Kitten user, and it matters most to the returning user who forgot the chords and the first-time evaluator who would otherwise never find the hand-off.

## Goals

- Make every cockpit capability, including the hand-off, discoverable by typing `/` - no keymap memorization, no README.
- Turn the focused agent's advertised commands from unreachable into first-class, reachable options inside Kitten.
- Make the hand-off - the product's reason to exist - visible from a user's first session.
- Teach the faster keyboard chords in context so the menu graduates users onto them instead of becoming a permanent crutch.
- Ship a discoverability surface that reads as a two-agent cockpit, not a me-too command list, at launch.

Target milestone: a single bundled V1 release (see Phased Rollout Plan).

## User Stories

Primary personas: the **returning solo developer** (forgot the chords), the **first-time evaluator** (needs the hand-off to be obvious), and the **power user** (wants the agent's own commands).

- As a returning developer, I want to type `/` and see every action available so that I never have to remember a chord or reopen the README.
- As a first-time evaluator, I want the hand-off to be visible from my first session, through the footer and a `/handoff` entry, so that I experience the product's core value without onboarding.
- As a power user, I want the focused agent's own slash commands to appear in the menu so that I have at least the capability inside Kitten that I would have in the agent's native CLI.
- As any user, I want the menu to filter as I type and never trigger inside a file path, URL, or code so that typing stays predictable on the surface I use most.
- As any user, I want each cockpit action to show its keyboard shortcut so that I gradually learn the faster chord.
- As a user whose second agent is still starting up, I want that agent's commands shown but disabled with a reason so that I understand why they are unavailable rather than assuming they do not exist.

## Core Features

**Unified command menu (Critical).**
A searchable dropdown in the prompt editor, grouped by source (Cockpit first, then the focused agent).
On open it shows the full grouped list; typing narrows it.
Up/Down move, Enter invokes, Esc dismisses.

**Focused agent's command surface (Critical).**
The focused agent's own advertised commands appear in the menu and stay current as the agent adds, removes, or changes them mid-session.
When the agent supplies an argument hint for a command, the menu shows it.

**Safe trigger and invoke-not-send (Critical).**
The menu opens only when `/` begins a token (start of the prompt or after whitespace) and closes when nothing matches or the caret leaves the token, so it never hijacks a file path or URL.
Choosing a cockpit action runs it locally; choosing the hand-off still opens its preview.
Choosing an agent command inserts its text into the prompt for the user to complete and send.
Nothing is ever sent to an agent without an explicit send.

**Teaching affordances (High).**
Cockpit actions rank first so the hand-off is never buried, each cockpit row prints its keyboard shortcut, and agent commands show their argument hint inline.

**Hand-off footer hint (High).**
A permanent one-line hint in the status strip surfaces the Ctrl+T hand-off and the `/` menu, so both are visible from session one without opening anything.

**Resilient states (Medium).**
A not-ready agent's commands are shown but disabled with a reason, and a no-match result presents a clear, non-broken state that lets Enter fall through to a normal prompt submit.

## User Experience

A new user lands in the cockpit and immediately sees the footer teaching Ctrl+T and `/`.
They type `/` and the menu opens showing everything available, Cockpit actions at the top with their shortcuts printed beside them, the focused agent's commands grouped below.
They keep typing to filter, arrow to a row, and press Enter.
A cockpit action runs at once (the hand-off opens its preview); an agent command drops into the prompt with its argument hint shown, ready to complete and send.
Over repeated sessions the printed shortcuts pull the user onto the chords, and the menu recedes into a fallback they reach for less often.

The experience is keyboard-only by design (this is a terminal UI, no mouse).
Discoverability rests on three always-present signals: the footer, the `/` trigger itself, and a line in the F1 help panel noting the menu exists.
Typing must stay instant and must never disturb the transcript.

## High-Level Technical Constraints

These are product boundaries, not implementation choices.

- The agent's commands are exactly what the agent advertises over the protocol; Kitten invents no commands of its own and shows only the focused agent's list in V1.
- Hand-off safety is absolute: no menu selection may send anything to an agent without the explicit send, a selection that triggers the hand-off still opens the mandatory preview, and hand-off bundles remain redacted.
- From the user's perspective the menu opens and filters within a single frame; typing never lags and never re-renders the conversation transcript.
- One agent failing or still starting up must never break the menu or the other agent.

## Non-Goals (Out of Scope)

- **Inline hand-off preview inside the dropdown** - deferred to Phase 2; it is a second surface with its own curation and would delay the discoverability win.
- **Cross-agent command routing** (handing off directly into the receiver's `/review`) - Phase 3; it couples two agents' command lifecycles.
- **The non-focused agent's commands in the menu** - V1 shows only the focused agent's; a full two-agent capability view belongs to the later control surface.
- **A second way to open the menu** - V1 is `/` only; no opening chord.
- **Nested or subcommand completion, and fuzzy typo-tolerant scoring** - V1 uses a flat, prefix/substring-filtered list with cockpit-first ordering.
- **Mouse interaction** - keyboard-only.

## Phased Rollout Plan

### MVP (Phase 1) - bundled V1

The unified menu, the focused agent's command surface, the safe trigger and invoke-not-send behavior, the teaching affordances, the footer hint, and the resilient states - shipped together as one release.
Success criteria to proceed: menu-driven action share above 30%, agent-command adoption in at least 25% of sessions, and first-session hand-off rate at or above 50%.

### Phase 2 - hand-off-aware palette

`/handoff` previews inline what will move and to which agent before opening the full preview, and the menu begins ranking a user's most-used commands first.
Success criteria: measured lift in hand-off completion and sustained menu usage without a rise in accidental sends.

### Phase 3 - cockpit control surface

Cross-agent routing (hand off directly into the receiver agent's `/review` or `/test`), the non-focused agent's commands surfaced for a true two-agent capability view, and relevance refinements (fuzzy scoring, nested completion).
Long-term success: the palette is the primary control surface for driving both agents.

## Success Metrics

- **First-session hand-off rate (north-star):** at least 50% of first sessions perform a hand-off.
- **Menu-driven action share:** more than 30% of cockpit-action invocations flow through the `/` menu within the first month.
- **Agent-command adoption:** at least 25% of sessions invoke one or more agent-advertised commands via the menu (baseline is zero today).
- **Command breadth per session:** median distinct commands invoked reaches at least 4, up from roughly 2 known chords.
- **Responsiveness quality:** menu open and filter render within one frame, with no extra transcript re-renders while typing.

## Risks and Mitigations

- **The `/` menu is itself undiscovered.** A palette you must know to open does not help a user who never types `/`. Mitigation: the always-visible footer plus an F1 help-panel line advertise both the menu and Ctrl+T.
- **It reads as catch-up parity.** Every rival already has a `/` menu. Mitigation: ship the two-agent grouping and the discoverable hand-off at launch so the first impression is the differentiator, not the parity.
- **Menu-share falls as users learn the chords.** This is success, not failure, but it can look like disengagement. Mitigation: treat first-session hand-off rate as the north-star and read menu-share as a diagnostic beneath it.
- **A janky menu erodes trust on the surface users touch most.** Mitigation: the token-begin trigger and no-match dismissal keep normal typing untouched, and the feature ships behind tests with the modal fallback held in reserve.
- **Dependency on agents advertising commands.** An agent that advertises none leaves its group empty. Mitigation: Kitten's own actions always populate the menu, and empty or disabled agent states are shown gracefully.

## Architecture Decision Records

- [ADR-001: `/` command menu - V1 scope, trigger model, and state ownership](adrs/adr-001.md) - non-modal editor-local palette, token-begin trigger guard, command data as reactive state, footer adopted, control surface deferred.
- [ADR-002: Bundle the slash-menu V1 into a single release](adrs/adr-002.md) - ship the command surface, palette, and footer together; the merge risk that argued for staging has cleared.

## Open Questions

- Baseline and precise target for first-session hand-off rate need real opt-in telemetry to calibrate the 50% figure.
- Exact footer copy and its screen-space budget in the status strip.
- How the `/handoff` entry should read now that a hand-off can be re-addressed to a developer-chosen target session (recent commit `fccb2ac`) - label and expected behavior when more than two sessions exist.
- Whether cockpit-first is the only ranking V1 needs, or whether light recency ranking should arrive sooner - revisit with usage data.
- Agent-command insertion details (leading `/`, trailing space, cursor placement for arguments) - to be settled in the TechSpec.
