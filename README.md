# Kitten

Kitten is a terminal cockpit for passing a live coding task from one AI agent to another without losing context.

It runs **Claude Code** and **Codex** together in one terminal using the [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk).  
If one agent stalls, you can hand its active task to the other with one action.

## Try Kitten

The only route approved for launch verification is the source checkout. It requires Bun 1.3.5 or newer and starts Kitten inside the cloned Git repository:

```bash
git clone https://github.com/MatheusBBarni/Kitten.git && cd Kitten && bun install && bun start
```

Do not use `npx kitten` for Kitten yet: the public npm name still belongs to an unrelated project. An npm or release installer becomes a supported route only after Kitten owns it publicly and the complete install path has been verified.

## Showcase Site

The canonical showcase URL is [https://matheusbbarni.github.io/Kitten/](https://matheusbbarni.github.io/Kitten/). It becomes a public entry point only after the launch gate below passes. The static Astro project lives in `site/` and deploys through `.github/workflows/showcase-site.yml`.

At launch, the showcase must have exactly one verified install CTA: the source-checkout command under [Try Kitten](#try-kitten). Keep `site/src/config/showcase-config.ts` and this README aligned, and do not add npm, curl, or release CTAs until that route is publicly available and freshly tested.

### Launch gate

Do not publish or announce the showcase until every item is checked:

- [ ] **Repository visibility:** `gh repo view MatheusBBarni/Kitten --json visibility --jq .visibility` reports `PUBLIC`, and the repository CTA works without authentication.
- [ ] **License presence:** an explicit open-source `LICENSE` or `LICENSE.md` is committed and GitHub detects it.
- [ ] **Recording availability:** `site/src/config/showcase-config.ts` references a real 20–30 second handoff recording and captions; the referenced files exist and visibly cover prepare, review/trim, confirm, and continue. The poster-only fallback is not launch proof.
- [ ] **Command verification:** the sole source-checkout command under [Try Kitten](#try-kitten) succeeds from a clean environment with the documented Bun and agent prerequisites.
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

- Bun 1.3.5 or newer
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

### One-time npm Trusted Publishing bootstrap

The five package names must exist before npm can trust this repository's release workflow. For the first release only:

1. Make the GitHub repository public and confirm that the maintainer controls both the `@kitten` npm scope and the existing unscoped `kitten` package. Do not publish any platform package until the main name is secured.
2. Use one short-lived, package-scoped npm access token to publish `@kitten/darwin-arm64`, `@kitten/darwin-x64`, `@kitten/linux-x64`, and `@kitten/linux-arm64` from one successful four-platform build, then publish `kitten` last at the same version.
3. Revoke that token immediately. Do not add it to `.github/workflows/release.yml` or repository secrets.
4. In npm's package settings for all five packages, configure a Trusted Publisher for repository `MatheusBBarni/Kitten` and workflow `release.yml`.
5. Use the normal release-please flow from then on. The publish job uses GitHub OIDC with npm provenance and has no npm registry secret.

After a real release, the four-platform smoke job checks `npx kitten@<version> --self-check`, version parity, and `npm audit signatures` against the published packages.

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
