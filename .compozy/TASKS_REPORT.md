# Compozy Tasks Report

Generated: 2026-07-16

Status of every PRD task packet under `.compozy/`. Completion is judged by the canonical
`status:` field on each `task_NN.md` (cross-checked against the `_tasks.md` index). A feature is
archived to `.compozy/tasks_done/` only when **all** of its tasks are `completed`.

> Note: un-ticked `- [ ]` lines inside archived task files are embedded test/verification
> checklists and `Deferred to task_NN` / `Not applicable` notes, not open work — the
> authoritative completion signal is the per-task `status:` field.

## Summary

| | Features | Task files |
|---|---:|---:|
| Remaining (`.compozy/tasks/`) | 2 | 0 pending + 2 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 30 | 250 completed |

- **Moved this run:** 5 features (38 tasks).

## Remaining — `.compozy/tasks/`

Both remaining folders are EARLY-STAGE according to the canonical scan: they contain only an
empty `adrs/` directory and have no `_idea.md`, `_prd.md`, or `task_NN.md` files. They need
`cy-create-techspec` / `cy-create-tasks` before execution.

| Feature | Status | Present artifacts |
|---|---|---|
| `keyboard-shortcuts` | EARLY-STAGE | `adrs/` only; no task files |
| `multi-agent-orchestration` | EARLY-STAGE | `adrs/` only; no task files |

## Moved to `.compozy/tasks_done/` this run

### Agent Role Profiles

All 6 tasks completed. The packet has 10 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Add the closed explore policy and immutable child snapshot contract |
| 02 | Reserve and release explore capacity atomically in delegation state |
| 03 | Add attested fail-closed explore child launch and MCP isolation |
| 04 | Add explore availability and typed denial handling to the delegation dialog |
| 05 | Render active explore policy in session and tab presentation |
| 06 | Add content-free explore telemetry and cross-layer safety hardening |

### PRD: Host-Owned MCP Child Control

All 7 tasks completed. The packet has 10 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Compose the bundled Kitten MCP child server |
| 02 | Define the strict agent_run MCP tool contract |
| 03 | Generalize the authenticated Kitten MCP bridge |
| 04 | Make delegated-session registration selection-neutral |
| 05 | Implement route-authorized batch start and poll |
| 06 | Wire agent_run lifecycle composition and end-to-end coverage |
| 07 | Record content-free agent_run telemetry |

### PRD: Managed Child Worktrees

All 9 tasks completed. The packet has 41 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Add protocol-free managed-worktree binding state |
| 02 | Add memoized managed-worktree review presentation |
| 03 | Build verified managed-worktree provisioner |
| 04 | Reconcile bindings and safely clean retained worktrees |
| 05 | Make delegated child launch transactional |
| 06 | Persist V4 bindings and reconcile restored worktrees |
| 07 | Disclose managed launch semantics and tab identity |
| 08 | Add terminal worktree review and cleanup routing |
| 09 | Emit content-free managed-worktree lifecycle telemetry |

### Product Requirements Document: Mid-Turn Steering

All 6 tasks completed. The packet has 25 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Core Steering Lifecycle |
| 02 | Steering Store Projection and Selectors |
| 03 | Fail-Closed Capability and Adapter Guard |
| 04 | Privacy-Safe Steering Observability |
| 05 | Controller Steering Orchestration |
| 06 | Composer Steering and End-to-End Behavior |

### Windowed Transcript Live Tail

All 10 tasks completed. The packet has 113 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Build the Pure Transcript Projection |
| 02 | Add Per-Session Presentation State and Selectors |
| 03 | Add the Strict Default-Off Configuration Contract |
| 04 | Migrate Controller and Boot Config Fixtures |
| 05 | Migrate UI Config Fixtures |
| 06 | Migrate Runtime Integration Config Fixtures |
| 07 | Migrate Session Shell and Telemetry Config Fixtures |
| 08 | Render the Projected Conversation and Preserve Anchors |
| 09 | Register Canonical History Commands |
| 10 | Emit Content-Free Experiment Telemetry |

## Previously archived (already in `.compozy/tasks_done/`)

| Feature | Title | Tasks |
|---|---|---:|
| `agent-usage-gauge` | PRD: Agent Usage Gauge | 7/7 |
| `ask-user-mcp-bridge` | PRD: Provider-Independent `ask_user` MCP Bridge | 7/7 |
| `clarification-question-picker` | Product Requirements Document: Clarification Question Picker | 12/12 |
| `claude-code-style-tui` | PRD: Claude Code-Style TUI Reskin | 11/11 |
| `cursor-integration` | Cursor Integration | 8/8 |
| `default-models-per-provider` | Default Models per Provider Task List | 8/8 |
| `file-selector-at` | Product Requirements Document: @ File Selector | 6/6 |
| `harness-delivery` | Product Requirements Document: Harness Delivery for Fresh Conversations | 5/5 |
| `harness-prompt-contract` | PRD: Versioned Kitten Harness Prompt Contract | 1/1 |
| `integrated-shell` | PRD: Integrated Shell | 14/14 |
| `kitten-agent-tui` | PRD: Kitten - Cross-Agent Hand-off Cockpit | 14/14 |
| `kitten-showcase-site` | Product Requirements Document: Kitten Showcase Site | 8/8 |
| `model-effort-selector` | PRD: Kitten - In-App Model & Reasoning-Effort Selector | 9/9 |
| `multi-agent-orchestration-registry` | PRD: Multi-Agent Orchestration Registry | 8/8 |
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

## Index drift observations

The authoritative per-task frontmatter marks every archived task complete. The archival scan found
pre-existing `_tasks.md` index drift in `integrated-shell` (4 entries), `model-effort-selector`
(6 entries), and `npm-and-github-release` (1 entry); those packets remain correctly archived because
their per-task `status:` fields are complete. No moved packet had material index drift.
