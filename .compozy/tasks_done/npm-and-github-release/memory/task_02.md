# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the installer placeholder with `MatheusBBarni/Kitten`, lead the README
  with the working checksummed curl channel, document the real launch/agent
  requirements, and enforce the documented URL contract in CI with tests.

## Important Decisions

- Keep the checksummed curl installer as the visitor-facing hero until task 07
  publishes and verifies the npm native-binary path; mention npm only as a
  future documented channel.
- Preserve the showcase's separately verified source-checkout CTA while making
  the README's general install guidance curl-first.
- Validate the README through one injectable resolver that rejects placeholders
  and canonical-slug drift before checking both the repository and raw installer
  URLs. This keeps unit tests deterministic while CI performs the live check.

## Learnings

- `origin` is `MatheusBBarni/Kitten`, the default branch is `main`, and the
  repository is now public. Both the repository page and raw installer resolve
  without authentication.
- `scripts/install.sh` already contained the canonical default and curl comment
  when this run began; the remaining work was documentation, CI enforcement,
  and complete default/override/platform test coverage.

## Files / Surfaces

- `README.md`
- `.github/workflows/ci.yml`
- `scripts/check-readme-install.ts`
- `scripts/install.sh` (verified, unchanged)
- `test/install.test.ts`
- `test/readmeInstall.test.ts`
- `test/ciWorkflow.test.ts`
- `test/package-shim.test.ts`

## Errors / Corrections

- Corrected stale workflow memory after live GitHub and raw URL checks showed
  that the repository had become public.
- Added a default-fetch test after focused coverage initially reported only 75%
  function coverage for the resolver; final focused coverage is 100% functions
  and 90% lines.
- Detected concurrent README product-copy and keybinding edits outside this
  task. Preserved them in the working tree and kept them out of this task's
  staged README patch.

## Ready for Next Run

- Task complete. Task 07 can promote npm only after its binary path is published
  and verified; task 08 can reuse the canonical repository/install contract for
  post-publish smoke validation.
