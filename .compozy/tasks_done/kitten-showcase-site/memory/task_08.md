# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Align the repository README with the showcase's sole verified source-checkout CTA, launch gates, V1 measurement posture, and final smoke workflow.
- Implementation and verification are complete; task tracking can close while the documented public-launch gates remain intentionally unchecked.

## Important Decisions

- Keep the source checkout as the only promoted launch route. A live npm lookup on 2026-07-13 still resolved `kitten@0.0.2` to the unrelated Octopress exporter, so the README's leading `npx kitten` CTA must be removed despite the in-progress npm release work.
- Document launch prerequisites as unchecked gates rather than implying readiness: GitHub currently reports the repository as private with no detected license, and the proof config still uses a poster fallback with `videoUrl: null`.
- Describe source checkout as the route approved for launch verification, not as already launch-verified; the clean-environment command gate is still pending.
- Preserve the pre-existing README Trusted Publishing bootstrap changes while correcting the visitor-facing install story.

## Learnings

- The canonical Pages URL is configured as `https://matheusbbarni.github.io/Kitten/` in `site/astro.config.mjs`.
- The production preview serves all required sections at `/Kitten/`; the site gate finished with 67 passing tests, 100% function coverage, 98.98% line coverage, and a successful static build.
- The root gate finished with typecheck exit 0 and 1,621 passing tests, 2 expected credentialed/external skips, and 0 failures.

## Files / Surfaces

- Touched: `README.md`, `test/showcaseReadme.test.ts`, `test/package-shim.test.ts`, and this task's tracking/memory files.

## Errors / Corrections

- `rtk test -f ...` does not proxy the shell `test` builtin and exits with shell usage output. Keep the README's portable plain-shell command, but use `rtk proxy sh -c 'test -f ...'` for agent-side verification.
- The first broad `bun run typecheck && bun test` pass completed with 1,621 passing, 2 skipped, and 0 failed tests, but emitted an intermittent OpenTUI TreeSitter teardown warning; a later filtered full rerun had the same pass/skip counts with no warning or error matches.
- A broad patch was rejected after another workspace process updated Task 08 surfaces. Re-read and preserve the newer README, package-shim test, and task-memory decisions before applying further edits.
- The first README contract test rejected the local preview `curl` smoke as if it were an install CTA. Narrowed the assertion to prohibited npm and pipe-to-shell install commands.
- A concurrent workspace update added `test/showcaseReadme.test.ts`; removed the duplicate `site/test/readme.test.ts` and retained the root cross-cutting documentation contract.

## Ready for Next Run

- README launch documentation and its contract tests are ready. Before public launch, the maintainer must still make the repository public, add a detected license, configure the real captioned recording, and re-run the source command from a clean environment.
