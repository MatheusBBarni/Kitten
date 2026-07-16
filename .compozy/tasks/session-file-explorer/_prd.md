# PRD: Session-Scoped File Explorer

## Overview

The Session-Scoped File Explorer keeps an active Kitten developer in the flow of a live agent conversation when they need to inspect or open a workspace file. It shows the focused session's Session Workspace, lets the developer navigate it with the keyboard, and opens a selected regular file in the developer's established external editor.

The primary user is a developer who works daily across multiple live Kitten sessions. The product value is continuity: the developer does not need to leave the cockpit, rediscover which workspace belongs to which agent session, or make Kitten compete with their editor. File navigation is familiar in established editors, and agent-oriented products expose file and directory exploration; Kitten differentiates by making that navigation explicitly session-aware. [VS Code navigation](https://code.visualstudio.com/docs/editing/editingevolved) [Cursor tools](https://docs.cursor.com/en/agent/tools)

This is a human-controlled feature. Developers report productivity gains from AI agents while continuing to report accuracy, security, and privacy concerns, so the explorer must preserve visible user intent, workspace boundaries, and content-free local measurement. [Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai)

## Goals

- Let an active-session developer inspect and open an eligible workspace file without abandoning the Kitten conversation.
- Make the focused session's workspace unmistakable, with independent explorer position for each active session.
- Provide a keyboard-first, discoverable navigation experience that is useful on normal and narrow terminals.
- Respect the developer's editor preference while preserving visible, understandable outcomes when opening fails or falls back.
- Validate recurring multi-session workflow value before expanding into broader workspace capabilities.

The MVP is successful when a defined opt-in beta of daily multi-session users shows repeat use: at least 60% use the explorer in three or more active sessions within 14 days. Reliability, privacy, and user-reported continuity are supporting release criteria, not substitutes for repeat use.

## User Stories

### Daily Multi-Session Developer

- As a developer working with several live agent sessions, I want the explorer to follow the session I focus so that I never confuse one agent's workspace with another.
- As a developer reviewing an agent's work, I want to browse and open a selected file without leaving Kitten so that I can preserve my conversational context.
- As a keyboard-first terminal user, I want predictable controls for revealing, navigating, refreshing, and leaving the explorer so that the feature feels like part of the cockpit rather than a separate mode.

### Developer With an Established Editor Workflow

- As a developer with a preferred editor, I want to choose the system default or save a custom editor preference so that Kitten fits the workflow I already use.
- As a developer opening a file, I want a concise result when the preferred editor cannot launch so that I know whether the fallback worked or what needs attention.

### Trust-Conscious Developer

- As a developer working in a repository with generated, hidden, or linked files, I want the explorer to show only eligible entries within the active workspace so that convenience does not expose unrelated files.
- As a privacy-conscious developer, I want optional local measurement to exclude file names, paths, editor details, and error text so that using the explorer does not create a file-activity record.

## Core Features

### P0: Focused-Session Workspace Navigation

The explorer shows the focused session's workspace and starts hidden on a new Kitten launch. It provides a lazy tree of directories and regular files, including normal hidden and ignored entries while excluding `.git`. Each active session retains its own expanded paths, selection, and scroll position during the current run; switching focus never mixes those positions.

### P0: Keyboard-First Explorer Experience

`Ctrl+B` and `/file-explorer` are equal entry points: either reveals and focuses the hidden explorer or hides the visible one. At readable widths, the explorer remains docked beside the conversation. At narrow widths, it temporarily occupies the main pane until the developer returns to the composer. Arrow keys select entries; Right or Enter expands a directory; Left collapses it; `R` refreshes; and `Escape` returns focus to the composer without hiding the docked sidebar.

### P0: Safe File Opening

The developer can open only a selected regular file. Directories support navigation only. The explorer keeps its visibility and focus while the open request runs, then reports a short success or actionable failure result. It displays only workspace entries that remain within the focused session boundary, including only valid contained links.

### P1: Editor Preference and Recovery

Settings offers an explicit Editor tab with System Default and Custom choices plus Save and Cancel. A Custom preference represents a validated external editor invocation with one selected-file placeholder. If a custom open attempt cannot start, Kitten tries the system default once and reports the final outcome. The saved choice applies to the next opening immediately and remains available after restart.

### P1: Privacy-Safe Product Learning

When a developer has opted in to local telemetry, Kitten records only coarse explorer-open, refresh, file-open, and fallback outcomes. It never records a path, filename, workspace identity, editor preference, editor arguments, error text, tree shape, or stable identifier. The beta combines those local aggregates with a short consented user check-in to measure repeat use and workflow continuity.

## User Experience

1. A developer starts Kitten and sees the familiar conversation-first cockpit; the explorer is hidden.
2. While reviewing an active agent session, the developer presses `Ctrl+B` or enters `/file-explorer`. The explorer reveals the workspace belonging to that focused session and takes navigation focus.
3. The developer expands directories, moves the selection with the keyboard, and refreshes only when they ask. On a narrow terminal, the same interaction uses the temporary full-pane presentation rather than an unreadable split.
4. The developer selects a regular file and opens it. Kitten stays visible and the explorer remains focused while the external editor request completes.
5. The developer receives a concise final result. If the chosen custom editor cannot start and the system-default fallback succeeds, that outcome is explicit; if neither works, the developer remains in the explorer with an actionable message.
6. When the developer focuses another session, the explorer immediately shows that session's workspace and restores only that session's current-run position. `Escape` always returns the developer to the composer.

Discoverability comes from the paired shortcut and slash command appearing with the existing help and command surfaces. The feature must remain fully usable by keyboard, communicate focus changes clearly, and avoid presenting the explorer as a modal that blocks established approval or clarification flows.

## High-Level Technical Constraints

- The explorer must always act on the focused session's workspace and must never expose entries outside that boundary, including through changed or linked paths.
- The browse experience includes eligible hidden and ignored entries but never exposes `.git`, broken links, or escaping links.
- Opening must remain user-initiated, asynchronous, and limited to regular files; Kitten never opens directories or embeds an editor.
- System-default and custom editor choices must use an explicit saved preference, never a shell command field or a flexible command template.
- The MVP supports Kitten's current macOS and Linux release matrix only.
- Product telemetry stays optional, local, content-free, and limited to allow-listed coarse outcomes.

## Non-Goals (Out of Scope)

- **Embedded editing or file preview** — Kitten opens the developer's established editor; it does not become an editor.
- **File creation or mutation** — The explorer does not create, rename, move, delete, save, or change permissions on files.
- **Workspace search, indexing, or watchers** — The MVP validates browse-and-open behavior before adding broader navigation infrastructure.
- **Git status decorations or repository filtering** — Git-specific views are separate user problems from Session Workspace navigation.
- **Multiple roots, remote workspaces, and Windows support** — The feature is intentionally limited to one focused Session Workspace on the existing supported platforms.
- **Context Pack curation** — Adding files to agent context is a later, separately validated workflow and must not weaken the navigation or review boundaries.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver focused-session workspace navigation, keyboard controls, docked and narrow presentations, user-initiated regular-file opening, saved editor preference, explicit fallback outcomes, and opt-in local aggregate measurement.
- Recruit a defined beta cohort of daily multi-session Kitten users.
- Proceed only when no user-trust or privacy blocker is found, launch-dispatch reliability reaches 95%, and at least 60% of the cohort uses the explorer in three or more active sessions within 14 days.

### Phase 2

- Improve discoverability and navigation polish only where beta feedback shows recurring friction.
- Consider carefully bounded enhancements that reduce repeated navigation effort, without adding an embedded editor, file mutations, or broad workspace ownership.
- Proceed only if repeat use remains stable after the MVP novelty period and at least 80% of surveyed beta participants rate the explorer as reducing context switching.

### Phase 3

- Evaluate an explicit, reviewable bridge from the explorer to Context Pack curation if it solves a demonstrated multi-session workflow need.
- Consider broader workspace capabilities only after separate product validation shows they improve Kitten's agent-session workflow more than they dilute it.

## Success Metrics

| Metric | Target | Decision Use |
| --- | --- | --- |
| Repeat multi-session use | At least 60% of the opt-in beta cohort uses the explorer in 3 or more active sessions within 14 days | Primary Phase 2 investment gate |
| Workflow continuity | At least 80% of surveyed beta participants rate the explorer 4 or 5 out of 5 for reducing context switching | Confirms the intended user value |
| Final launch-dispatch reliability | At least 95% of regular-file open attempts end in a successful final dispatch | Confirms the basic workflow is dependable enough to evaluate adoption |
| Fallback effectiveness | At least 90% of failed custom-editor attempts reach a successful system-default dispatch | Confirms the preference model recovers predictably |
| Privacy and boundary incidents | 0 confirmed instances of recorded content or exposure beyond the Session Workspace during beta | Required trust gate for continued rollout |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users view the explorer as a novelty rather than a workflow tool | Use repeat use across multiple active sessions—not first opens—as the Phase 2 gate. |
| Users expect Kitten to replace their editor | Describe the feature consistently as a bridge to the user's established editor and keep embedded editing out of scope. |
| The beta cohort does not represent the intended multi-session workflow | Recruit daily multi-session users first and record cohort composition before interpreting results. |
| A failed editor handoff erodes trust | Keep the developer in context, make the final outcome clear, and collect only coarse reliability outcomes for improvement. |
| Privacy concerns suppress adoption | Make telemetry opt-in, local, and content-free; state explicitly what is never recorded. |
| Adjacent workspace requests expand the release prematurely | Use ADR-002's repeat-use gate and require a separate product decision before adding search, mutations, previews, or curation. |

## Architecture Decision Records

- [ADR-001: Keep a safety-complete session explorer as the V1 boundary](adrs/adr-001.md) — Retain the complete, narrow browse-and-open workflow while protecting workspace containment and user control.
- [ADR-002: Validate repeat multi-session use before expanding the explorer](adrs/adr-002.md) — Make recurring use by daily multi-session users the primary evidence gate for broader investment.

## Open Questions

- What beta cohort size, consent flow, and review cadence will make the repeat-use result decision-useful while keeping all telemetry local?
- What wording best distinguishes a successful handoff request from proof that an external GUI editor is fully ready for interaction?
- What terminal-width behavior feels readable to daily multi-session users across the supported terminal environments?
- If Phase 2 validates demand, which bounded navigation improvement most directly reduces repeat friction without turning Kitten into an editor?
