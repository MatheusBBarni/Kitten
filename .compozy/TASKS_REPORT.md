# Compozy Tasks Report

Generated: 2026-07-15

Status of every PRD task packet under `.compozy/`. Completion is judged by the canonical
`status:` field on each `task_NN.md` (cross-checked against the `_tasks.md` index). A feature is
archived to `.compozy/tasks_done/` only when **all** of its tasks are `completed`.

> Note: un-ticked `- [ ]` lines inside archived task files are embedded test/verification
> checklists and `Deferred to task_NN` / `Not applicable` notes, not open work — the
> authoritative completion signal is the per-task `status:` field.

## Summary

| | Features | Task files |
| --- | ---: | --- |
| Remaining (`.compozy/tasks/`) | 1 | 0 pending + 1 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 25 | 212 completed |

- **Moved this run:** 4 features (21 tasks).

## Remaining — `.compozy/tasks/`

- `multi-agent-orchestration` — **EARLY-STAGE**. The folder currently has no planning artifacts or task files. It needs `cy-create-techspec` / `cy-create-tasks` before execution.

## Moved to `.compozy/tasks_done/` this run

### `ask-user-mcp-bridge` — PRD: Provider-Independent `ask_user` MCP Bridge

All 7 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 7. The unchecked-item count is 74.

| # | Title |
| ---: | --- |
| 01 | Normalize clarification forms, outcomes, and ACP translation |
| 02 | Add fixed timeout configuration and content-free telemetry outcomes |
| 03 | Add coordinator request handles and exact timeout settlement |
| 04 | Build the session-bound authenticated local IPC bridge |
| 05 | Implement the same-binary stdio MCP child and bounded `ask_user` schema |
| 06 | Provision the bridge per session and prove end-to-end lifecycle behavior |
| 07 | Extend the clarification dialog for form metadata, custom answers, skip, and timeout |

### `harness-delivery` — Product Requirements Document: Harness Delivery for Fresh Conversations

All 5 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 5. The unchecked-item count is 62.

| # | Title |
| ---: | --- |
| 01 | Define Generation-Scoped Harness Delivery State |
| 02 | Add Certified Runtime Profiles and Adapter Envelope |
| 03 | Route First Prompts Through Controller-Owned Delivery |
| 04 | Persist Content-Free Delivery Checkpoints Across Restore |
| 05 | Add Degraded-Start Recovery UI Without Content Leakage |

### `harness-prompt-contract` — PRD: Versioned Kitten Harness Prompt Contract

All 1 task completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 1. The unchecked-item count is 16.

| # | Title |
| ---: | --- |
| 01 | Add deterministic V1 harness prompt renderer |

### `multi-agent-orchestration-registry` — PRD: Multi-Agent Orchestration Registry

All 8 tasks completed. Index drift: `_tasks.md` records 0 completed tasks; task frontmatter records 8. The unchecked-item count is 91.

| # | Title |
| ---: | --- |
| 01 | Add Pure Delegation State and Selectors |
| 02 | Integrate Delegation State into AppStore |
| 03 | Add Controller-Owned Delegated Child Launch |
| 04 | Harden Delegated Lifecycle and Parent Teardown |
| 05 | Build the Explicit Delegation Launch Dialog |
| 06 | Surface Delegated Children in Workspace Views |
| 07 | Add Delegated Parent Close Confirmation |
| 08 | Enforce Delegation Persistence and Telemetry Boundaries |

## Previously archived (already in `.compozy/tasks_done/`)

| Feature | Title | Tasks (completed/total) |
| --- | --- | ---: |
| `agent-usage-gauge` | PRD: Agent Usage Gauge | 7/7 |
| `clarification-question-picker` | Product Requirements Document: Clarification Question Picker | 12/12 |
| `claude-code-style-tui` | PRD: Claude Code-Style TUI Reskin | 11/11 |
| `cursor-integration` | Cursor Integration | 8/8 |
| `default-models-per-provider` | Default Models per Provider | 8/8 |
| `file-selector-at` | Product Requirements Document: @ File Selector | 6/6 |
| `integrated-shell` | PRD: Integrated Shell | 14/14 |
| `kitten-agent-tui` | PRD: Kitten - Cross-Agent Hand-off Cockpit | 14/14 |
| `kitten-showcase-site` | Product Requirements Document: Kitten Showcase Site | 8/8 |
| `model-effort-selector` | PRD: Kitten - In-App Model & Reasoning-Effort Selector | 9/9 |
| `multi-language-syntax-highlighting` | Product Requirements Document: Multi-Language Syntax Highlighting | 9/9 |
| `multi-provider-agent-sessions` | PRD: Kitten Multi-Session Fleet | 9/9 |
| `npm-and-github-release` | NPM and GitHub Release - PRD | 8/8 |
| `prompt-history-navigation` | Prompt History Navigation | 4/4 |
| `session-resume` | PRD: Resumable Cross-Agent Sessions | 13/13 |
| `session-tabs` | Product Requirements Document: Session Tabs | 12/12 |
| `settings-modal` | Settings Modal - PRD | 10/10 |
| `slash-command-menu` | PRD: Slash-Command Menu (`/`) | 7/7 |
| `statusline-customization` | PRD: Conversational Statusline Customization (`/statusline`) | 7/7 |
| `streaming-markdown-rendering` | PRD: Elevated Markdown - The Trustworthy Hand-off Review Console | 6/6 |
| `unified-mcp-config` | PRD: Unified MCP Configuration for Kitten | 9/9 |

## Index drift

The scanner observed status-index drift in these archived packets. This run did not alter `_tasks.md` data; per-task frontmatter remains authoritative.

| Feature | `_tasks.md` completed | Task frontmatter completed | Unchecked items |
| --- | ---: | ---: | ---: |
| `agent-usage-gauge` | 0 | 7 | 1 |
| `ask-user-mcp-bridge` | 0 | 7 | 74 |
| `clarification-question-picker` | 0 | 12 | 0 |
| `claude-code-style-tui` | 0 | 11 | 89 |
| `cursor-integration` | 0 | 8 | 11 |
| `default-models-per-provider` | 0 | 8 | 21 |
| `file-selector-at` | 0 | 6 | 11 |
| `harness-delivery` | 0 | 5 | 62 |
| `harness-prompt-contract` | 0 | 1 | 16 |
| `integrated-shell` | 4 | 14 | 105 |
| `kitten-showcase-site` | 0 | 8 | 16 |
| `model-effort-selector` | 6 | 9 | 6 |
| `multi-agent-orchestration-registry` | 0 | 8 | 91 |
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
