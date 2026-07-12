# NPM and GitHub Release

## Overview

Kitten runs Claude Code and Codex in one terminal and hands a live coding task between them with a keystroke.
Today it can barely be installed or shipped.
`npx kitten` fails on any machine without Bun, the advertised `curl | bash` one-liner 404s against a placeholder repo slug, and every release is hand-cut with a `0.0.0`/tag versioning footgun the pipeline already had to engineer around.

This feature makes cutting a release one deliberate action and makes `npm i` actually work.
V1 is a release-grade, stable-channel release train: a Conventional-Commit release-please cut, the prebuilt native binary shipped through npm so `npx kitten` runs without Bun, OIDC provenance that deletes the standing publish token, and PR-title enforcement so the automation has clean input.
It ships in two halves - the cut (slug fix, release-please, PR-title lint) first, then the npm-native binary and provenance - each independently valuable.

The value is unblocking adoption and shipping.
The primary user is the maintainer who cuts releases, who trades hand-crafting a tag, notes, and version for one reviewable act: merging a release PR.
The secondary user is the developer who reaches for `npx kitten` to try it in thirty seconds, and the tertiary user is the security-conscious adopter who checks provenance before depending on anything.
Ambition: a Quick Win that removes an adoption blocker, on a compounding trust foundation.

## Problem

A working release pipeline exists, but it is purely reactive.
`.github/workflows/release.yml` fires only on `release: published`; it builds four per-platform binaries on native runners, self-checks each, uploads them plus a `SHA256SUMS` manifest, and runs `bun publish`.
Nothing creates the tag or the GitHub Release, so a human decides the version, writes the notes, and hand-cuts the release every time.
`package.json` ships `version: 0.0.0` and CI stamps the real version from whatever tag the human typed - an implicit, un-reviewed source of truth that produces a version/tag mismatch on the first release and a hard `403` on every republish.

The npm package cannot run for the audience it needs to win.
It ships raw TypeScript (`files: [src, ...]`, `bin: src/index.ts`) with Bun-only APIs, so on a Node machine without Bun both `npx kitten` and `npm i -g kitten` error out.
The only Node-runnable artifact, the compiled binary, lives solely on GitHub Releases and never in the npm tarball.
An evaluator's very first command fails.

Both advertised install paths are broken for a new user.
`scripts/install.sh` and the README hardcode a placeholder repo slug `OWNER/kitten`, while the real repository is `MatheusBBarni/Kitten`, so the documented curl one-liner 404s today.
ADR-006 frames npm as the secondary "`bunx kitten` for people who already have Bun" path, which is the exact inverse of what a JS-ecosystem tool needs.
Meanwhile the publish path carries a standing security liability: a long-lived `NPM_TOKEN` sits in CI (the exact asset that token-theft attacks harvest), and the binaries are protected only by a checksum manifest, which proves integrity in transit but not authenticity.

### Market Data

release-please (Google) matches the desired flow one-to-one: a maintained release PR whose merge writes the changelog, mints the tag, and cuts the GitHub Release, firing the same `release: published` event the pipeline already consumes.
The npm-native-binary problem is already solved in the ecosystem: `@openai/codex@0.144.0` ships the identical four targets kitten builds via a tiny main package plus per-platform `optionalDependencies`, with no install scripts.
For JS-ecosystem AI CLIs, `npm i -g` / `npx` is the expected primary install (gemini-cli, OpenCode, Codex, Charm Crush all offer it), while the maturity frontier - Claude Code - is a zero-dependency native binary via curl; kitten can offer both.
npm's own pitch for `npx` is "one command, zero commitment" in a README.

The supply-chain case for provenance is strong and current.
Sonatype's 2026 report counted 454,600 new malicious open-source packages in 2025, with over 99% of open-source malware appearing on npm.
The September 2025 token-theft campaign compromised 18 packages pulling roughly 2.6 billion downloads a week, and the Shai-Hulud worm self-propagated across 500+ packages by harvesting CI tokens.
npm Trusted Publishing (OIDC, GA in 2025) removes the static token from existence and auto-generates Sigstore/SLSA provenance on GitHub Actions publishes.

## Core Features

| #   | Feature | Priority | Description |
| --- | ------- | -------- | ----------- |
| F1  | Fix the broken install paths | Critical | Correct the placeholder repo slug `OWNER/kitten` -> `MatheusBBarni/Kitten` in `install.sh` and the README, and add a CI check that the README's literal install commands resolve so it can never silently regress. Unblocks the curl path immediately. |
| F2  | release-please automated cut | Critical | A continuously maintained release PR built from Conventional Commits; merging it writes `CHANGELOG.md`, mints the version tag, and cuts the GitHub Release (firing the existing pipeline). The `.release-please-manifest.json` is the single version source, retiring the `0.0.0`/tag hack. |
| F3  | npm-native binary via optionalDependencies | Critical | A thin main `kitten` shim plus four platform packages (`darwin-arm64/x64`, `linux-x64/arm64`) carrying the compiled binary inside the tarball, `os`/`cpu` gated, no install scripts, no download fallback (shim fails loud with the Release URL). Makes `npx kitten` / `npm i -g kitten` work without Bun. |
| F4  | Atomic, ordered publish | Critical | The publish job `needs:` all four build jobs; it publishes the four platform packages first and the main shim last with exact-pinned `optionalDependencies`, and feeds the same build artifacts to both npm and the GitHub Release so the channels cannot diverge. A partial failure leaves the previous version resolving cleanly. |
| F5  | OIDC provenance, token-less publish | High | Move the registry push from `bun publish` to `npm publish` (Bun stays the compiler), adopt npm Trusted Publishing with `--provenance`, add `id-token: write`, and delete the static `NPM_TOKEN`. |
| F6  | PR-title commit enforcement | High | Squash-merge with "default to PR title" plus `amannn/action-semantic-pull-request`, so exactly one valid Conventional Commit lands on `main` per PR. No commitlint/husky local hooks. |
| F7  | Install documentation | Medium | Document `npx kitten` as the hero install, `npm i -g kitten` for daily use, and the checksummed curl one-liner as the "no Node" alternative, with the download-size expectation set. |

## KPIs

| KPI | Target | How to Measure |
| --- | ------ | -------------- |
| Release-cut effort | <= 1 manual action to ship (merge the release PR) | Count distinct maintainer-triggered steps in the documented release runbook |
| `npx kitten` works without Bun | 100% boot (`--self-check`) across all 4 platforms | CI smoke job running `npx kitten@<ver> --self-check` in a Bun-free Node container per platform |
| Broken/partial publishes | 0 (no version/tag mismatch, no partial platform set, no 403 republish) | Release-workflow success rate = clean publishes / release attempts |
| Merge-to-published latency | < 15 min (all 4 binaries + 5 npm packages + GitHub Release live) | Timestamp delta from release-PR merge to last publish job green |
| npm provenance coverage | 100% of npm publishes carry a provenance attestation | `npm audit signatures` / provenance badge present on the published version |

## Feature Assessment

| Criteria | Question | Score |
| -------- | -------- | ----- |
| **Impact** | How much more valuable does this make the product? | Must do (a product you can't cleanly install or reliably ship has an adoption ceiling near zero) |
| **Reach** | What % of users would this affect? | Must do (every would-be user must install; every release flows through this) |
| **Frequency** | How often would users encounter this value? | Strong (felt by the maintainer every release, by users at every install/update) |
| **Differentiation** | Does this set us apart or just match competitors? | Maybe (working install is table stakes; provenance + dual channel is a mild edge) |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe (plumbing is copyable, but reliability + provenance compound into trust) |
| **Feasibility** | Can we actually build this? | Strong (proven patterns - Codex template, release-please, Trusted Publishing - on an existing pipeline) |

Leverage type: Quick Win that removes an adoption blocker, on a compounding trust foundation.

## Council Insights

- **Recommended approach:** release-please cut + npm-native binary via `optionalDependencies` + OIDC provenance (killing the static token) + PR-title enforcement + atomic ordered publish + slug fix, sequenced Half A (cut, slug, lint) then Half B (npm binary, provenance). Binary-channel attestation deferred.
- **Key trade-offs:** a heavier npm footprint (a Bun-runtime binary across four platform packages, tens of MB each) buys a self-contained, integrity-covered, offline-safe install with no runtime fetch; re-tooling the one currently-green publish step (`bun publish` -> `npm publish`) buys a token-less publish with free provenance; doing "release-grade" now rather than a minimal cut is justified because the council found the extra pieces cheap when bundled (OIDC is low-effort, atomic publish is required anyway once five packages ship, PR-title lint is about ten lines).
- **Risks identified:** partial multi-package publish (mitigated by gating on all four builds, platform-packages-first/shim-last, exact pins); OIDC bootstrap chicken-and-egg (first publish with a scoped automation token, then lock to trusted publishing); large package / slow first `npx` (progress indicator, steer daily users to the global install); the missing-platform-package resolution edge (loud shim error, download fallback only if it bites); version bootstrap off `0.0.0` (explicit floor); binary channel remaining checksum-only (honest labeling, deferred attestation).
- **Stretch goal (V2+):** a self-updating binary (`kitten upgrade`) with stable/beta channels, plus binary-channel attestation (`gh attestation verify`) once a second maintainer or real consumers exist.

## Out of Scope (V1)

- **Binary-channel attestation** (`actions/attest-build-provenance` + `gh attestation verify`) - keep `SHA256SUMS`; defer signing the curl binaries until a second maintainer or real consumers appear, and don't market the binary channel as "attested" meanwhile.
- **Pre-release / beta / canary channels** - stable only; channel infrastructure is over-built for a pre-1.0, zero-user project.
- **Self-updating binary (`kitten upgrade`)** - the V2 retention play; depends on the release train existing first.
- **commitlint + husky local hooks** - bypassable with `--no-verify`, add dev-machine friction, and are redundant once the squash-merge boundary is guarded by PR-title lint.
- **esbuild-style hash-verified download fallback in the shim** - reintroduces the runtime network-fetch risk V1 deliberately avoids; add only if the missing-platform-package case actually bites in practice.
- **Windows / linux-musl / additional architectures** - each is a linear add later (one build row + one generated package + one pinned optional dependency); V1 ships the existing four targets.
- **Frictionless first-run / dual-agent onboarding (`kitten doctor`)** - the recommended next idea and a different task; it does not deliver the "`npm i` works" this idea is about.

## Architecture Decision Records

- [ADR-001: V1 scope for the automated release train](adrs/adr-001.md) - release-please cut with the manifest as the single version source, npm-native binary via `optionalDependencies`, atomic ordered token-less publish with OIDC provenance, PR-title enforcement, and supersession of ADR-006's npm-secondary framing.

## Summary / Differentiator

A fully automated, provenance-signed, single-package release train paired with a dual install channel - `npx`/`npm i -g` for the JS ecosystem and a zero-dependency checksummed curl binary for everyone else - puts kitten ahead of its AI-CLI peers, where release automation is bespoke or channel-bound and provenance is largely absent.
The compounding asset is trust: a release that any adopter can trace to a specific public commit, cut with one reviewable action, that never silently rots the install story.

## Integration with Existing Features

| Integration Point | How |
| ----------------- | --- |
| `release.yml` (reactive pipeline) | release-please's cut fires the `release: published` event it already consumes; the publish job is restructured into an atomic, ordered, multi-package publish and switched from `bun publish` to `npm publish`. |
| `scripts/build.ts` (four-target compile + `SHA256SUMS`) | The same compiled artifacts feed both the GitHub Release upload and the four platform tarballs; never rebuilt per channel. |
| `scripts/install.sh` (curl installer) | Slug fix; it remains the checksum-verified "no Node" channel. |
| `package.json` (npm shape) | Becomes the thin main shim with `optionalDependencies` on the platform packages; version is stamped from the release-please manifest, not `0.0.0`-from-tag. |
| `--self-check` / `selfCheck.ts` | Stays the per-artifact CI gate before publish, and doubles as the smoke test for `npx kitten --self-check` on a Bun-free runner. |
| ADR-006 (binary distribution) | Channel framing superseded: npm becomes co-primary and Bun-free rather than a secondary `bunx` path. |

## Open Questions

- **OIDC bootstrap:** what is the exact first-publish path for five brand-new packages (a scoped automation token, then lock each to trusted publishing), and does the CI runner image meet the requirements (npm CLI >= 11.5.1, Node >= 22.14.0)?
- **Version floor:** what is the first release-please version off `0.0.0` with no existing tags (e.g. `0.1.0`), and do we seed `.release-please-manifest.json` and a bootstrap tag?
- **Package naming/scope:** do the platform packages use a scoped `@kitten/*` name (requiring an owned npm org) or unscoped `kitten-darwin-arm64` style names?
- **Package size budget:** is a tens-of-MB-per-platform npm package acceptable, or do we invest in `bun --compile` size reduction/minify to protect the first-`npx` experience?
- **Version stamping in the binary:** does `bun build --compile` need `--define`-style version injection so `--self-check`/`--version` reports the release version, and how do we keep the shim's version and the binary's reported version in agreement?
- **Repo name casing:** the real remote is `MatheusBBarni/Kitten` (capital K) - confirm the canonical slug to avoid a case-sensitivity 404 in `install.sh` and the release asset URLs.
- **Manual escape hatch:** should `release.yml` keep `workflow_dispatch`, and if so how does it avoid double-publishing against the release-please path?
