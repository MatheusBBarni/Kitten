# Prompt History Navigation

## Overview

Prompt History Navigation lets users recover a recently submitted prompt, make a small change, and resend it without retyping. It serves anyone working in a live Kitten agent session, especially developers iterating on task wording, corrections, and follow-ups.

V1 is intentionally narrow. It provides a short, in-memory history that belongs only to the active run and originating agent session. Users move through it with familiar arrow keys, see a compact position indicator while browsing, and return to a blank composer after moving forward past the newest recalled prompt.

Market research supports this direction: GitHub Copilot CLI documents Up and Down as command-history navigation, while Claude Code gives multiline cursor movement and menus precedence before history navigation. Kitten matches those expectations while using a more privacy-preserving current-run scope. [GitHub Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode)

## Goals

- Reduce the effort required to retry a recently sent prompt with a small edit.
- Make recall predictable in a keyboard-first, multiline composer.
- Keep prompt content private to the agent session and current run.
- Give users clear feedback about where they are in recalled history.
- Validate value through faster edit-and-resend behavior rather than feature exposure alone.

## User Stories

### Iterating developer

- As a developer refining an agent request, I want to press Up to recover my latest prompt so that I can adjust it instead of retyping it.
- As a developer comparing several recent prompt variants, I want to move backward and forward through them so that I can reuse the most useful version.
- As a developer who resends the same text repeatedly, I want adjacent duplicates collapsed so that recall remains concise.

### Multiline prompt author

- As a user composing a multiline prompt, I want Up and Down to keep moving my cursor while movement remains possible so that recall does not disrupt editing.
- As a user who reaches a recall boundary, I want a clear and consistent transition into history browsing so that the behavior is learnable.

### Privacy-conscious user

- As a user working with multiple agents, I want recalled prompts to remain in their originating session and disappear when the run ends so that another session cannot expose my content.

## Core Features

### F1. Session-local recent-prompt recall — Critical

Retain a bounded list of recently submitted prompts for the active run and originating agent session. The list is a convenience for immediate reuse, not a complete activity record.

### F2. Boundary-aware arrow navigation — Critical

Use Up to move from newer to older recalled prompts and Down to move from older to newer prompts. Do not wrap at either end. Down clears the composer only after the user has recalled the newest entry.

### F3. Multiline and menu precedence — Critical

Preserve ordinary vertical editing whenever the composer can still move the cursor. When the command menu is open, its existing arrow navigation takes priority over prompt recall.

### F4. Visible recall position — High

Show a compact indicator, such as `History 2/5`, while the user is browsing recalled prompts. Remove it when the user returns to the ordinary composer state.

### F5. Adjacent-duplicate collapsing — High

Keep one entry when the same prompt is submitted consecutively. Distinct prompts remain separately recallable in chronological order.

### F6. Privacy-preserving lifecycle — High

Never make a prompt from one agent session available in another. Discard the history when the current run ends, is cleared, or is replaced.

### F7. Keyboard discoverability — Medium

Document prompt recall, the position indicator, and the multiline boundary in the existing keyboard guidance.

## User Experience

1. A user submits a prompt. It becomes the most recent entry for that agent session.
2. In a plain composer, the user presses Up at the upward editing boundary. The composer shows the latest recalled prompt and a compact position indicator.
3. Further Up presses move to older entries. Further Down presses move toward newer entries.
4. Down from the newest recalled entry clears the composer and removes the indicator, as explicitly chosen for V1.
5. While a command menu is open, arrows continue to navigate menu options. While a multiline prompt still allows vertical cursor movement, arrows continue to edit the prompt.
6. A recalled prompt can be edited and resent. If that resubmission is identical to the previous entry, it does not create duplicate adjacent history.

The indicator must be concise, consistently located, and readable without requiring pointer input. Keyboard help must describe the condition under which arrows recall prompts so users do not mistake recall for a replacement of normal multiline editing.

## High-Level Technical Constraints

- Do not retain prompt content across restarts or outside the current run.
- Do not expose a prompt from one agent session to another session.
- Preserve established keyboard behavior in active menus and ordinary multiline editing.
- Keep the recall experience responsive enough to feel immediate during composition.

## Non-Goals (Out of Scope)

- **Persistent prompt storage** — V1 is not a long-term prompt library and does not introduce retention controls.
- **Cross-session or cross-agent history** — content ownership remains with the originating session.
- **Search, favorites, pinning, or history management** — defer discovery features until immediate reuse proves valuable.
- **Complete audit history** — adjacent duplicates are intentionally collapsed and older entries may be bounded.
- **Unconditional arrow-key interception** — normal multiline editing and menu navigation remain intact.
- **Restoring a pre-browse draft** — V1 deliberately clears after the newest recalled entry.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver session-local recall, boundary-aware navigation, the recall position indicator, duplicate collapsing, lifecycle privacy, and keyboard guidance.
- Proceed when scripted usability sessions show users can recall, edit, resend, and return to a blank composer without confusion.

### Phase 2

- Refine the indicator wording and keyboard guidance from usage and usability evidence.
- Evaluate whether the bounded history capacity supports common retry workflows without adding persistent storage.
- Proceed when recall-to-edited-resend behavior meets the success threshold.

### Phase 3

- Reassess advanced discovery or retained prompt collections only if measured demand exceeds the value of the privacy-first V1 boundary.
- Require an explicit user-value and retention-policy decision before expanding scope.

## Success Metrics

| Metric | Target | Measurement |
| --- | ---: | --- |
| Recall adoption | ≥25% of eligible sessions | Sessions with at least two submitted prompts that use recall, measured without storing prompt content. |
| Edit-and-resend rate | ≥50% of recalled prompts | Recalled prompts followed by an edited resubmission. |
| Time-to-retry improvement | ≥20% faster in usability comparison | Median time to revise and resend a recent prompt versus manual re-entry. |
| Recall comprehension | ≥80% of usability participants | Participants correctly explain the position indicator and clear-on-Down boundary. |
| Cross-session exposure | 0 cases | Product acceptance evidence shows recalled prompts never appear outside their originating session. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users do not discover recall | Keep concise keyboard guidance near the existing composer help. |
| Users mistake recalled content for an ordinary draft | Show a compact, stable position indicator while browsing history. |
| Users expect arrows to move the cursor | Preserve normal multiline movement and menu navigation before recall. |
| Users worry about prompt retention | State the current-run, session-local boundary clearly and avoid persistence in V1. |
| Low usage leads to unjustified scope growth | Use edit-and-resend outcomes to decide whether any future discovery feature is warranted. |

## Architecture Decision Records

- [ADR-001: Scope Prompt Recall to the Active Agent Session](adrs/adr-001.md) — limits V1 to private, current-run history and safe arrow-key precedence.
- [ADR-002: Make Prompt Recall Visible and Collapse Adjacent Duplicates](adrs/adr-002.md) — adds visible recall state, concise duplicate handling, and an outcome-focused measure of value.

## Open Questions

- What bounded history capacity best serves common retry workflows without creating an expectation of durable storage?
- Should the position indicator show only ordinal position, or also the total available entries, after the MVP usability findings?
- Which content-free event definitions best distinguish an edited resend from a simple resend while preserving privacy?
