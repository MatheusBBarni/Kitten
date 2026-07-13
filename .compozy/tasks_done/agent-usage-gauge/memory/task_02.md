# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Surface ACP `usage_update` as the protocol-free domain `usage` event while dropping `cost` and `_meta`; preserve all other unsurfaced variants as `null`.

## Important Decisions

- Keep `translateUsage` private and validate its public contract through `translateSessionUpdate`.
- Exercise connection dispatch through the existing in-memory ACP transport and mock agent rather than invoking private routing methods.

## Learnings

- The installed ACP SDK defines `UsageUpdate` with required numeric `used`/`size` plus optional `cost` and `_meta`; field-by-field copying is sufficient to keep the domain event content-free.
- Existing `AgentConnection.onSessionUpdate` routing already emits every translated non-message event immediately, so no production routing change was required.
- Verification passed with 97.00% function and 98.24% line coverage overall; both modified production modules reported 100% function and line coverage.

## Files / Surfaces

- `src/agent/acpTranslate.ts`
- `src/agent/acpTranslate.test.ts`
- `src/agent/agentConnection.test.ts`

## Errors / Corrections

- The first baseline `--test-name-pattern` did not match Bun's expanded parameterized test name; rerunning the full canonical translator suite captured the valid pre-change signal.

## Ready for Next Run

- Task 02 is implemented and verified. `usage_update` now reaches `onUpdate` subscribers as `{ kind: "usage", used, size }`; translation and connection tests cover metadata/cost exclusion and preserved null variants.
