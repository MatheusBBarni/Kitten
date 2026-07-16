# Pause run attempts only for clarification

Kitten Orchestrator will pause a Run Attempt for reactive user input only when an agent raises a bounded task or domain clarification. ACP permission requests remain host-policy decisions: requests inside the existing worktree, sandbox, scoped-credential, and no-push guardrails are approved automatically, while boundary escapes are denied automatically and recorded as safe failures.

## Considered Options

- Prompting for permissions was rejected because it turns normal unattended execution into babysitting and risks treating the agent as a policy authority.
- Rejecting all clarifications was rejected because missing product intent is not safely inferable and should not be disguised as an execution failure.

## Consequences

The desktop attention model needs a dedicated Needs You state for clarification, bounded settlement and recovery behavior, and clear separation between task intent and runtime authorization.
