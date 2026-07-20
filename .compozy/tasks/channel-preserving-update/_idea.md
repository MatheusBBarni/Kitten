# Channel-Preserving CLI Updates

## Overview

Add `kitten --update`, an explicit one-shot command that updates Kitten to the latest stable release without launching the Cockpit. It serves developers who installed Kitten through either co-primary supported channel: global npm or the checksum-verified standalone installer.

V1 optimizes for safe, channel-preserving convenience. It performs an update only after proving ownership of the running installation; otherwise it leaves the system unchanged and gives precise recovery commands. The ambition is a Quick Win: a small surface that establishes a durable trust standard for future lifecycle features.

### Summary / Differentiator

Most CLI updaters optimize for apparent success. Kitten should optimize for justified mutation: it refuses to overwrite an executable merely because it is named `kitten`, and it never changes a user's installation channel as a side effect.

## Problem

A developer returning to a previously installed CLI needs a fast way to reach the latest stable release. Today the safe path is manual: infer how Kitten was installed, choose the correct npm or standalone recovery command, and repeat the installation. That friction encourages stale versions and turns straightforward maintenance into support work.

The risk is asymmetric. A permissive updater can overwrite a copied binary, update an npm prefix unrelated to the executable being run, follow an unsafe path, or replace a valid installation after a failed download. A command that reports success but changes the wrong executable is worse than no updater.

Kitten already treats npm and checksum-verified standalone binaries as co-primary channels. The update experience must retain that decision: npm-owned installs remain npm-owned; only a standalone binary bound to a verified installation record may self-replace. Every other context is an intentional, informative no-op.

### Market Data

- Bun directs package-manager installations to update through their package manager to avoid channel conflicts. [Bun upgrade guide](https://bun.sh/docs/guides/util/upgrade)
- npm global installation semantics are rooted in the configured global prefix; an executable name alone is not provenance. [npm folders](https://docs.npmjs.com/files/folders.html/)
- Rustup provides an explicit self-update command and release channels, while Homebrew separates metadata refresh from installed-package upgrades. [Rustup basics](https://rust-lang.github.io/rustup/basics.html) · [Homebrew manpage](https://docs.brew.sh/Manpage)
- GitHub documents release-asset integrity verification; Kitten's checksum-plus-atomic-replacement design aligns with that model while honestly deferring publisher-compromise resistance. [GitHub release integrity](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity)

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Explicit metadata command | Critical | `kitten --update` dispatches before repository checks, agent launch, ACP connections, or Cockpit mount; it targets only the latest stable release and exits when finished. |
| F2 | Proven global npm update | Critical | Only a proved global npm installation invokes `npm install --global @matheusbbarni/kitten@latest`; local, `npx`, copied, and ambiguous paths never invoke npm or download a binary. |
| F3 | Verified standalone ownership | Critical | The installer writes a versioned XDG-state record only after a verified standalone installation succeeds. Self-update requires the canonical running executable to match that record. |
| F4 | Integrity-protected replacement | Critical | The standalone path resolves the shipped host artifact, requires one valid checksum-manifest entry, verifies downloaded bytes, reports an already-current binary without writing, and atomically replaces only the verified target. |
| F5 | Fail-closed recovery | High | Unsupported, stale, malformed, symlink-mismatched, permission-failed, or otherwise inconclusive invocations exit nonzero without mutation and print both supported recovery commands. |
| F6 | Discoverable, release-parity CLI | High | `--help`, README guidance, launcher behavior, and the compiled-binary integration contract accurately document and prove `--update`, retaining existing metadata-flag precedence. |

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| `src/index.ts` metadata dispatch | Add the explicit update path before normal boot while retaining `--version` before `--help` precedence. |
| `bin/launcher.mjs` | Provide positive global-npm provenance rather than classifying by executable name. |
| `scripts/install.sh` | Write the standalone installation record only after checksum verification and successful installation. |
| Build and release artifacts | Reuse the four shipped host artifact names and `SHA256SUMS` contract. |
| XDG state convention | Store standalone ownership evidence under Kitten's existing state-directory convention. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Verified-path contract compliance | 100% | Focused CI matrix proves each supported npm and standalone scenario takes only its owning channel. |
| Failure preservation | 100% | Every induced download, manifest, hash, write, permission, and rename failure leaves the previous standalone executable byte-identical. |
| Channel-switch incidents | 0 | Focused tests and post-release incident review find no npm-to-standalone or standalone-to-npm mutation. |
| Unsupported-path safety | 100% | Source, `npx`, local, copied, unsupported, and invalid-record fixtures exit nonzero with no filesystem or package-manager mutation. |
| Trustworthy completion | ≥95% after sufficient opt-in sample | Content-free, opt-in local outcome data—if added—reports successful verified updates rather than merely process exits. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Quick Win**

## Council Insights

- **Recommended approach:** Ship both verified npm and standalone update paths as co-primary, synchronous transactions. Classify provenance first; mutate only after the relevant channel and replacement are proven.
- **Key trade-offs:** A recovery-only command is simpler but fails to validate the self-update value; broader update management creates unneeded lifecycle and trust complexity. Legitimate nonstandard installs may be refused to preserve safety.
- **Risks identified:** npm-prefix and shim confusion; stale or malformed standalone records; duplicate or malformed manifests; symlink, path-substitution, permission, and concurrent-update races; checksum verification's inability to detect a compromised release publisher.
- **Risk mitigation:** A provenance-and-mutation decision table; narrow injectable seams; same-directory secure temporary files; canonical-target revalidation and serialization; unique manifest rows; hash-before-write; atomic replacement; byte-identical failure tests; explicit residual-risk documentation.
- **Stretch goal (V2+):** A release trust centre: signed or attested release verification, optional check-only behavior, channel-aware update visibility, and release notes—only after the core command earns trust.

## Out of Scope (V1)

- **Background checks and notifications** — the user chose an explicit, one-shot action; background network activity enlarges the lifecycle and privacy surface.
- **TUI update surfaces or automatic relaunch** — updates must not mount the Cockpit or surprise an active workflow.
- **Prerelease, version-selection, and rollback UI** — latest stable is the only supported target; selection and recovery policy require separate product decisions.
- **Other package managers** — pnpm, Yarn, Homebrew, and future channels need their own positive ownership proof.
- **Windows support** — current release artifacts cover the four shipped Darwin/Linux targets only.
- **Publisher-compromise resistance** — signed provenance and release attestation are valuable but separate from the existing checksum contract.

## Architecture Decision Records

- [ADR-001: Preserve Verified Installation Channels with Fail-Closed Updates](adrs/adr-001.md) — Requires positive channel provenance and verified replacement before mutation.

## Open Questions

- What minimum post-release sample is sufficient before treating the ≥95% opt-in outcome KPI as meaningful?
- Which exact human-facing messages best distinguish “safe refusal” from an updater failure for nonstandard but legitimate installations?
- When should a future release-trust slice add publisher provenance or attestation without changing the two-channel ownership model?
