# Settings Modal - PRD

## Overview

Kitten runs Claude Code and Codex in one terminal and hands a live task between them with a keystroke.
Today a user cannot shape how it looks or behaves from inside the app: the theme copies whatever the terminal reports, the keys are hard-coded, and any change means quitting to an editor and hand-editing `~/.config/kitten/config.json`.

This PRD covers an in-app settings modal that lets a developer customize Kitten without leaving the cockpit.
It is for the terminal-native developer who already runs both agents daily and has opinions about their theme and their keys.
The value is ownership: the small acts of making a tool yours, which today are either impossible (there is no theme picker) or gated behind editing an undocumented JSON file.

V1 delivers one category, theme, through an instant-apply, live-preview, tabbed modal, built on a reactive-config foundation (config that is written back to disk, read live, and kept in sync with hand-edits).
Keymap remapping is the committed Phase 2 fast-follow on that same foundation.

## Goals

- Let the daily power user set and keep a theme from inside the app, with no JSON editing.
- Prove the reactive-config foundation (write-back plus hot-reload) end to end on the cheapest payload, so later categories are cheap to add.
- Establish the settings frame that keymap and future categories slot into.
- Decide whether to proceed to Phase 2 on a real signal, sustained theme override, rather than a one-time open.
- Milestones: Phase 1 ships theme; Phase 2 ships keymap once the gating metric is met.

## User Stories

Primary persona, the daily power user:

- As a daily Kitten user, I want to pick a theme from inside the app so my cockpit matches the rest of my setup without editing JSON.
- As a daily user whose terminal background differs from Kitten's auto guess, I want to pin light or dark so the cockpit stays legible.
- As a daily user, I want a recognizable named theme (for example a Catppuccin palette) so Kitten looks like the other tools I use.
- As a daily user, I want to see a theme on the real cockpit before I commit so I know how it actually reads.
- As a daily user, I want to reset a setting to its default so an experiment is one keystroke to undo.
- (Phase 2) As a daily user whose multiplexer already claims `Ctrl+T`, I want to rebind the hand-off key so Kitten stops fighting my setup.

Secondary persona, the first-run evaluator:

- As someone trying Kitten, I want to discover that settings exist from within the app so the tool feels finished rather than JSON-only.

## Core Features

| #  | Feature                           | Priority | What it does and why                                                                                                                                                                                          |
| -- | --------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 | Reactive config foundation        | Critical | Config is read live, written back to disk safely, and kept in sync when the file changes on disk, so a change made in the modal and a hand-edit never disagree. This is the enabler every setting reuses.     |
| F2 | Settings modal shell              | Critical | A modal opened by a global key, navigated with arrows, organized into category tabs (Theme now, Keys later), with a persistent hint footer. Gives settings a discoverable in-app home.                        |
| F3 | Theme selection with live preview | Critical | Choose `auto`, `light`, `dark`, or one of 1-2 named presets. Moving the selection repaints the real cockpit immediately and persists the choice. Turns theming from "whatever the terminal says" into a deliberate, visible choice. |
| F4 | Reset to default                  | High     | Any setting can be returned to its default in one keystroke, so exploring is safe and reversible.                                                                                                            |
| F5 | Live-vs-restart labeling          | High     | Each setting states whether it applies now or needs a restart, so the modal never implies a change is live when it is not.                                                                                    |
| F6 | Keymap remapping                  | Phase 2  | Rebind the cockpit keys, led by the hand-off and switch-focus chords, with capture-a-key and conflict-aware validation. Committed as the immediate next phase on the F1 foundation.                           |

Feature interaction: F3-F6 all read and write through F1; F5 governs how every category presents its apply behavior; F2 hosts them all.

## User Experience

Primary flow, the daily power user changing a theme:

1. A hint in the status strip and an entry in the help panel tell the user a settings key exists.
2. The user presses the settings key. The modal opens, captures the keyboard, and the composer steps aside, matching how the approval and hand-off overlays already behave.
3. The Theme tab is selected. The user arrows through `auto`, `light`, `dark`, and the named preset(s). The real cockpit behind the modal repaints on each move, so the choice is judged on the actual UI, not a swatch.
4. The selected theme persists immediately. There is no separate save step.
5. If the user wants to undo an experiment, reset-to-default returns the setting in one keystroke.
6. Esc closes the modal. The last applied theme stays in effect and survives the next launch.

Discoverability and onboarding: the modal is reachable by a single documented chord, surfaced in the always-visible status strip hint and the F1 help panel, consistent with how existing keys are taught.

Accessibility and quality: navigation is keyboard-only; every mode and preset stays legible across light and dark terminal backgrounds; state is never signaled by color alone (a selection marker carries it), matching the tool's existing no-hard-coded-color rule.

## High-Level Technical Constraints

- Integrates with the existing config file at `~/.config/kitten/config.json`; modal-edits and hand-edits must resolve to one consistent source of truth.
- A config write must never corrupt or truncate an existing, possibly hand-edited file, and must never leave Kitten unable to start.
- A theme change must take effect within the same session with no perceptible lag.
- Every mode and preset must remain legible across the range of terminal backgrounds.
- Any setting presented as live must genuinely apply live; anything that cannot must be labeled as needing a restart.
- Privacy: the modal sends no data off the machine and adds no telemetry beyond the existing opt-in, content-free counters.

## Non-Goals (Out of Scope)

- Agent launch-command editing: deferred; the config file still covers it, it cannot apply live, and it has the highest blast radius.
- Telemetry toggle inside the modal: deferred; a privacy-relevant boolean that only re-skins existing config.
- Model-provider selection or link-out: the selector it would point at is not built, so a link would be a dead door.
- Fully user-defined custom palettes: beyond the 1-2 curated presets in V1.
- Keymap remapping in the first ship: it is the committed Phase 2, not part of the MVP.
- Portable or shareable settings profiles: a V2-plus direction.

## Phased Rollout Plan

### MVP (Phase 1)

- F1 reactive config foundation, F2 modal shell, F3 theme with `auto/light/dark` plus 1-2 named presets and live preview, F4 reset-to-default, F5 live-vs-restart labeling.
- Success criteria to proceed to Phase 2: the sustained-theme-override target is met and zero broken-config errors are caused by a modal write.

### Phase 2

- F6 keymap remapping, starting with the hand-off and switch-focus chords, with capture-a-key and terminal-aware conflict validation, all on the Phase 1 foundation.
- Success criteria to proceed to Phase 3: a meaningful share of users remap at least one binding, with no rise in reports of broken input.

### Phase 3

- Expanded theme catalog and custom palettes, and portable profiles that save and share a theme-plus-keymap set.
- Long-term success: customization becomes a reason users stay and recommend the tool.

## Success Metrics

- Primary and gating: sustained theme override, the share of daily users who set a non-auto theme and still have it set a week later. Target > 25%.
- Config changes made through the modal rather than by hand-editing the file: target > 80% (among users who change config).
- Config-write safety: 0 broken-config errors attributable to a modal write.
- Modal reach (secondary): > 60% of active users open it within their first 3 sessions.
- Time to first persisted change: median < 45s from opening the modal.
- Phase 2: > 15% of users remap at least one binding.

## Risks and Mitigations

- Adoption risk, theme is a demo rather than a need (the council's dissent): gate Phase 2 on sustained override, not on opens, so a weak signal stops the investment early.
- Accidental-change risk from instant apply: reset-to-default plus the change being trivially reversible keeps the cost near zero.
- Scope-creep risk from pulling presets into V1: cap at 1-2 curated presets; custom palettes stay out.
- Competitive risk, peers add in-app settings: differentiate on the live cockpit preview and, in Phase 2, hand-off-centric key rebinding, which single-agent tools have no reason to build.
- Dependency risk on the unbuilt model-provider selector: omit the link entirely rather than ship a dead door.
- Discoverability risk, power users overlook the modal: surface it in the status strip hint and the help panel.

## Architecture Decision Records

- [ADR-001: Settings modal V1 scope - theme-first on a reactive-config foundation](adrs/adr-001.md) - Build the reactive-config foundation first; ship theme in the modal shell as V1; keymap as the committed fast-follow.
- [ADR-002: Instant-apply, live-preview interaction model](adrs/adr-002.md) - Arrowing a theme repaints the cockpit live and persists immediately, no save step; tabbed shell; reset-to-default.
- [ADR-003: Include 1-2 named theme presets in V1](adrs/adr-003.md) - Ship `auto/light/dark` plus 1-2 curated presets, adding a small palette registry; custom palettes stay out.

## Open Questions

- Which specific preset(s) ship in V1 (a Catppuccin variant, or something else)?
- Which global chord opens the modal, and does it collide with anything a user is likely to already have bound?
- When a hand-edit and a modal-edit race, is last-write-wins acceptable, or should the modal detect the external change and reconcile?
- What baseline sets the exact sustained-override target, and over what window beyond the initial week?
- (Phase 2) How are bindings the host terminal cannot deliver presented during capture, detected and disabled or warned on?
