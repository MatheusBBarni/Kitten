# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the retired flat `answered` clarification result with structured submitted answers and the four terminal outcomes, while preserving the ACP anti-corruption boundary.

## Important Decisions

- Choice fields require explicit `allowsCustom`; text fields continue to represent custom-only input without choice options.
- `ClarificationAnswer` always carries `selectedOptionIds`; `customText` remains separate and optional.
- Native ACP normalization sets `allowsCustom: false`. ACP response translation accepts only `submitted` answers that exactly match the normalized field; every other terminal outcome or richer/invalid answer cancels.
- Shared V1 limits are exported from the protocol-free core: 10 fields, 20 options per choice field, and 4 KiB per text value.

## Learnings

- The existing ACP schema uses object property keys as field IDs, so duplicate native field IDs cannot survive parsing; duplicate option IDs are rejected during normalization and duplicate normalized payload IDs are rejected before ACP response translation.
- Telemetry directly consumed the old terminal kind and therefore had to move to the same closed four-kind vocabulary in this task.

## Files / Surfaces

- Core contract and tests: `src/core/types.ts`, `src/core/types.test.ts`.
- ACP translation and adapter-path tests: `src/agent/acpTranslate.ts`, `src/agent/acpTranslate.test.ts`, `src/agent/agentConnection.test.ts`.
- Mechanical consumers: `src/ui/ClarificationPrompt.tsx` and tests, `src/app/controller.ts` and tests, fake/integration fixtures, telemetry enum/tests.

## Errors / Corrections

- The workspace already contained unrelated harness-delivery edits overlapping `src/core/types.ts`, `src/agent/agentConnection.ts`, and `src/app/controller.ts`; task edits are being layered around and must not overwrite or stage unrelated work.
- The first focused typecheck exposed `CLARIFICATION_LIMITS` being imported through a type-only import; the import was corrected before verification.
- The mandatory full gate is not clean: typecheck passes, but the full test run reports 1,860 pass, 203 fail, and 4 skip. Failures include an inherited release-workflow policy mismatch, a broad OpenTUI renderer cascade, and clarification lifecycle fixtures stopped by the unrelated harness `Safe start unavailable` state.

## Ready for Next Run

- Implementation and migrations are present. The focused core/ACP/adapter/UI suite passes 153 tests, and the broader task-scoped suite passes 368 tests.
- Focused coverage reports 99.30% lines for `acpTranslate.ts` and 97.50% for `agentConnection.ts`; the selected-test command still exits nonzero because its aggregate over imported files is 60.34%.
- Self-review and whitespace validation are clean. Task status and master tracking remain pending, and no automatic commit was created because the repository-wide verification gate failed.
