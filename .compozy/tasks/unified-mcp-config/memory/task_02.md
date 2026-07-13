# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Build the boot-time MCP provisioning resolver that expands env references, resolves absolute commands, and partitions failures without throwing.

## Important Decisions

- Centralize env and command resolution in `src/config/mcpResolver.ts`, following task_02's refinement of the broader TechSpec split.
- Treat a throwing or non-absolute injected command resolution as command-not-found so provisioning remains warn-never-block.

## Learnings

- A single config-layer seam can leave task_03 as a pure ACP shape translator: successful servers already carry expanded env and absolute commands.
- Focused coverage is 100% for the resolver; the full repository gate passes with 1,246 tests and the existing opt-in reload probe skipped.

## Files / Surfaces

- `src/config/mcpResolver.ts`
- `src/config/mcpResolver.test.ts`

## Errors / Corrections

- The workspace already contains unrelated modified/untracked Compozy tracking files; keep them unstaged and outside this task's commit.

## Ready for Next Run

- Resolver contract is ready for task_05 controller wiring through `resolveMcpServers(servers, options)`.
- No shared workflow-memory promotion was needed; all decisions are local to this resolver.
