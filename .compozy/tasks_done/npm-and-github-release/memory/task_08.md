# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Complete the consolidated release train with a consumer-atomic five-package
  npm publish under Trusted Publishing, then verify the real published package
  on all four native runners without Bun.

## Important Decisions

- Follow ADR-003's consolidated workflow: `publish` waits for the release cut,
  every matrix build, and Release-asset attachment before publishing.
- Keep OIDC permission scoped to the publish job and keep steady-state workflow
  authentication free of npm registry secrets.
- Derive the npm version from the checked-out release `package.json`, require it
  to match the `vX.Y.Z` tag, and synchronize all exact optional-dependency pins
  before publishing the shim last.
- Restore executable mode after artifact download because GitHub artifact
  transfer does not preserve the platform binary mode.

## Learnings

- The existing build artifact upload includes only the binary and checksum; task
  08 must also transfer `dist/npm/@kitten/<slug>` from that same native build.
- A matrix job is one `needs` entry, but GitHub does not satisfy that dependency
  until every matrix child completes successfully.
- Live npm metadata reports `kitten@0.0.2` owned by `benng`, with repository
  `github.com/ben-ng/kitten-js`; all four planned platform package names return
  404. The main package cannot be published by this project without a transfer or
  naming decision, and control of the `@kitten` scope is not yet confirmed.
- GitHub reports `MatheusBBarni/Kitten` as private. Current npm documentation says
  provenance is not generated for private repositories, even under Trusted
  Publishing, so task acceptance requires a visibility change.

## Files / Surfaces

- `.github/workflows/release.yml`: same-build platform-package transfer,
  release/version guards, public-provenance preflight, ordered OIDC publish, and
  four-runner Bun-free smoke with signature/version checks.
- `test/releaseWorkflow.test.ts`: YAML contract coverage for gating, artifact
  reuse, publish ordering, exact pinning, OIDC/toolchain/no-secret posture, and
  smoke matrix behavior.
- `README.md`: one-time package bootstrap, public-repository requirement, name
  ownership prerequisite, token revocation, and Trusted Publisher setup.
- `task_08.md` plus workflow memory: partial verified tracking and blockers.

## Errors / Corrections

- The workspace contains many unrelated modified/untracked Compozy tracking
  files. Preserve them and stage only task-08 implementation files; do not use a
  broad `git add`.
- Real five-package publish/provenance acceptance is externally blocked by the
  private repository and foreign-owned `kitten` package name. Keep task tracking
  pending and do not auto-commit while those prerequisites remain unresolved.

## Ready for Next Run

- Local implementation evidence is clean: focused workflow tests 11/11,
  `actionlint` warning-free, repository typecheck plus 1,541 tests passing (2
  credential-gated skips), and coverage at 97.33% functions / 98.30% lines.
- Task remains pending only on external acceptance. Make the repository public,
  secure/rename the main npm package and confirm `@kitten` scope control, perform
  the one-time five-package bootstrap, configure all Trusted Publishers, then run
  a real release and confirm the four smoke children plus registry provenance.
- No automatic commit was created because task completion and the real acceptance
  gate are blocked; implementation files remain ready for review.
