# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add fail-closed, separately versioned explore-v2 and Recipient Profile evidence resolvers without changing explore-v1 or starting any Context Build runtime.

## Important Decisions

- Model independently reviewed profiles separately from current runtime evidence; both must match the fully resolved command, ordered arguments, complete environment, adapter/runtime release, and model.
- Represent Context Build authority as one exact closed operation set: scoped `ask_user`, bounded draft/workspace reads, and revision-fenced draft mutation. Any partial or widened operation set is malformed or mismatched evidence.
- Make review and runtime evidence time-bounded through explicit validity windows supplied to a deterministic resolver clock; no environment switch, inferred provider support, or generic estimate participates in resolution.
- Keep production explore-v2 capability and Recipient Profile registries empty. Tests inject reviewed profiles explicitly, while production composition remains unavailable.

## Learnings

- Existing explore-v1 is already a distinct `explore-v1` attestation with an empty production registry and report-only restrictions; task 04 can remain isolated in a new module.
- Existing core Recipient Fit handles exact payload counts after recipient evidence exists. This task supplies the earlier recipe/profile evidence boundary and must not duplicate fit arithmetic.
- The ordinary harness registry can remain supported while a composed Context Pack result stays unavailable; this proves harness delivery cannot imply explore-v2 or recipient authority.
- Task-scoped coverage reached 100% for `contextPackCapability.ts` and 90.07% for the harness composition seam (95.03% combined).

## Files / Surfaces

- Planned implementation: `src/config/contextPackCapability.ts`, `src/config/contextPackCapability.test.ts`, `src/config/harnessCapability.ts`, `src/config/harnessCapability.test.ts`, and protocol-free vocabulary in `src/core/types.ts`.
- Regression-only inspection: `src/config/exploreCapability.ts` and `src/config/exploreCapability.test.ts`; preserve behavior unchanged.
- Implemented: `src/config/contextPackCapability.ts`, `src/config/contextPackCapability.test.ts`, `src/config/harnessCapability.ts`, `src/config/harnessCapability.test.ts`, `src/config/exploreCapability.test.ts`, and the Context Pack evidence vocabulary appended to `src/core/types.ts`.
- Tracking/memory only: `.compozy/tasks/context-packs/task_04.md` and `.compozy/tasks/context-packs/memory/task_04.md`; `_tasks.md` remains unchanged.

## Errors / Corrections

- The first shell baseline used `rtk test`, which the proxy interpreted incorrectly; the authoritative baseline is the later `rtk ls` result showing both resolver files are absent.
- Strict typecheck caught one harness test fixture whose provider id widened to `string`; the fixture was corrected to `ResolvedAgentConfig` before final verification.
- A broad focused-coverage command that also loaded `explorePolicy.ts` tripped that dependency's per-file threshold. The task-owned unit/integration coverage command excludes unrelated policy coverage and passed at 95.03%; explore-v1 regressions still pass in targeted and full-suite runs.

## Ready for Next Run

- Implementation and self-review are complete. Exact recipe, authority, freshness, capacity, reserve, and counter evidence resolve only through explicitly injected reviewed profiles; both production registries remain empty.
- Fresh `rtk bun run typecheck && rtk bun test` exited 0 after all code changes. The targeted 44-test capability suite and 32-test coverage suite also passed with zero failures.
- Later controller/bridge tasks may call the composed resolver, but must not add an environment override, infer support from harness/explore-v1, or turn generic Pack Estimate into recipient evidence.
