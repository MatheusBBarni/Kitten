# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- Task 03 removed root `src`/`test` ownership; Cockpit production code, colocated tests, contract tests, and fixtures now resolve exclusively under `packages/tui`.
- Task 04 removed the final root build/bin compatibility bridges and moved public package, CI, release, changelog, and delivery-checker ownership to `packages/tui`; `scripts/install.sh` remains at the repository root as the canonical stable installer URL.
- Task 10 established one durable desktop-owned Git worktree binding per card under `.kitten/worktrees/cards/<opaque-binding-id>`, with branch `kitten/card/<opaque-binding-id>` and persisted canonical repository, common-Git-dir, and baseline identity.

## Shared Decisions

- During the staged relocation, package lifecycle scripts must name package-owned entrypoints while preserving the historical workspace working directory until Tasks 03/04 remove the compatibility bridges.
- Package-owned lifecycle commands continue to preserve the historical workspace cwd with explicit package-local targets because same-binary MCP contracts depend on that cwd behavior.

## Shared Learnings

- Desktop follow-up queue journal events do not consume `attempt_sequence`: that sequence remains reserved for normalized ACP activity ordering, while queue attempt/generation identity is validated inside each immutable queue payload. Interleaving the two would create false ACP sequence gaps during replay.
- Attention Blocker journal events likewise do not consume `attempt_sequence`; blocker ordering and replay use the blocker projection version while ACP activity sequencing remains independent.

## Open Risks

## Handoffs

- Future delivery work must preserve the public `@matheusbbarni/kitten` identity, `kitten` command, native artifact/checksum names, installer URL, update refusal, provenance behavior, and package-scoped release ownership established by Task 04.
- Attempt launch and recovery consumers must call the card worktree service to reuse and freshly verify the persisted binding; they must not mutate the trusted parent checkout or automatically push, remove, or force-clean a binding. Cleanup remains explicit and refusal-first.
- Attention consumers must use the durable blocker projection and `needs_attention` execution status as authority: terminal outcome commits before same-attempt resume, while notification delivery or failure remains observable and cannot resolve or duplicate the blocker.
