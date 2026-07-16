# Preserve work lineage across fresh attempts

One Orchestrated Work will retain the task's isolated worktree, branch, original pre-change baseline, and pull request across review cycles. Each review rejection creates a new Run Attempt with a fresh ACP session and immutable Run Context; prior transcripts, contexts, gate evidence, costs, and feedback remain append-only history.

## Considered Options

- Resuming the same ACP session was rejected because provider recovery and hidden conversational state would become correctness dependencies.
- Rebuilding from the base branch for every review cycle was rejected because it discards accepted work and fragments one review conversation across branches and pull requests.

## Consequences

The domain and persistence model must assign distinct work, attempt, session, and evidence identities. The original baseline is captured once per Orchestrated Work, while verification after each attempt evaluates the cumulative worktree against that baseline.
