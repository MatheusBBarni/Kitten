# Kitten

Kitten is a terminal cockpit for passing a live coding task from one AI agent to another without losing context.

It runs **Claude Code** and **Codex** together in one terminal using the [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk).  
If one agent stalls, you can hand its active task to the other with one action.

## Try Kitten

From inside a git repository, run:

```bash
npx kitten
```

The first run downloads the prebuilt standalone binary for your platform, so it can take longer than a typical JavaScript CLI. Bun is not required.

For daily use, install Kitten globally:

```bash
npm i -g kitten
kitten
```

A successful install is version-stamped: `npx kitten --version` or `kitten --version` prints the exact installed package version. `kitten --self-check` ends with `SELF-CHECK OK` when the headless startup path is healthy.

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

- Node.js with npm
- Claude Code and Codex installed and authenticated
- A git repository to launch Kitten from

Kitten only launches the published ACP adapters. It does not handle agent binaries or authentication secrets.

## Develop from source

Source development requires [Bun](https://bun.sh) 1.3.5 or newer.

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

### MCP servers

Declare shared MCP servers in the top-level `mcpServers` object. It is a name-keyed map: each key is the server name shown in Kitten's readouts, and each value is a stdio launch recipe with these fields:

- `command` — the executable Kitten launches.
- `args` — the command-line arguments, in order.
- `env` — environment variables passed to the server. Values can reference launch-time variables with `${VAR}`.

The following strict JSON is ready to copy into `config.json`. The `github` key names the server, `npx` launches it over stdio, `args` identifies the package, and `env` reads the token from the environment instead of storing the secret in this file.

<!-- mcp-config-example:start -->
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```
<!-- mcp-config-example:end -->

Set every referenced variable in the environment before starting Kitten. For the example above:

```bash
export GITHUB_TOKEN="your-token"
bun start
```

V1 supports stdio servers only. Remote HTTP/SSE entries such as this one are rejected when the config loads:

<!-- mcp-remote-example:start -->
```json
{
  "mcpServers": {
    "github-remote": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/"
    }
  }
}
```
<!-- mcp-remote-example:end -->

An unresolved `${VAR}` does not block startup: Kitten skips that server and shows a warning. Declared MCP servers are active in sessions launched by Kitten; writing them into Claude Code or Codex configuration for standalone use is deferred beyond V1.

Run `bun run selfcheck` to see the loaded/skipped MCP readout without opening the cockpit. In the cockpit, the same per-session result appears in the status strip.

## Development commands

```bash
bun test              # run the test suite
bun run typecheck     # TypeScript no-emit check
bun run test:coverage # run coverage checks
bun run build         # build release binaries
bun run build:local   # quick local binary build
```

## Contributing

Pull request titles must follow Conventional Commits, for example `feat: add session search` or `fix!: remove a legacy option`.
The repository uses squash merge, with **Default to PR title for squash merge commits** enabled in GitHub, so the linted PR title becomes the commit that release-please reads from `main`.

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
