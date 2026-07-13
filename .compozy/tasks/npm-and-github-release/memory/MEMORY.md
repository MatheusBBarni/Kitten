# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- Platform-package staging must preserve the compiled artifact's executable mode; writing only its bytes produces a non-executable npm payload that the Node launcher cannot spawn.

## Open Risks

- The GitHub repository is currently private. Unauthenticated requests to both
  `https://github.com/MatheusBBarni/Kitten` and its raw `main/scripts/install.sh`
  URL return 404, so public curl-install and post-merge URL resolution checks
  remain blocked until repository visibility or the distribution contract changes.
- npm provenance is also unavailable while the GitHub repository is private;
  Trusted Publishing can publish from a private repository but npm does not
  generate provenance for it.
- The unscoped npm package `kitten` is owned by `benng` and points to
  `github.com/ben-ng/kitten-js`. The release train needs a transfer or a different
  main package name before it can publish the shim. The four `@kitten/<slug>`
  platform package names currently return 404 and still require bootstrap plus
  confirmation that the maintainer controls the `@kitten` scope.

## Handoffs
