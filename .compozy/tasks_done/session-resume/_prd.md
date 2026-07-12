# PRD: Resumable Cross-Agent Sessions

## Overview

Kitten runs two AI coding agents side by side and hands a live task between them, and this feature lets a developer close the terminal and come back later to the exact same cockpit.
Press `Ctrl+R`, pick a previous session, and both agent threads, whoever had focus, and the hand-off state come back live, so a task parked on Friday is ready to continue on Monday without re-explaining anything.
It is for the cross-agent power developer already running Claude Code and Codex in Kitten; the primary job is parking work and picking it up across days, with crash and accidental-close recovery riding free on the same machinery.
It matters because agent tasks now span hours and get interrupted, single-agent resume is already table-stakes everywhere, and no tool restores the two-agent hand-off relationship, which is the one thing that makes Kitten Kitten.

## Goals

- Make park-and-resume a zero-setup daily-driver moment: persistence is on by default, and returning to a project offers the last run plus a picker of prior runs.
- Restore the whole cockpit rather than two disconnected threads: focus, the hand-off ledger, pending diffs, and both live conversations return as one unit, with hand-back intact.
- Keep the promise honest: every pane states whether it came back live or as read-only history, and never silently claims a liveness it cannot deliver.
- Hold the trust brand as Kitten writes content to disk for the first time: a small stored footprint, a clear first-run disclosure, and an always-available delete.
- Ship the differentiator in V1: resuming the cross-agent relationship, which no competitor offers.

Timeline: a single V1 release built in internal phases - persistence and a confirmation probe first, then the picker and live restore, then degradation and preview polish.

## User Stories

Primary persona - the cross-agent power developer (P1):

- As a developer who parks a half-finished cross-agent task, I want to reopen it days later with both agents and the hand-off state intact, so that I continue instead of rebuilding context.
- As a developer returning to a project, I want Kitten to offer my last run immediately, so that resuming is one keystroke.
- As a developer with many past runs, I want to search the picker by what I was doing, so that I find the right session fast.
- As a developer resuming a session, I want each agent pane to tell me whether it is live or read-only, so that I trust what I am looking at.
- As a developer who resumed a session, I want to hand it back to the other agent the way I always do, so that resume does not change my workflow.

Secondary persona - the interrupted developer (P2):

- As a developer whose terminal crashed or rebooted, I want my cockpit back as it was, so that I lose no work.

Tertiary persona - the privacy-conscious developer (P3):

- As a developer, I want to see what Kitten stores and where, and delete any session or all of them, so that I stay in control of my data.

## Core Features

Critical:

- **Whole-cockpit persistence, on by default.** Kitten continuously saves the active run - the two session ids, light metadata (last prompt, git branch, project, timestamps, message counts), and the curated hand-off bundle - so any run can be reopened later. Autosave doubles as crash and close recovery. Persistence is on by default, disclosed at first run, and has an off-switch.
- **`Ctrl+R` session picker.** A full-screen picker scoped to the current project, with a one-key widen to other projects, live fuzzy search, and a preview before committing. Each row shows the summary or first prompt, relative time, message count, and git branch. A "resume last run" fast-path skips the picker.
- **Live whole-cockpit restore with honest per-side status.** Resuming brings both agent panes back live where their transcript is still available, restores focus and the hand-off relationship, and labels each pane restored, history-only, or unavailable. It never blocks the whole resume because one side degraded.

High:

- **Hand-back after resume.** A restored, live focused pane plus the restored bundle is enough to continue and hand back, using the existing hand-off preview-confirm flow with no new step to learn.
- **Data control.** Per-session delete from the picker, a global delete-all, and a visible statement of what is stored and where. Sessions are kept until the user deletes them.
- **Graceful unavailability.** When an agent has already purged the underlying transcript, the picker marks that session unavailable, still restores the relationship and the bundle, and offers to start fresh from that context.

## User Experience

First contact: on first run, alongside the existing readiness guidance, Kitten states once that it now remembers sessions for this project, where they are stored, and how to delete them.
Everyday resume: the developer opens Kitten in a project and is offered the last run to resume with one keystroke; pressing `Ctrl+R` instead opens the picker.
Picker: the list is scoped to the current project and filters live as the developer types; each row reads like a memory ("refactor the auth guard - 2d - 47 msgs - feat/auth"); `Space` previews the cockpit without committing, `Enter` resumes, and a widen key reveals other projects.
Restore: both panes repopulate, a small per-pane badge says live or read-only, focus lands where it was, and the pending diffs and hand-off bundle are back.
Continue and hand back: the developer types the next prompt to the live focused agent and hands back with the usual `Ctrl+T` flow.
Data control: any session can be deleted from the picker, and a global clear removes everything.
Discoverability: `Ctrl+R` appears in the help panel and the keybinding hint, matching the shell reverse-search convention it borrows from.
Accessibility: keyboard-first throughout, matching the existing overlays, with status conveyed in text rather than color alone.

## High-Level Technical Constraints

- Resume leans on each agent's own ability to reload a past session over ACP; Kitten restores a pane live only when the agent can reload it, and degrades to read-only otherwise. This is a per-agent, external dependency, not something Kitten controls.
- Data privacy: Kitten stores conversation-derived content (the curated bundle and metadata) on the local disk for the first time. Storage stays local, is readable only by the user, has the existing secret redaction applied, and is deletable. Nothing is uploaded.
- Performance from the user's view: the picker is interactive within a fraction of a second, and a live resume reaches a usable cockpit within a few seconds on the fast path.
- Consistency: hand-back reuses the existing confirmed hand-off flow, so resume introduces no new way to send content to an agent.

## Non-Goals (Out of Scope)

- Guaranteed both-panes-live on every resume - V1 degrades honestly per side; closing the remaining agent-side replay gaps comes later.
- Automatic re-send of restored context to an agent without the preview - any such path stays behind the existing confirm step.
- First-class run management - naming, branching, replay, and sharing runs are a later growth path, not V1.
- Time-based auto-deletion and retention policies - V1 keeps sessions until the user deletes them.
- Encryption-at-rest and a configurable retention engine - deferred.
- Cross-project as the default picker view - V1 defaults to the current project and offers widening on demand.
- Storing full transcripts in Kitten's own store - Kitten keeps pointers and the bundle and rehydrates transcripts live from each agent.

## Phased Rollout Plan

A single V1 release, built in three internal phases with go/no-go criteria.

### MVP (Phase 1) - Persistence and confirmation

- Continuous autosave of pointers, metadata, and the bundle, on by default, with first-run disclosure and delete.
- "Resume last run" on startup.
- A confirmation probe that the pinned agents reload a days-old session in practice.
- Success criteria to proceed: a run survives a full close-and-reopen with the relationship restored, and both pinned agents reload a prior session.

### Phase 2 - Picker and live restore

- The `Ctrl+R` picker: project scope, one-key widen, live search, preview, and informative rows.
- Live whole-cockpit restore with per-side status.
- Success criteria to proceed: users can find and resume a specific prior run, both panes restore live on the fast path, and per-side status is always shown.

### Phase 3 - Degradation and polish

- Graceful unavailable handling, global delete-all, preview refinements, and discoverability in help.
- Long-term success: the resume-adoption and continue-without-re-explain targets are met, with zero reported data-at-rest incidents.

## Success Metrics

- Resume adoption: `Ctrl+R` or last-run resume used by more than 35% of returning users within 7 days, in projects with a prior run.
- Two-sided live fidelity: both panes restore live in more than 70% of whole-cockpit resumes.
- Continue without re-explain: in more than 60% of resumes, the first message after resume is task continuation rather than restated context.
- Relationship-restore reliability: the relationship layer restores in more than 99% of resumes.
- Picker responsiveness: interactive within 150 ms, and live resume to a usable cockpit within 3 seconds on the fast path.
- Data control: zero unredacted secrets in stored sessions, and delete removes a session from the picker every time.

## Risks and Mitigations

- Adoption risk: the multi-agent power user is still an early-adopter minority. Mitigation: persistence is on by default and the last run is one keystroke away, so the value shows up with no setup, and it compounds Kitten's core hand-off bet rather than adding a separate thing to learn.
- Trust risk: writing content to disk for the first time could feel at odds with Kitten's consent brand. Mitigation: a small stored footprint (pointers and bundle, not transcripts), a clear first-run disclosure, redaction applied to what is stored, and an always-available delete and off-switch.
- Honesty risk: a resume that silently claimed "live" when a pane was only history would burn trust in a trust-sensitive audience. Mitigation: explicit per-side status and a graceful unavailable path, never an all-or-nothing block.
- Dependency risk: resume relies on each agent keeping its own session reloadable, and an agent may purge or change its store. Mitigation: keep only pointers and bundle so the relationship always restores, degrade to read-only or unavailable cleanly, and confirm behavior against the pinned agent versions first.
- Unbounded-store risk: keep-forever retention grows the store and can list purged sessions. Mitigation: cheap per-session and global delete, the unavailable state for stale rows, and retention policy left open for a later release.

## Architecture Decision Records

- [ADR-001: Two-Layer Whole-Cockpit Resume - Reliable Relationship, Best-Effort Liveness](adrs/adr-001.md) - Restore the hand-off relationship reliably and per-agent liveness best-effort, with a data-at-rest gate.
- [ADR-002: V1 Rollout Shape - Whole-Cockpit Resume Delivered End-to-End](adrs/adr-002.md) - Ship the full two-layer resume in one V1 release built in internal phases, with on-by-default persistence of pointers and bundle and keep-forever retention.

## Open Questions

- Should the picker expose a way to reveal or copy the underlying agent session id, since its absence was a documented frustration in similar tools?
- What is the exact first-run disclosure wording, given the existing onboarding budget of under 60 seconds to first response?
- Should "resume last run" prompt on startup, or resume silently with an easy undo, to avoid adding a boot step?
- `Ctrl+R` collides with shell reverse-search and with Claude Code's in-picker rename; confirm the binding or choose an alternative before build.
- How should a session that is unavailable on one side but live on the other be labeled in the picker, before the user opens it?
