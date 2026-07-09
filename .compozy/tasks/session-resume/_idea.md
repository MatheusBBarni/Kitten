# Kitten - Resumable Cross-Agent Sessions

## Overview

Kitten runs two AI coding agents side by side and hands a live task between them, but today that work vanishes the moment you close the terminal.
Resumable sessions let a developer press `Ctrl+R`, pick a previous run, and drop back into it with both agent threads, the focus, and the hand-off state restored, so a task parked on Friday is live again on Monday without re-explaining anything.

The target user is the cross-agent power developer already running Claude Code and Codex in Kitten and handing tasks between them.
The primary job is parking work and picking it up across days; crash and accidental-close recovery ride free on the same machinery.

V1 is shaped as two layers.
The relationship layer - focus, the hand-off ledger, pending diffs, touched files - is Kitten's own state and is always restored, reliably, because no external adapter can break it.
The live-conversation layer is best-effort per agent: each pane comes back live when its adapter can reload the session, and drops to clearly-labeled read-only history when it cannot.
This keeps the promise honest on a protocol whose resume fidelity is uneven across agents, while still shipping the part no competitor offers: resuming the two-agent relationship itself.

## Summary / Differentiator

Single-agent resume is table-stakes.
Claude Code, Codex, aider, Zed, and Crush all persist and reload an agent's own transcript, so a multi-agent cockpit that cannot resume reads as broken rather than minimal.
Kitten's wedge is the layer none of them touch: it restores the relationship between two agents - which agent handed what to which, the curated hand-off bundle, the pending diffs, and which pane holds focus - as one resumable unit.
That relationship is Kitten's own state, and no ACP `session/load` returns it, so it is both the unclaimed whitespace and the piece a competitor cannot copy without first modeling a cross-agent hand-off.
Because the relationship layer is fully owned and the live-replay layer is not, the reliable half of resume is also the valuable half.

## Problem

A developer who runs two agents in Kitten and hands a task between them has no way to keep that work across sessions.
Agent tasks are no longer short: turns routinely run tens of minutes, real tasks span hours, and the work is broken up by meetings, context switches, and overnight breaks.
When the terminal closes, by choice or by reboot or by crash, the entire cockpit is gone: both transcripts, the diffs in flight, and the hand-off relationship that is the whole point of Kitten.
The developer restarts from zero and re-explains the project to each agent, which is exactly the context tax Kitten was built to remove, reintroduced at the session boundary.

The underlying agents each solve this for themselves and only themselves.
Claude Code writes its own resumable sessions and Codex writes its own, but neither knows the other exists, and neither has any concept of the hand-off between them.
So even a developer who manually resumed each agent from its own CLI would recover two disconnected threads, not the cockpit: the focus, the curated bundle, and the pending diffs would still be lost.
The one artifact that makes Kitten Kitten is the one artifact no agent persists.

Shipping nothing here is also a competitive gap.
Every comparable tool now persists and reloads sessions, so a cockpit that forgets everything on close looks behind the field no matter how good the hand-off is.

### Market Data

- Single-agent resume is table-stakes: Claude Code (`claude --resume` picker, `~/.claude/projects/*.jsonl`, full live context), Codex CLI (`codex resume`, `~/.codex/sessions`, restores transcript + plan + approvals), aider (`--restore-chat-history`), Zed (external-agent history shipped in stable v0.225.9, Feb 2026), and Crush (per-session store).
- Agent task durations are growing: Anthropic reports the 99.9th-percentile Claude Code turn nearly doubled to over 45 minutes between late September and early January, and cites METR that a frontier model can complete tasks a human would take roughly 5 hours to do ("Measuring AI agent autonomy in practice," Feb 2026).
- Real agent work is punctuated: Anthropic frames the everyday reality as agents that pause for clarification and get interrupted by humans, which is exactly the park-and-resume pattern.
- Losing agent context on restart is a documented, repeated complaint: developers on the Zed and Cursor forums reported reverting to other tools because external-agent context was lost on restart, which drove Zed to ship external-agent history in Feb 2026.
- The multi-agent power user is still an early-adopter minority: roughly 31% of developers use AI agents at all (Stack Overflow 2025 Developer Survey, ~49k respondents), so the absolute base is small but growing. Trust in AI accuracy also fell from ~40% to ~29% year over year, so this audience punishes features that silently misbehave.
- ACP provides the resume primitive: the protocol defines `session/load` (agent replays full history via notifications) and `session/resume` (context only), gated by an advertised `loadSession` capability. Claude's ACP adapter supports it, Codex's advertises it with reported replay gaps, and Cursor-class adapters shipped it returning nothing as late as mid-2026, so resume fidelity is real but uneven across agents.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Whole-cockpit run persistence | Critical | Continuously persist the active run - both agents' `turns`, `focusedAgentId`, per-agent status and plan, and the hand-off ledger and last bundle - to a versioned, slot-keyed record under `~/.local/state/kitten/`. Autosave doubles as crash and close recovery. |
| F2 | `Ctrl+R` session picker | Critical | A modal fuzzy picker (cloning the existing overlay pattern) listing prior runs for the current project, each row showing the last prompt or summary, time since last activity, message count, and git branch, with live incremental search and a preview. Enter resumes; a "resume last run" fast-path skips the picker. |
| F3 | Two-layer live resume with per-side degradation | Critical | Restore the relationship layer atomically and reliably; probe each agent's `loadSession` capability and restore each pane live via `session/load` where supported and the id is still valid, else load it as clearly-labeled read-only history. Restoration status is explicit per side (`restored` / `history-only` / `unavailable`), never silent and never an all-or-nothing block. |
| F4 | Hand-back after resume via the existing flow | High | A restored-live focused pane plus the restored bundle is enough to continue and hand back, and hand-back reuses the existing `Ctrl+T` redacted-preview-confirm flow with no new egress path. |
| F5 | Data-at-rest safety gate | High | Persisted runs get atomic `0600` file and `0700` directory permissions, the existing secret redactor applied to anything written, a first-run disclosure of what is stored and where, per-session delete from the picker plus a global delete-all, and a retention cap. |
| F6 | Adapter capability and durability probe | High | Capture `agentCapabilities.loadSession` at `initialize` (currently discarded) and verify at resume that a stored id is still reloadable, so the UI can pick live-vs-history honestly per agent and per run. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Resume adoption | `Ctrl+R` resume used by > 35% of returning users within 7 days (projects with a prior run) | Opt-in telemetry: resume events / returning users with >= 1 prior persisted run |
| Two-sided live fidelity | Both panes restore live in > 70% of whole-cockpit resumes | Telemetry: resumes where both sessions reach `restored` / total resumes |
| Continue without re-explain | In > 60% of resumes, the first post-resume message is task continuation rather than context-restating | Reuse the existing re-explanation heuristic on the first N post-resume turns |
| Picker responsiveness | `Ctrl+R` to interactive < 150 ms; resume to first live token < 3 s on the Claude side | Instrumented timings around picker open and `session/load` replay settle |
| Relationship-restore reliability | Relationship layer restores successfully in > 99% of resumes | Telemetry: relationship-layer restore failures / total resumes |
| Data-at-rest safety | 0 unredacted secrets in persisted runs | Redactor coverage on the persist path plus 0 reported leak incidents |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Strong |
| **Feasibility** | Can we actually build this? | Maybe |

Leverage type: Strategic Bet / Compounding Feature.

The plain-resume half matches the field, so it scores as table-stakes rather than differentiation; the relationship-restore half is unclaimed and compounds with Kitten's core hand-off bet, which lifts Differentiation and Defensibility to Strong.
Feasibility is Maybe, not Strong, because the SDK plumbing exists and the state is one small object, but per-adapter resume fidelity is uneven and unverified against the pinned binaries.

## Council Insights

- **Recommended approach:** Ship whole-cockpit resume as two layers. The relationship layer (focus, hand-off ledger, pending diffs, touched files) is Kitten's own state and always restores; the live-conversation layer is best-effort per agent via ACP `session/load`, degrading to labeled read-only history when an adapter cannot reload. Hand-back reuses the existing `Ctrl+T` preview-confirm flow. Four of five advisors backed this; the reframing that carried the room is that the reliable part of resume is also the differentiated part, because it is the state Kitten owns.
- **Key trade-offs:** Reliability of the relationship layer vs. liveness of the conversation layer (own the first, degrade the second); index-plus-`session/load` rehydration vs. persisting our own transcript copy (prefer the former, redact any fallback snapshot we do write); shipping the differentiator in V1 vs. deferring the risky re-inject path (ship restore-and-display now, defer automatic re-anchor-and-send).
- **Risks identified:** (1) A days-old session id may not reload if the adapter did not persist its own session across restarts - mitigated by a capability-and-durability probe spike run before the promise is committed. (2) Re-anchoring the bundle on resume is where "nothing leaves unredacted" could silently regress into an unredacted re-send - mitigated by routing hand-back only through the existing preview-confirm gate in V1. (3) Writing conversation content to disk for the first time is a new at-rest exposure surface - mitigated by the F5 safety gate.
- **Stretch goal (V2+):** Make the cockpit run a durable, first-class object: named runs you can branch (fork a run to try a different approach across both agents), replay, and share as a redacted bundle a teammate can resume. The slot-keyed run record is designed so this is a growth path, not a rewrite.
- **Dissenting view (preserved):** One advisor argued that "live across days" is a promise the adapter matrix has not earned, and that the honest V1 is best-effort read-only history plus single focused-agent live-resume, with the hand-off-edge deferred. This becomes the fallback if the probe spike shows the pinned adapters cannot reliably reload days-old ids.

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| App store (`AppState`) | The whole cockpit is one store; a run serializes to `focusedAgentId` plus per-agent `{ sessionId, turns, status, plan }`. Persist `turns` as source of truth and recompute derived fields via the existing `withDerived`. |
| Telemetry sink (`src/telemetry/recorder.ts`) | Reuse `createJsonlFileSink` and XDG-state path resolution for the run store, keeping persistence under `~/.local/state/kitten/`. |
| Secret redactor (`src/core/secretRedactor.ts`) | Apply the existing redactor on the persist path and on any bundle re-inject, so the redaction guarantee holds at rest and on resume. |
| Overlay pattern (`ApprovalPrompt`, `HandoffPreview`) | The `Ctrl+R` picker is a new modal overlay following the same pattern; add a `sessionPicker` slot to `OverlayState` and include it in `selectHasOpenOverlay`. |
| Keymap (`src/ui/keymap.ts`) | `Ctrl+R` is currently unbound; add a `resume-session` command and update the help panel. |
| ACP connection (`src/agent/agentConnection.ts`) | Extend the wrapper with a `loadSession` path and capture `agentCapabilities.loadSession` at `initialize`, both absent today. |
| Hand-off flow (`src/app/handoff.ts`) | Hand-back after resume reuses the existing preview-confirm flow; the persisted hand-off ledger is re-anchored to freshly restored session ids. |

## Out of Scope (V1)

- **Guaranteed dual-live fidelity** - closing Codex and Cursor-class replay gaps so both panes are always live is a V2 goal; V1 degrades per side honestly instead.
- **Automatic hand-off re-anchor-and-send** - any resume path that re-injects and sends context without the preview is deferred to V2 behind an explicit redaction gate, preview, and tests, because it is the most likely place for an unredacted re-send.
- **Fork, list, multi-run, branch, and share UI** - first-class run management is the V2 growth path; V1 ships the picker and resume-newest only.
- **OS-keychain encryption-at-rest** - named as the V1.1 target that resolves the fidelity-vs-redaction tension; V1 relies on file permissions, redaction of detected secrets, and retention.
- **Configurable retention-policy engine** - V1 ships a fixed retention cap plus delete; a policy engine is V1.1.
- **Cross-project global picker** - V1 scopes the picker to the current project; a widen-to-all-projects mode is deferred.

## Architecture Decision Records

- [ADR-001: Two-Layer Whole-Cockpit Resume - Reliable Relationship, Best-Effort Liveness](adrs/adr-001.md) - Ship whole-cockpit resume as a reliable relationship layer plus best-effort per-agent liveness, with a V1 data-at-rest gate and an up-front adapter-capability probe.

## Open Questions

- Do `claude-code-acp@0.57.0` and `codex-acp@1.1.0` reload a days-old session id after Kitten spawns a fresh subprocess? This is the top feasibility risk and should be a probe spike at the front of the PRD.
- Should persistence be on by default, or opt-in? Product favors on-by-default for the park-across-days job; security favors on-by-default only when paired with the first-run disclosure and a visible purge.
- What is the default retention cap - by run count, by age, or both?
- For the history-only fallback, how large a transcript snapshot should Kitten persist itself versus rely on `session/load` replay?
- Should the picker offer a widen-to-all-projects key in V1, or stay strictly project-scoped?
- `Ctrl+R` collides with shell reverse-search and with Claude Code's in-picker "rename" binding; confirm the choice or pick an alternative before implementation.
