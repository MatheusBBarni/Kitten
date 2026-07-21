---
status: completed
title: Persist Canonical Statusline Colors Safely
type: refactor
complexity: high
---

# Task 02: Persist Canonical Statusline Colors Safely

## Overview

Carry the expanded statusline layout through strict user configuration,
confirmation, boot, and external-reload lifecycle paths. A saved color must be
the exact canonical value reviewed by the user, while malformed preferences and
failed writes retain the existing fail-closed and no-state-change behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- Reuse the core-normalized layout in strict config parsing, resolved preferences, and atomic writes; never add a second color parser.
- Persist only canonical color values in the paired statusline delta and preserve unrelated user preferences.
- Maintain persist-before-apply confirmation behavior so a failed write leaves the active layout unchanged.
- Ensure boot seeding and external watcher reload accept canonical colors, reject invalid on-disk values, and do not create a write-back loop.
- Retain existing malformed-file, symlink-safety, atomic-write, null-layout, and recovery guarantees.
</requirements>

## Subtasks

- [x] 2.1 Extend strict statusline preference loading and resolved configuration for canonical colored layouts.
- [x] 2.2 Preserve atomic, unrelated-setting-safe persistence for colored statusline deltas.
- [x] 2.3 Carry canonical layouts through confirmation, boot seeding, and external reload without changing write ordering.
- [x] 2.4 Cover successful persistence, invalid configuration, failed writes, and watcher reload behavior with colored layouts.

## Implementation Details

Follow the TechSpec's Integration Points and existing config writer safety
patterns. Configuration remains a strict boundary: all accepted color-bearing
layouts must originate from the pure core normalizer.

### Relevant Files

- `src/config/configLoader.ts` — strict schema, resolved preference, and load/reload validation.
- `src/config/configLoader.test.ts` — valid and malformed config coverage.
- `src/config/configWriter.ts` — atomic user-preference persistence that preserves unrelated settings.
- `src/config/configWriter.test.ts` — canonical round-trip and writer-safety coverage.
- `src/index.ts` — confirmation, boot, and watcher lifecycle ownership.
- `test/index.integration.test.tsx` — mounted lifecycle coverage for confirmation and reload behavior.
- `test/configPersistence.integration.test.ts` — end-to-end persisted-preference round-trip coverage.

### Dependent Files

- `src/core/statusline.ts` — supplies the sole normalized statusline layout contract.
- `src/ui/StatuslineOverlay.tsx` — displays the reviewed canonical configuration change.

### Related ADRs

- [ADR-001: Keep statusline colors item-local and declarative](adrs/adr-001.md) — forbids alternate executable or shared preference surfaces.
- [ADR-003: Carry canonical colors through the pure statusline model](adrs/adr-003.md) — requires config and lifecycle reuse of canonical core output.

## Deliverables

- Strict color-aware config load, merge, and atomic persistence behavior.
- Confirmation, boot, and watcher lifecycle support for canonical colored layouts.
- Unit and integration regression coverage for persistence and reload safety.
- Focused suites plus the project regression commands required by the TechSpec for the completed cross-layer implementation.

## Tests

- Unit tests:
  - [x] Valid named and hex colors load as canonical values and round-trip without altering unrelated preferences.
  - [x] Invalid color syntax or extra item keys cause the existing hard configuration failure path.
  - [x] Atomic writes, malformed-file handling, and symlink protections continue to hold for colored layouts.
- Integration tests:
  - [x] Explicit confirmation persists before applying the reviewed canonical colored layout.
  - [x] Failed persistence and cancellation leave the active layout untouched.
  - [x] Fresh boot and an external config watcher reload expose the canonical color without a write-back loop.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- Disk, resolved configuration, and active lifecycle state agree on the same canonical color values.
- No invalid persisted color reaches the active layout.
- Existing user settings survive a colored statusline write unchanged outside the paired statusline delta.
- Focused tests and the required full regression gate pass with >=80% targeted coverage.
