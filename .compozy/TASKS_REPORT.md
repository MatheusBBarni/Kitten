# Compozy Tasks Report

Generated: 2026-07-13

Status is determined from task-file frontmatter. `_tasks.md` checkboxes and status tables are informational only; observed index drift is reported below and was not edited during this archival run.

## Summary

| Category | Count | Detail |
| --- | ---: | --- |
| Remaining | 3 features | 3 pending + 0 not-yet-decomposed |
| Archived | 14 features | 132 completed tasks |

- Moved this run: 6 features (46 completed tasks).

## Remaining

### `npm-and-github-release` — NPM and GitHub Release - PRD

7/8 completed. Index drift: `_tasks.md` records 1 completed task; task frontmatter records 7. The unchecked-item count is 12.

| # | Title | Status | Dependencies |
| ---: | --- | --- | --- |
| 01 | Self-describing version module, `--version`/`--help`, and ACP `clientInfo` | completed | — |
| 02 | Honest install: installer slug fix, README rewrite, CI resolve-check | pending | — |
| 03 | release-please config and version-floor manifest | completed | — |
| 04 | PR-title Conventional-Commit lint workflow | completed | — |
| 05 | Consolidated release workflow: cut, native build matrix, Release assets | completed | task_03 |
| 06 | npm platform-package generator in `scripts/build.ts` | completed | — |
| 07 | Node launcher and `package.json` restructure | completed | task_06 |
| 08 | Atomic OIDC-provenance publish and post-publish `npx` smoke | completed | task_05, task_06, task_07 |

### `session-tabs` — Product Requirements Document: Session Tabs

11/12 completed. Index drift: `_tasks.md` has no completed-task status entries; task frontmatter records 11. The unchecked-item count is 13.

| # | Title | Status | Dependencies |
| ---: | --- | --- | --- |
| 01 | Model session-tab workspace state and reducer | completed | — |
| 02 | Integrate workspace state into `AppStore` and selectors | completed | task_01 |
| 03 | Add V2 run persistence and V1 migration | completed | task_01, task_02 |
| 04 | Replace fixed controller plan with mutable conversation registry | completed | task_02, task_03 |
| 05 | Implement safe per-tab close and permission teardown | completed | task_02, task_04 |
| 06 | Expose tab actions and protect nullable-session consumers | completed | task_02, task_05 |
| 07 | Add capability-gated tab keyboard navigation | completed | task_02, task_06 |
| 08 | Render tab strip and empty workspace | completed | task_02, task_06, task_07 |
| 09 | Add rename and active-work close dialogs | completed | task_02, task_05, task_06, task_08 |
| 10 | Guard selected-only workspace controls | completed | task_06, task_08 |
| 11 | Upgrade Sessions overlay for overflow and background work | completed | task_06, task_07, task_08 |
| 12 | Harden boot/readiness and instrument the integrated flow | pending | task_03 through task_11 |

### `slash-command-menu` — PRD: Slash-Command Menu (`/`)

6/7 completed. Index drift: `_tasks.md` records every task as pending; task frontmatter records 6 completed tasks. The unchecked-item count is 10.

| # | Title | Status | Dependencies |
| ---: | --- | --- | --- |
| 01 | Command domain slice: type, event, and reducer field | completed | — |
| 02 | Translate ACP `available_commands_update` in the adapter | completed | task_01 |
| 03 | `selectSessionCommands` selector | completed | task_01 |
| 04 | Menu navigation keymap and footer hint | completed | — |
| 05 | Extract `runCockpitCommand` dispatcher and thread `onRunCommand` | pending | — |
| 06 | `SlashMenu` presentational component | completed | — |
| 07 | `PromptEditor` menu integration | completed | task_03, task_04, task_05, task_06 |

## Moved This Run

### `agent-usage-gauge` — PRD: Agent Usage Gauge

All 7 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 7. The unchecked-item count is 1.

| # | Title |
| ---: | --- |
| 01 | Usage domain event, state field, and reducer case |
| 02 | Surface `usage_update` in ACP translation |
| 03 | Emission-validation debug log for usage |
| 04 | `selectSessionHeadroom` selector |
| 05 | `formatHeadroom` pure display helper |
| 06 | Status-strip headroom segment |
| 07 | Handoff-preview target headroom line |

### `clarification-question-picker` — Product Requirements Document: Clarification Question Picker

All 12 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 12. The unchecked-item count is 0.

| # | Title |
| ---: | --- |
| 01 | Add fail-closed ACP capability classification and contract gate |
| 02 | Add core clarification model and status compatibility |
| 03 | Complete clarification attention presentation and regression coverage |
| 04 | Map verified ACP elicitation into the adapter boundary |
| 05 | Replace the permission queue with a controller interaction coordinator |
| 06 | Project clarification interactions through actions, store, and selectors |
| 07 | Build the clarification dialog and keyboard workflow |
| 08 | Suspend approval and handoff modal handlers during clarification preemption |
| 09 | Suspend sessions, session-picker, and model-selector handlers during clarification preemption |
| 10 | Suspend settings modal handler during clarification preemption |
| 11 | Extend content-free clarification telemetry and notification coverage |
| 12 | Add end-to-end clarification lifecycle regression coverage |

### `file-selector-at` — Product Requirements Document: @ File Selector

All 6 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 6. The unchecked-item count is 11.

| # | Title |
| ---: | --- |
| 01 | Repository file discovery source and safety policy |
| 02 | Explicit-session discovery action and controller wiring |
| 03 | Opt-in file-selector telemetry through controller actions |
| 04 | Stateless file selector presentation and `@` help entry |
| 05 | Pure file-completion parsing, formatting, and edit tracking |
| 06 | `PromptEditor` async `@` selector integration and regressions |

### `kitten-showcase-site` — Product Requirements Document: Kitten Showcase Site

All 8 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 8. The unchecked-item count is 16.

| # | Title |
| ---: | --- |
| 01 | Create standalone Astro subproject scaffold |
| 02 | Add showcase config model as the source of truth for copy, claims, and links |
| 03 | Build core showcase landing page sections and single-page layout |
| 04 | Add accessible install copy action handling |
| 05 | Add live GitHub star count integration with resilient fallback |
| 06 | Add motion-safe media presentation, styling, and accessibility hardening |
| 07 | Add GitHub Pages workflow for site build and deployment |
| 08 | Add launch documentation and final validation checks in repository README |

### `prompt-history-navigation` — Prompt History Navigation

All 4 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 4. The unchecked-item count is 0.

| # | Title |
| ---: | --- |
| 01 | Add Pure Prompt-History Reducer |
| 02 | Integrate History into Session State and Selectors |
| 03 | Add Controller Recall Actions and Private Telemetry |
| 04 | Implement Composer Recall UX and Keyboard Help |

### `unified-mcp-config` — PRD: Unified MCP Configuration for Kitten

All 9 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 9. The unchecked-item count is 43.

| # | Title |
| ---: | --- |
| 01 | MCP config - domain type, schema, and normalization |
| 02 | MCP provisioning resolver - env references and command resolution |
| 03 | ACP MCP translator - domain to SDK McpServer |
| 04 | Widen `AgentConnection.newSession` and update fakes |
| 05 | Controller - thread MCP list, resolve, and record readout |
| 06 | Readout surfaces - selfcheck and status strip |
| 07 | Redact MCP secrets in telemetry and logs |
| 08 | Adapter-honor smoke test and fixture MCP server |
| 09 | Setup documentation and example config |

## Previously Archived

| Feature | Title | Tasks (completed/total) |
| --- | --- | ---: |
| `claude-code-style-tui` | PRD: Claude Code-Style TUI Reskin | 11/11 |
| `integrated-shell` | PRD: Integrated Shell | 14/14 |
| `kitten-agent-tui` | PRD: Kitten - Cross-Agent Hand-off Cockpit | 14/14 |
| `model-effort-selector` | PRD: Kitten - In-App Model & Reasoning-Effort Selector | 9/9 |
| `multi-provider-agent-sessions` | PRD: Kitten Multi-Session Fleet | 9/9 |
| `session-resume` | PRD: Resumable Cross-Agent Sessions | 13/13 |
| `settings-modal` | Settings Modal - PRD | 10/10 |
| `streaming-markdown-rendering` | PRD: Elevated Markdown - The Trustworthy Hand-off Review Console | 6/6 |
