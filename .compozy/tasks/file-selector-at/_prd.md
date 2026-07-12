# Product Requirements Document: @ File Selector

## Overview

@ File Selector lets any Kitten developer find one relevant repository file while composing a prompt and insert a visible repository-relative file reference without leaving the keyboard.

Today, developers must remember, type, or copy a path manually. That interrupts prompt composition and makes duplicate or unfamiliar filenames easy to reference incorrectly. The MVP removes that friction with a familiar @ flow while remaining honest: the selected text is an explicit pointer for the active agent, not a guarantee that the file's contents are attached as context.

## Goals

- Reduce the time and errors involved in adding a known repository file to a prompt.
- Give every Kitten developer the same keyboard-first file-reference experience, regardless of the focused agent.
- Keep the workflow trustworthy by showing an explicit file reference rather than promising provider-specific attachment behavior.
- Validate whether users adopt single-file references before expanding scope.

## User Stories

### All Kitten developers

- As a developer, I want to type @ and search normal repository files so that I can reference a relevant file without recalling its full path.
- As a developer, I want to see repository-relative paths so that I can distinguish files with the same name.
- As a developer, I want to accept one result without sending my prompt so that I can finish my request before giving it to the agent.
- As a developer, I want an unambiguous visible reference after selection so that I know exactly what I included in my prompt.
- As a developer, I want to keep typing when no file matches so that a failed search never interrupts my work.
- As a developer using multiple sessions, I want the selector to reflect the focused session's repository so that I do not reference a file from the wrong workspace.

## Core Features

### Critical

- **@ trigger and single-file search:** Typing @ opens a prompt-local selector for one normal repository file belonging to the focused session.
- **Path-based filtering and disambiguation:** Subsequent typing narrows candidates, with repository-relative paths visible enough to distinguish duplicate filenames.
- **Keyboard-first selection:** Arrow keys move the active result, Enter inserts the reference without submitting the prompt, and Escape closes the selector without changing the draft.
- **Focused-session scope:** Every result belongs to the repository context of the session currently receiving the prompt.

### High

- **Explicit reference semantics:** An accepted item is presented as a file reference in the prompt. Product copy must not imply a guaranteed file-content attachment.
- **Normal-file boundary:** V1 includes normal repository files and excludes ignored, generated, and outside-repository files.
- **Non-blocking empty and failure states:** A no-match or unavailable result source leaves ordinary typing available and displays a brief, legible explanation.

## User Experience

1. A developer begins composing a prompt for the focused agent.
2. They type @ where a file reference is useful.
3. A compact selector appears beneath the prompt and shows files from that session's repository.
4. As they type, results narrow and full relative paths resolve duplicate names.
5. They use the keyboard to choose one file and press Enter.
6. Kitten inserts a visible reference but does not send the prompt.
7. The developer completes, edits, or removes the reference before submitting their request.

The selector should be familiar to users of modern coding agents, work entirely from the keyboard, and never capture ordinary typing after dismissal. Empty and unavailable states must be concise and leave the draft untouched. The experience must work consistently when the user switches between ready sessions.

## High-Level Technical Constraints

- The experience must remain provider-neutral and use the same user-facing semantics for every focused session.
- Candidate files must stay within the focused session's repository boundary and conform to the normal-file policy.
- A selection must remain visible prompt content and must not be represented as a guaranteed context attachment.
- Discovery must feel responsive enough to preserve composition flow: target a warm query-result latency of p95 at or below 100 ms.
- Usage measurement, if enabled, must be opt-in and must not collect prompt or source-code content.

## Non-Goals (Out of Scope)

- Guaranteed provider-specific attachment of selected file contents.
- Selecting multiple files, folders, symbols, or arbitrary non-file context.
- Including ignored, generated, binary, or outside-repository files.
- Persistent personalization, custom filters, or user-managed ranking.
- Changing any history that records files agents actually read, edited, or otherwise observed.
- Persistent cross-session repository catalogs or richer context-management capabilities.

## Phased Rollout Plan

### MVP (Phase 1)

Deliver one-file @ search for normal repository files in the focused session, keyboard navigation, visible relative-path references, and non-blocking empty or unavailable states.

**Success criteria to proceed:** Usability validation shows that developers can reliably select and insert the intended file while preserving their prompt, and early opt-in measurement shows reduced composition time with low wrong-file correction.

### Phase 2

Improve discoverability and ranking only where MVP feedback identifies a repeatable search problem. Consider broader candidate policy only if users repeatedly need excluded files and the trust boundary remains clear.

**Success criteria to proceed:** The expanded behavior demonstrably improves successful selection without reducing clarity about what the reference means.

### Phase 3

Evaluate a provider-aware context composer that can explicitly show when a selected item is actually included as agent context, subject to proven demand and a consistent user promise.

**Long-term success criteria:** Users can make informed context choices across providers without ambiguity, unnecessary prompt friction, or uncontrolled context growth.

## Success Metrics

- **Prompt-friction reduction:** At least 30% lower median time to add a known path compared with manual entry in usability testing.
- **Selection speed:** Median time from @ invocation to accepted reference of 2.0 seconds or less.
- **Selector completion:** At least 70% of initiated non-empty @ queries end in an accepted reference.
- **Wrong-file correction:** Fewer than 5% of accepted references are removed or replaced before prompt submission.
- **Eligible-session adoption:** At least 20% of ready prompt sessions use an accepted @ selection within 30 days of release.
- **Warm result latency:** p95 query-to-result rendering at or below 100 ms once the session's repository source is available.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users assume selection attaches file contents to every agent. | Use explicit file-reference wording and avoid attachment-like claims in the interface and documentation. |
| Search results contain irrelevant or surprising files. | Limit V1 to normal repository files and state the boundary clearly. |
| A no-match result disrupts prompt composition. | Keep normal typing active and show concise non-blocking feedback. |
| Users select the wrong duplicate filename. | Display repository-relative paths during filtering and selection. |
| The feature adds complexity without habitual value. | Keep V1 to a single file and use opt-in, content-free measurement to decide whether to expand it. |

## Architecture Decision Records

- [ADR-001: Keep @ File Selection as an Honest, On-Demand Single-File Reference](adrs/adr-001.md) — Defines the provider-neutral, one-file V1 and its honest semantic boundary.
- [ADR-002: Limit V1 to Normal Repository Files and Preserve Composition on No Match](adrs/adr-002.md) — Confirms the candidate policy and non-blocking no-match behavior.

## Open Questions

- What exact inline wording best conveys that selection inserts a file reference rather than guaranteeing file-content attachment?
- Which user-facing explanation, if any, should distinguish unavailable file discovery from an ordinary no-match result?
- What opt-in baseline task should be used to compare manual path entry with @ selection?
