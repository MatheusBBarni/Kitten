# Make run attempts durable and inspectable

Kitten Orchestrator will keep unattended execution as its default attention model, but every Run Attempt will be represented by a durable Kitten session within its Orchestrated Work. The review board remains the primary destination; a developer may open the active or historical session to inspect its reviewed context and transcript, resolve a genuine blocker, steer an active attempt, or delegate bounded work without being required to supervise normal execution.

## Considered Options

- Strict batch execution was rejected because it would discard the context, clarification, steering, and delegation value being brought into the shared Kitten core.
- Required interactive supervision was rejected because it breaks the predecessor product's walk-away workflow.

## Consequences

Attempt persistence must preserve enough protocol-free session state for inspection and recovery, while attention policy must distinguish genuine blockers from events that policy can settle automatically.
