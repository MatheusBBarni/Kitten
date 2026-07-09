# Kitten

A terminal cockpit that hands a live coding task back and forth between two AI agents.

Kitten runs Claude Code and Codex side by side in one terminal, both connected over the [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk). When one agent gets stuck, or you just want a second opinion, you hit a key and hand the whole task over to the other one. The other agent picks up where the first left off: the recent transcript, the files it touched, and the diffs it proposed. Both sessions stay live the entire time, so handing the task back is the same keystroke in the other direction.

## Why

Switching between agents today usually means copy-pasting context from one chat window into another, and hoping you grabbed the parts that mattered. Kitten makes that one action. It bundles the relevant slice of the session, lets you look it over and trim it, and forwards it. Nothing leaves for the other agent until you confirm.

## How the hand-off works

Press `Ctrl+T` and Kitten assembles a bundle from the focused agent's session: a bounded excerpt of the conversation, the list of files that were touched, and any pending diffs. It shows you the bundle in a preview overlay before anything is sent.

In the preview you can:

- Walk the file and diff list with the arrow keys.
- Drop anything you don't want to forward with `Space`.
- Edit the summary the receiving agent reads first with `e`.
- Send it with `Enter`, which forwards the bundle and moves focus to the other agent.
- Back out with `Esc`, which discards the hand-off and sends nothing.

Two things are deliberate. The target is always just the agent that isn't focused, which is why hand-off and hand-back are one flow instead of two. And the bundle is redacted for secrets as it's built, with the preview as a second line of defense, so a stray credential doesn't ride along into the other agent's prompt.

## Keybindings

| Key | Action |
| --- | --- |
| `Ctrl+O` | Switch focus to the other agent |
| `Ctrl+T` | Hand the task off to the other agent |
| `Enter` | Send the prompt to the focused agent |
| `Shift+Enter` | Insert a newline in the prompt |
| `Esc` | Interrupt the agent while it's working |
| `F1` | Show or hide the help panel |

When the agent asks for permission to do something, an approval overlay takes over the keyboard: arrow keys to move between options, `Enter` to answer, `Esc` to dismiss.

## Requirements

- [Bun](https://bun.sh) 1.3 or newer.
- Claude Code and Codex installed and authenticated. Kitten never owns their binaries or their auth; it just spawns their published ACP adapters.

## Getting started

```bash
bun install
bun start
```

On first run Kitten checks that both agents are reachable and reports what it finds, so a missing binary or a failed handshake shows up before you start working. If one agent can't start, the other stays fully usable.

To check your setup without opening the cockpit:

```bash
bun run selfcheck
```

## Configuration

A config file is optional. With no file, Kitten uses working defaults for both agents, each pinned to a known-good adapter version so an adapter release can't quietly change the handshake underneath you.

If you want to override something, drop a `config.json` at `~/.config/kitten/config.json` (or point `KITTEN_CONFIG` at a path of your choice). Overrides merge per agent and per field, so changing one agent's launch command leaves everything else alone. A broken config file is a hard error rather than a silent fallback.

Telemetry is off by default. When you turn it on, it stays local: content-free counters written to a JSONL file, nothing sent anywhere.

## Development

```bash
bun test           # run the test suite
bun run typecheck  # tsc --noEmit
bun run build      # produce a compiled binary
```

## Tech stack

Bun, TypeScript, OpenTUI for the terminal UI, React for the component tree, and the ACP TypeScript SDK for talking to the agents.
