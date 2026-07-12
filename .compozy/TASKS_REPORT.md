# Compozy Tasks Report

Generated: 2026-07-12

Status of every PRD task packet under `.compozy/`. Completion is judged by the canonical
`status:` field on each `task_NN.md` (cross-checked against the `_tasks.md` index). A feature is
archived to `.compozy/tasks_done/` only when **all** of its tasks are `completed`.

> Note: un-ticked `- [ ]` lines inside task files are embedded test/verification checklists and
> `Deferred to task_NN` / `Not applicable` notes, not open work — the authoritative completion
> signal is the per-task `status:` field.

## Summary

| | Features | Task files |
|---|---:|---:|
| Remaining (`.compozy/tasks/`) | 8 | 49 pending + 2 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 8 | 86 completed |

- **Moved this run:** 0 features (0 tasks).
- No index drift was detected.

## Remaining — `.compozy/tasks/`

### agent-usage-gauge — Agent Usage Gauge

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

### file-selector-at — @ File Selector

6 tasks remain pending. The scan found 74 unchecked embedded checklist boxes.

| # | Title | Status | Dependencies |
|---|---|---|---|
| 01 | Repository file discovery source and safety policy | pending | — |
| 02 | Explicit-session discovery action and controller wiring | pending | task_01 |
| 03 | Opt-in file-selector telemetry through controller actions | pending | task_02 |
| 04 | Stateless file selector presentation and @ help entry | pending | — |
| 05 | Pure file-completion parsing, formatting, and edit tracking | pending | — |
| 06 | PromptEditor async @ selector integration and regressions | pending | task_02, task_03, task_04, task_05 |

### npm-and-github-release — NPM and GitHub Release

8 tasks remain pending. The scan found 80 unchecked embedded checklist boxes.

| # | Title | Status | Dependencies |
|---|---|---|---|
| 01 | Self-describing version: version module, `--version`/`--help`, ACP clientInfo | pending | — |
| 02 | Honest install: installer slug fix, README rewrite, CI resolve-check | pending | — |
| 03 | release-please config and version-floor manifest | pending | — |
| 04 | PR-title Conventional-Commit lint workflow | pending | — |
| 05 | Consolidated release workflow: cut, native build matrix, Release assets | pending | task_03 |
| 06 | npm platform-package generator in scripts/build.ts | pending | — |
| 07 | Node launcher and package.json restructure | pending | task_06 |
| 08 | Atomic OIDC-provenance publish and post-publish npx smoke | pending | task_05, task_06, task_07 |

### session-tabs — Session Tabs

12 tasks remain pending. The scan found 142 unchecked embedded checklist boxes.

| # | Title | Status | Dependencies |
|---|---|---|---|
| 01 | Model session-tab workspace state and reducer | pending | — |
| 02 | Integrate workspace state into AppStore and selectors | pending | task_01 |
| 03 | Add V2 run persistence and V1 migration | pending | task_01, task_02 |
| 04 | Replace fixed controller plan with mutable conversation registry | pending | task_02, task_03 |
| 05 | Implement safe per-tab close and permission teardown | pending | task_02, task_04 |
| 06 | Expose tab actions and protect nullable-session consumers | pending | task_02, task_05 |
| 07 | Add capability-gated tab keyboard navigation | pending | task_02, task_06 |
| 08 | Render tab strip and empty workspace | pending | task_02, task_06, task_07 |
| 09 | Add rename and active-work close dialogs | pending | task_02, task_05, task_06, task_08 |
| 10 | Guard selected-only workspace controls | pending | task_06, task_08 |
| 11 | Upgrade Sessions overlay for overflow and background work | pending | task_06, task_07, task_08 |
| 12 | Harden boot/readiness and instrument the integrated flow | pending | task_03, task_04, task_05, task_06, task_07, task_08, task_09, task_10, task_11 |

### slash-command-menu — Slash-Command Menu (`/`)

7 tasks remain pending. The scan found 70 unchecked embedded checklist boxes.

| # | Title | Status | Dependencies |
|---|---|---|---|
| 01 | Command domain slice: type, event, and reducer field | pending | — |
| 02 | Translate ACP available_commands_update in the adapter | pending | task_01 |
| 03 | selectSessionCommands selector | pending | task_01 |
| 04 | Menu navigation keymap and footer hint | pending | — |
| 05 | Extract runCockpitCommand dispatcher and thread onRunCommand | pending | — |
| 06 | SlashMenu presentational component | pending | — |
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
| clarification-question-picker | Clarification Question Picker | `_prd.md`, `adrs/` | `cy-create-techspec` then `cy-create-tasks` |
| kitten-showcase-site | Kitten Showcase Site | `_idea.md`, `_prd.md`, `adrs/` | `cy-create-techspec` then `cy-create-tasks` |

## Moved to `.compozy/tasks_done/` this run

No folders moved. The scan found no source folder whose task files were all `status: completed`.

## Previously archived (already in `.compozy/tasks_done/`)

| Feature | Title | Tasks (`completed/total`) |
|---|---|---:|
| claude-code-style-tui | Claude Code-Style TUI Reskin | 11/11 |
| integrated-shell | Integrated Shell | 14/14 |
| kitten-agent-tui | Kitten: Cross-Agent Hand-off Cockpit | 14/14 |
| model-effort-selector | Kitten: In-App Model & Reasoning-Effort Selector | 9/9 |
| multi-provider-agent-sessions | Kitten Multi-Session Fleet | 9/9 |
| session-resume | Resumable Cross-Agent Sessions | 13/13 |
| settings-modal | Settings Modal | 10/10 |
| streaming-markdown-rendering | Elevated Markdown: The Trustworthy Hand-off Review Console | 6/6 |
