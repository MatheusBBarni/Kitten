# Kitten

Kitten is a terminal cockpit for passing a live coding task from one AI agent to another without losing context.

It runs **Claude Code**, **Codex**, and **Cursor** together in one terminal using the [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk).
If one agent stalls, you can hand its active task to another ready session through a reviewed transfer.

## Install Kitten

Install the latest standalone binary with the checksummed installer:

```bash
curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash
```

The installer uses `~/.local/bin` by default and tells you how to add it to `PATH` when needed. Launch Kitten from inside the Git repository where you want the agents to work:

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

Kitten launches the agents' published [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk) adapters. It does not install the agent CLIs or manage their authentication. The npm channel will be documented here when its native-binary install path is published and verified.

### Local Cursor session

Cursor is Kitten's third local coding-agent session. Kitten starts Cursor through its native `agent acp` stdio server and supports only the reviewed, certified local profile. This integration does not connect to Cursor cloud agents, background agents, or other remote Cursor products.

Cursor is checked independently. If its CLI is missing, unauthenticated, incompatible, or outside Kitten's certified profile, Kitten reports a Cursor-specific recovery action while ready Claude Code and Codex sessions remain usable. Until a credentialed contract run is reviewed, Kitten does not claim an exact certified Cursor version or enable unverified Cursor-only capabilities.

## Showcase Site

The canonical showcase URL is [https://matheusbbarni.github.io/Kitten/](https://matheusbbarni.github.io/Kitten/). It becomes a public entry point only after the launch gate below passes. The static Astro project lives in `site/` and deploys through `.github/workflows/showcase-site.yml`.

At launch, the showcase must have exactly one verified install CTA: the source-checkout command under [Develop from source](#develop-from-source). Keep that site-specific CTA separate from the curl-first install guidance above.

### Launch gate

Do not publish or announce the showcase until every item is checked:

- [ ] **Repository visibility:** `gh repo view MatheusBBarni/Kitten --json visibility --jq .visibility` reports `PUBLIC`, and the repository CTA works without authentication.
- [ ] **License presence:** an explicit open-source `LICENSE` or `LICENSE.md` is committed and GitHub detects it.
- [ ] **Recording availability:** `site/src/config/showcase-config.ts` references a real 20–30 second handoff recording and captions; the referenced files exist and visibly cover prepare, review/trim, confirm, and continue. The poster-only fallback is not launch proof.
- [ ] **Command verification:** the sole source-checkout command under [Develop from source](#develop-from-source) succeeds from a clean environment with the documented Bun and agent prerequisites.
- [ ] **Claim review:** page copy matches released behavior and does not imply complete context transfer, automatic sending, or guaranteed secret removal.

Before launch, at least 8 of 10 target developers should be able to explain the reviewed handoff after 30 seconds. The first 30-day review targets are at least 12 install-intent actions per 100 sessions, 40% proof engagement, 25 net-new GitHub stars, and no more than 20% of the first 20 substantive feedback items caused by unclear setup.

### Smoke validation

Build the isolated site, check its rendered sections and fallback asset, then run the browser-behavior contracts:

```bash
cd site
bun install --frozen-lockfile
bun run check
bun run build
bun run test:coverage
test -f dist/index.html
rg -n 'id="(hero|proof|install|requirements|faq)"' dist/index.html
test -f public/proof/kitten-reviewed-handoff-poster.svg
bun test test/landing-page.test.ts test/accessibility-motion.test.ts
bun test src/scripts/copy-command.test.ts src/scripts/star-count.test.ts src/scripts/proof-media-state.test.ts src/scripts/proof-media.test.ts
```

Serve the production artifact and verify the Pages base path from another terminal:

```bash
cd site
bun run preview -- --host 127.0.0.1
```

```bash
curl --fail http://127.0.0.1:4321/Kitten/
```

Complete these manual browser checks against the preview:

- Activate the copy button with the keyboard and confirm the `aria-live` status reports success; with clipboard access blocked, confirm the command is selected for manual copying.
- Block or fail the GitHub API request and confirm the star control keeps its repository link, shows the configured unavailable message, and never fabricates `0` stars.
- Enable reduced motion and confirm proof video does not autoplay, pauses if the preference changes, retains native controls, and leaves the written handoff steps visible.

### Maintenance and measurement

V1 emits no automatic showcase telemetry: no analytics endpoint, event beacon, cookies, fingerprints, persistent identifiers, or third-party behavioral scripts. Kitten's application telemetry is separate, local, content-free, opt-in, and off by default.

Until a separately reviewed post-launch instrumentation change exists, maintainers assess install intent and proof comprehension through launch feedback and public GitHub/release signals. Record the launch star baseline and aggregate the manual 30-day results without presenting them as per-visitor site analytics.

## Why this project exists

Handing work from one coding agent to another usually means copying a transcript, finding the relevant files, and hoping you did not leave out the one detail that matters. Kitten prepares a focused handoff instead, then leaves the final decision with you.

## Syntax highlighting

Kitten enhances code only after its parser, aliases, source behavior, and compiled-binary behavior pass the same release gate.

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

When you start a handoff, Kitten collects a bounded transcript excerpt, relevant file references, pending diffs, and any captured shell context. The sessions stay live throughout, so the receiving agent can continue from the context you explicitly choose to send. Cursor uses this same reviewed flow in both directions; there is no Cursor-only shortcut.

1. Press `Ctrl+T` to start a handoff. If more than one other session is ready, choose the destination first.
2. Review the preview. Move through files and diffs with the arrow keys, use `Space` to keep or drop an item, `e` to edit the summary, and `m` to set the target model or reasoning effort.
3. Press `Enter` to send the curated bundle and focus the destination, or `Esc` to cancel without sending anything.

Nothing is sent when you start the handoff, choose a target, or open and curate the preview. Only explicit confirmation from the preview sends the bundle.

Kitten redacts recognised credentials before showing the preview. Review is still the final safeguard: redaction reduces risk, but it is not a promise that every secret has been found.

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

- `/help` — Show all available Kitten commands.
- `/shell` — Focus the integrated shell.
- `/copy` — Copy the latest shell command for an external terminal.
- `/handoff` — Start a reviewed handoff to another ready session.
- `/sessions` — Show all sessions and jump to one that needs you.
- `/previous-tab` and `/next-tab` — Select the adjacent visible conversation.
- `/resume` — Find and resume a saved run for this project.
- `/new` — Create a new conversation, or recover an unavailable restored context when one is selected.
- `/clear` — Clear this run and restart with fresh sessions.
- `/model` — Choose an agent model and reasoning effort.
- `/settings` — Open Kitten settings.

When an agent asks for approval, use:

- arrow keys to choose
- `Enter` to confirm
- `Esc` to dismiss

## Develop from source

Source development requires [Bun](https://bun.sh) 1.3.5 or newer.

```bash
git clone https://github.com/MatheusBBarni/Kitten.git && cd Kitten && bun install && bun start
```

On first launch, Kitten checks each configured agent and reports readiness. A missing, unauthenticated, incompatible, or uncertified Cursor session does not block ready siblings; its recovery message is shown without prompt, code, credential, or repository content.

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

### Provider model defaults

You can declare a default model, reasoning effort, or both for each provider. These are personal, declarative preferences: only `model` and `effort` are accepted, and Kitten never creates or rewrites them. Manual changes made in a live session also remain session-local.

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

Provider defaults are restored only by the intentional provider-selection flow. Editing this file does not silently change a live session, and Kitten never writes selections back to it.

### MCP servers

Kitten automatically injects its local `kitten-ask-user` MCP server into every agent session. It exposes the `ask_user` tool for consequential decisions, so the agent can open Kitten's structured question dialog and continue with the submitted, skipped, timed-out, or cancelled outcome. It is not a user-configured server: do **not** add it to `mcpServers`. The status strip reports `ask_user attached` once Kitten has handed the declaration to the provider session; a dynamically started session reports `ask_user loading` while that happens.

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

Run `bun run selfcheck` to see the loaded/skipped MCP readout plus the built-in `ask_user` bridge status without opening the cockpit. In the cockpit, the same per-session result appears in the status strip.

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

### One-time npm Trusted Publishing bootstrap

The five package names must exist before npm can trust this repository's release workflow. For the first release only:

1. Make the GitHub repository public and confirm that the maintainer controls the `@matheusbbarni` npm scope. Do not publish any platform package until the scoped main package name is secured.
2. Use one short-lived, package-scoped npm access token to publish `@matheusbbarni/kitten-darwin-arm64`, `@matheusbbarni/kitten-darwin-x64`, `@matheusbbarni/kitten-linux-x64`, and `@matheusbbarni/kitten-linux-arm64` from one successful four-platform build, then publish `@matheusbbarni/kitten` last at the same version.
3. Revoke that token immediately. Do not add it to `.github/workflows/release.yml` or repository secrets.
4. In npm's package settings for all five packages, configure a Trusted Publisher for repository `MatheusBBarni/Kitten` and workflow `release.yml`.
5. Use the normal release-please flow from then on. The publish job uses GitHub OIDC with npm provenance and has no npm registry secret.

After a real release, the four-platform smoke job checks `npx @matheusbbarni/kitten@<version> --self-check`, version parity, and `npm audit signatures` against the published packages.

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
