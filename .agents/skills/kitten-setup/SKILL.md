---
name: kitten-setup
description: First-run setup for the Kitten repo after cloning — install Bun and the two agent CLIs, install deps, verify the boot with the headless self-check, then run the cockpit. Use when setting up Kitten for the first time, when `bun start` won't launch, or when an agent shows as not-ready at boot. Do not use for the inner edit/test loop (see kitten-dev-workflow).
---

# Kitten Setup

Get from a fresh clone to a running cockpit. Kitten runs two AI coding agents side by side in the terminal over the Agent Client Protocol (ACP) and lets you hand a live task between them.

## Prerequisites

1. **Bun >= 1.3** - the only runtime. Install from https://bun.sh, then confirm: `bun --version`.
2. **The two agents, installed and authenticated.** Kitten does **not** own the agent binaries or their auth - it spawns their published ACP adapters (by default via `npx`: `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`, both version-pinned). You need:
   - **Claude Code** installed and logged in.
   - **Codex** installed and logged in.

   If you only have one of them authenticated, Kitten still runs - the other agent shows as not-ready and its pane explains why, while the working agent stays fully usable.

## Steps

Run everything from inside the cloned repo (which is itself a git repository, so the repo gate below is satisfied).

```bash
bun install            # exact-pinned deps; may take a moment on first run
bun run selfcheck      # headless boot check: mounts the real view tree without a terminal
bun start              # launch the cockpit
```

`bun run selfcheck` prints a rendered frame followed by `SELF-CHECK OK` and exits 0 when boot wiring is sound. Use it as the fast "did I break boot" check - it needs no interactive terminal and no live agents.

Key bindings once the cockpit is up: `Ctrl+O` switch focus, `Ctrl+T` hand off the task to the other agent, `Enter` send, `Shift+Enter` newline, `Esc` interrupt, `F1` help.

## Two first-run gates (why boot might refuse)

Boot applies two gates before mounting the cockpit, and each prints the exact reason and exits non-zero rather than dropping you into a dead screen:

1. **Repo gate** - Kitten refuses to run outside a git repository (it treats the current directory as the project). Fix: `cd` into a repo. This is checked first and costs nothing, so no agent is even spawned outside a repo.
2. **Readiness gate** - after the agents come up, boot stops if **none** completed its ACP handshake. The message names each agent's specific gap (missing binary, "not logged in", handshake rejected). Fix the named gap - usually authenticate the agent's CLI - and start again.

An agent that fails is a *state*, not a crash: one broken agent never blocks the other.

## Configuration (optional)

A config file is optional; with none, working defaults apply (both providers pinned to known-good adapter versions). Resolution order:

1. `$KITTEN_CONFIG` - explicit path, wins outright.
2. `$XDG_CONFIG_HOME/kitten/config.json`.
3. `~/.config/kitten/config.json` (the default).

The file expresses **deltas only** and is merged per-provider and per-field over the defaults. Its schema is strict - unknown keys are errors (so typos surface), and a file that exists but is malformed is a **hard error**, never a silent fallback. Telemetry is opt-in and off by default; when on it stays local (content-free JSONL, nothing sent anywhere).

## Next

Once it runs, use **kitten-dev-workflow** for the edit/test/verify loop, and read `CLAUDE.md` (repo root) plus the ADRs under `.compozy/tasks_done/kitten-agent-tui/adrs/` for the architecture.
