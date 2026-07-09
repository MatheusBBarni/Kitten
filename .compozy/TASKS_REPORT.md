# Compozy Tasks Report

Generated: 2026-07-09

Status of every PRD task packet under `.compozy/`.
Completion is judged by the canonical `status:` field on each `task_NN.md`, cross-checked against the `_tasks.md` index.
A feature is archived to `.compozy/tasks_done/` only when all of its tasks are `completed`.

> Note: un-ticked `- [ ]` lines inside archived task files are embedded test/verification checklists and `Deferred to task_NN` / `Not applicable` notes, not open work.
> The authoritative completion signal is the per-task `status:` field.

## Summary

| | Features | Task files |
|---|---|---|
| Remaining (`.compozy/tasks/`) | 6 | 14 pending + 4 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 1 | 14 completed |

- **Moved this run:** 1 feature (14 tasks).

## Remaining - `.compozy/tasks/`

### integrated-shell - Integrated Shell

Mid-decomposition during this run: the `_tasks.md` index lists 14 planned tasks, but only `task_01`-`task_05` exist on disk so far (all `pending`), and the folder grew from 4 to 5 task files while the scan was running.
The table below reflects the planned index; rows 06-14 have no `task_NN.md` file yet.

| # | Title | Status | Dependencies |
|---|-------|--------|--------------|
| 01 | Shell domain types and reducer | pending | — |
| 02 | Shell store slice, pane focus, and selectors | pending | task_01 |
| 03 | ShellRuntime over Bun.Terminal and @xterm/headless | pending | task_01 |
| 04 | Shell integration: OSC 133/OSC 7 command and cwd events | pending | task_03 |
| 05 | Controller ownership and event wiring for the shell | pending | task_02, task_03 |
| 06 | Shell configuration block | planned (no file) | task_01, task_03 |
| 07 | Key-to-VT input encoder | planned (no file) | — |
| 08 | ShellPane render bridge | planned (no file) | task_02, task_05 |
| 09 | Pane focus, toggle chord, input forwarding, and Ctrl+C routing | planned (no file) | task_02, task_07, task_08, task_11 |
| 10 | In-pane interactive application support | planned (no file) | task_08, task_09 |
| 11 | Telemetry recorder surface for shell events | planned (no file) | task_01 |
| 12 | Hand-off shell snapshot assembly | planned (no file) | task_01, task_04, task_05 |
| 13 | Hand-off preview Shell context section | planned (no file) | task_11, task_12 |
| 14 | Discovery affordances and run-externally action | planned (no file) | task_09, task_11, task_13 |

### model-effort-selector - Kitten: In-App Model & Reasoning-Effort Selector

9 tasks, all `pending`.

| # | Title | Status | Dependencies |
|---|-------|--------|--------------|
| 01 | Domain config-option channel and reducer | pending | — |
| 02 | ACP translation of config-option updates | pending | task_01 |
| 03 | Adapter live setSessionConfigOption and capture | pending | task_01, task_02 |
| 04 | Store slot, selectors, and category allowlist | pending | task_01 |
| 05 | Controller action and session-start seeding | pending | task_03, task_04 |
| 06 | ModelSelect overlay, keymap, and mid-switch warning | pending | task_04, task_05 |
| 07 | Status strip model and effort display | pending | task_04 |
| 08 | Effort-tagged hand-off | pending | task_03, task_05, task_06 |
| 09 | Switch telemetry and kept-change heuristic | pending | task_04, task_05, task_08 |

### Early-stage (PRD/idea only, no task files)

These need `cy-create-techspec` and/or `cy-create-tasks` before execution.

| Feature | Title | Artifacts present | Next step |
|---|---|---|---|
| multi-provider-agent-sessions | Kitten Multi-Session Fleet | `_idea.md`, `_prd.md`, `_techspec.md`, `adrs/` | `cy-create-tasks` |
| session-resume | Resumable Cross-Agent Sessions | `_idea.md`, `_prd.md`, `adrs/` | `cy-create-techspec` then `cy-create-tasks` |
| settings-modal | Settings Modal | `_idea.md`, `_prd.md`, `_techspec.md`, `adrs/` | `cy-create-tasks` |
| streaming-markdown-rendering | Elevated Markdown: The Trustworthy Hand-off Review Console | `_idea.md`, `_prd.md`, `_techspec.md`, `adrs/` | `cy-create-tasks` |

## Moved to `.compozy/tasks_done/` this run

### kitten-agent-tui - Kitten: Cross-Agent Hand-off Cockpit

All 14 tasks completed.

| # | Title |
|---|-------|
| 01 | Project scaffold and tooling |
| 02 | Domain core types and session reducer |
| 03 | Agent adapter layer and ACP translation |
| 04 | Config loading and agent readiness |
| 05 | Reactive app store |
| 06 | Deterministic hand-off bundle assembler and secret redactor |
| 07 | Session controller and orchestration |
| 08 | UI shell, cockpit, and status strip |
| 09 | Conversation view |
| 10 | Prompt editor and send flow |
| 11 | Approval prompt overlay |
| 12 | Hand-off and hand-back flow |
| 13 | Telemetry recorder and heuristics |
| 14 | First-run flow and packaging |
