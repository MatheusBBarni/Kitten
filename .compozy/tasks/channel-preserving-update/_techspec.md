# TechSpec: Channel-Preserving CLI Update

## Executive Summary

`kitten --update` will use two deliberately separate mutation boundaries. The Node package launcher will prove global npm ownership and run the npm transaction; the compiled Bun executable will update only an installer-recorded standalone binary. `src/index.ts` will dispatch the standalone path after existing `--version` and `--help` handling but before self-check, repository validation, agent startup, and Cockpit mounting. The launcher will preserve that metadata precedence before it considers its own npm path.

The standalone path adds one outer-layer TypeScript module, `src/update.ts`, and a versioned XDG-state registry keyed by canonical installed path. It resolves a stable release through GitHub Releases metadata, verifies exactly one matching `SHA256SUMS` entry and the artifact hash, then replaces the proven target through a same-directory transactional protocol. The primary trade-off is stricter eligibility and more state/transaction logic in exchange for refusing every ambiguous, copied, local-package, `npx`, stale-record, or changed-binary invocation without choosing another update channel.

## System Architecture

### Component Overview

**Node npm update boundary — `bin/kitten.mjs` and `bin/launcher.mjs`**

- `bin/kitten.mjs` passes its canonical package location plus the existing Node/platform/argument seams to `runLauncher`.
- `runLauncher` preserves `--version` before `--help`; for a remaining `--update`, it canonicalizes the shim package root, asks `npm root --global`, verifies the main and resolved platform package belong beneath that root, then invokes `npm install --global @matheusbbarni/kitten@latest`.
- A local dependency, `npx` cache, unsupported host, failed canonicalization, absent npm, or mismatched resolved platform package returns the shared safe-refusal output. It does not spawn the binary, invoke npm, or fall back to standalone replacement.

**Standalone update boundary — `src/index.ts` and new `src/update.ts`**

- `src/index.ts` retains synchronous metadata dispatch. When metadata did not handle the invocation, it recognizes `--update` before `--self-check` and normal boot, awaits the standalone update service, writes its outcome, and exits with that outcome's status.
- `src/update.ts` is outside ACP, core, store, app, and UI layers. It owns standalone record loading, release metadata validation, manifest parsing, artifact hashing, atomic target/registry transaction handling, concise outcome formatting, and injected I/O seams.
- A compiled executable reaches this service only when its canonical regular-file target matches a standalone record. Direct platform-package binaries and copied executables have no qualifying record and refuse safely.

**Installer and state boundary — `scripts/install.sh` plus XDG state**

- After an artifact checksum has been verified and installation succeeds, `scripts/install.sh` records canonical path, platform, embedded version, and SHA-256 in `$XDG_STATE_HOME/kitten/standalone-installations.json`, falling back to `~/.local/state/kitten`.
- The registry is a versioned map keyed by a deterministic digest of canonical path. It is separate from `state.json`, whose schema owns first-run state.
- Registry writes are atomic. The installer must leave no record on a failed download, invalid manifest, checksum mismatch, or failed target installation.

**Release boundary — GitHub Releases**

- The standalone service reads the latest stable release metadata, accepts only a valid stable `kitten-v<version>` tag, and constructs the exact tag-scoped URLs for the existing `kitten-{platform}` asset and `SHA256SUMS`.
- It accepts exactly one valid SHA-256 row for the selected artifact. Missing, duplicate, malformed, unexpected-platform, draft, prerelease, or tag/version mismatch cases are safe refusals.

### Requirement Traceability

| PRD requirement | Technical owner |
| --- | --- |
| Explicit action that bypasses Cockpit boot | `src/index.ts` metadata/update dispatch and launcher argument routing |
| Global npm update preserves npm ownership | Node launcher canonical ancestry proof and npm command runner |
| Standalone update preserves binary ownership | XDG canonical-path registry and `src/update.ts` target validation |
| Integrity-protected replacement and already-current result | release metadata client, strict manifest parser, SHA-256 verifier, transactional replacement |
| Self-describing success and safe refusal | shared `UpdateOutcome` formatter used by launcher and standalone service |
| Discoverability and release parity | CLI help, README, package-launcher tests, and compiled-binary coverage |

## Implementation Design

### Core Interfaces

The TypeScript boundary keeps effects injectable and makes safe outcomes explicit:

```typescript
export interface StandaloneInstallationRecord {
  schemaVersion: 1
  canonicalPath: string
  platform: string
  version: string
  sha256: string
}
export interface UpdateDependencies {
  fetchJson(url: string): Promise<unknown>
  fetchBytes(url: string): Promise<Uint8Array>
  sha256(bytes: Uint8Array): string
  resolveExecutable(): Promise<string>
}
export type UpdateOutcome =
  | { kind: "updated"; channel: "standalone"; from: string; to: string }
  | { kind: "already-current"; channel: "standalone" | "npm"; version: string }
  | { kind: "refused" | "failed"; message: string }
```

Portable registry schema, shown in Go notation for cross-tool clarity; the production implementation remains TypeScript and writes JSON:

```go
type StandaloneInstallationRecord struct {
    SchemaVersion int    `json:"schemaVersion"`
    CanonicalPath string `json:"canonicalPath"`
    Platform      string `json:"platform"`
    Version       string `json:"version"`
    SHA256        string `json:"sha256"`
}
```

`runLauncher` will receive injected equivalents for canonical path resolution, command execution, package version reads, output, and process status. It returns an explicit integer status rather than throwing; the executable applies the same nonzero refusal convention.

### Data Models

**Standalone registry**

- File: `$XDG_STATE_HOME/kitten/standalone-installations.json`, else `~/.local/state/kitten/standalone-installations.json`.
- Envelope: `schemaVersion: 1` and a map whose key is the SHA-256 digest of `canonicalPath` and whose value is `StandaloneInstallationRecord`.
- Validation requires an exact key/path match, one supported platform, stable semantic version text, lowercase 64-character SHA-256, and a canonical regular-file target whose current hash and embedded `KITTEN_VERSION` equal the record.
- Malformed, unreadable, duplicate, mismatched, or stale data is not repaired by `--update`; it produces the shared safe refusal.

**Release candidate**

- `tag`: validated latest stable GitHub release tag, normalized to the candidate version.
- `artifact`: the existing artifact name from `BUILD_TARGETS` / `artifactName`, selected only for the host platform.
- `expectedSha256`: the sole valid manifest checksum for that artifact.
- The service considers the installed version already current when the validated candidate version equals the current embedded `KITTEN_VERSION`; it performs no binary or registry write in that case.

**Transactional replacement state**

- Same-directory exclusive lock prevents concurrent replacement of one canonical target. An existing or unrecoverable lock is a no-mutation refusal.
- Candidate bytes live in a private same-directory temporary file with executable mode; the old target moves to an adjacent private backup during the commit window.
- The service atomically installs the candidate and registry record, deletes the backup only after both commits, and restores the backup plus previous registry on any later failure it can handle. Tests assert byte-identical target and unchanged registry on every induced failure branch.

### API Endpoints

Kitten adds no inbound HTTP API or local server endpoint.

Outbound standalone calls are fixed, unauthenticated public GitHub endpoints and use no user-supplied URL:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `https://api.github.com/repos/MatheusBBarni/Kitten/releases/latest` | Obtain the latest stable tag and reject malformed/draft/prerelease metadata. |
| `GET` | `https://github.com/MatheusBBarni/Kitten/releases/download/<tag>/kitten-<platform>` | Download the exact host artifact only after release metadata validation. |
| `GET` | `https://github.com/MatheusBBarni/Kitten/releases/download/<tag>/SHA256SUMS` | Obtain the checksum manifest for the same tag and validate exactly one matching row. |

The npm path is a local child-process integration, not an HTTP API: `npm root --global` proves the root and `npm install --global @matheusbbarni/kitten@latest` owns the package update.

## Integration Points

**npm global installation**

- The Node launcher canonicalizes its package root and the resolved platform-package binary, then compares both to the canonical global root returned by `npm root --global`.
- It reads the installed package version before and after a successful npm command from the verified global package location. A no-change package version becomes `already-current`; any different post-command version becomes `updated`.
- The command runner receives argument arrays and inherited terminal streams. No shell interpolation, registry override, or package-manager fallback is introduced.

**Standalone installer**

- `scripts/install.sh` keeps its existing artifact and checksum download contract. After `install -m 755` succeeds, it invokes the record-writer path supplied by the compiled executable or equivalent safe serializer, with the resolved canonical target, platform, embedded version, and verified hash.
- Record-writing failure leaves a usable installed binary but no update eligibility; the installer reports that state rather than fabricating ownership.

**Build and release artifacts**

- `scripts/build.ts` remains the source of the four supported platform names and `SHA256SUMS` format.
- `.github/workflows/release.yml` continues to publish tag-scoped artifacts and checksum manifests. The implementation relies on that existing contract; it does not add a release asset or package dependency.

**Documentation and command discovery**

- `formatCliHelp()` and `README.md` add `kitten --update`, use the exact two recovery commands from the PRD, and retain `--version` before `--help` precedence.
- Package launcher behavior documents npm ownership; standalone guidance documents checksum and safe-refusal boundaries without claiming publisher-compromise protection.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| `src/index.ts` | modified | New asynchronous metadata route must not disturb version/help/self-check precedence. Medium risk. | Add `--update` recognition and injectable standalone dispatch before normal boot. |
| `src/update.ts` | new | Owns all standalone mutation and trust validation. Highest risk. | Implement strict parsers, XDG registry, release client, hash verification, transaction, and formatter with injectable seams. |
| `bin/kitten.mjs` | modified | Supplies package provenance to launcher. Medium risk. | Derive canonical main-package root and pass it without trusting environment markers. |
| `bin/launcher.mjs` | modified | Classifies global npm versus local/npx invocation. Highest npm risk. | Add canonical ancestry check, npm transaction, stable output, and no-fallback refusal. |
| `scripts/install.sh` | modified | Establishes standalone ownership only after an existing verified install. High safety risk. | Persist or request atomic registry write after target installation; cover timing failures. |
| `README.md` and CLI help | modified | Incorrect commands would undermine recovery. Low risk. | Use exact `npm install --global` and curl recovery text plus `--update` guidance. |
| `test/firstRunBoot.test.ts`, `test/launcher.test.mjs`, `test/install.test.ts` | modified | Existing focused contracts must expand without real network/npm mutation. Medium risk. | Add precedence, provenance, record-timing, output, and refusal cases. |
| `src/update.test.ts` and local update integration test | new | Proves transaction rollback and host process behavior. Highest verification value. | Add injected failure matrix and deterministic temporary-directory process fixture. |

## Testing Approach

### Unit Tests

- `src/update.test.ts` exercises registry key/path validation, XDG fallback, stable-tag parsing, strict `SHA256SUMS` parsing, candidate version comparison, formatted outcomes, and every refusal reason using injected dependencies.
- The standalone transaction matrix injects failures at lock acquisition, release metadata fetch/parse, artifact fetch, manifest fetch/parse, hash mismatch, temporary-file write/chmod, target backup/rename, registry publish, cleanup, and rollback. Each failure asserts nonzero status, original target bytes, and original registry bytes.
- `test/firstRunBoot.test.ts` asserts `--version` still wins over `--help` and `--update`, `--help` wins over `--update` when version is absent, and standalone update dispatch occurs before self-check and normal boot.
- `test/launcher.test.mjs` injects npm root, path resolution, command, and package-version seams. It proves only exact global ancestry invokes npm, local/npx/missing/mismatched contexts mutate nothing, and result output includes the npm channel plus prior/result or already-current version.
- `test/install.test.ts` proves installer records appear only after verified successful installation and are absent after checksum or install failures.

### Integration Tests

- A deterministic temporary-directory fixture supplies a fake global npm root and fake npm executable. It packages and runs the launcher to confirm local package paths cannot trigger npm and proven global paths issue only the expected npm argument array.
- A local standalone fixture hosts representative latest-release JSON, matching artifact bytes, and `SHA256SUMS`. It invokes the compiled or equivalent update entry against an installer-created record, then proves successful replacement, already-current no-write behavior, and byte-identical preservation across induced filesystem and registry failures.
- Extend `test/npm-launcher.integration.test.ts` and `test/build.integration.test.ts` so the packaged Node launcher and host compiled artifact preserve the update dispatch contract without contacting GitHub.
- No test uses real credentials, a real npm global prefix, or a live GitHub release. Existing published-package smoke remains independent packaging evidence.

## Development Sequencing

### Build Order

1. **Standalone update primitives** — add `src/update.ts` types, stable-tag/manifest parsing, XDG path resolution, outcome formatter, and injected dependency contracts. No dependencies.
2. **Standalone ownership registry** — add atomic canonical-path record read/write and installer handoff after successful checksum-verified installation; depends on step 1.
3. **Standalone update transaction** — implement record validation, release metadata/artifact retrieval, hash verification, lock/temp/backup/atomic replacement, rollback, and already-current detection; depends on steps 1-2.
4. **Compiled CLI dispatch** — wire `--update` after existing version/help dispatch and before self-check/normal boot, retaining test injection seams; depends on step 3.
5. **Global npm transaction** — extend `bin/kitten.mjs` and `bin/launcher.mjs` with canonical global-root proof, npm invocation, and output; depends on step 1 and the CLI outcome contract from step 4.
6. **Discoverability updates** — align help, README, and package-facing recovery strings with final result semantics; depends on steps 4-5.
7. **Focused and local integration verification** — complete induced-failure, package-launcher, compiled-artifact, and documentation contracts; depends on steps 2-6.

### Technical Dependencies

- Existing Bun/Node filesystem, path, crypto, URL, and child-process APIs; no new npm package.
- Public GitHub Releases metadata and tag-scoped assets for the existing repository and four host artifacts.
- `npm` available on the Node launcher PATH for verified global npm installations. Absence is a supported failure, never a standalone fallback.
- POSIX filesystem semantics on the already supported macOS/Linux targets for canonicalization, same-directory rename, and executable permissions.

## Monitoring and Observability

- V1 adds no automatic telemetry, network analytics, background polling, or persistent update event log. The command runs only on explicit invocation.
- Terminal output is the operational surface: every success names the channel and version transition; every refusal/failure states whether no change occurred and prints both recovery commands.
- Test fixtures retain structured outcome kinds only in memory. Release validation reviews the focused update suite and existing build/release smoke; there is no alerting service for this local CLI feature.

## Technical Considerations

### Key Decisions

- **Provenance-specific mutation boundary.** The Node launcher owns npm because it can prove global package ancestry; the compiled binary owns standalone only when its canonical target matches installer state. This rejects environment-marker or filename-based classification.
- **Canonical-path XDG registry.** A versioned map supports every installer-managed custom destination while treating moved, copied, modified, and stale paths as untrusted. The cost is registry lifecycle and rollback complexity.
- **GitHub latest-release metadata plus tag-scoped assets.** A structured stable tag yields reliable prior/result output and eliminates redirect inference. Availability failures remain no-mutation outcomes.
- **Strict release and replacement protocol.** Exactly one valid manifest row, SHA-256 verification before execution/replacement, same-directory lock/temp/backup, atomic commit, and rollback preserve the prior program through induced failures. Checksums still do not protect against a compromised release publisher.
- **Two-layer deterministic verification.** Injected unit seams prove all refusal/rollback branches; local process fixtures prove launcher and filesystem boundaries without turning publication timing into a test dependency.

### Known Risks

- **npm layout differences (medium).** Prefixes and symlinks can vary. Canonical comparisons of the launcher, global root, and platform binary, with fixture coverage, prevent path heuristics from becoming authority.
- **Stale lock or recovery interruption (medium).** A crash can leave a lock or backup. V1 must fail closed and report recovery rather than guessing; cleanup/rollback behavior receives fault-injection tests.
- **Registry publication after binary replacement (medium).** A state-directory failure could leave ownership evidence inconsistent. The adjacent backup and previous-registry snapshot enable rollback; failure tests must verify both artifacts.
- **Release API/asset outage or rate limit (medium).** The request fails before replacement and prints the established manual install commands.
- **Publisher compromise (residual, outside V1).** Metadata, manifest, and artifact may agree maliciously. Signed/attested provenance is explicitly deferred by the PRD and ADR-001.

## Architecture Decision Records

- [ADR-001: Preserve Verified Installation Channels with Fail-Closed Updates](adrs/adr-001.md) — Requires positive ownership and verified replacement before any update mutation.
- [ADR-002: Make Every Update Outcome Self-Describing and Fail Closed](adrs/adr-002.md) — Requires channel/version feedback and both recovery paths for every safe refusal.
- [ADR-003: Keep Update Mutation at Its Provenance Boundary](adrs/adr-003.md) — Assigns npm mutation to the proven Node launcher and standalone mutation to the proven compiled binary.
- [ADR-004: Use Canonical-Path Records and Tagged Releases for Standalone Updates](adrs/adr-004.md) — Defines the XDG registry, stable-release source, and integrity-protected standalone transaction.
- [ADR-005: Prove Update Transactions with Isolated Local Tests](adrs/adr-005.md) — Requires injected failure tests plus deterministic local integration evidence.
