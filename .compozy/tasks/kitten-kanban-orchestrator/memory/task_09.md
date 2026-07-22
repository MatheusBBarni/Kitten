# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implemented the desktop-owned deterministic local Skill Catalog, journal-backed catalog projections,
and immutable exact-content Skill snapshots. The implementation is ready for downstream runnable
validation and attempt Run Context integration without display-name selection.

## Important Decisions

- Catalog ordering uses code-unit comparison: every canonical project root and its entries precede
  user roots, independently of configured input order.
- A Skill identity is `skill:` plus SHA-256 over its canonical `SKILL.md` location and validated
  content digest. Workflow stage/card Skill values now reject non-catalog free-text identities.
- Snapshot content is persisted as a SQLite BLOB and strictly decoded as UTF-8 on read so a valid
  leading BOM and all other validated bytes remain exact.
- Catalog replacement is an immutable journal event with disposable current projections. Snapshot
  rows are append-only, trigger-protected, and replay idempotently during projection rebuild.

## Learnings

- Bun's SQLite TEXT binding strips a leading UTF-8 BOM. BLOB persistence is required for the task's
  exact validated-content contract while retaining a string-facing host model.
- Explicitly finalizing replay/read statements prevents active statement handles from interfering
  with reopen and close evidence in the package's temporary-SQLite tests.

## Files / Surfaces

- Added `packages/desktop/src/catalog/` contracts, discovery, projection adapter, fixtures, and tests.
- Extended desktop migrations, event-journal validation/projections/snapshots, projection rebuild,
  and SQLite lifecycle tests.
- Tightened `packages/desktop/src/workflow/workflowTypes.ts` SkillId construction and updated existing
  workflow/journal fixtures to use digest-backed identities.

## Errors / Corrections

- Initial snapshot persistence used SQLite TEXT. A BOM regression test exposed byte loss, so storage
  was corrected to BLOB with strict UTF-8 decoding before final verification.
- Strict forced SQLite close exposed cached/active statement behavior in the existing journal suite.
  Read/rebuild statements are finalized and the normal close path is now asserted to leave the
  database unusable after closing.

## Ready for Next Run

- Task 11 can validate stage defaults/card overrides against catalog SkillIds and snapshot the chosen
  entry into an immutable Run Context.
- Task 17 can consume the persisted root, entry, collision, and invalid-file diagnostics through the
  future typed host RPC boundary.
