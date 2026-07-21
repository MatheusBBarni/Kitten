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
|---|---:|---|
| Remaining (`.compozy/tasks/`) | 1 | 6 pending + 0 not-yet-decomposed |
| Archived (`.compozy/tasks_done/`) | 40 | 315 completed |

- **Moved this run:** 5 features (25 tasks).

## Remaining — `.compozy/tasks/`

### Kitten Orchestrator

All six task files remain `pending`; the `_tasks.md` index matches their frontmatter.

| # | Title | Status |
|---:|---|---|
| 01 | Establish Private Workspace and Cockpit Package Boundary | pending |
| 02 | Relocate Cockpit Runtime Launcher and Build Tooling | pending |
| 03 | Relocate Cockpit Contract Suite and Preserve App Local CWD | pending |
| 04 | Delegate Root Development Commands and CI to Cockpit | pending |
| 05 | Bridge Root Release Orchestration to Cockpit Artifacts | pending |
| 06 | Preserve Root Installer and Documentation Contract | pending |

## Moved to `.compozy/tasks_done/` this run

### PRD: Channel-Preserving CLI Update

All 6 tasks completed. The packet has 11 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Define standalone update primitives |
| 02 | Persist installer-owned standalone provenance |
| 03 | Execute fail-closed standalone updates |
| 04 | Dispatch standalone updates before boot |
| 05 | Prove and update global npm installations |
| 06 | Align update help and public install recovery guidance |

### PRD: Hard Stop Continuation

All 6 tasks completed. The packet has 69 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Model the live post-interrupt continuation lifecycle |
| 02 | Attest safe continuation settlement at the adapter boundary |
| 03 | Persist only the settled-interrupted harness checkpoint |
| 04 | Coordinate confirmed hard-stop continuation dispatch |
| 05 | Present and recover continuation drafts in the composer |
| 06 | Record content-free hard-stop outcomes and prove privacy boundaries |

### Product Requirements Document: Statusline Context Headroom Field

All 4 tasks completed.

| # | Title |
|---:|---|
| 01 | Harden per-session headroom validity |
| 02 | Add CONTEXT to pure statusline and proposal contracts |
| 03 | Supply focused-session CONTEXT to the saved footer |
| 04 | Supply captured-session CONTEXT to preview and prove saved-layout parity |

### PRD: Statusline Item Colors

All 4 tasks completed.

| # | Title |
|---:|---|
| 01 | Extend Core Statusline Color Contract |
| 02 | Persist Canonical Statusline Colors Safely |
| 03 | Define Strict Colored Statusline Proposal Grammar |
| 04 | Render Shared Colored Statusline Segments |

### PRD: Accessible Source-Attributed Theme Family Catalog

All 5 tasks completed. The packet has 11 un-ticked embedded checklist lines.

| # | Title |
|---:|---|
| 01 | Create the protocol-free theme catalog |
| 02 | Canonicalize configuration, persistence, and telemetry compatibility |
| 03 | Expand palette rendering and accessibility coverage |
| 04 | Build the grouped scrollable Settings picker |
| 05 | Publish the catalog contract and release evidence |

## Previously archived (already in `.compozy/tasks_done/`)

| Feature | Title | Tasks |
|---|---|---:|
| `agent-role-profiles` | Agent Role Profiles | 6/6 |
| `agent-usage-gauge` | PRD: Agent Usage Gauge | 7/7 |
| `ask-user-mcp-bridge` | PRD: Provider-Independent `ask_user` MCP Bridge | 7/7 |
| `clarification-question-picker` | Product Requirements Document: Clarification Question Picker | 12/12 |
| `claude-code-style-tui` | PRD: Claude Code-Style TUI Reskin | 11/11 |
| `concurrent-mcp-calls` | PRD: Reliable Concurrent MCP Calls for Supervised Work | 5/5 |
| `context-packs` | Context Packs | 15/15 |
| `cursor-acp-readiness` | PRD: Cursor ACP Readiness and Truthful Model Controls | 7/7 |
| `cursor-integration` | Cursor Integration | 8/8 |
| `default-models-per-provider` | Default Models per Provider | 8/8 |
| `file-selector-at` | Product Requirements Document: @ File Selector | 6/6 |
| `harness-capability-composition` | Harness Capability Composition | 4/4 |
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
| `session-file-explorer` | PRD: Session-Scoped File Explorer | 9/9 |
| `session-resume` | PRD: Resumable Cross-Agent Sessions | 13/13 |
| `session-tabs` | Product Requirements Document: Session Tabs | 12/12 |
| `settings-modal` | Settings Modal | 10/10 |
| `slash-command-menu` | PRD: Slash-Command Menu (`/`) | 7/7 |
| `statusline-customization` | PRD: Conversational Statusline Customization (`/statusline`) | 7/7 |
| `streaming-markdown-rendering` | PRD: Elevated Markdown - The Trustworthy Hand-off Review Console | 6/6 |
| `unified-mcp-config` | PRD: Unified MCP Configuration for Kitten | 9/9 |
| `windowed-transcript-live-tail` | Windowed Transcript Live Tail | 10/10 |

## Index drift observations

The authoritative per-task frontmatter marks every packet moved this run complete. The archival
scan found `indexDrift(0)` for `channel-preserving-update`, `hard-stop-continuation`,
`statusline-context-field`, `statusline-item-colors`, and `theme-family-catalog`; their
`_tasks.md` indexes were not used to decide completion.
