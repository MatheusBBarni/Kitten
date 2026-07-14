# Compozy Tasks Report

Generated: 2026-07-14

Status of every PRD task packet under `.compozy/`. Completion is judged by the canonical
`status:` field on each `task_NN.md` (cross-checked against the `_tasks.md` index). A feature is
archived to `.compozy/tasks_done/` only when all of its tasks are `completed`.

> Note: un-ticked `- [ ]` lines inside archived task files are embedded test/verification
> checklists and `Deferred to task_NN` / `Not applicable` notes, not open work — the
> authoritative completion signal is the per-task `status:` field.

## Summary

| | Features | Task files |
| --- | ---: | --- |
| Remaining (`.compozy/tasks/`) | 0 | 0 pending + 0 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 21 | 191 completed |

- **Moved this run:** 4 features (32 completed tasks).

## Remaining — `.compozy/tasks/`

No task packets remain. All active packets were classified DONE by the authoritative task-frontmatter scan.

## Moved to `.compozy/tasks_done/` this run

### `cursor-integration` — Cursor Integration

All 8 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 8. The unchecked-item count is 11.

| # | Title |
| ---: | --- |
| 01 | Add Cursor provider identity and runtime-profile config |
| 02 | Add Cursor readiness preflight and recovery messages |
| 03 | Authenticate certified Cursor profiles at the ACP boundary |
| 04 | Extend runtime orchestration and content-free telemetry for Cursor |
| 05 | Preserve fail-closed clarification and persistence behavior |
| 06 | Render Cursor through shared provider metadata |
| 07 | Add Cursor onboarding, docs, and reviewed-handoff regression coverage |
| 08 | Add the opt-in Cursor contract and certify the production profile |

### `default-models-per-provider` — Default Models per Provider

All 8 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 8. The unchecked-item count is 21. Its PRD has no H1, so this title uses the packet/task-list title.

| # | Title |
| ---: | --- |
| 01 | Add transitional provider-default config and core result contract |
| 02 | Migrate the first typed-fixture group to the new config shape |
| 03 | Complete fixture migration and make provider defaults required |
| 04 | Expose the narrow per-session default-result selector |
| 05 | Add controller-owned default application and content-free outcome telemetry |
| 06 | Bridge valid config reloads without live-session mutation |
| 07 | Apply defaults after explicit /model selection and render picker feedback |
| 08 | Render confirmed default outcomes in the status strip |

### `multi-language-syntax-highlighting` — Product Requirements Document: Multi-Language Syntax Highlighting

All 9 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 9. The unchecked-item count is 30.

| # | Title |
| ---: | --- |
| 01 | Create parser manifest foundation and Markdown override assets |
| 02 | Add Rust and Go grammar capabilities |
| 03 | Add OCaml and ReScript grammar capabilities |
| 04 | Add JSON and Bash grammar capabilities |
| 05 | Add Python grammar capability |
| 06 | Register syntax capabilities at boot and render entry points |
| 07 | Add content-free diagnostics and safe fallback contracts |
| 08 | Prove the support matrix in self-check and compiled artifacts |
| 09 | Publish the supported-label contract |

### `statusline-customization` — PRD: Conversational Statusline Customization (`/statusline`)

All 7 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 7. The unchecked-item count is 0.

| # | Title |
| ---: | --- |
| 01 | Add Pure Statusline Layout Contract and Renderer |
| 02 | Add Strict Statusline Config and Symlink-Safe Persistence |
| 03 | Add Reactive Statusline Preference and Modal State |
| 04 | Wire Statusline Confirmation and External Reload Lifecycle |
| 05 | Add Strict Focused-Agent Proposal Orchestration |
| 06 | Build the Keyboard-First Statusline Command and Modal Workflow |
| 07 | Render Saved Custom Layouts While Retaining the Legacy Footer |

## Previously archived (already in `.compozy/tasks_done/`)

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
| `npm-and-github-release` | NPM and GitHub Release - PRD | 8/8 |
| `prompt-history-navigation` | Prompt History Navigation | 4/4 |
| `session-resume` | PRD: Resumable Cross-Agent Sessions | 13/13 |
| `session-tabs` | Product Requirements Document: Session Tabs | 12/12 |
| `settings-modal` | Settings Modal - PRD | 10/10 |
| `slash-command-menu` | PRD: Slash-Command Menu (`/`) | 7/7 |
| `streaming-markdown-rendering` | PRD: Elevated Markdown - The Trustworthy Hand-off Review Console | 6/6 |
| `unified-mcp-config` | PRD: Unified MCP Configuration for Kitten | 9/9 |

## Index drift

The scanner observed status-index drift in these archived packets. This run did not alter `_tasks.md` data; per-task frontmatter remains authoritative.

| Feature | `_tasks.md` completed | Task frontmatter completed | Unchecked items |
| --- | ---: | ---: | ---: |
| `agent-usage-gauge` | 0 | 7 | 1 |
| `clarification-question-picker` | 0 | 12 | 0 |
| `claude-code-style-tui` | 0 | 11 | 89 |
| `cursor-integration` | 0 | 8 | 11 |
| `default-models-per-provider` | 0 | 8 | 21 |
| `file-selector-at` | 0 | 6 | 11 |
| `integrated-shell` | 4 | 14 | 105 |
| `kitten-showcase-site` | 0 | 8 | 16 |
| `model-effort-selector` | 6 | 9 | 6 |
| `multi-language-syntax-highlighting` | 0 | 9 | 30 |
| `npm-and-github-release` | 1 | 8 | 2 |
| `prompt-history-navigation` | 0 | 4 | 0 |
| `session-resume` | 0 | 13 | 143 |
| `session-tabs` | 0 | 12 | 13 |
| `settings-modal` | 0 | 10 | 7 |
| `slash-command-menu` | 0 | 7 | 10 |
| `statusline-customization` | 0 | 7 | 0 |
| `streaming-markdown-rendering` | 0 | 6 | 58 |
| `unified-mcp-config` | 0 | 9 | 43 |

`kitten-agent-tui` and `multi-provider-agent-sessions` have matching status indexes; their unchecked-item counts are 5 and 27, respectively.
