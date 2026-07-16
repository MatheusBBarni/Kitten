# Use reviewed handoffs instead of shared live sessions

Moving work between Kitten Orchestrator and Kitten Cockpit will use an explicit Cross-App Handoff containing reviewed task, worktree, context, transcript, and evidence material. The recipient application starts a new session it owns; neither transparent provider-session resume nor concurrent control of one live ACP session is part of the contract.

## Considered Options

- Transferring a live ACP session was rejected because provider resume behavior would become a cross-app correctness and recovery dependency.
- Concurrent session control was rejected because duplicate prompts, conflicting permissions, and split lifecycle ownership require a distributed broker unrelated to the core product goal.

## Consequences

The handoff must make the new-session boundary visible, preserve source evidence, redact and review transferred material, and coordinate worktree access so only one application may actively mutate it at a time.
