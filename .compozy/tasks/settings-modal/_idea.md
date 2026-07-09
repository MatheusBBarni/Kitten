# Settings Modal

## Overview

Kitten lets a developer run Claude Code and Codex in one terminal and hand a live task between them with a keystroke.
How it looks and behaves is currently fixed at build time or buried in a JSON file: the theme copies whatever the terminal reports, the keybindings are hard-coded, and changing an agent's launch command means opening `~/.config/kitten/config.json` in an editor.

This feature adds an in-app settings modal so a developer can customize Kitten without leaving the cockpit.
The value the product owner is after is customization the tool cannot do today, choosing a theme and remapping keys, rather than a nicer wrapper around config that already exists.

V1 is deliberately narrow.
It ships one shared foundation (config that can be written back to disk, read reactively, and hot-reloaded) and one visible category on top of it: theme, presented in the modal shell with a live preview that repaints the real dual-agent view as you move through the options.
Keymap remapping, the category most aligned with what makes Kitten distinctive, is the committed next slice on the same foundation.
It is a Quick Win in sequencing, not a promise that the whole four-category wishlist ships at once.

Target user: the terminal-native developer who already runs both agents daily, has opinions about their theme and their keys, and today has to hand-edit JSON or accept the defaults.

## Problem

A developer using Kitten has no way to make it theirs from inside the app.
The theme is whatever the terminal's dark/light mode resolves to; there is no picker and no way to pin a preference.
The global keys (hand-off on `Ctrl+T`, switch-focus on `Ctrl+O`) are constants in the source, so a user whose multiplexer already claims one of those chords has no recourse.
Any other change means quitting to an editor, finding an undocumented JSON path, and editing a file whose schema they have to already know.
For a tool whose pitch is a fast keyboard-driven workflow, the customization stops at the edges of what the author chose.

The friction has two costs.
For an existing user, it blocks the small acts of ownership that make a tool feel like home: the theme that matches the rest of their setup, the key that does not fight their terminal.
For someone evaluating Kitten for the first time, a JSON-only configuration story reads as unfinished and raises the odds they close it before it sticks.

Editing the config file is insufficient for the audience Kitten wants to win.
It offers no discoverability (you cannot browse theme names or see which actions are rebindable), no validation at the moment of change (a bad keybinding surfaces as broken input at runtime, not as an error when you set it), and no live feedback (you cannot see a theme before committing to it).
It also cannot express capabilities that are absent from the config schema, which is exactly where the requested value, themes and remappable keys, lives.

### Market Data

Among terminal-based AI coding tools, an in-app settings surface is still rare.
Only Google's gemini-cli (a searchable `/settings` dialog) and Batrachian's toad ("no need to edit JSON") ship one; aider and Charm's Crush are config-file-first, and OpenCode offers an in-app theme picker but leaves keybindings file-only.
The GUI tier developers compare against, Warp, Zed, and Cursor, all treat theming and a visual keymap editor as standard, which sets the bar a TUI is measured against.

Demand for customization is well documented.
In JetBrains' Developer Ecosystem survey of roughly 7,000 developers, 83% preferred a dark editor theme and 89% customized their IDE in some way.
A single community theme shows how far the behavior travels: Catppuccin has around 19,400 GitHub stars and more than 200 ports across editors, terminals, and CLI tools, and the most popular VS Code themes exceed 10 million installs each.
Developers override their environment's defaults across every tool they use, and today Kitten gives them nothing to override with.

## Core Features

| #   | Feature                                       | Priority | Description                                                                                                                                                                                          |
| --- | --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Reactive config foundation                    | Critical | Move the mutable config into the store so views re-read it, add atomic delta-only write-back to `config.json`, and hot-reload the file on change so modal-edits and hand-edits share one source of truth. |
| F2  | Settings modal shell                          | Critical | A store-backed overlay reusing the approval/hand-off pattern: opened by a global key, keyboard-captured, tabbed by category, with reset-to-default and a which-key hint footer.                       |
| F3  | Theme selection with live preview             | Critical | Choose `auto`, `light`, or `dark`, consulted by the palette ahead of the terminal-reported mode, with the real cockpit repainting as the user moves through options. Persisted and applied live.     |
| F4  | Live-vs-restart labeling                      | High     | Every setting shows whether it applies immediately or needs a restart, so the modal never implies a change is live when it is not.                                                                    |
| F5  | Keymap remapping (committed V1.1 fast-follow) | High     | Rebind the cockpit keys, led by the hand-off and switch-focus chords, with capture-a-key and terminal-aware conflict validation. Built on F1, sequenced immediately after the first ship.            |

## KPIs

| KPI                             | Target                                                      | How to Measure                                                            |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Settings modal reach            | > 60% of active users open it within their first 3 sessions | Content-free counter `settings_opened` in the existing telemetry recorder |
| Edits via modal vs hand-edit    | > 80% of config mutations go through the modal              | Counter split `config_write{source=modal\|file}`                          |
| Explicit theme adoption         | > 30% of users set a non-auto theme                        | Counter `theme_set{mode}`                                                  |
| Config-write safety             | 0 broken-config errors caused by a modal write             | Counter `config_write_error{source=modal}` (writes round-trip through zod) |
| Time-to-first-persisted-change  | < 45s median from open to saved change                     | Timestamp delta `settings_opened` -> `config_write`                       |
| Keymap customization (V1.1)     | > 15% of users remap at least one binding                  | Counter `keymap_override_count`                                           |

## Feature Assessment

| Criteria            | Question                                            | Score                                                                        |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Impact**          | How much more valuable does this make the product?  | Strong                                                                        |
| **Reach**           | What % of users would this affect?                  | Strong                                                                        |
| **Frequency**       | How often would users encounter this value?         | Strong (the theme is felt every session)                                     |
| **Differentiation** | Does this set us apart or just match competitors?   | Maybe for theme alone; Strong once keymap and live preview land              |
| **Defensibility**   | Is this easy to copy or does it compound over time? | Maybe (the reactive-config foundation compounds; the screen itself is copyable) |
| **Feasibility**     | Can we actually build this?                         | Strong (the overlay pattern exists; the foundation is bounded and additive)  |

Leverage type: Quick Win for the first ship, building a Compounding foundation that every later setting reuses.

## Council Insights

- **Recommended approach:** Build the reactive-config foundation (store slice + atomic delta write-back + hot-reload) as the real deliverable, ship the settings modal shell with theme and live preview as V1, and commit keymap remapping as the immediate fast-follow. Defer launch-command, telemetry, and model-provider.
- **Key trade-offs:** Theme alone is table-stakes parity, so the first public increment is not itself a differentiator; the payoff is proving the foundation cheaply and planting the frame keymap slots into. Building the foundation properly costs more up front than a naive theme picker.
- **Risks identified:** config-write corruption (mitigated by temp-file + atomic rename, delta-only serialization, and zod-validation before commit); split-brain between modal and hand-edits (mitigated by a single write/read path via hot-reload); over-promising "live" (mitigated by live-vs-restart labels and deferring the non-live categories); keymap footguns in V1.1 (mitigated by terminal-aware conflict validation).
- **Stretch goal (V2+):** Portable Kitten profiles - theme plus keymap saved as a named, shareable/importable artifact, riding the "carry my setup everywhere" behavior. Compounding and hard to copy, dependent on the foundation and both categories existing first.

## Out of Scope (V1)

- **Agent launch-command editing** - surfaces existing config rather than new customization, cannot apply live (relaunching an agent discards the running session), and carries the highest blast radius (a bad command bricks the agent). The config file still covers it.
- **Telemetry toggle in the modal** - a privacy-relevant boolean that also only re-skins existing config; cheap to add once the shell exists, and outside the new-customization focus.
- **Model-provider selection in the modal** - the selector it would host is not built, so a link would be a dead door; omitted until `model-provider-selector` ships.
- **Named or custom theme presets beyond auto/light/dark** - a palette registry is more than the first ship needs to prove the override path.
- **Portable/shareable profiles** - the V2+ compounding direction, dependent on the foundation plus both theme and keymap existing.

## Architecture Decision Records

- [ADR-001: Settings modal V1 scope - theme-first on a reactive-config foundation](adrs/adr-001.md) - Ship a shared reactive-config, write-back, and hot-reload foundation with theme in the modal shell as V1; keymap as the committed fast-follow; defer launch-command, telemetry, and model-provider.

## Summary / Differentiator

The differentiator is customization organized around the hand-off, rather than a settings screen for its own sake.
A live preview that repaints the actual dual-agent cockpit, and next the rebindable hand-off keys with conflict-aware capture, are things a file-first competitor cannot stage and a single-agent competitor has no reason to build.
The reactive-config foundation underneath is the compounding asset every later setting reuses.

## Integration with Existing Features

| Integration Point                        | How                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay system (`ApprovalPrompt`, `HandoffPreview`) | The settings modal is another store-backed overlay slot on the same rail, joined into `selectHasOpenOverlay` so the shell stands down and the composer releases focus. |
| Config loader (`configLoader.ts`)        | Write-back inverts `mergeAppConfig` to emit deltas; hot-reload re-runs `loadAppConfig` on file change.                                                 |
| Theme system (`theme.ts`)                | `usePalette` consults the persisted preference ahead of the terminal-reported mode; the live re-render comes free from the existing hook.              |
| Keymap table (`keymap.ts`)               | A new `open-settings` binding joins `COCKPIT_KEYMAP`, which also drives help and hints; V1.1 remapping makes that table runtime-built.                 |
| `model-provider-selector` task           | The modal will link to that selector once it exists; omitted from V1 as a dead link today.                                                             |

## Open Questions

- **Theme scope:** is `auto/light/dark` enough for V1, or should the first ship include at least one named preset (a Catppuccin-flavored palette) to signal the ecosystem angle?
- **Hot-reload conflict policy:** when a hand-edit and a modal-edit race, is last-write-wins acceptable, or should the modal detect an external change and reconcile?
- **Theme demand signal:** the dissenting council view holds theme may be closer to a demo than a measured need. What counter or early signal settles it before investing further?
- **Keymap capture on non-Kitty terminals (V1.1):** how do we present bindings the host terminal cannot deliver (`Shift+Enter`, several `Ctrl` chords)? Detect protocol support and disable them, or warn on capture?
- **Open-settings chord:** which global key opens the modal, and does it collide with anything a user is likely to already have bound?
