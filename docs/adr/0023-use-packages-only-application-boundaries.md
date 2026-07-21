# Use packages-only application boundaries

## Status

Accepted

The Kitten monorepo will contain application and capability code only under `packages/`: `packages/tui` hosts Kitten Cockpit, `packages/desktop` hosts the Electrobun Kanban Orchestrator and its app-owned SQLite/controller lifecycle, and `packages/engine` exposes only UI-free shared capabilities. This refines the two-application monorepo decision without reviving a universal controller: the desktop owns board scheduling, worktrees, Direct ACP runtime, and persistence, while the terminal application retains its own lifecycle.

## Consequences

- No top-level `apps/` application boundary is introduced.
- React, HeroUI, Tailwind, Zustand, and TanStack Query remain desktop-renderer concerns behind typed Electrobun RPC; the Bun-side Orchestrator controller is not reachable directly from the renderer.
- Shared `packages/engine` contracts may be consumed by both applications but must stay free of board state, SQLite, worktree ownership, and application controller state.
