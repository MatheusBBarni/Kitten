# Keep direct ACP and Compozy execution routes

Kitten Orchestrator will support two execution routes: direct ACP sessions through the certified Claude, Codex, and Cursor profiles, and the existing Compozy CLI workflow under the same host-owned governance. The provider-specific Claude Agent SDK runner will exist only as a migration rollback path and will be removed after direct ACP reaches the required parity gates.

## Considered Options

- ACP-only execution was rejected because Compozy represents a higher-level task workflow with deliberate product value, not another provider wire adapter.
- Keeping the Claude SDK runner permanently was rejected because it duplicates the direct Claude ACP route and preserves the provider coupling this migration is intended to remove.

## Consequences

Task routing must model route identity separately from ACP provider identity. Both routes must satisfy the same worktree, scoped-credential, no-push, budget, cancellation, baseline, gate, and review contracts, while route-specific readiness and evidence remain explicit.
