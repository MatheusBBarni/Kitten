---
status: completed
title: "Publish the supported-label contract"
type: docs
complexity: low
---

# Task 9: Publish the supported-label contract

## Overview

Document the final, release-gated syntax-highlighting contract so developers know which labels Kitten enhances and what happens when it cannot. Keep the published language list synchronized with the manifest and make the fallback promise explicit without overstating ReScript support.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. MUST document canonical labels and aliases for JavaScript, TypeScript, Rust, Go, OCaml, ReScript when released, JSON, Bash, Python, Markdown, and diff.
- 2. MUST state that only documented, release-gated labels highlight and that unknown, malformed, unavailable, and unlabelled fences remain labelled, bounded, copy-safe plaintext.
- 3. MUST state that Kitten never guesses a language from unlabelled code or extensionless/dotfile diffs.
- 4. MUST omit ReScript from the highlighted-support list when its release gate remains unmet and describe its plaintext status honestly.
- 5. MUST add a docs-drift contract test tied to manifest metadata and run the relevant release-evidence checks.
</requirements>

## Subtasks

- [ ] 9.1 Add concise supported-label and fallback documentation.
- [ ] 9.2 Align published labels with the completed manifest and ReScript status.
- [ ] 9.3 Add docs-drift contract coverage.
- [ ] 9.4 Run focused and full release-evidence verification.

## Implementation Details

Follow the TechSpec **Technical Dependencies**, **Monitoring and Observability**, and **Development Sequencing** sections. This task publishes the evidence produced by the self-check task; it must not alter release workflows, build commands, or language behavior.

### Relevant Files

- `README.md` — user-facing installation and feature documentation.
- `src/ui/syntaxParsers.ts` — authoritative released labels and capability metadata.
- `src/app/selfCheck.ts` — capability-matrix release evidence.
- `test/build.integration.test.ts` — compiled-host proof.
- `test/releaseWorkflow.test.ts` — current native release self-check workflow contract.

### Dependent Files

- `README.md` — new Syntax Highlighting support and fallback section.
- `test/syntaxHighlightingDocs.test.ts` — new manifest-to-documentation drift check.
- `src/ui/syntaxParsers.test.ts` — focused manifest contract coverage run with the docs test.

### Related ADRs

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — supported labels are release-gated.
- [ADR-002: Default-on trustworthy code recognition](adrs/adr-002.md) — default behavior and readable fallback promise.
- [ADR-003: Static parser manifest with pre-initialization registration](adrs/adr-003.md) — manifest is the source of truth.

## Deliverables

- Published supported-label and fallback contract in the README.
- Manifest-aligned documentation drift test.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration and release-evidence verification **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Documentation labels and aliases exactly match released manifest metadata.
  - [ ] Documentation includes the no-guess, labelled plaintext, and copy-safe fallback statements.
  - [ ] ReScript documentation matches its actual release-gate state.
- Integration tests:
  - [ ] Focused manifest, self-check, compiled-artifact, and release-workflow tests pass together.
  - [ ] `bun run typecheck`, the full test suite, self-check, and build provide fresh evidence; inherited warnings or crashes are recorded as blockers.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Developers can determine supported labels and fallback behavior without reading source code.
- Documentation never promises a capability that lacks release evidence.
