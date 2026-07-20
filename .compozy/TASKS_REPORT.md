# Compozy Tasks Report

Generated: 2026-07-20

Status of every PRD task packet under `.compozy/`. Completion is judged by the canonical
`status:` field on each `task_NN.md` (cross-checked against the `_tasks.md` index). A feature is
archived to `.compozy/tasks_done/` only when **all** of its tasks are `completed`.

> Note: un-ticked `- [ ]` lines inside archived task files are embedded test/verification
> checklists and `Deferred to task_NN` / `Not applicable` notes, not open work — the
> authoritative completion signal is the per-task `status:` field.

## Summary

| | Features | Task files |
|---|---:|---:|
| Remaining (`.compozy/tasks/`) | 0 | 0 pending + 0 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 36 | 296 completed |

- **Moved this run:** 6 features (46 tasks).

## Moved to `.compozy/tasks_done/` this run

### PRD: Reliable Concurrent MCP Calls for Supervised Work

All 5 tasks completed. The packet has 12 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Add targeted clarification cancellation and bridge telemetry |
| 02 | Admit concurrent authenticated MCP sockets per route |
| 03 | Model closed MCP failure state in the core |
| 04 | Classify bundled MCP failures at the ACP boundary |
| 05 | Render truthful concurrent MCP tool outcomes |

### Context Packs

All 15 tasks completed. The packet has 11 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Core Context Pack lifecycle and deterministic assembly |
| 02 | Store-owned Context Pack slice and selectors |
| 03 | Strict Context Pack persistence |
| 04 | Closed explore-v2 capability and Recipient Profile evidence |
| 05 | Bounded workspace materialization and source fences |
| 06 | Generation-bound Context Pack bridge |
| 07 | Controller-owned Context Build lifecycle |
| 08 | Review, sealing, and fail-closed Send Here |
| 09 | Immutable sealed-pack handoff composition |
| 10 | Confirmed Context Pack Markdown export |
| 11 | /context workspace and review UI |
| 12 | Context Pack File Explorer membership |
| 13 | Context Pack attention cues |
| 14 | Content-free Context Pack telemetry |
| 15 | Explore-v2 real-adapter certification |

### PRD: Cursor ACP Readiness and Truthful Model Controls

All 7 tasks completed. The packet has 51 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Preserve exact Cursor profile and readiness taxonomy |
| 02 | Add closed ACP live-config contract evidence |
| 03 | Add targeted unavailable-Cursor recheck |
| 04 | Render readiness-first Cursor model controls |
| 05 | Align local-only Cursor docs and telemetry guardrails |
| 06 | Review native evidence and add the exact Cursor profile |
| 07 | Project bounded Cursor recovery state |

### Harness Capability Composition

All 4 tasks completed. The packet has 44 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Core capability-composition contract |
| 02 | Fresh-generation controller composition |
| 03 | Envelope-only adapter bridge guidance |
| 04 | Content-free composition telemetry |

### Kitten Orchestrator

All 6 tasks completed. The packet has 67 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Establish Private Workspace and Cockpit Package Boundary |
| 02 | Relocate Cockpit Runtime Launcher and Build Tooling |
| 03 | Relocate Cockpit Contract Suite and Preserve App Local CWD |
| 04 | Delegate Root Development Commands and CI to Cockpit |
| 05 | Bridge Root Release Orchestration to Cockpit Artifacts |
| 06 | Preserve Root Installer and Documentation Contract |

### PRD: Session-Scoped File Explorer

All 9 tasks completed. The packet has 78 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Store Explorer State, Transitions, and Narrow Selectors |
| 02 | Containment-Safe Lazy Workspace Tree Source |
| 03 | Direct-Argv External Editor Launcher |
| 04 | Strict Editor Preference Config and Atomic Persistence |
| 05 | Session-Addressed Explorer Orchestration and Production Injection |
| 06 | Apply Saved and Watched Editor Preference at Runtime |
| 07 | Explorer Command Registry, Keyboard Tree, and Responsive Presentation |
| 08 | Settings Editor Draft and Explicit Save/Cancel UX |
| 09 | Content-Free Explorer Telemetry and Cross-Boundary Proof |

## Previously archived (already in `.compozy/tasks_done/`)

| Feature | Title | Tasks |
|---|---|---:|
| `agent-role-profiles` | Agent Role Profiles | 6/6 |
| `agent-usage-gauge` | PRD: Agent Usage Gauge | 7/7 |
| `ask-user-mcp-bridge` | PRD: Provider-Independent `ask_user` MCP Bridge | 7/7 |
| `clarification-question-picker` | Product Requirements Document: Clarification Question Picker | 12/12 |
| `claude-code-style-tui` | PRD: Claude Code-Style TUI Reskin | 11/11 |
| `cursor-integration` | Cursor Integration | 8/8 |
| `default-models-per-provider` | Default Models per Provider Task List | 8/8 |
| `file-selector-at` | Product Requirements Document: @ File Selector | 6/6 |
| `harness-delivery` | Product Requirements Document: Harness Delivery for Fresh Conversations | 5/5 |
| `harness-prompt-contract` | PRD: Versioned Kitten Harness Prompt Contract | 1/1 |
| `host-owned-mcp-control` | PRD: Host-Owned MCP Child Control | 7/7 |
| `integrated-shell` | PRD: Integrated Shell | 14/14 |
| `kitten-agent-tui` | PRD: Kitten - Cross-Agent Hand-off Cockpit | 14/14 |
| `kitten-showcase-site` | Product Requirements Document: Kitten Showcase Site | 8/8 |
| `managed-child-worktrees` | PRD: Managed Child Worktrees | 9/9 |
| `mid-turn-steering` | Product Requirements Document: Mid-Turn Steering | 6/6 |
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
| `windowed-transcript-live-tail` | Windowed Transcript Live Tail | 10/10 |

## Index drift observations

The authoritative per-task frontmatter marks every archived task complete. The archival scan found
`indexDrift(0)` for each packet moved this run (`concurrent-mcp-calls`, `context-packs`,
`cursor-acp-readiness`, `harness-capability-composition`, `kitten-orchestrator`, and
`session-file-explorer`); their `_tasks.md` indexes were therefore not used to decide completion.
