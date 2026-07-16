# Share capabilities, not application lifecycles

Kitten Cockpit and Kitten Orchestrator will share packages for ACP transport and translation, readiness, protocol-free agent/session concepts, context, clarification, steering, harness behavior, and common policy primitives. They will not share one universal controller, store, or workflow engine: the cockpit owns long-lived interactive sessions, while the orchestrator owns queued task execution, worktrees, verification, and review governance.

## Considered Options

- A unified engine was rejected because live conversations and unattended task runs have different lifecycle, persistence, and attention semantics.
- Sharing only ACP transport was rejected because it would duplicate the protocol-free domain and policy contracts that are intended to stay consistent across both applications.

## Consequences

Shared packages must remain UI- and application-lifecycle-free. Each app adapts the common capabilities into its own controller and state model, and orchestrator-only governance code must not leak into the cockpit.
