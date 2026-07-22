# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Kitten is

A terminal cockpit that runs two AI coding agents (Claude Code and Codex) side by side over the [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk) and lets the developer hand a live task from one agent to the other with one keystroke. Both agent sessions stay live for the whole run, so handing back is the same flow pointed the other way. Kitten never owns the agent binaries or their auth; it spawns their published ACP adapters as subprocesses.

Runtime is **Bun** (>= 1.3), language is **TypeScript**, UI is **OpenTUI + React 19** rendered to the terminal, and the agent transport is the **ACP TypeScript SDK** (`@agentclientprotocol/sdk`).

## Commands

```bash
bun install            # install deps (bunfig pins exact versions; see below)
bun start              # run the cockpit (alias: bun run dev)
bun run selfcheck      # headless boot self-check (mounts the real tree, no terminal); alias for `bun run src/index.ts --self-check`
bun test               # run the whole suite (bun's built-in runner)
bun test --coverage --isolate # coverage; threshold 0.8 is enforced when coverage runs (bun run test:coverage)
bun run typecheck      # tsc --noEmit
bun run build          # compile standalone per-platform binaries (scripts/build.ts)
bun run build:local    # quick single-binary compile for the host only
```

Run a single test file or a single test by name:

```bash
bun test src/core/sessionReducer.test.ts        # one file
bun test --test-name-pattern "redacts"          # by test name across the suite
```

Tests are colocated with the code they cover (`*.test.ts` / `*.test.tsx` next to the source under `src/`), plus integration tests under `test/`. There are ~37 test files; new code is expected to bring its own.

## Architecture

Kitten is layered deliberately, and the layering is the thing to protect. The layers, from the outside in:

1. **Agent Adapter Layer** (`src/agent/`) - the ACP anti-corruption boundary. `AgentConnection` spawns one agent subprocess, speaks ACP, implements the ACP `Client` callbacks (permission + filesystem), and **translates ACP wire types into Kitten's protocol-free domain events** (`acpTranslate.ts`). No ACP type escapes this layer. Streamed `agent_message` deltas are coalesced to at most one flush per frame here (`FrameScheduler`), which is what keeps a streaming token from re-rendering the transcript.
2. **Domain Core** (`src/core/`) - pure, protocol-free, no I/O, no ACP, no React. Holds the normalized session model and domain event union (`types.ts`), the single reducer that is the only writer of `SessionState` (`sessionReducer.ts`), the deterministic hand-off bundle assembler (`bundleAssembler.ts`), and the secret redactor (`secretRedactor.ts`). Same input, same output.
3. **Store** (`src/store/`) - one external, immutable reactive store (`appStore.ts`) with narrow selector subscriptions (`selectors.ts`). React does **not** own this state; components subscribe to narrow slices and re-render only when that exact slice changes (structural sharing + `Object.is`). The store never applies an event by hand - it always routes through the core reducer - and never imports an ACP type.
4. **Controller / App** (`src/app/`) - the orchestration seam. `controller.ts` wires config -> connections -> store: it builds one long-lived `AgentConnection` per configured session, opens an ACP session per agent, pumps domain events into the owning store slice, and parks incoming permission requests in the store's approval overlay. `actions.ts` is the **only** surface the UI uses to drive agents (send prompt, cancel, switch focus, answer permission). `handoff.ts` owns the assemble -> curate -> send -> switch flow.
5. **UI** (`src/ui/`) - OpenTUI + React views. `main.tsx` is the JSX seam kept separate so `src/index.ts` stays JSX-free and testable. `CockpitApp.tsx` is the shell (a focused single-pane layout, not a split); `keymap.ts` is the single source of truth for every binding and the help panel. Views only ever see `ControllerActions` and store selectors - never a connection, never ACP.
6. **Config / boot** (`src/config/`) - `configLoader.ts` (load, validate with zod, merge, resolve sessions), `readiness.ts` (per-agent handshake verdict), `firstRun.ts` (boot gates).

The one-line rule: **ACP lives only in `src/agent/`; the core is pure; the store is the single mutable state and only the reducer writes session state; the UI reaches agents only through `ControllerActions`.** When adding a feature, respect which layer owns what.

### Boot flow (`src/index.ts`)

Importing `src/index.ts` has **no side effects** - boot only runs under `import.meta.main`, so tests import it and drive `main()`/`renderCockpit()` against an in-memory renderer with injected fakes. Every seam (renderer factory, controller/session factory, exit handler, repo check) is injectable. Boot applies two gates before mounting: (1) the **repo gate** - Kitten refuses to run outside a git repository, checked first because it costs nothing; (2) the **readiness gate** - after agents come up, boot stops if none is ready rather than mounting a dead cockpit. A blocked gate prints the exact reason and exits non-zero.

### Degrade-per-agent, never crash

Startup and every action degrade rather than throw. A missing binary, a rejected handshake, or a failed `session/new` marks **that one** agent not-ready and leaves the other fully usable (`createSessionController` never rejects). Actions on a not-ready agent are no-ops; a connection that fails mid-call reports through `onError` and leaves the other agent untouched. A UI callback fired from a keypress must never reject into the React tree.

### The hand-off (the product)

`Ctrl+T` assembles a `HandoffBundle` from the focused agent's session (a bounded transcript excerpt, referenced files, pending diffs), opens a preview overlay, and on `Enter` sends the curated bundle to the *other* agent as a prompt and moves focus with it. Load-bearing invariants:
- **Nothing is ever auto-sent.** Only `confirm` reaches an agent; there is deliberately no keystroke-to-send path that skips the preview.
- **Bundles arrive redacted.** The assembler redacts as it builds, biased to **false negatives** (a missed secret is caught by the mandatory human preview; an over-eager redactor silently corrupts the bundle the receiver must work from). Do not "improve" the redactor toward aggressive matching.
- **Direction is derived, not configured** - the target is simply the agent that is not focused, which is why hand-off and hand-back are one flow.

### Sessions vs. providers (identity model)

A `ProviderKind` (`claude-code` | `codex`) is the spawn-recipe identity; a `SessionId` is a Kitten-assigned per-session instance identity, fixed at config load *before* any ACP handshake. Two sessions may share a provider kind; each still gets a distinct `SessionId`, and the store keys by `SessionId`. A not-ready session (no ACP id yet) still exists in the store. Config is a `providers` map (spawn recipes) plus an ordered `sessions` list; an empty `sessions` list means zero-config (one session per configured provider in the launch directory). `agents` is a **deprecated alias** for `providers`, kept for one migration window.

## Configuration

Config resolution (`resolveConfigPath` in `src/config/configLoader.ts`): `$KITTEN_CONFIG` (explicit path) > `$XDG_CONFIG_HOME/kitten/config.json` > `~/.config/kitten/config.json`. The file is **optional** - with none, working defaults apply, each provider pinned to a known-good ACP adapter version (pinning is the mitigation against an adapter changing its handshake beneath a running install). The config schema is `strict()` (unknown keys are errors, so typos surface); it expresses **deltas only**, merged per-provider and per-field over the defaults. A file that exists but is malformed is a **hard error**, never a silent fallback to defaults.

Telemetry is **opt-in and off by default**. When enabled it stays local: content-free counters (never prompt/code content) written to a JSONL file, nothing sent anywhere.

## Conventions and gotchas

- **Dependency pinning.** `bunfig.toml` sets `exact = true` and enforces a minimum-release-age supply-chain guard. `@opentui/*`, the ACP SDK, and their native cores are explicitly allow-listed and hard-pinned (they are pre-1.0 and fast-moving); everything else stays under the age guard. Do not widen ranges.
- **JSX config.** `tsconfig.json` uses `jsxImportSource: "@opentui/react"` (not React DOM). Strict mode is on with `noUncheckedIndexedAccess` and `noFallthroughCasesInSwitch`; `.ts` extensions are used in imports (`allowImportingTsExtensions`, `verbatimModuleSyntax`). This is a terminal app - there is no browser DOM.
- **Keybindings live in one table.** `src/ui/keymap.ts` is the single source of truth for dispatch *and* the help panel, so a binding can never drift from its docs. Global chords are control/function keys only (they are live even inside the prompt editor); overlays are modal and consume every key. Add bindings there, not inline in components.
- **Desktop styling uses Tailwind.** In `packages/desktop`, style components with Tailwind utility classes. Do not add component-specific rules to `src/renderer/styles.css`; keep that file for Tailwind imports, theme tokens, base styles, and existing shared legacy rules while they are migrated.
- **Releases** ship as per-platform standalone binaries built on native CI runners (a single machine can't cross-compile all four targets because OpenTUI's Zig core loads per-platform via FFI), delivered through the checksummed installer in `scripts/install.sh` and `.github/workflows/release.yml`.

## Coding rules

The enforceable engineering constraints for this repo live under `.claude/rules/` and are imported below. Follow them when writing or reviewing code - each states the invariant, the rationale, and the anti-patterns:

- @.claude/rules/layering.md - keep ACP in the adapter, the core pure, the store the single writer, the UI on `ControllerActions`.
- @.claude/rules/resilience.md - degrade per agent, never crash; a malformed config is a hard error.
- @.claude/rules/testing.md - colocated tests, injectable seams, the `typecheck && test` gate.
- @.claude/rules/dependencies.md - exact pins, don't widen, respect the allow-list and age guard.
- @.claude/rules/handoff-safety.md - never auto-send, bundles arrive redacted, redactor biased to false negatives.

## Skills

Project skills live under `.claude/skills/` (real content in `.agents/skills/`, symlinked). Claude Code auto-discovers them; other agent tools can read the `SKILL.md` files directly.

- **kitten-setup** - clone to a running cockpit: prerequisites, install, self-check, boot gates.
- **kitten-dev-workflow** - the test/typecheck/build loop and the pre-commit verification gate.
- Stack references, vendored so every maintainer has them regardless of their global setup: **opentui**, **react**, **typescript-advanced**, **zod**, **tui-design**.

## Design records

The design rationale lives in six ADRs under `.compozy/tasks_done/kitten-agent-tui/adrs/` (`adr-001`..`adr-006`), with the PRD and TechSpec beside them (`_prd.md`, `_techspec.md`). The source references these inline (e.g. "ADR-003" for the layering, "ADR-004" for the external store, "ADR-005" for the config/session model). Read the relevant ADR before changing a boundary a comment attributes to one. Ongoing/planned work is tracked as Compozy task packets under `.compozy/tasks/<slug>/`.
