# Ship a two-application Kitten monorepo

Kitten will become a monorepo that ships two distinct applications: **Kitten Cockpit**, the existing terminal application for interactive agent work, and **Kitten Orchestrator**, a desktop application for governed unattended task execution. They will share selected agent, session, context, and policy capabilities while retaining separate UI and entry-point boundaries; this preserves each workflow's focus without maintaining two repositories or forcing both products into one shell.

## Considered Options

- One desktop application with cockpit and orchestrator modes was rejected because it couples two different attention models and would make the existing TUI subordinate to the desktop shell.
- Retiring the cockpit was rejected because interactive live sessions and unattended queue execution are complementary products, not replacement workflows.

## Consequences

The migration must establish explicit shared-package boundaries, keep UI code app-local, and retire Task Orchestrator only after its required capabilities and relevant history have moved into the Kitten monorepo.
