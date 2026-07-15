# Persist draft manifests and redacted sealed Context Pack payloads

Context engineering must resume across Kitten restarts without treating an old Explore child or capability attestation as live, and a Sealed Context Pack must remain the exact payload the operator reviewed even if workspace files later change. Kitten will persist a **Draft Manifest** containing paths, ranges, rationales, source identities, budget settings, and revision state without copied source content. **Pack Materialization** validates current sources and redacts the assembled payload before review; after sealing, that exact redacted payload is persisted through the existing owner-only run-storage boundary.

## Considered Options

- Keep every Context Pack in memory and discard it at exit.
- Persist only live paths and reconstruct both drafts and sealed packs from current files.
- Persist draft metadata and the exact redacted sealed payload while excluding live child authority.

## Consequences

- Restored drafts must revalidate their source identities before review or sealing.
- Restored sealed packs remain inspectable and reusable, but every send still requires a fresh Recipient Fit Check.
- Run-record schema and sanitization must cover Context Pack fields, reject excess content, retain owner-only file permissions, and prove that raw unredacted material cannot reach disk.
- Context Build lifecycle, capability attestations, reservations, and child ownership remain non-persistent.
