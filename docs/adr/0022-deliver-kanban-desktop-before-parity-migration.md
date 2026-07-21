# Deliver the Kanban desktop product before parity migration

## Status

Accepted

Kitten will deliver a macOS-first, local-first Kanban desktop Orchestrator now, rather than first preserving the predecessor desktop product as a parity migration. This intentionally supersedes ADR-0012: the new product centers editable Workflow Stages, locally cataloged Workflow Skills, durable Direct ACP Run Attempts, scoped `ask_user` Attention Blockers, and explicit human review, because the desired operating model is a governed Skill pipeline rather than a behavior-preserving import.

## Consequences

- The existing parity-only `kitten-orchestrator` packet must be replanned before implementation; it is no longer the delivery sequence.
- Board and attempt records remain local and app-owned, but their schema follows the new Workflow Board and Run Transcript terminology instead of predecessor UI behavior.
- Automatic execution remains bounded and review-governed: fresh installs allow one active run globally, no final-stage success publishes work, and an operator completes reviewed work explicitly.
