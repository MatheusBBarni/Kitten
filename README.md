# Kitten

Kitten is a terminal cockpit for passing a live coding task from one AI agent to another without losing context.

It runs **Claude Code** and **Codex** together in one terminal using the [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk).  
If one agent stalls, you can hand its active task to the other with one action.

## Why this project exists

Context handoff between AI agents is usually manual: copy transcripts, pull file lists, guess what matters, and hope nothing gets lost.  
Kitten does the heavy lifting by bundling only the useful slices and giving you a chance to review them first.

## What gets bundled

- recent chat excerpts
- files that were touched
- pending diffs

Both agent sessions stay live. Once a handoff is sent, the receiving agent continues from the same moment, not from scratch.

## How handoff works

Press `Ctrl+T`.

Kitten builds a bounded handoff bundle for the focused agent and opens it in a preview overlay before sending.

In the preview you can:

- move through files and diffs with the arrow keys
- remove items with `Space`
- edit the summary with `e`
- send with `Enter` (sends to the other agent and switches focus)
- cancel with `Esc` (sends nothing)

The destination is always the unfocused agent, so handoff and handback are the same path in reverse.

Secrets are redacted during bundle creation. The preview gives you a second chance to double-check before anything leaves your current session.

## Keybindings

| Key | Command | Action |
| --- | --- | --- |
| `Ctrl+O` | `/switch` | Focus the other agent |
| `Ctrl+T` | `/handoff` | Start a handoff |
| <code>Ctrl+&grave;</code> / <code>F2</code> | `/shell` | Focus the integrated shell |
| `Enter` | (no command) | Send the prompt to the focused agent |
| `Shift+Enter` | (no command) | Insert a newline in prompt input |
| `Esc` | (no command) | Interrupt the focused agent |
| `F1` | `/help` | Toggle help panel |

## Slash commands

In the prompt, type `/` to open the command menu and run Kitten actions directly.  
You can also type the command directly and press `Enter`.

- `/help` — Show all available Kitten commands.
- `/shell` — Focus the integrated shell.
- `/copy` — Copy the latest shell command for an external terminal.
- `/switch` — Switch focus to the other agent.
- `/handoff` — Build and send a handoff summary to the other agent.
- `/sessions` — Show all sessions and jump to one that needs you.
- `/resume` — Find and resume a saved run for this project.
- `/new` — Start a new run with fresh agent sessions.
- `/clear` — Clear this run and restart with fresh sessions.
- `/model` — Choose an agent model and reasoning effort.
- `/settings` — Open Kitten settings.

When an agent asks for approval, use:

- arrow keys to choose
- `Enter` to confirm
- `Esc` to dismiss

## Requirements

- [Bun](https://bun.sh) 1.3.5 or newer
- Claude Code and Codex installed and authenticated

Kitten only launches the published ACP adapters. It does not handle agent binaries or authentication secrets.

## Getting started

```bash
bun install
bun start
```

On first launch, Kitten checks each configured agent and reports readiness. If one adapter cannot start, the other stays usable.

Check setup without opening the cockpit:

```bash
bun run selfcheck
```

This runs the startup path checks without opening interactive prompt sessions.

Verify session reload behavior:

```bash
bun run selfcheck:reload
```

For each configured session, Kitten:

- starts a short probe session
- restarts using the same session ID
- verifies that history reloads correctly

and exits non-zero on any failure.

## Configuration

Config is optional.

With no config file, Kitten uses default settings and pinned adapter versions.

To override:

- `~/.config/kitten/config.json`
- `KITTEN_CONFIG` (path to a custom config file)

Overrides are merged per provider/session and by field, so you can change one setting without touching the rest.

Malformed config files fail fast. There is no silent fallback.

Telemetry is disabled by default. When enabled, it writes local content-free JSONL counters only.

## Development commands

```bash
bun test              # run the test suite
bun run typecheck     # TypeScript no-emit check
bun run test:coverage # run coverage checks
bun run build         # build release binaries
bun run build:local   # quick local binary build
```

## Project structure

- `src/agent` — ACP adapter boundary
- `src/core` — pure domain model and reducer
- `src/store` — app state
- `src/app` — controller and orchestration
- `src/ui` — terminal interface
- `src/config` — config loading, validation, boot flow
- `scripts` — build helpers and tooling

## Tech stack

Bun, TypeScript, OpenTUI, React on the terminal renderer, and the ACP TypeScript SDK.
