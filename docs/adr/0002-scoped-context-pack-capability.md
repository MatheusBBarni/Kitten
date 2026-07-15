# Allow Explore children to curate draft Context Packs through a scoped capability

RepoPrompt-style context engineering requires iterative selection changes, token feedback, and awareness of the changes under review, while Kitten's accepted `explore` contract previously allowed only the scoped `ask_user` bridge. Kitten will amend that contract to allow an attested, app-owned **Context Pack Capability** that is bound to the parent session and launch generation. It may curate a **Draft Context Pack**, inspect its budget state, and list or read bounded host-derived staged/unstaged per-file patches inside the Session Workspace plus pending diffs already captured by the parent. It cannot modify workspace files, use general Git or shell commands, access external MCP, control agents, seal a pack, or send content; capability attestation remains fail-closed and must cover this exact authority.

## Considered Options

- Keep `explore` unchanged and require the operator to translate its prose suggestions into a pack manually.
- Introduce a separate context-builder role with a second certified policy.
- Extend the fixed `explore` role with the selected app-state-only capability.

## Consequences

- The current `agent-role-profiles` packet finishes and remains truthful as report-only `explore-v1`.
- A separate follow-on `context-packs` packet must define and verify a new `explore-v2` policy snapshot, provider attestation, capability bridge, and verification matrix before Context Build can ship.
- Diff discovery must be path-contained, size-bounded, read-only, and limited to current per-file patch artifacts rather than a general Git command surface.
- Context Pack sealing and sending remain explicit human review boundaries and are never exposed to the child.
