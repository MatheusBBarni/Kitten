# PRD: Conversational Statusline Customization (`/statusline`)

## Overview

Kitten gives developers a compact status strip containing valuable workspace and agent context, but every developer currently sees the same fixed information hierarchy. Conversational Statusline Customization lets an individual developer invoke `/statusline`, describe the personal statusline they want, inspect a real preview and exact config change, then save it only after explicit confirmation.

The feature makes a confirmed layout visible immediately in the active cockpit and retains it as that developer's personal preference. It offers the convenience users have learned from conversational statusline tools while remaining bounded, compact, and trustworthy: Kitten proposes a safe declarative layout rather than a command or script. The primary audience is developers who regularly move among repositories, branches, models, and reasoning levels and want their cockpit to foreground the information they personally need.

## Goals

- Let a first-time developer create and save a useful personal statusline without learning configuration syntax.
- Make the effect of a confirmed change immediate, visible, and consistent with the preview.
- Give developers clear control over whether a natural-language request is sent to an LLM.
- Keep the MVP compact and personal: a single-line layout built from a small, understandable set of status fields.
- Validate first-use quality through moderated usability evaluation, without recording statusline content or request text.

## User Stories

### Individual developer

- As a developer switching between repositories, I want to describe the status information I care about so that my cockpit reflects my workflow rather than a fixed default.
- As a developer with long branch names, I want a shortened branch option so that my statusline remains readable on a narrow terminal.
- As a developer reviewing an AI-assisted change, I want to see the exact resulting line and config change before I save so that I remain in control.
- As a privacy-conscious developer, I want clear acknowledgement before my request is sent to an LLM so that I can make an informed decision.
- As a developer whose request cannot be completed, I want a small set of useful fallback layouts so that I can still personalize the cockpit.

### Returning developer

- As a returning developer, I want my saved personal layout to appear consistently so that I do not need to reconfigure the cockpit for every session.
- As a developer whose status data is temporarily unavailable, I want the line to stay honest and compact rather than display invented or misleading values.

## Core Features

### Conversational personal layout request — Critical

`/statusline` opens a focused experience where the developer describes the statusline they want in natural language. The flow is personal to the developer and uses the active session's visible workspace and agent context.

### First-request data-use acknowledgement — Critical

Before the first request is sent to an LLM, Kitten shows a concise explanation of what will be shared and requires acknowledgement. The developer may decline; declining reveals the recovery path rather than blocking personalization entirely.

### Safe ordered statusline choices — Critical

Kitten supports an ordered, single-line layout composed from a deliberately limited field set: folder, full path, branch, shortened branch, provider, model, effort, and help text. The developer can choose a separator. Unsupported requests are explained plainly rather than approximated or silently changed.

### Exact preview, diff, and explicit save — Critical

Every proposal shows the rendered line in the current terminal context alongside the exact personal configuration change. Save and Cancel are explicit choices. Saving applies the approved line immediately in the active cockpit and makes it the developer's retained preference.

### Compact and honest rendering — High

The statusline stays one line and readable on narrow terminals. When information is unavailable or space is constrained, Kitten applies predictable omission and shortening behavior; it never invents a value or expands into multiple lines.

### Recovery-only presets — High

Three fixed layouts provide a reliable recovery path when the LLM is unavailable, cannot satisfy the request, or the developer opts out. These layouts use the same preview and confirmation experience as a conversational proposal.

## User Experience

1. A developer discovers `/statusline` through Kitten's command menu or help.
2. They invoke it and describe the information order and compactness they want.
3. On the first request, Kitten clearly explains the LLM data-use boundary. The developer acknowledges it or declines.
4. Kitten presents a single-line preview at the current terminal width plus the exact personal config change.
5. The developer confirms or cancels. Confirmation updates the visible statusline immediately.
6. If conversation is unavailable, cannot fulfill the request, or is declined, Kitten presents three fixed layouts as a recovery option.
7. On future sessions, the developer sees the retained personal layout without repeating the setup flow.

The experience remains keyboard-first, concise, and readable. The preview must make narrowed branches, omitted unavailable fields, and help-text visibility understandable before any saved change occurs.

## High-Level Technical Constraints

- The feature is limited to a personal, single-line statusline preference in MVP.
- Only the documented status fields and bounded formatting choices may be proposed or saved; no executable, dynamic, or arbitrary output is part of the product contract.
- The active statusline after confirmation must match the preview the developer approved.
- Kitten must obtain explicit first-request acknowledgement before sending a natural-language request to an LLM and must not retain request text, raw responses, or statusline content for measurement.
- Saving must preserve the developer's unrelated existing configuration and must never occur without explicit confirmation.
- The experience must remain legible at constrained terminal widths and visibly handle unavailable data.

## Non-Goals (Out of Scope)

- Arbitrary shell scripts, templates, ANSI control sequences, timers, or dynamic commands.
- Multiline statuslines, a visual drag-and-drop editor, or free-form formatting languages.
- Shared team layouts, repository-specific profiles, import/export, or layout marketplaces.
- Cost, rate-limit, external-service, or arbitrary custom status fields.
- A general conversational settings assistant beyond this one personal statusline flow.
- Statusline-specific telemetry, request logging, or retention of raw LLM output.

## Phased Rollout Plan

### MVP (Phase 1)

- Conversational `/statusline`, first-request acknowledgement, ordered safe fields, exact preview/diff, explicit confirmation, immediate application, and recovery-only presets.
- Success criteria: in a moderated study, at least 9 of 12 first-time participants save a layout unaided; the median time from invocation to confirmed save is 90 seconds or less; and every saved change follows visible confirmation.

### Phase 2

- Expand only the safe field and compact-format choices demonstrated by MVP requests, while preserving the same preview and disclosure model.
- Success criteria: additional choices improve successful first-use completion without reducing preview comprehension or increasing recovery-path reliance.

### Phase 3

- Evaluate project or team statusline profiles and the broader use of the reviewed conversational-preference pattern.
- Long-term success criteria: developers can carry an understandable personal default across work while more specialized profiles remain opt-in and predictable.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| First-creation completion | At least 9 of 12 participants | Moderated usability study: participant saves a layout unaided |
| Time to satisfactory layout | Median of 90 seconds or less | Invocation to confirmed save during the same study |
| Preview comprehension | At least 10 of 12 participants | Participant correctly describes the saved statusline before confirmation |
| Confirmation integrity | 100% of saved changes | Study observation and acceptance evidence show a visible confirmation preceded every save |
| Recovery clarity | At least 10 of 12 participants understand why presets appeared | Scenario-based usability prompt after an unavailable, unsatisfied, or declined request |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers expect arbitrary statusline scripting | Show the supported capabilities clearly and explain unsupported requests in plain language. |
| Developers do not understand what leaves the machine | Use a concise blocking acknowledgement before the first LLM request. |
| Narrow terminals make a layout hard to read | Preview the actual single-line result and use predictable shortening and omission. |
| The LLM is unavailable or cannot fulfill the request | Offer recovery-only presets through the same review and confirmation experience. |
| Immediate changes make users uneasy | Show the exact config diff and visible result before confirmation, with Cancel always available. |
| First-use measurement creates a privacy concern | Use a moderated study for MVP evaluation and collect no statusline-specific telemetry. |

## Architecture Decision Records

- [ADR-001: Constrain V1 to declarative conversational statusline configuration](adrs/adr-001.md) — preserve a bounded, non-executable layout model.
- [ADR-002: Make the statusline flow immediate, disclosed, and conversational-first](adrs/adr-002.md) — apply confirmed changes immediately, require first-request acknowledgement, and reserve presets for recovery.

## Open Questions

- Which LLM or agent will process a statusline request, and what exact destination wording should the acknowledgement use?
- Which three fixed layouts best serve as the recovery presets?
- What copy best explains an unavailable or unsupported request without making the developer feel blocked?
- Which additional safe fields, if any, earn inclusion after MVP usability findings?
