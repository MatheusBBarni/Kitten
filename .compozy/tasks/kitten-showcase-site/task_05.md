---
status: pending
title: Add live GitHub star count integration with resilient fallback
type: frontend
complexity: medium
---

# Task 05: Add live GitHub star count integration with resilient fallback

## Overview

Implement the runtime GitHub star display so the page shows an accurate support signal without inflating engagement metrics or adding third-party tracking. The behavior must degrade gracefully when the API is unavailable and never render a fabricated zero.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON WHAT — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST fetch `https://api.github.com/repos/{owner}/{repo}` on the client using repository config values from Task 02.
2. MUST render loading state, success state, and non-fabricated fallback state in the star control.
3. MUST keep repository link clickable even when star count is unavailable.
4. MUST avoid emitting visitor-level telemetry or persistent identifiers in the fetch flow.
5. MUST handle common failure modes (network, API errors, rate limiting) with stable UI output.
</requirements>

## Subtasks

- [ ] 05.01 Implement `site/src/scripts/star-count.ts` with fetch + parse + state update logic.
- [ ] 05.02 Add `data-*` hooks in `site/src/components/SiteControls.astro` for dataset-driven runtime updates.
- [ ] 05.03 Update site config/metadata integration with repo owner/name values used by the API call.
- [ ] 05.04 Add visible fallback text that is explicit and never defaults to `0`.
- [ ] 05.05 Add minimal request-throttle guard so only one request is triggered per render context.

## Implementation Details

This task follows TechSpec API endpoint and integration requirements for star proofing.

- `site/src/scripts/star-count.ts`: request lifecycle and DOM update behavior.
- `site/src/components/SiteControls.astro`: star count label, status text, and repo link.

### Relevant Files

- `site/src/scripts/star-count.ts` — client-side GitHub API integration.
- `site/src/components/SiteControls.astro` — rendering target for star count and repo link.
- `site/src/config/showcase-config.ts` — repo owner/name source of truth.

### Dependent Files

- `.compozy/tasks/kitten-showcase-site/task_03.md` — base component to attach star control attributes.
- `.compozy/tasks/kitten-showcase-site/task_06.md` — a11y and visual treatments for loading/error states.

### Related ADRs

- [ADR-005: Resolve GitHub star count client-side with resilient fallback](../adrs/adr-005.md) — direct implementation constraint.
- [ADR-002: Center V1 on a Verified Two-Agent Handoff](../adrs/adr-002.md) — secondary social proof remains secondary to CTA trust.

## Deliverables

- Runtime star count flow with loading, success, and fallback states.
- No fabricated counts and no tracking side effects.
- Unit tests for response parsing and fallback state transitions.
- Integration checks that star count updates and link remains functional on failure.
- Unit test coverage target: >=80% for star-count parser and state mapper logic.

## Tests

- Unit tests:
  - [ ] Successful response path parses `stargazers_count` and updates label.
- [ ] Error response path keeps fallback text and preserves repo link.
  - [ ] Rate-limit/error simulation still renders explicit nonzero fallback and no crash.
- Integration tests:
  - [ ] Browser/page smoke renders fallback quickly before API resolution.
  - [ ] Manual network-blocked run keeps control readable and clickable.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80% for response parsing and fallback handling
- Fallback text is shown without rendering fabricated zero values
- Star control remains functional when API is unavailable
