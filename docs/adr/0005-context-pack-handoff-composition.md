# Carry an optional sealed Context Pack inside the Handoff Bundle

Kitten's existing **Handoff Bundle** captures conversation continuation, referenced files, diffs, and optional shell context, while a **Sealed Context Pack** captures deliberately curated task and workspace context. Kitten will keep the Handoff Bundle as the cross-agent transport envelope and allow it to carry at most one Sealed Context Pack in V1. Assembly deduplicates envelope file and diff blocks already represented by the pack, then presents one combined exact-payload review and confirmation; the attached pack remains immutable and may only be attached or removed as a whole.

## Considered Options

- Flatten the pack into ordinary hand-off blocks and discard its identity.
- Replace the existing Handoff Bundle and assembler with Context Packs.
- Compose the two artifacts while preserving their distinct responsibilities.

## Consequences

- Existing no-auto-send, redaction, curation-by-identity, and explicit-confirmation invariants continue to govern the final transport.
- Handoff assembly needs deterministic overlap rules based on source identity rather than display path or list index.
- Editing an attached pack's contents exits the hand-off flow into a new draft and review cycle; hand-off review cannot mutate a sealed payload in place.
- The same Sealed Context Pack remains reusable for parent sends and delegated-child starts outside hand-off.
