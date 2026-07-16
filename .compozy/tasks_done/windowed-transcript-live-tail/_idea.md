## Overview

Kitten should keep long-running coding-agent sessions responsive without discarding any live-run transcript history. The V1 targets developers who run extended sessions with streamed responses and dense tool activity. It presents a bounded live view, while retaining every semantic turn in memory for inspection during that run.

V1 is intentionally minimal: a protected live tail, a stable collapsed-history marker, explicit history expansion, preserved reading position, per-session presentation state, and privacy-safe measurements. It ships default-off until its correctness and performance are validated.

## Summary / Differentiator

Kitten will offer complete live-run transcript integrity with a bounded active presentation. This differs from model-context compaction, which changes what an agent sees, and from ordinary chat-history lists, which do not protect the live work surface.

## Problem

`ConversationView` currently renders the full focused-session transcript. As sessions accumulate agent messages and tool rows, UI work grows even though the user can inspect only a small viewport. The result is a risk of degraded responsiveness, excess memory use, and unstable scrolling precisely during long, high-value work.

Developers must be able to inspect active streams, tool activity, and recent decisions without fearing that older work was lost. At the same time, Kitten's current privacy contract deliberately avoids persisting transcript content to disk. V1 must therefore distinguish between complete history during a live run and cross-restart restoration.

### Market Data

Long-running coding-agent sessions are an established use case: GitHub documents session compaction and checkpointing for extended Copilot CLI work. [GitHub Copilot context management](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management)

RepoPrompt CE publicly validates a similar presentation model: a protected detailed tail, stable collapsed-history markers, explicit expansion, and identity stability across appends. [RepoPrompt projection tests](https://github.com/repoprompt/repoprompt-ce/blob/main/Tests/RepoPromptTests/AgentMode/Transcript/AgentTranscriptWindowedProjectionTests.swift)

As a demand proxy, Stack Overflow reports 47.1% daily AI-tool use and 69% of AI-agent users reporting productivity gains. [Stack Overflow 2025 survey](https://survey.stackoverflow.co/2025/)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Bounded live transcript | Critical | Present a bounded working view for long sessions while retaining every semantic turn in live memory. Older content becomes a stable marker with its hidden-turn count. |
| F2 | Protected live tail | Critical | Never collapse active streaming work, pending/running tools, recent conversational turns, or transcript context required by a live interaction. |
| F3 | Explicit history expansion | High | Let users load earlier history on demand without forcing a jump to the latest content or replacing the semantic transcript. |
| F4 | Trustworthy live-run semantics | High | Clearly preserve the existing distinction between live-run history and non-persisted transcript content; older tool updates must remain coherent after projection changes. |
| F5 | Independent session views | High | Keep each agent session's expansion and reading position independent when users switch focus. |
| F6 | Safe rollout evidence | Medium | Ship default-off and collect only opt-in, local, content-free counters for visible rows, archived rows, and projection-duration buckets. |

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Live session transcript | Remains the complete, authoritative record for the current run. |
| Conversation surface | Receives a bounded presentation rather than the full retained transcript. |
| Session switching | Restores each session's ephemeral history window and detached/live reading state. |
| Approvals and clarifications | Remain visible overlays; their related transcript context must not become undiscoverable. |
| Local telemetry | Measures performance behavior without collecting transcript text, IDs, paths, or prompts. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Bounded rendering | <=120 rendered transcript rows in a 1,000-turn synthetic session | Deterministic UI/projection test |
| Live-run preservation | 100% of semantic turns retained | Compare authoritative turn count before and after projection changes |
| Protected-content safety | 0 protected rows collapsed | Tests covering streams, tools, approvals, and clarifications |
| Frozen-prefix stability | 100% identity reuse during tail streaming updates | Referential/row-identity assertions |
| Projection responsiveness | p95 projection duration <=16 ms for the documented 1,000-turn benchmark | Content-free duration buckets |
| Scroll stability | 0 unwanted jumps to the live tail after manual detachment | Prepend-anchor and session-switch interaction tests |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Quick Win**

## Council Insights

- **Recommended approach:** Ship a minimal, default-off bounded projection that preserves the complete live-run transcript, protects active work, and uses a stable collapsed-history marker.
- **Key trade-offs:** A bounded view improves long-session reliability but introduces marker, anchoring, and old-tool-update behavior. Generic virtualization and persisted transcript history offer more capability at materially greater scope.
- **Risks identified:** Hidden/stale work, scroll jumps, and misleading recovery expectations. Mitigate with protected-content rules, deterministic re-projection, detached-scroll tests, truthful live-run semantics, and a rapid-disable flag.
- **Stretch goal (V2+):** Persistent, searchable cross-agent transcript history—only after an explicit privacy and storage decision.

## Out of Scope (V1)

- **Disk transcript persistence** — Changes Kitten's privacy contract and storage schema; V1 covers complete history only during a live run.
- **General-purpose virtualization platform** — Larger UI infrastructure is unnecessary until bounded presentation proves insufficient.
- **Searchable transcript archive** — Valuable, but depends on a separate persistence and privacy decision.
- **Configurable/adaptive window policies** — Fixed, measured defaults keep the first release understandable and testable.
- **Rich history navigation and filtering** — The first release needs explicit earlier-history loading, not a complete transcript browser.

## Architecture Decision Records

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Preserve the authoritative live-run transcript while bounding its presentation with explicit safety constraints.

## Open Questions

- What protected-tail size and earlier-history batch size best meet the benchmark without making the first view too sparse?
- What wording most clearly communicates that expanded history is available for the live run but is not disk-persisted?
- What evidence should promote the default-off rollout to the default experience?
- How should a live clarification with no direct transcript-turn ID retain sufficient nearby context?
