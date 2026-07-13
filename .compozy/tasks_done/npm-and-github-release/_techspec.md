# NPM and GitHub Release - Technical Specification

## Executive Summary

This spec turns kitten's manual, Bun-only release into an automated, conventional-commit release train that also ships a Node-runnable binary via npm.
Four moving parts: a `release-please` cut that owns versioning and the changelog; a restructured npm package (a thin Node launcher plus four per-platform binary packages resolved by `optionalDependencies`); a single consolidated GitHub Actions workflow that builds all four native targets and publishes atomically with OIDC provenance; and a small set of source changes (`src/version.ts`, `--version`/`--help`, an accurate README and installer) that make kitten self-describing and installable.

The primary trade-off: the design reuses `scripts/build.ts`'s existing seam-based structure and the `package.json`-as-version-source pattern to keep the change small and drift-free, at the cost of restructuring the current `release.yml` and the `package.json` shape (from shipping raw TypeScript to shipping a compiled-binary launcher).
It deliberately avoids new subsystems - no arg-parsing library, no `--define`, no generated version file, no elevated CI token - so every addition lands in an existing file or a single new small file, and the compiled binary and `bun run` behave identically.

## System Architecture

### Component Overview

- **Version module (`src/version.ts`, new).** Imports `package.json` as JSON and exports `KITTEN_VERSION`. Consumed by the CLI (`--version`/`--help`) and by `agentConnection.ts` (ACP `clientInfo`). Bundled into the compiled binary by `bun build --compile`. Implements PRD **C5**; see ADR-004.
- **CLI flag dispatch (`src/index.ts`, modified).** Adds `wantsVersion`/`wantsHelp` predicates as siblings to the existing `wantsSelfCheck`, each printing and exiting before `main()`.
- **Platform-package generator (`scripts/build.ts`, extended).** New seam-gated functions (`platformPackageManifest`, `writePlatformPackage`) that, per built target, write an `@kitten/<slug>` package directory containing the binary and its `package.json`. Reuses the existing `Bun.write` seam pattern. Implements PRD **C1**.
- **Main launcher (`bin/kitten.mjs`, new).** A Node-compatible shim that resolves the installed platform package's binary and execs it with the user's argv/stdio. The `package.json` `bin` points here. Implements PRD **C1**.
- **Release automation config (`release-please-config.json` + `.release-please-manifest.json`, new).** Single-package config with the version floor. Implements PRD **C3**, **C6**; see ADR-003.
- **Consolidated release workflow (`.github/workflows/release.yml`, restructured).** `release_please` job -> gated `build` matrix (native runners, generates platform packages) -> atomic `publish` job (`npm publish --provenance` under OIDC + GitHub Release assets). Implements **C3/C4/C7**; see ADR-003.
- **PR-title lint (`.github/workflows/pr-title.yml`, new).** `amannn/action-semantic-pull-request` validates the squash-merge PR title. Implements **C9**.
- **Docs + installer (`README.md`, `scripts/install.sh`, modified).** Slug fix `OWNER/kitten` -> `MatheusBBarni/Kitten`; README rewritten to lead with `npx`/`npm i -g`/curl; a CI check that the README's install commands resolve. Implements **C2/C8**.

**Data flow (a release):** merge to `main` -> `release-please` maintains the release PR -> maintainer curates notes, merges -> `release_please` creates tag + GitHub Release (emits `release_created`) -> `build` matrix compiles 4 binaries + generates 4 platform packages + `SHA256SUMS` -> `publish` uploads binaries to the Release and publishes 4 platform packages then the main shim to npm with provenance.

## Implementation Design

### Core Interfaces

The version source (new module, the type both the CLI and ACP client depend on):

```ts
// src/version.ts
import pkg from "../package.json" with { type: "json" }

/** kitten's release version; single source of truth (release-please bumps package.json). */
export const KITTEN_VERSION: string = pkg.version
```

Platform-package generation, added to `scripts/build.ts`, following its existing injectable-seam convention (`BuildOptions.run/hash/writeManifest`):

```ts
// scripts/build.ts (additions)
export interface PlatformPackage {
  target: BuildTarget
  dir: string        // e.g. dist/npm/@kitten/darwin-arm64
  name: string       // e.g. @kitten/darwin-arm64
}

/** Serialized package.json for a platform package: name, version, os, cpu, bin file. */
export function platformPackageManifest(target: BuildTarget, version: string): string

/** Write the platform package dir (package.json + copied binary). Seam-gated for tests. */
export function writePlatformPackage(
  artifact: BuildArtifact,
  version: string,
  outDir: string,
  write?: (path: string, contents: string | Uint8Array) => Promise<void>,
): Promise<PlatformPackage>
```

The Node launcher (runs under Node for `npx` without Bun, and under Bun):

```js
// bin/kitten.mjs
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null
const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null
if (!os || !arch) fail(`unsupported platform ${process.platform}-${process.arch}`)
const slug = `${os}-${arch}`
let bin
try { bin = createRequire(import.meta.url).resolve(`@kitten/${slug}/kitten-${slug}`) }
catch { fail(`no prebuilt binary for ${slug}; download from https://github.com/MatheusBBarni/Kitten/releases`) }
process.exit(spawnSync(bin, process.argv.slice(2), { stdio: "inherit" }).status ?? 1)

function fail(m) { console.error(`kitten: ${m}`); process.exit(1) }
```

### Data Models

**Main package `package.json` (restructured):**
- `bin`: `{ "kitten": "bin/kitten.mjs" }` (was `src/index.ts`).
- `optionalDependencies`: exact-pinned map of the four `@kitten/<slug>` packages to the release version (`"@kitten/darwin-arm64": "x.y.z"`, ...).
- `files`: `["bin"]` (was `["src", "bunfig.toml", "tsconfig.json"]`); the shim no longer ships source or requires Bun.
- Keep `publishConfig.access: public`; drop the Bun-only `engines.bun` constraint on the shim (it must resolve under Node).

**Platform package `package.json` (generated, one per slug):**
- `name`: `@kitten/<slug>`; `version`: the release version; `os`: `[darwin|linux]`; `cpu`: `[arm64|x64]`.
- `files`: `["kitten-<slug>"]`; no `exports` map (so the launcher can resolve the binary subpath); no install scripts.

**`release-please-config.json` / `.release-please-manifest.json`:** single package at repo root, `release-type: node`, `changelog-sections` mapping `feat`->Features, `fix`->Fixes, `!`/`BREAKING CHANGE`->Breaking; the manifest seeds the version floor (see Open Questions).

### CLI Surface (no HTTP API - this section replaces "API Endpoints")

- `kitten --version` -> prints `KITTEN_VERSION`, exit 0.
- `kitten --help` -> prints usage, examples-first, and the install/upgrade commands matched to channel, exit 0.
- `kitten --self-check` -> unchanged.
- unknown flags -> unchanged (fall through to launching the cockpit).

## Integration Points

- **npm registry - OIDC Trusted Publishing.** The `publish` job authenticates via `id-token: write` (no `NPM_TOKEN`); `npm publish --provenance` emits the Sigstore/SLSA attestation. Bootstrap: the first publish of each of the five packages uses a scoped automation token, after which each is locked to trusted publishing. Requires an image with npm CLI >= 11.5.1 / Node >= 22.14.0.
- **GitHub Releases.** `release-please-action` creates the Release; the `publish` job attaches `kitten-<slug>` binaries + `SHA256SUMS` via `gh release upload`. Permission: `contents: write`.
- **release-please-action / amannn/action-semantic-pull-request.** Pinned by version; the former's `release_created`/`tag_name` outputs gate the build/publish jobs.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/version.ts` | new | Version source; low risk | Add module importing `package.json` |
| `src/index.ts` | modified | Add `--version`/`--help` predicates; low risk (additive before `main()`) | Add two predicates + dispatch |
| `src/agent/agentConnection.ts` | modified | Replace hardcoded `"0.0.0"` `clientInfo` with `KITTEN_VERSION`; low risk | One-line change |
| `scripts/build.ts` | modified | Add platform-package generation behind a seam; medium risk (release-critical) | New functions + call in `buildAll`/CLI |
| `bin/kitten.mjs` | new | Node launcher; medium risk (the npx-without-Bun path) | New file + `npm pack` test |
| `package.json` | modified | Shim shape: `bin`, `optionalDependencies`, `files`; high risk (wrong shape breaks install) | Restructure per Data Models |
| `.github/workflows/release.yml` | modified | Consolidated release-please + build + atomic publish; high risk | Restructure per ADR-003 |
| `.github/workflows/pr-title.yml` | new | PR-title lint; low risk | Add workflow |
| `release-please-config.json`, `.release-please-manifest.json` | new | Cut config + version floor; medium risk | Add + seed floor |
| `scripts/install.sh`, `README.md` | modified | Slug fix + honest install docs; low risk, high visibility | Fix slug, rewrite, add CI resolve-check |

## Testing Approach

### Unit Tests

- **`src/version.ts`** (`bun test`): assert `KITTEN_VERSION` equals `package.json`'s `version`.
- **Platform-package generator** (`test/build.test.ts` conventions): drive `platformPackageManifest`/`writePlatformPackage` with an injected `write` seam (as existing `buildAll` tests inject `run`/`hash`/`writeManifest`); assert each generated manifest has the correct `name`/`os`/`cpu`/`version`/`files` and that the binary is copied to the expected path. Coverage stays >= the repo's 0.8 threshold.
- **`scripts/install.sh`** (`test/install.test.ts`): update for the real slug; assert platform detection maps to the same four slugs as `BUILD_TARGETS`.

### Integration Tests

- **Extend `test/build.integration.test.ts`:** after the existing host compile + `--self-check` assertions, assert the compiled binary's `--version` output equals `package.json`'s version.
- **Local-pack Bun-free install (new, pre-merge CI):** `npm pack` the main shim + host platform package, `npm install` both tarballs into a temp dir, and run the installed `kitten` launcher **under `node`** (not bun) to assert `--version`/`--self-check` succeed - proving resolution + exec work without Bun on the host platform.
- **Post-publish smoke (new workflow, all 4 platforms):** after a real publish, run `npx kitten@<ver> --self-check` in a Bun-free Node container per platform (Success Metric: 100% boot across platforms).

## Development Sequencing

### Build Order

1. **Version module + CLI flags + ACP wiring** - no dependencies. Create `src/version.ts`; add `--version`/`--help` to `src/index.ts`; point `agentConnection.ts` `clientInfo` at `KITTEN_VERSION`. (C5)
2. **Installer slug fix + README rewrite + README-resolve CI check** - no dependencies. Independent Phase-1 quick win. (C2, C8)
3. **release-please config + manifest (version floor)** - no dependencies. (C3, C6)
4. **PR-title lint workflow** - no dependencies. (C9)
5. **Consolidated release workflow skeleton** - depends on step 3. `release_please` job + gated `build` matrix reusing today's `build.ts` + Release-asset attach. Ships the Phase-1 *cut* (binaries on the Release, no npm-native binary yet). (C3, C4 partial)
6. **Platform-package generator in `build.ts`** - depends on step 1 (version). New `platformPackageManifest`/`writePlatformPackage` + call sites. (C1)
7. **Main launcher + `package.json` restructure** - depends on step 6 (package names/paths). Add `bin/kitten.mjs`; flip `bin`/`files`/`optionalDependencies`. (C1)
8. **Atomic publish job** - depends on steps 5, 6, 7. OIDC Trusted Publishing + `npm publish --provenance`; publish 4 platform packages, then the main shim (exact-pinned); no `NPM_TOKEN`. (C4, C7)
9. **Tests** - unit (version, generator) depend on 1, 6; local-pack Bun-free install depends on 7; extended `build.integration` depends on 1; post-publish npx smoke depends on 8.

Maps to PRD phasing: Phase 1 = steps 1-5 (+relevant tests); Phase 2 = steps 6-9.

### Technical Dependencies

- **npm scope/name availability** (`@kitten/*` and `kitten`) and the OIDC trusted-publisher bootstrap must be resolved before step 8.
- CI runner image meeting npm CLI >= 11.5.1 / Node >= 22.14.0 for provenance.

## Monitoring and Observability

Release/install health is observed through CI and public registry signals, not app telemetry (the existing recorder is product-usage only):
- **Workflow signals:** `build` matrix all-green, `publish` green, post-publish smoke green per platform; merge-to-published latency from workflow timing (target < 15 min).
- **Registry signals:** provenance badge / `npm audit signatures` on each publish (target 100%); the published version equals `kitten --version` output (asserted in CI).
- **Docs signal:** the README-install-commands-resolve check on every PR.
- **Failure mode to alert on:** a `publish` job that fails after any platform package is published (partial publish) - the ordering (shim last) means this leaves the prior version resolvable; surface it as a failed run.

## Technical Considerations

### Key Decisions

- **Version source = bundled `package.json` JSON import** (ADR-004). Rationale: single source release-please already owns, drift-free, identical in dev and compiled binary. Rejected: `--define` (no precedent, dev/build split), generated file (drift).
- **Package topology = main shim + four `optionalDependencies` platform packages** (ADR-001). Rationale: binary inside the tarball, no install scripts, no runtime fetch (esbuild/`@openai/codex` model). Rejected: postinstall/first-run download.
- **Package naming = scoped `@kitten/*` (recommended), unscoped `kitten-<slug>` fallback.** Rationale: clean namespace, groups on npm; contingent on owning the `kitten` scope - recorded as a prerequisite.
- **One consolidated workflow gated on `release_created`** (ADR-003). Rationale: a `GITHUB_TOKEN`-created Release does not trigger a separate workflow, and avoiding an elevated token preserves the standing-secret elimination. Rejected: two workflows + PAT/App token.
- **npx-without-Bun verified by local-pack pre-merge + post-publish smoke.** Rationale: catch packaging bugs before merge and verify the real published artifact on all platforms.

### Known Risks

- **Wrong `package.json` shim shape breaks every install.** Likelihood medium, impact high. Mitigation: the local-pack Bun-free install test runs pre-merge; the shim fails loud with a Release URL on unresolved platforms.
- **Partial multi-package publish.** Mitigation: publish job `needs:` all four builds; platform packages first, shim last, exact-pinned - a failure leaves the previous version resolving.
- **OIDC bootstrap chicken-and-egg** (trusted publisher needs the package to exist). Mitigation: first publish per package with a scoped token, then lock to trusted publishing.
- **`@kitten` scope unavailable.** Mitigation: documented unscoped fallback; resolve before step 8.
- **Heavy binary (embeds Bun runtime) inflates the npm tarball.** Mitigation: acceptable for V1; size-reduction (`--minify`) is a follow-up; `os`/`cpu` ensure a user pulls only their one platform package.
- **Slug casing** (`MatheusBBarni/Kitten` vs `OWNER/kitten`). Mitigation: pin the exact slug in `install.sh`, README, and the launcher's error URL.

## Architecture Decision Records

- [ADR-001: V1 scope for the automated release train](adrs/adr-001.md) - release-please cut, npm-native binary via `optionalDependencies`, atomic ordered token-less publish with OIDC provenance, PR-title enforcement.
- [ADR-002: V1 product scope - reliable pipeline plus a self-describing install](adrs/adr-002.md) - Approach A: pipeline plus `--version`/`--help`, honest README, version-stamped install, curated notes.
- [ADR-003: One consolidated release workflow driven by release-please outputs](adrs/adr-003.md) - a `GITHUB_TOKEN`-safe single workflow gated on `release_created`, refining ADR-001's trigger mechanism without an elevated token.
- [ADR-004: Version source of truth via a bundled `package.json` JSON import](adrs/adr-004.md) - `src/version.ts` re-exports `package.json`'s version to the CLI and ACP client, bundled into the binary.
