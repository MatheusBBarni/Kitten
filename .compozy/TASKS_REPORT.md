# Compozy Tasks Report

Generated: 2026-07-12

Status of every PRD task packet under `.compozy/`. Completion is judged by the canonical
`status:` field on each `task_NN.md` (cross-checked against the `_tasks.md` index). A feature is
archived to `.compozy/tasks_done/` only when **all** of its tasks are `completed`.

> Note: un-ticked `- [ ]` lines inside task files are embedded test/verification checklists and
> `Deferred to task_NN` / `Not applicable` notes, not open work. The authoritative completion
> signal is the per-task `status:` field.

## Summary

| | Features | Task files |
|---|---:|---:|
| Remaining (`.compozy/tasks/`) | 7 | 31 pending + 3 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 8 | 86 completed |

- **Moved this run:** 7 features (72 tasks).
- Index drift was detected for `claude-code-style-tui` (index reports 0 completed),
  `integrated-shell` (4), `model-effort-selector` (6), `session-resume` (0), `settings-modal`
  (0), and `streaming-markdown-rendering` (0). The per-task `status:` fields were authoritative,
  so all six were moved because every task file was `completed`.

## Remaining — `.compozy/tasks/`

### agent-usage-gauge — Kitten - Agent Usage Gauge

7 tasks remain pending. The scan found 62 unchecked embedded checklist boxes.

| # | Title | Status | Dependencies |
|---|---|---|---|
| 01 | Usage domain event, state field, and reducer case | pending | — |
| 02 | Surface usage_update in ACP translation | pending | task_01 |
| 03 | Emission-validation debug log for usage | pending | task_02 |
| 04 | selectSessionHeadroom selector | pending | task_01 |
| 05 | formatHeadroom pure display helper | pending | — |
| 06 | Status-strip headroom segment | pending | task_04, task_05 |
| 07 | Handoff-preview target headroom line | pending | task_04, task_05 |

### npm-and-github-release — NPM and GitHub Release

8 tasks remain pending. The scan found 80 unchecked embedded checklist boxes.

| # | Title | Status | Dependencies |
|---|---|---|---|
| 01 | Self-describing version: version module, `--version`/`--help`, ACP clientInfo | pending | - |
| 02 | Honest install: installer slug fix, README rewrite, CI resolve-check | pending | - |
| 03 | release-please config and version-floor manifest | pending | - |
| 04 | PR-title Conventional-Commit lint workflow | pending | - |
| 05 | Consolidated release workflow: cut, native build matrix, Release assets | pending | task_03 |
| 06 | npm platform-package generator in scripts/build.ts | pending | - |
| 07 | Node launcher and package.json restructure | pending | task_06 |
| 08 | Atomic OIDC-provenance publish and post-publish npx smoke | pending | task_05, task_06, task_07 |

### slash-command-menu — Slash-Command Menu (`/`)

7 tasks remain pending. The scan found 70 unchecked embedded checklist boxes.

| # | Title | Status | Dependencies |
|---|---|---|---|
| 01 | Command domain slice: type, event, and reducer field | pending | - |
| 02 | Translate ACP available_commands_update in the adapter | pending | task_01 |
| 03 | selectSessionCommands selector | pending | task_01 |
| 04 | Menu navigation keymap and footer hint | pending | - |
| 05 | Extract runCockpitCommand dispatcher and thread onRunCommand | pending | - |
| 06 | SlashMenu presentational component | pending | - |
| 07 | PromptEditor menu integration | pending | task_03, task_04, task_05, task_06 |

### unified-mcp-config — Unified MCP Configuration for Kitten

9 tasks remain pending. The scan found 79 unchecked embedded checklist boxes.

| # | Title | Status | Dependencies |
|---|---|---|---|
| 01 | MCP config: domain type, schema, and normalization | pending | — |
| 02 | MCP provisioning resolver (env references + command resolution) | pending | task_01 |
| 03 | ACP MCP translator (domain to SDK McpServer) | pending | task_01 |
| 04 | Widen AgentConnection.newSession and update fakes | pending | task_01, task_03 |
| 05 | Controller: thread MCP list, resolve, and record readout | pending | task_02, task_04 |
| 06 | Readout surfaces: selfcheck and status strip | pending | task_02, task_05 |
| 07 | Redact MCP secrets in telemetry and logs | pending | task_05 |
| 08 | Adapter-honor smoke test and fixture MCP server | pending | task_04 |
| 09 | Setup documentation and example config | pending | task_01 |

### Early-stage (PRD/idea only, no task files)

These need `cy-create-techspec` and/or `cy-create-tasks` before execution.

| Feature | Title | Artifacts present | Next step |
|---|---|---|---|
| file-selector-at | file-selector-at | `adrs/` | `cy-create-techspec` then `cy-create-tasks` |
| kitten-showcase-site | Kitten Showcase Site | `_idea.md`, `_prd.md`, `adrs/` | `cy-create-techspec` then `cy-create-tasks` |
| session-tabs | Session Tabs | `_idea.md`, `adrs/` | `cy-create-techspec` then `cy-create-tasks` |

## Moved to `.compozy/tasks_done/` this run

### claude-code-style-tui — Claude Code-Style TUI Reskin

All 11 tasks completed. Embedded unchecked checklist boxes: 89. Index drift: `_tasks.md`
reported 0 completed.

| # | Title |
|---|---|
| 01 | Palette: warm accent and chrome color keys |
| 02 | First-run state module and welcomeBanner config field |
| 03 | WelcomeBanner component |
| 04 | Prompt chevron and spacing restyle |
| 05 | Transient boot-banner render root |
| 06 | Idle-screen welcome banner |
| 07 | Git branch reader utility |
| 08 | Status-bar slot contract |
| 09 | Branch event, reducer, and refresh wiring |
| 10 | Honest hand-off result |
| 11 | Dual-agent StatusBar rebuild |

### integrated-shell — Integrated Shell

All 14 tasks completed. Embedded unchecked checklist boxes: 105. Index drift: `_tasks.md`
reported 4 completed.

| # | Title |
|---|---|
| 01 | Shell domain types and reducer |
| 02 | Shell store slice, pane focus, and selectors |
| 03 | ShellRuntime over Bun.Terminal and @xterm/headless |
| 04 | Shell integration: OSC 133/OSC 7 command and cwd events |
| 05 | Controller ownership and event wiring for the shell |
| 06 | Shell configuration block |
| 07 | Key-to-VT input encoder |
| 08 | ShellPane render bridge |
| 09 | Pane focus, toggle chord, input forwarding, and Ctrl+C routing |
| 10 | In-pane interactive application support |
| 11 | Telemetry recorder surface for shell events |
| 12 | Hand-off shell snapshot assembly |
| 13 | Hand-off preview Shell context section |
| 14 | Discovery affordances and run-externally action |

### model-effort-selector — Kitten: In-App Model & Reasoning-Effort Selector

All 9 tasks completed. Embedded unchecked checklist boxes: 6. Index drift: `_tasks.md`
reported 6 completed.

| # | Title |
|---|---|
| 01 | Domain config-option channel and reducer |
| 02 | ACP translation of config-option updates |
| 03 | Adapter live setSessionConfigOption and capture |
| 04 | Store slot, selectors, and category allowlist |
| 05 | Controller action and session-start seeding |
| 06 | ModelSelect overlay, keymap, and mid-switch warning |
| 07 | Status strip model and effort display |
| 08 | Effort-tagged hand-off |
| 09 | Switch telemetry and kept-change heuristic |

### multi-provider-agent-sessions — Kitten Multi-Session Fleet

All 9 tasks completed. Embedded unchecked checklist boxes: 27.

| # | Title |
|---|---|
| 01 | Session identity and store refactor |
| 02 | Fleet configuration model |
| 03 | Controller: one runtime per session with its own working directory |
| 04 | Extended session states and attention derivation |
| 05 | Ctrl+S sessions overview and jump-to-next |
| 06 | Session-addressed hand-off |
| 07 | Safe multi-session approvals labeling |
| 08 | Layered attention notifier |
| 09 | Attention and multi-session telemetry |

### session-resume — Resumable Cross-Agent Sessions

All 13 tasks completed. Embedded unchecked checklist boxes: 143. Index drift: `_tasks.md`
reported 0 completed.

| # | Title |
|---|---|
| 01 | persistenceEnabled config flag |
| 02 | Run store: record type and one-file-per-run I/O |
| 03 | Autosave writer wired at boot |
| 04 | ACP adapter loadSession and capability capture |
| 05 | Reload confirmation probe in selfcheck |
| 06 | Store restoration state and session-picker slot |
| 07 | Restore orchestration with per-agent degradation |
| 08 | Resume-last-run startup fast-path |
| 09 | Ctrl+R session picker overlay |
| 10 | Session delete from the picker |
| 11 | First-run persistence disclosure |
| 12 | Restoration degradation UX |
| 13 | Resume telemetry counters |

### settings-modal — Settings Modal

All 10 tasks completed. Embedded unchecked checklist boxes: 7. The `_tasks.md` index reported
0 completed.

| # | Title |
|---|---|
| 01 | Config schema and theme preference type |
| 02 | Reactive preferences slice and settings overlay slot |
| 03 | Theme palette registry, resolver, and live usePalette |
| 04 | Atomic delta config write-back |
| 05 | Config file-watcher with debounced reload |
| 06 | Settings keymap bindings |
| 07 | Content-free telemetry events for settings |
| 08 | Settings modal component |
| 09 | Persistence and watcher wiring at boot |
| 10 | Shell integration for the settings modal |

### streaming-markdown-rendering — Elevated Markdown: The Trustworthy Hand-off Review Console

All 6 tasks completed. Embedded unchecked checklist boxes: 58. The `_tasks.md` index reported
0 completed.

| # | Title |
|---|---|
| 01 | Register Markdown markup theme scopes |
| 02 | Shared Markdown renderer leaf and MessageView migration |
| 03 | Fix #807: guarantee Markdown and diff highlighting in the compiled binary |
| 04 | Render the hand-off summary as Markdown |
| 05 | File-row provenance links for the hand-off preview |
| 06 | Markdown rendering polish: tables, degradation, and clean copy |

## Previously archived (already in `.compozy/tasks_done/`)

| Feature | Title | Tasks (`completed/total`) |
|---|---|---:|
| kitten-agent-tui | Kitten: Cross-Agent Hand-off Cockpit | 14/14 |
