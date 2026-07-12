# TechSpec: Integrated Shell

## Executive Summary

The integrated shell adds a real PTY-backed terminal to the Kitten cockpit and wires its working state into the hand-off.
It follows the patterns already in the codebase: an imperative `ShellRuntime` (owned and disposed by `SessionController`, like `AgentConnection`) spawns one long-lived `$SHELL` through Bun's native `Bun.Terminal` PTY, feeds the byte stream to an `@xterm/headless` emulator, and renders the active screen buffer into OpenTUI each frame through the existing frame scheduler.
State is split in two: a high-frequency render representation stays imperative in the runtime, while a pure `shell` slice on `AppState` (cwd, a bounded ring of command records, running status) is written by a `shellReducer` from `ShellEvent`s and read through narrow selectors, exactly as session state is today.
Command boundaries, exit codes, and cwd come from OSC 133 and OSC 7 shell-integration sequences, so the hand-off snapshot carries fact rather than a guess.

The primary trade-off: rendering interactive apps in-pane via `@xterm/headless` (the owner's choice over a full-window passthrough) keeps Kitten chrome and avoids a suspend/restore lifecycle, but it takes on the hardest part of terminal emulation up front - full cursor addressing, input encoding, and resize correctness - as MVP work rather than deferring it.

## System Architecture

### Component Overview

- **`ShellRuntime`** (new, imperative, controller-owned): owns the `Bun.Terminal` PTY, the `@xterm/headless` instance, the scrollback ring, and the semantic command ring. Registers OSC handlers on the emulator, emits `ShellEvent`s, accepts input bytes, forwards interrupts, resizes, and produces a `ShellSnapshot`. Obtained via an injectable `ShellRuntimeFactory`, mirroring `TransportFactory` so tests avoid a real PTY.
- **`shellReducer` + `shell` slice** (new pure core + store): folds `ShellEvent`s into `ShellState`. Single writer, no I/O, exhaustively unit-tested, matching `sessionReducer`.
- **`ShellPane`** (new UI): reads the emulator's active buffer (primary or alternate) and paints styled cells into OpenTUI; forwards focused-pane key events to the runtime as encoded bytes.
- **Focus + input routing** (modified `CockpitApp`, `keymap`, `appStore`): a `focusedPane` union (`agent | shell`) decides who owns the keyboard; a toggle chord flips it; global chords stand down while the shell is focused.
- **Hand-off integration** (modified `bundleAssembler`, `handoff`, `HandoffPreview`): an optional `shell` field on `HandoffBundle`, redacted at assembly, curated as a droppable "Shell context" section in the preview.

**Data flow:** PTY bytes -> `@xterm/headless` (screen model + OSC handlers) -> `ShellRuntime` emits `ShellEvent`s -> `shellReducer` -> `shell` slice -> selectors -> `ShellPane` render. Keystrokes (shell focused) -> key-to-VT encoder -> `ShellRuntime.write` -> PTY. At hand-off, `ShellRuntime.snapshot()` -> `bundleAssembler` (redact) -> `HandoffBundle.shell` -> preview -> target agent prompt.

## Implementation Design

### Core Interfaces

The primary type other components depend on is the runtime, kept behind an injectable factory like the agent transport:

```ts
export interface ShellRuntime {
  /** Domain events (screen revision bumps, command/cwd changes) for the reducer. */
  onEvent(cb: (event: ShellEvent) => void): Unsubscribe
  /** Forward encoded key bytes to the PTY. */
  write(bytes: Uint8Array): void
  /** Interrupt the foreground command by sending 0x03 to the PTY. */
  interrupt(): void
  /** Reflow on a pane or terminal resize. */
  resize(cols: number, rows: number): void
  /** Read the active screen buffer's visible rows as styled runs. */
  view(): readonly StyledLine[]
  /** A stable cwd + recent-command snapshot for the hand-off. */
  snapshot(): ShellSnapshot
  /** Kill the shell process and release the emulator. Never throws. */
  dispose(): Promise<void>
}

export type ShellRuntimeFactory = (options: ShellSpawnOptions) => ShellRuntime
```

### Data Models

```ts
export interface ShellCommandRecord {
  id: string
  command: string
  output: string          // raw; redacted only at hand-off assembly
  exitCode: number | null // null while running
}
export interface ShellState {
  status: "idle" | "running"
  cwd: string
  commands: ShellCommandRecord[] // bounded ring (most recent N)
  renderRev: number              // bumps when the screen changes
}
export interface ShellSnapshot { cwd: string; commands: ShellCommandRecord[] }

export type ShellEvent =
  | { kind: "screen"; rev: number }
  | { kind: "command_started"; id: string; command: string }
  | { kind: "command_finished"; id: string; exitCode: number }
  | { kind: "cwd_changed"; cwd: string }
```

Hand-off additions stay minimal and additive:

```ts
export interface HandoffBundle {
  /* existing: intent, summary, files, pendingDiffs, redactionCount */
  shell?: ShellSnapshot // cwd + curated command records; env never included
}
export interface HandoffEdits {
  /* existing: summary, excludedFiles, excludedDiffs */
  excludedCommands: ReadonlySet<string> // command ids the developer dropped
}
```

`AppState` gains `shell: ShellState` and `focusedPane: { kind: "agent"; agentId: AgentId } | { kind: "shell" }`. The store gains `applyShellEvent(event)` and `setFocusedPane(pane)`; `selectors.ts` gains `selectShell`, `selectFocusedPane`, `selectIsShellFocused`.

### API Endpoints

Not applicable. Kitten is a local TUI with no network or HTTP surface. The equivalent internal surface is the store actions above and the keymap command `toggle-shell`.

## Integration Points

- **Bun `Bun.Terminal`** (native PTY, Bun >= 1.3.5; 1.3.13 in use): spawns and drives the shell; POSIX only.
- **`@xterm/headless`** (new dependency): VT emulation and OSC handler registration. Rendered into OpenTUI by a bridge Kitten owns.
- **Shell integration snippets** (shipped assets): OSC 133 / OSC 7 hooks sourced into bash and zsh at spawn, without touching the user's dotfiles.
- **OpenTUI renderer**: `exitOnCtrlC` flips to `false`; Ctrl+C is routed by focus. Existing overlay stand-down precedence is reused for the shell.
- **Hand-off**: reuses `secretRedactor` unchanged on snapshot output.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/shell/shellRuntime.ts` | new | PTY + `@xterm/headless` + OSC parsing + render bridge. Highest risk in the change. | Create behind a factory seam |
| `src/core/types.ts` | modified | Add shell types; add `shell?` to `HandoffBundle`; `excludedCommands` to edits. Low risk. | Add types |
| `src/core/shellReducer.ts` | new | Pure reducer for the shell slice. Low risk. | Create + unit test |
| `src/store/appStore.ts` | modified | Add `shell` slice, `focusedPane`, `applyShellEvent`, `setFocusedPane`. Medium risk (focus model change). | Extend store |
| `src/store/selectors.ts` | modified | Shell + focused-pane selectors. Low risk. | Add selectors |
| `src/ui/ShellPane.tsx` | new | Render active buffer; forward input. Medium risk (bridge fidelity). | Create |
| `src/ui/CockpitApp.tsx` | modified | Mount pane in the toggled region; route keys by `focusedPane`; Ctrl+C routing. Medium risk. | Modify keyboard/focus |
| `src/index.ts` | modified | `exitOnCtrlC: false`; keep app-quit when agent-focused. Medium risk (quit path). | Modify renderer + teardown |
| `src/ui/keymap.ts` | modified | `toggle-shell` chord, `SHELL_HINT`, global stand-down while shell-focused. Low risk. | Extend keymap |
| `src/core/bundleAssembler.ts` | modified | Populate + redact `bundle.shell` from a snapshot. Low risk. | Extend `assemble` |
| `src/app/handoff.ts` | modified | Read snapshot; `composeHandoffBlocks` shell block; `excludedCommands` curation. Low risk. | Extend flow |
| `src/ui/HandoffPreview.tsx` | modified | Droppable "Shell context" section (mirrors files/diffs). Low risk. | Extend preview |
| `src/app/controller.ts` | modified | Own and dispose the `ShellRuntime`; expose snapshot to the hand-off. Medium risk (lifecycle). | Extend controller |
| `src/config/configLoader.ts` | modified | Optional `shell` block (enable flag, command override, scrollback size). Low risk. | Extend zod schema |
| `src/telemetry/recorder.ts` | modified | Add `shell_activated`, `shell_snapshot_attached`, `external_run` event types + methods. Low risk. | Extend recorder |

## Testing Approach

### Unit Tests
- `shellReducer`: one fixture per `ShellEvent`; command open/close with exit codes; cwd updates; ring-buffer bounding. Pure, deterministic.
- OSC parsing: byte fixtures with OSC 133/OSC 7 sequences assert the emitted `ShellEvent`s.
- Key-to-VT encoder: `KeyEvent` fixtures (arrows, Ctrl combos, function keys) assert the encoded byte sequences.
- Snapshot redaction: extend `bundleAssembler` tests so a command whose output contains a token is redacted and counted; assert env is never present.
- Mock boundary: an in-memory `ShellRuntimeFactory` that emits scripted bytes/events, analogous to `createInMemoryTransportPair`.

### Integration Tests
- `ShellRuntime` against a real bash with the integration snippet: `pwd`, `cd /tmp`, `false` assert `cwd_changed` and exit codes 0 then 1.
- Alt-screen: a script emitting `ESC[?1049h`/`l` asserts the pane renders the alternate buffer, then restores.
- Focus and interrupt: assert `exitOnCtrlC` is false; shell-focused Ctrl+C forwards `0x03` and the app survives; agent-focused Ctrl+C tears down.
- End-to-end hand-off: run commands, `Ctrl+T`, assert the "Shell context" section pre-fills; drop one command with `Space`; confirm; assert the target prompt contains cwd and the surviving commands, redaction applied.

## Development Sequencing

### Build Order
1. Shell domain types, `shellReducer`, `shell` slice on `AppState`, and selectors. No dependencies (pure core + store).
2. `ShellRuntime` over `Bun.Terminal` + `@xterm/headless`: spawn a shell, feed bytes, expose the buffer. Depends on step 1 for the event types it emits. Treat as a de-risking spike before proceeding.
3. OSC 133 / OSC 7 parsing and the bash/zsh integration snippets, emitting `command_*` and `cwd_changed` events. Depends on step 2.
4. `ShellPane` render bridge: paint the active buffer into OpenTUI, frame-coalesced. Depends on step 2.
5. Pane-focus union, `toggle-shell` chord, key-to-VT input forwarding, `exitOnCtrlC: false`, and Ctrl+C routing. Depends on step 1 (focus state) and step 4 (a pane to focus).
6. In-pane alt-screen handling: switch to the alternate buffer and optionally expand the pane to full height. Depends on steps 4 and 5.
7. Hand-off snapshot: `HandoffBundle.shell`, assembler populate-and-redact, `composeHandoffBlocks` shell block, `HandoffEdits.excludedCommands`. Depends on step 1 (snapshot type) and step 3 (trustworthy records).
8. `HandoffPreview` "Shell context" curation section. Depends on step 7.
9. Discovery (status-strip hint + F1 entry), config block, and telemetry events. Depends on step 5 (chord exists) and step 7 (attach action exists).
10. Controller ownership and disposal wiring plus end-to-end integration tests. Depends on all prior steps.

### Technical Dependencies
- Add `@xterm/headless` as a dependency.
- Bun >= 1.3.5 for `Bun.Terminal` (1.3.13 present).
- POSIX platform (macOS/Linux); Windows is out of scope.

## Monitoring and Observability

Reuse the content-free, opt-in recorder. New event types on `TelemetryEventType`: `shell_activated` (shell ran at least one command in a session), `shell_snapshot_attached` (a hand-off carried a shell snapshot), `external_run` (the in-cockpit "run externally" affordance was used). All carry only type, timestamp, anonymous `sessionRef`, and optional coarse buckets, never command text. The existing `reexplanation_detected` metric now doubles as the moat signal, comparing hand-offs with and without an attached snapshot.

## Technical Considerations

### Key Decisions
- **PTY via `Bun.Terminal`, runtime mirrors `AgentConnection`** (ADR-003): first-party, stack-consistent, reuses the disposal and frame-scheduling patterns. Rejected `node-pty` (native addon, Windows-only benefit).
- **`@xterm/headless` for VT emulation** (ADR-003): mature, portable, no native build. Rejected `ghostty-opentui` (young native dependency) and a hand-rolled SGR parser (fails on cursor-addressed output).
- **OSC 133 + OSC 7 shell integration** (ADR-004): the only reliable source of exit codes and true cwd. Rejected heuristic prompt parsing and raw-scrollback-only (both ship unreliable state).
- **In-pane alt-screen emulation** (ADR-005): keeps Kitten chrome, no suspend/restore. Rejected full-window raw passthrough as the primary path (kept as a fallback). Focus is a discriminated pane union, not an `isShell` boolean; Ctrl+C rides the PTY line discipline.

### Known Risks
- **`@xterm/headless` to OpenTUI bridge fidelity** for full-screen cursor apps and resize is the highest risk. Mitigation: the step 2 spike validates it before dependent work; the full-window passthrough (ADR-005 alternative) remains a fallback.
- **Input-encoding gaps** (a key that encodes wrong breaks an app). Mitigation: table-driven encoder with fixtures for the common keys.
- **Per-shell OSC integration** conflicts with exotic prompts. Mitigation: additive hooks; detect and skip an existing integration; degrade to raw scrollback.
- **Render throughput** under output floods. Mitigation: frame coalescing, bounded ring, visible-window draw.
- **Global keymap stands down while shell-focused** is a behavior change. Mitigation: one reserved toggle chord always leaves the shell; documented in F1.
- **PRD reconciliation**: this pulls the PRD's Phase 2 in-pane rendering into the MVP (ADR-005). The PRD Phased Rollout should be updated to match.

## Architecture Decision Records

- [ADR-001: V1 Integrated Shell Is a Real PTY That Feeds the Hand-off](adrs/adr-001.md) - Real shell plus a curated hand-off snapshot; defer the shared substrate.
- [ADR-002: Ship the Full Cockpit Shell in One Release, With Interactive-App Takeover in the MVP](adrs/adr-002.md) - Approach A; interactive apps in the MVP.
- [ADR-003: Shell Runtime and Rendering Architecture](adrs/adr-003.md) - `Bun.Terminal` PTY, imperative runtime, pure `shell` slice, `@xterm/headless` bridged to OpenTUI.
- [ADR-004: Trustworthy Shell State via OSC 133 + OSC 7 Shell Integration](adrs/adr-004.md) - Reliable command boundaries, exit codes, and cwd.
- [ADR-005: In-Pane Interactive Apps, Pane Focus, and Ctrl+C Routing](adrs/adr-005.md) - In-pane alt-screen emulation, pane-focus union, Ctrl+C via the PTY line discipline.
