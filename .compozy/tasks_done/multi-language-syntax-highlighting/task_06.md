---
status: completed
title: "Register syntax capabilities at boot and render entry points"
type: frontend
complexity: high
---

# Task 6: Register syntax capabilities at boot and render entry points

## Overview

Wire the completed static manifest into normal startup and both code-render entry points before OpenTUI can initialize its global Tree-sitter client. The task must preserve permanently streaming Markdown, complete-fence normalization, and the shared diff no-guess contract while making direct UI mounts safe.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST register syntax parsers after the embedded worker is configured and before cockpit rendering begins.
- 2. MUST invoke the same idempotent guard immediately before `<markdown>` and shared `<diff>` construction.
- 3. MUST retain `MARKDOWN_STREAMING = true` and leave `normalizeMarkdownForDisplay()` behavior unchanged except where later fallback requirements require an explicit correction.
- 4. MUST keep `filetypeFor()` as the sole diff-extension/no-guess decision point.
- 5. MUST provide a boot-order test seam without creating module-import native allocations.
</requirements>

## Subtasks

- [x] 6.1 Register completed capabilities in normal boot order.
- [x] 6.2 Guard shared Markdown direct mounts.
- [x] 6.3 Guard the shared diff body used by transcript and overlays.
- [x] 6.4 Add boot-order and direct-render regression evidence.

## Implementation Details

Follow the TechSpec **System Architecture**, **Integration Points**, and **Development Sequencing** sections. Registration is global and must precede the first client creation; no per-surface alias maps, main-view restructuring, self-check expansion, or diagnostics implementation belongs here.

### Relevant Files

- `src/index.ts` — current worker setup and cockpit-render boot gate.
- `src/ui/Markdown.tsx` — sole shared Markdown leaf and streaming compatibility pin.
- `src/ui/ToolCallRow.tsx` — shared diff body used by transcript and overlay surfaces.
- `src/ui/syntaxParsers.ts` — idempotent registration contract from earlier tasks.
- `test/index.integration.test.tsx` — injected boot-dependency and ordering test seam.

### Dependent Files

- `src/index.ts` — boot registration call.
- `src/ui/Markdown.tsx` — direct mount guard.
- `src/ui/ToolCallRow.tsx` — shared diff guard.
- `test/index.integration.test.tsx` — boot-order evidence.
- `src/ui/Markdown.test.tsx` — direct Markdown registration and teardown coverage.
- `src/ui/ConversationView.test.tsx` — diff extension/no-guess regression coverage.

### Related ADRs

- [ADR-002: Default-on trustworthy code recognition](adrs/adr-002.md) — consistent live and hand-off reading experience.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — mandatory registration order and shared guards.

## Deliverables

- Boot-ordered and entry-point-guarded parser registration.
- Preserved Markdown streaming and diff extension contracts.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for boot, Markdown, and diff paths **(REQUIRED)**.

## Tests

- Unit tests:
  - [x] Repeated entry-point guards do not register duplicate parser overrides.
  - [x] Registration is not invoked by importing the entry module alone.
  - [x] `filetypeFor()` retains its existing extensionless, trailing-dot, and dotfile results.
- Integration tests:
  - [x] Worker configuration completes before parser registration and cockpit render in the injected boot path.
  - [x] A direct Markdown test mount registers capabilities before code rendering and preserves multi-block streaming output.
  - [x] Transcript and overlay diff paths reach the shared guard without changing displayed or copied diff source.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Every code-render path sees the same parser manifest before client initialization.
- No regression to streaming Markdown or unguessed diff behavior.
