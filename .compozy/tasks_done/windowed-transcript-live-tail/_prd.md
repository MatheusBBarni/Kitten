## Overview

Windowed Transcript with Protected Live Tail keeps Kitten responsive during long coding-agent sessions without hiding or discarding earlier live-run activity. It serves developers who run extended sessions with streamed responses, tool activity, and multi-agent handoffs.

The product provides a bounded working conversation view, protects current work, and collapses only older history behind a visible count and explicit reveal action. It launches as a clearly described opt-in experiment and becomes the default only after it demonstrates both reliable behavior and responsiveness in long sessions.

## Goals

- Keep the live conversation usable as sessions grow, without sacrificing access to any live-run transcript turn.
- Give developers confidence that older activity remains available through a visible count and explicit reveal action.
- Keep current agent work, active tool activity, and recent decisions immediately visible.
- Preserve a developer's reading position when earlier history is revealed or when the focused session changes.
- Validate the experience through privacy-safe, opt-in local measurements before making it the default.

## User Stories

### Long-session developer

- As a developer running a multi-hour agent session, I want the conversation to remain responsive so I can continue supervising work without UI degradation.
- As a developer, I want to see active agent output, current tools, and recent decisions immediately so I can act on live work.
- As a developer reviewing earlier work, I want to know how much history is hidden and reveal it intentionally so I never assume it was deleted.

### Multi-agent operator

- As a developer switching between live agent sessions, I want each conversation to retain my current history depth and reading position so I can resume context quickly.
- As a developer reading older activity, I want new agent output not to pull me away from the content I am inspecting.

### Privacy-conscious developer

- As a developer, I want clear live-run history semantics so I understand that this feature does not create a disk-persisted transcript archive.
- As a developer, I want performance evidence to remain local and content-free so using the experiment does not expose my prompts or code.

## Core Features

### Bounded live conversation view

When enabled, the conversation shows a focused working set rather than an ever-growing visible transcript. The product retains every turn during the live run; only the active presentation is bounded.

### Protected live tail

The conversation always keeps active streamed output, pending or running tool activity, recent user and agent turns, and context needed for a live interaction visible. Users never need to expand older history to understand what is happening now.

### Counted history marker and explicit reveal

Older activity is represented by a stable marker that reports the number of hidden turns and offers a clear action to load earlier history. Revealing history adds context without deleting, replacing, or obscuring the current conversation.

### Stable reading position

When users are reviewing earlier activity, newly arriving content does not force them back to the live tail. Loading earlier history preserves the visible reading position. A clear return-to-live action remains available when users want it.

### Independent session continuity

Each live agent session keeps its own visible-history depth and reading position. Switching focus returns the developer to the state they left for that conversation.

### Experimental rollout and local evidence

The capability begins as a default-off experiment with clear discovery and an understandable description of its live-run scope. It records only opt-in, local, content-free evidence about visible versus hidden rows and responsiveness.

## User Experience

1. A developer opts into the experimental bounded-history experience and sees a concise explanation that it preserves complete history for the current live run.
2. During a long conversation, the developer continues to see current streamed responses, active tools, and recent turns in the working view.
3. When earlier context is collapsed, a marker states how many turns are hidden and offers a direct action to load them.
4. If the developer is reading history, incoming activity does not move their viewport. They can explicitly return to the latest activity when ready.
5. When the developer switches to another live agent session and later returns, its history depth and reading position remain intact.
6. If a saved session cannot provide its earlier transcript after restart, Kitten communicates that limitation honestly rather than implying the marker can recover it.

Accessibility and discoverability requirements:

- The marker must use clear language, expose its hidden-turn count in text, and be operable by keyboard.
- The reveal and return-to-live actions must be discoverable through the existing command/help experience.
- The experimental preference must describe its benefits, scope, and privacy behavior in plain language.

## High-Level Technical Constraints

- Preserve all transcript turns during the current live run; this feature must not silently discard content.
- Do not add disk-persisted transcript content or send transcript content through telemetry.
- Keep performance measurements opt-in, local, and content-free.
- Maintain user-visible continuity across active session switching.
- Support a rapid disable path while the experiment is evaluated.

## Non-Goals (Out of Scope)

- Persisting full transcript history across restarts.
- Search, filters, exports, or a general transcript-browser product.
- A configurable window-policy platform or adaptive personalization.
- A general-purpose virtualization initiative beyond the bounded live-history experience.
- Redesigning existing saved-session or restoration workflows.

## Phased Rollout Plan

### MVP (Phase 1)

- Provide the opt-in bounded working view, protected live tail, counted marker, explicit history reveal, stable reading position, and independent session continuity.
- Keep all live-run transcript content available and retain the existing privacy boundary.
- Proceed to Phase 2 only when the preservation, protected-content, interaction-stability, and long-session responsiveness targets are met.

### Phase 2

- Evaluate experimental usage and local performance evidence from long-session developers.
- Improve discoverability and clarify live-run semantics where early users show confusion.
- Promote the capability toward the default experience only when the agreed reliability and responsiveness criteria hold in the evaluation period.

### Phase 3

- Consider richer navigation, search, or durable history only through a separate privacy, storage, and product-value decision.
- Consider broader history controls only after the bounded working view has proven sustained value.

## Success Metrics

| Metric | Target | Decision Use |
| --- | --- | --- |
| Live-run preservation | 100% of transcript turns remain available during a live run | Required for every rollout phase |
| Protected-content safety | 0 active streams, pending/running tools, or required live-interaction context is hidden | Required for every rollout phase |
| Bounded working view | At most 120 visible transcript rows in a documented 1,000-turn scenario | Demonstrates bounded presentation value |
| Long-session responsiveness | p95 update-to-visible responsiveness at or below 16 ms in the documented benchmark | Required before default adoption |
| Reading stability | 0 unsolicited jumps to the live tail while a user is reading history | Required before default adoption |
| Privacy | 0 transcript-content fields recorded by the experiment | Required for all phases |

The experiment becomes eligible for default-on evaluation only after all required safety, stability, and responsiveness targets hold during the evaluation period.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers interpret collapsed history as deleted history | Show a hidden-turn count, a direct reveal action, and plain-language live-run semantics. |
| Developers lose context while reviewing previous work | Preserve reading position and avoid automatic return to the live tail. |
| The experiment creates confusion or does not provide enough value | Keep it opt-in, gather local content-free evidence, and require the agreed graduation criteria. |
| Scope expands into a general history product | Keep persistence, search, richer navigation, and configurable policies out of the MVP. |
| Privacy expectations change unexpectedly | Do not persist transcript content or transmit content through telemetry. |

## Architecture Decision Records

- [ADR-001: Ship a flagged bounded live transcript projection](adrs/adr-001.md) — Establishes the bounded live-run projection and its privacy-preserving scope.
- [ADR-002: Launch bounded live history as a truth-first experiment](adrs/adr-002.md) — Defines the opt-in, counted-marker experience and evidence-based default adoption.

## Open Questions

- What protected-tail size and earlier-history batch size best balance immediate context with a compact working view?
- What exact wording best communicates that complete history is available during the live run but not as a cross-restart archive?
- What evaluation-period duration and participant threshold should govern promotion from opt-in to default-on?
