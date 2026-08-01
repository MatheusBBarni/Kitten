# Kitten

Kitten is a terminal cockpit for moving a live coding task between agents without rebuilding the context by hand.

It runs **Claude Code**, **Codex**, and **Cursor** in one terminal through the [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk). If an agent gets stuck, start a handoff, review what Kitten collected, and decide whether to send it to another ready session.

## Install Kitten

Install the published CLI. npm selects the supported binary for your machine:

```bash
npm install --global @matheusbbarni/kitten
```

The package provides the `kitten` command. If you prefer the standalone binary, use the checksummed installer. It installs to `~/.local/bin` by default and explains how to add that directory to `PATH` if necessary:

```bash
curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash
```

### Update Kitten

Run one explicit update to the latest stable release, then return to the shell:

```bash
kitten --update
```

This command does not launch the cockpit, require a Git repository, start agents, prompt, or relaunch Kitten. It updates a verified global npm installation with npm, or an installer-managed standalone binary from the standalone release channel. Source checkouts, local dependencies, `npx` invocations, copied binaries, and unknown or uncertain installation contexts remain unchanged. There is no channel fallback.

If Kitten cannot verify the update path, it leaves the installation alone. Use one of the supported recovery commands:

```bash
npm install --global @matheusbbarni/kitten@latest
```

```bash
curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash
```

For standalone updates, checksum verification checks release-asset integrity by detecting corrupted or mismatched downloads. It does not protect against a compromised release publisher.

Launch Kitten from inside the Git repository where you want the agents to work:

```bash
cd path/to/your/repository
kitten
```

### Requirements

- macOS or Linux on arm64 or x64
- Claude Code installed and authenticated
- Codex installed and authenticated
- Cursor's local `agent` CLI installed and authenticated to use the Cursor session
- A git repository to launch Kitten from

Kitten launches the agents' published [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk) adapters. It does not install the agent CLIs or manage their authentication.

### Local Cursor session

Cursor is Kitten's third local coding-agent session. Kitten starts it through Cursor's native `agent acp` stdio server and supports only the reviewed, certified local profile. It does not connect to Cursor cloud agents, background agents, or other remote Cursor products.

Authentication stays in Cursor's native flow. Kitten does not collect or manage Cursor credentials, and it does not use direct CLI model lists or flags to control an active ACP session. Its model and reasoning controls come only from capabilities that active ACP session advertises.

Kitten checks Cursor separately. If its CLI is missing, unauthenticated, incompatible, or outside Kitten's certified profile, it gives a Cursor-specific recovery action while ready Claude Code and Codex sessions remain usable. Until a credentialed contract run is reviewed, Kitten does not claim an exact certified Cursor version or enable unverified Cursor-only capabilities.

## Showcase Site

The canonical showcase URL is [https://matheusbbarni.github.io/Kitten/](https://matheusbbarni.github.io/Kitten/). It becomes a public entry point only after the launch gate below passes. The static Astro project lives in `site/` and deploys through `.github/workflows/showcase-site.yml`.

At launch, the showcase must have exactly one verified install CTA: `npm install --global @matheusbbarni/kitten`. That route must match the primary install guidance above. The standalone installer remains available for people who prefer it.

### Launch gate

Publish or announce the showcase only when every item is checked:

- [ ] **Repository visibility:** `gh repo view MatheusBBarni/Kitten --json visibility --jq .visibility` reports `PUBLIC`, and the repository CTA works without authentication.
- [ ] **License presence:** an explicit open-source `LICENSE` or `LICENSE.md` is committed and GitHub detects it.
- [ ] **Proof clarity:** the visible handoff steps accurately cover prepare, review/trim, confirm, and continue without implying automatic sending or complete context transfer.
- [ ] **Command verification:** `npm install --global @matheusbbarni/kitten` succeeds from a clean environment and launches the published CLI with the documented agent prerequisites.
- [ ] **Claim review:** page copy matches released behavior and does not imply complete context transfer, automatic sending, or guaranteed secret removal.

Before launch, ask 10 target developers to explain the reviewed handoff after 30 seconds; at least 8 should get it right. Over the first 30 days, track at least 12 install-intent actions per 100 sessions, 40% proof engagement, 25 net-new GitHub stars, and no more than 20% of the first 20 substantive feedback items caused by unclear setup.

### Smoke validation

From `site/`, build the isolated site, inspect its rendered sections, and run its browser-behavior contracts:

```bash
cd site
bun install --frozen-lockfile
bun run check
bun run build
bun run test:coverage
test -f dist/index.html
rg -n 'id="(hero|proof|install|requirements|faq)"' dist/index.html
bun test test/landing-page.test.ts test/accessibility-motion.test.ts
bun test src/scripts/copy-command.test.ts src/scripts/star-count.test.ts
```

Then serve the production artifact and verify the Pages base path from another terminal:

```bash
cd site
bun run preview -- --host 127.0.0.1
```

```bash
curl --fail http://127.0.0.1:4321/Kitten/
```

Finally, check the preview in a browser:

- Activate the copy button with the keyboard and confirm the `aria-live` status reports success; with clipboard access blocked, confirm the command is selected for manual copying.
- Block or fail the GitHub API request and confirm the star control keeps its repository link, shows the configured unavailable message, and never fabricates `0` stars.
- Navigate the package-manager tabs with the keyboard and confirm only the selected install command is focusable while the written handoff steps remain visible.

### Maintenance and measurement

V1 emits no automatic showcase telemetry: no analytics endpoint, event beacon, cookies, fingerprints, persistent identifiers, or third-party behavioral scripts. Kitten's application telemetry is separate, local, content-free, opt-in, and off by default.

Until a reviewed post-launch instrumentation change exists, assess install intent and proof comprehension through launch feedback and public GitHub or release signals. Record the launch star baseline and the aggregate 30-day results, but do not present them as per-visitor site analytics.

## Why this project exists

Moving work between coding agents usually means copying a transcript, finding the relevant files, and hoping the important detail did not get lost. Kitten prepares a focused handoff, but the final call stays with you.

## Syntax highlighting

Kitten ships syntax highlighting only after the parser, aliases, source behavior, and compiled-binary behavior pass the release gate.

### Released fence labels

| Language | Canonical label | Aliases |
| --- | --- | --- |
| JavaScript | `javascript` | `js`, `jsx`, `javascriptreact` |
| TypeScript | `typescript` | `ts`, `tsx`, `typescriptreact` |
| Rust | `rust` | `rs` |
| Go | `go` | `golang` |
| OCaml | `ocaml` | `ml`, `mli` |
| JSON | `json` | — |
| Bash | `bash` | `sh`, `shell` |
| Python | `python` | `py` |
| Markdown | `markdown` | `md` |

### Fallback contract

Only the documented, release-gated labels above receive syntax highlighting. Unknown, malformed, unavailable, and unlabelled fences remain visibly bounded, copy-safe plaintext; when source declares a label, Kitten retains that label. Kitten never guesses a language from unlabelled code, extensionless diffs, or dotfile diffs.

The canonical `diff` format is Kitten's built-in unified-diff surface, with no aliases. It adds language-specific enhancement only when a recognized file extension supplies real context; otherwise the diff remains plaintext.

ReScript (`rescript`, aliases `res` and `resi`) has not met the release gate and is therefore not in the highlighted-support list. ReScript fences and diffs remain labelled, bounded, copy-safe plaintext until that gate passes.

## How handoffs work

When you start a handoff, Kitten collects a bounded transcript excerpt, relevant file references, pending diffs, and any captured shell context. The sessions stay live, so the receiving agent can continue from the context you choose to send. Cursor follows the same reviewed flow in both directions; there is no Cursor-only shortcut.

1. Press `Ctrl+T` to start a handoff. If more than one other session is ready, choose the destination first.
2. Review the preview. Move through files and diffs with the arrow keys, use `Space` to keep or drop an item, `e` to edit the summary, and `m` to set the target model or reasoning effort.
3. Press `Enter` to send the curated bundle and focus the destination, or `Esc` to cancel without sending anything.

Nothing is sent when you start the handoff, choose a target, or open and curate the preview. Only explicit confirmation from the preview sends the bundle.

Kitten redacts recognised credentials before showing the preview. Treat review as the final safeguard: redaction reduces risk, but it is not a promise that every secret has been found.

## Everyday controls

| Key | What it does |
| --- | --- |
| `Ctrl+T` | Start a reviewed handoff |
| <code>Ctrl+&grave;</code> / `F2` | Focus or leave the integrated shell |
| `Ctrl+H` / `Ctrl+L` | Select the previous or next visible conversation when Kitty keyboard input is available |
| `/` | Open and filter the command menu |
| `@` | Find and add a repository file reference to the prompt |
| `Enter` / `Shift+Enter` | Send the prompt / insert a newline |
| `↑` / `↓` | Recall prompts at multiline editing boundaries |
| `Esc` | Interrupt the focused agent while it is working |

## Slash commands

Type `/` in the prompt to filter the command menu, or write the full command and press `Enter`.

- `/help`: Show all available Kitten commands.
- `/shell`: Focus the integrated shell.
- `/copy`: Copy the latest shell command for an external terminal.
- `/handoff`: Start a reviewed handoff to another ready session.
- `/sessions`: Show all sessions and jump to one that needs you.
- `/previous-tab` and `/next-tab`: Select the adjacent visible conversation.
- `/resume`: Find and resume a saved run for this project.
- `/new`: Create a new conversation, or recover an unavailable restored context when one is selected.
- `/clear`: Clear this run and restart with fresh sessions.
- `/model`: Choose an agent model and reasoning effort.
- `/settings`: Open Kitten settings.

When an agent asks for approval, use:

- arrow keys to choose
- `Enter` to confirm
- `Esc` to dismiss

## Develop from source

To work from source, install [Bun](https://bun.sh) 1.3.5 or newer.

```bash
git clone https://github.com/MatheusBBarni/Kitten.git && cd Kitten && bun install && bun start
```

On first launch, Kitten checks each configured agent and reports its readiness. A missing, unauthenticated, incompatible, or uncertified Cursor session does not block ready siblings. Its recovery message includes no prompt, code, credential, or repository content.

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

It exits non-zero if any check fails.

## Configuration

Configuration is optional. Without a config file, Kitten uses its defaults and pinned adapter versions.

To add overrides, use either:

- `~/.config/kitten/config.json`
- `KITTEN_CONFIG` (path to a custom config file)

Kitten merges overrides by provider, session, and field, so you can change one setting without replacing the rest. Malformed config files fail fast; there is no silent fallback.

Telemetry is off by default. If enabled, it writes only local, content-free JSONL counters.

### Theme catalog

Settings applies a selected theme immediately and saves it to `config.json`. Kitten's built-in presets come from a curated, source-attributed catalog. See the [Theme Catalog](docs/theme-catalog.md) for families, variants, and license records.

### Experimental transcript windowing

The bounded transcript view is off by default. To try it, add this strict top-level boolean to `config.json`:

<!-- transcript-windowing-example:start -->
```json
{
  "transcriptWindowingEnabled": true
}
```
<!-- transcript-windowing-example:end -->

This changes presentation only. Kitten keeps the complete transcript in memory for the current live run and collapses older rows behind an explicit history control. It does not persist transcript content across restarts, create a transcript archive, or change telemetry's local, content-free privacy boundary. There is no Settings toggle or environment override; remove the field or set it to `false` to return to the full-transcript view.

### Provider model defaults

Set a default model, reasoning effort, or both for each provider. These are personal preferences: only `model` and `effort` are accepted, and Kitten never creates or rewrites them. Changes made during a live session stay session-local.

<!-- provider-defaults-example:start -->
```json
{
  "providerDefaults": {
    "claude-code": {
      "model": "claude-opus-4-1",
      "effort": "high"
    },
    "codex": {
      "model": "gpt-5.4",
      "effort": "high"
    }
  }
}
```
<!-- provider-defaults-example:end -->

Provider defaults take effect only through the intentional provider-selection flow. Editing this file never changes a live session, and Kitten never writes selections back to it.

### MCP servers

Kitten automatically adds its local `kitten-ask-user` MCP server to every agent session. Its `ask_user` tool opens Kitten's structured question dialog for consequential decisions, then continues with the submitted, skipped, timed-out, or cancelled outcome. This is not a user-configured server: do **not** add it to `mcpServers`. The status strip shows `ask_user attached` after Kitten hands the declaration to the provider session, or `ask_user loading` while a dynamically started session catches up.

Declare shared MCP servers in the top-level `mcpServers` object. It is a name-keyed map: each key is the server name shown in Kitten's readouts, and each value is a stdio launch recipe with these fields:

- `command`: the executable Kitten launches.
- `args`: the command-line arguments, in order.
- `env`: environment variables passed to the server. Values can reference launch-time variables with `${VAR}`.

Copy this strict JSON into `config.json`. The `github` key names the server, `npx` launches it over stdio, `args` identifies the package, and `env` reads the token from the environment instead of storing the secret in the file.

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

Set every referenced variable before starting Kitten. For the example above:

```bash
export GITHUB_TOKEN="your-token"
bun start
```

V1 supports stdio servers only. Kitten rejects remote HTTP/SSE entries such as this one while loading the config:

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

An unresolved `${VAR}` does not block startup. Kitten skips that server and shows a warning. Declared MCP servers are active only in sessions Kitten launches; configuring Claude Code or Codex to use them standalone is outside V1.

Run `bun run selfcheck` to see the loaded or skipped MCP readout and the built-in `ask_user` bridge status without opening the cockpit. The status strip shows the same result for each session.

## Development commands

```bash
bun test              # run the test suite
bun run typecheck     # TypeScript no-emit check
bun run test:coverage # run coverage checks
bun run build         # build release binaries
bun run build:local   # quick local binary build
```

## Contributing

Use Conventional Commits for pull request titles, for example `feat: add session search` or `fix!: remove a legacy option`. The repository uses squash merge with **Default to PR title for squash merge commits** enabled in GitHub, so release-please reads the linted title from the commit on `main`.

### One-time npm Trusted Publishing bootstrap

For the first release, create the five package names before npm can trust this repository's release workflow:

1. Make the GitHub repository public and confirm that the maintainer controls the `@matheusbbarni` npm scope. Do not publish any platform package until the scoped main package name is secured.
2. From one successful four-platform build, use a short-lived, package-scoped npm access token to publish `@matheusbbarni/kitten-darwin-arm64`, `@matheusbbarni/kitten-darwin-x64`, `@matheusbbarni/kitten-linux-x64`, and `@matheusbbarni/kitten-linux-arm64`. Publish `@matheusbbarni/kitten` last at the same version.
3. Revoke that token immediately. Do not add it to `.github/workflows/release.yml` or repository secrets.
4. In npm's package settings for all five packages, configure a Trusted Publisher for repository `MatheusBBarni/Kitten` and workflow `release.yml`.
5. Use the normal release-please flow from then on. The publish job uses GitHub OIDC with npm provenance and has no npm registry secret.

After a real release, the four-platform smoke job checks `npx @matheusbbarni/kitten@<version> --self-check`, version parity, and `npm audit signatures` against the published packages.

## Project structure

- `src/agent`: ACP adapter boundary
- `src/core`: pure domain model and reducer
- `src/store`: app state
- `src/app`: controller and orchestration
- `src/ui`: terminal interface
- `src/config`: config loading, validation, and boot flow
- `scripts`: build helpers and tooling

## Tech stack

Kitten uses Bun, TypeScript, OpenTUI, React's terminal renderer, and the ACP TypeScript SDK.
