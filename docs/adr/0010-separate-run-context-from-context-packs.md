# Separate automatic Run Context from reviewed Context Packs

Kitten Orchestrator will automatically assemble one immutable, auditable Run Context for each Run Attempt from the task, repository instructions, prior attempt and review notes, and bounded host-selected evidence. A reviewed Sealed Context Pack may be attached as an optional input, but Orchestrator never auto-seals, mutates, trims, or silently sends a Context Pack.

## Considered Options

- Requiring a reviewed Context Pack for every task was rejected because it adds a manual admission step to the normal unattended workflow.
- Auto-sealing Context Packs for trusted projects was rejected because it breaks the cross-product meaning of a Context Pack and Kitten's explicit-review safety contract.

## Consequences

Attempt evidence must retain the exact Run Context snapshot used. Shared context tooling may materialize and budget both forms, but the UI and domain model must keep automatic Run Context distinct from human-reviewed portable Context Packs.
