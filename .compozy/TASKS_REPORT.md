# Compozy Tasks Report

Generated: 2026-07-13

Status is determined from `task_*.md` frontmatter. `_tasks.md` checkboxes and status tables are informational only; observed index drift is reported below and was not edited during this archival run.

## Summary

| | Features | Task files |
| --- | ---: | --- |
| Remaining (`.compozy/tasks/`) | 1 | 0 pending + 1 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 17 | 159 completed |

- Moved this run: 3 features (27 completed tasks).

## Remaining

### `statusline-customization` — early stage

No runnable `task_*.md` files are present, so this packet remains in `.compozy/tasks/`.

Available artifact:

- `adrs/adr-001.md`

Needs a PRD, TechSpec, and decomposed task files before it can be executed or archived.

## Moved This Run

### `npm-and-github-release` — NPM and GitHub Release - PRD

All 8 tasks completed. Index drift: `_tasks.md` records 1 completed task; task frontmatter records 8. The unchecked-item count is 2.

| # | Title |
| ---: | --- |
| 01 | Self-describing version module, `--version`/`--help`, and ACP `clientInfo` |
| 02 | Honest install: installer slug fix, README rewrite, CI resolve-check |
| 03 | release-please config and version-floor manifest |
| 04 | PR-title Conventional-Commit lint workflow |
| 05 | Consolidated release workflow: cut, native build matrix, Release assets |
| 06 | npm platform-package generator in `scripts/build.ts` |
| 07 | Node launcher and `package.json` restructure |
| 08 | Atomic OIDC-provenance publish and post-publish `npx` smoke |

### `session-tabs` — Product Requirements Document: Session Tabs

All 12 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 12. The unchecked-item count is 13.

| # | Title |
| ---: | --- |
| 01 | Model session-tab workspace state and reducer |
| 02 | Integrate workspace state into `AppStore` and selectors |
| 03 | Add V2 run persistence and V1 migration |
| 04 | Replace fixed controller plan with mutable conversation registry |
| 05 | Implement safe per-tab close and permission teardown |
| 06 | Expose tab actions and protect nullable-session consumers |
| 07 | Add capability-gated tab keyboard navigation |
| 08 | Render tab strip and empty workspace |
| 09 | Add rename and active-work close dialogs |
| 10 | Guard selected-only workspace controls |
| 11 | Upgrade Sessions overlay for overflow and background work |
| 12 | Harden boot/readiness and instrument the integrated flow |

### `slash-command-menu` — PRD: Slash-Command Menu (`/`)

All 7 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 7. The unchecked-item count is 10.

| # | Title |
| ---: | --- |
| 01 | Command domain slice: type, event, and reducer field |
| 02 | Translate ACP `available_commands_update` in the adapter |
| 03 | `selectSessionCommands` selector |
| 04 | Menu navigation keymap and footer hint |
| 05 | Extract `runCockpitCommand` dispatcher and thread `onRunCommand` |
| 06 | `SlashMenu` presentational component |
| 07 | `PromptEditor` menu integration |

## Previously Archived

| Feature | Title | Tasks (completed/total) |
| --- | --- | ---: |
| `agent-usage-gauge` | PRD: Agent Usage Gauge | 7/7 |
| `clarification-question-picker` | Product Requirements Document: Clarification Question Picker | 12/12 |
| `claude-code-style-tui` | PRD: Claude Code-Style TUI Reskin | 11/11 |
| `file-selector-at` | Product Requirements Document: @ File Selector | 6/6 |
| `integrated-shell` | PRD: Integrated Shell | 14/14 |
| `kitten-agent-tui` | PRD: Kitten - Cross-Agent Hand-off Cockpit | 14/14 |
| `kitten-showcase-site` | Product Requirements Document: Kitten Showcase Site | 8/8 |
| `model-effort-selector` | PRD: Kitten - In-App Model & Reasoning-Effort Selector | 9/9 |
| `multi-provider-agent-sessions` | PRD: Kitten Multi-Session Fleet | 9/9 |
| `prompt-history-navigation` | Prompt History Navigation | 4/4 |
| `session-resume` | PRD: Resumable Cross-Agent Sessions | 13/13 |
| `settings-modal` | Settings Modal - PRD | 10/10 |
| `streaming-markdown-rendering` | PRD: Elevated Markdown - The Trustworthy Hand-off Review Console | 6/6 |
| `unified-mcp-config` | PRD: Unified MCP Configuration for Kitten | 9/9 |

## Index Drift

The scanner observed status-index drift in these archived packets. This run does not alter `_tasks.md` data.

| Feature | `_tasks.md` completed | Task frontmatter completed | Unchecked items |
| --- | ---: | ---: | ---: |
| `agent-usage-gauge` | 0 | 7 | 1 |
| `clarification-question-picker` | 0 | 12 | 0 |
| `claude-code-style-tui` | 0 | 11 | 89 |
| `file-selector-at` | 0 | 6 | 11 |
| `integrated-shell` | 4 | 14 | 105 |
| `kitten-showcase-site` | 0 | 8 | 16 |
| `model-effort-selector` | 6 | 9 | 6 |
| `npm-and-github-release` | 1 | 8 | 2 |
| `prompt-history-navigation` | 0 | 4 | 0 |
| `session-resume` | 0 | 13 | 143 |
| `session-tabs` | 0 | 12 | 13 |
| `settings-modal` | 0 | 10 | 7 |
| `slash-command-menu` | 0 | 7 | 10 |
| `streaming-markdown-rendering` | 0 | 6 | 58 |
| `unified-mcp-config` | 0 | 9 | 43 |

`kitten-agent-tui` and `multi-provider-agent-sessions` have matching status indexes; their unchecked-item counts are 5 and 27, respectively.
