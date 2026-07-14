---
status: completed
title: "Add Pure Statusline Layout Contract and Renderer"
type: backend
complexity: medium
---

# Task 01: Add Pure Statusline Layout Contract and Renderer

## Overview

Create the protocol-free statusline domain module that owns the allowlisted layout model, strict response parsing, normalization, session-context mapping, and deterministic rendering. This gives the later config, preview, and footer surfaces one source of truth, so an approved layout cannot render differently after it is saved.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a pure `src/core/statusline.ts` module that exports the layout, preference, context, normalized segment, parser-result, and preset contracts described by the TechSpec "Core Interfaces" and "Data Models" sections.
- MUST accept only `FOLDER`, `FULL_PATH`, `BRANCH`, `ELLIPSIS_BRANCH`, `PROVIDER`, `MODEL`, `EFFORT`, and `HELP_TEXT`; unknown, duplicate, empty, malformed, or executable values MUST be rejected.
- MUST enforce printable separators, paired layout fields, a 4–80 grapheme `ELLIPSIS_BRANCH` limit, and the sole fenced-JSON response contract without heuristic extraction.
- MUST render values in declared order, omit unavailable values and adjacent separators, shorten only `ELLIPSIS_BRANCH`, and omit trailing segments to fit the supplied grapheme budget.
- MUST remain deterministic and free of React, ACP, filesystem, timers, process access, telemetry, and terminal I/O.
</requirements>

## Subtasks

- [x] 1.1 Define the bounded declarative layout, preference, context, segment, proposal-result, and recovery-preset contracts.
- [x] 1.2 Normalize and validate layouts from persisted configuration and model proposals with one shared acceptance boundary.
- [x] 1.3 Parse only a complete, single fenced JSON reply and return a legible invalid or unavailable result for every rejected response.
- [x] 1.4 Derive allowed field values and render a one-line segment sequence with deterministic omission and branch ellipsis.
- [x] 1.5 Add direct coverage for valid layouts, invalid inputs, Unicode graphemes, omission, and recovery presets.

## Implementation Details

Create the pure core seam described in TechSpec "Component Overview", "Core Interfaces", and "Data Models". Keep rendering policy here rather than duplicating formatters in the overlay or `StatusStrip`; later layers provide session values and terminal width but never reinterpret saved layout data.

### Relevant Files

- `src/core/statusline.ts` — new pure layout validation, proposal parsing, context mapping, rendering, and fixed preset definitions.
- `src/core/statusline.test.ts` — colocated deterministic tests for parser, normalizer, and renderer behavior.
- `src/core/types.ts` — existing protocol-free types and session read models that provide the allowed context inputs.

### Dependent Files

- `src/config/configLoader.ts` — validates the persisted delta through the shared domain contract.
- `src/store/appStore.ts` — stores resolved preference and transient proposal payload without duplicating layout semantics.
- `src/app/statuslineFlow.ts` — accepts only the parser result from this module.
- `src/ui/StatuslineOverlay.tsx` and `src/ui/StatusStrip.tsx` — render preview and footer segments through the same renderer.

### Related ADRs

- [ADR-001: Constrain V1 to declarative conversational statusline configuration](adrs/adr-001.md) — requires bounded non-executable fields and deterministic rendering.
- [ADR-003: Persist a structured statusline preference and share one pure renderer](adrs/adr-003.md) — establishes the shared renderer and grapheme policy.
- [ADR-004: Use the focused agent transcript with a strict fenced proposal contract](adrs/adr-004.md) — defines the strict response acceptance boundary.

## Deliverables

- A pure statusline domain module with validated layout, parser, preset, context, and renderer behavior.
- Colocated unit coverage for all accepted and rejected layout and reply forms.
- A context-to-renderer composition test with no agent, filesystem, or terminal dependency.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for statusline core composition **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] A layout containing every supported simple field and one bounded `ELLIPSIS_BRANCH` normalizes successfully.
  - [x] Unknown fields, duplicate field kinds, empty lines, control-character separators, invalid paired layout fields, and branch limits outside 4–80 are rejected with a reason.
  - [x] A response consisting of exactly one fenced `json` block is accepted, while prose, multiple blocks, bare JSON, malformed JSON, and unsupported output are rejected.
  - [x] A multigrapheme branch shortens at the configured grapheme limit without splitting a grapheme cluster.
  - [x] Missing branch, model, effort, or path values remove their segment and do not leave doubled separators.
  - [x] A narrow budget preserves declared order and removes trailing segments without shortening non-ellipsis values.
- Integration tests:
  - [x] A saved Compact preset composed with a representative focused-session context produces the same ordered segments expected by a consumer at 80 and 64 grapheme budgets.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every preview and footer consumer can use one validated, deterministic renderer.
- No unsupported field, template, command, ANSI sequence, or arbitrary output is accepted.
