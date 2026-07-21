# Migrate the desktop product parity-first

## Status

Superseded by [ADR-0022](0022-deliver-kanban-desktop-before-parity-migration.md)

Kitten Orchestrator will begin as a behavior-preserving migration of the existing Task Orchestrator desktop application into the Kitten monorepo. The Electrobun shell, typed RPC boundary, SQLite persistence, trust onboarding, queue/worktree/gate/review governance, security guards, tests, and current React UI establish the parity baseline; agent, session, context, and policy internals move onto Shared Capabilities incrementally after each migrated slice passes its existing contracts.

## Considered Options

- Migrating only the backend and designing a new UI immediately was rejected because it combines product redesign with repository and runtime migration.
- Selective clean-room reconstruction was rejected because it makes lost behavior, evidence, and security invariants difficult to detect.

## Consequences

The migration plan needs explicit parity gates for every slice and must preserve data compatibility until a deliberate migration replaces it. Rebranding and visual redesign cannot be used to hide missing predecessor behavior.
