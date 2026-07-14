# NPM and GitHub Release - PRD

## Overview

Kitten runs Claude Code and Codex in one terminal and hands a live coding task between them with a keystroke.
Today it is effectively unshippable and uninstallable: `npx kitten` fails on any machine without Bun, the advertised curl one-liner 404s against a placeholder repo slug, the README only documents a from-source flow, kitten cannot even tell a user which version they are running, and every release is hand-cut with a `0.0.0`/tag versioning footgun.

This feature makes cutting a release one deliberate action and makes installing kitten trustworthy and obvious.
It is for three people: the maintainer who cuts releases, the developer who reaches for `npx kitten` to try it, and the security-conscious adopter who checks provenance before depending on anything.
It is valuable because a product you cannot cleanly install or reliably ship has an adoption ceiling near zero; this is the floor every later feature stands on.

## Goals

- Reduce cutting a release to **one reviewable action** (merge the release PR), with the version and human-readable notes decided upstream.
- Make `npx kitten` and `npm i -g kitten` **work on any machine without Bun**, across all four supported platforms.
- Fix both advertised install paths so a **new user's first documented command works**.
- Make every kitten **self-describing**: a user can always ask its version and get real, accurate output.
- Make every published release **trustworthy**: provenance-signed on npm with no long-lived publish secret, and integrity-verifiable binaries.
- Ship these in two independently valuable halves - the cut, then the Bun-free npm install - so value lands early.

## User Stories

**Maintainer (primary)**
- As the maintainer, I want to cut a release by merging one PR so that I never again hand-craft a tag, notes, and version or hit the `0.0.0`/tag `403`.
- As the maintainer, I want the changelog auto-drafted from commits and grouped by impact so that I only curate wording before publishing, not assemble notes from scratch.
- As the maintainer, I want the publish to be all-or-nothing so that a half-finished release never reaches users.

**Evaluating developer (secondary)**
- As a developer trying kitten, I want to run `npx kitten` on my stock Node machine so that I can see it work without first installing Bun.
- As a developer, I want the very first command in the README to actually run so that I do not bounce on a 404 or a "Bun not found" error.
- As a developer, I want a version-stamped success line after install so that I know it worked and what I got.

**Daily user (secondary)**
- As a daily user, I want `kitten --version` and `kitten --help` to work so that I can check what I am running and how to use it, and report the right version in an issue.
- As a user considering an upgrade, I want release notes grouped into Breaking/Features/Fixes so that I can judge at a glance whether upgrading is safe.

**Security-conscious adopter (tertiary)**
- As a security-conscious adopter, I want npm to show a provenance attestation for kitten so that I can verify the package was built by kitten's CI from a specific public commit before I depend on it.

## Core Features

| #  | Capability | Priority | What the user gets |
| -- | ---------- | -------- | ------------------ |
| C1 | Install without Bun (`npx` / `npm i -g`) | Critical | The prebuilt native binary is delivered through npm per platform, so `npx kitten` and `npm i -g kitten` run on any Node machine with no Bun. |
| C2 | Working curl installer | Critical | The checksummed `curl … \| sh` one-liner installs the native binary with no Node at all; the placeholder repo slug is fixed so it no longer 404s. |
| C3 | One-action release cut | Critical | The maintainer merges a continuously maintained release PR; that mints the version, writes the changelog, and cuts the GitHub Release. No hand-crafted tags or versions. |
| C4 | Reliable, all-or-nothing publish | Critical | A release publishes every platform and channel together or not at all; a partial failure leaves the previous version installing cleanly. |
| C5 | Self-describing version | High | `kitten --version` and `kitten --help` work everywhere, reporting the real published version (also corrected in what kitten tells agents over ACP). |
| C6 | Human-readable release notes | High | The changelog is auto-drafted grouped into Breaking/Features/Fixes, curated before merge, and published verbatim to the GitHub Release; kitten states that it follows SemVer. |
| C7 | Trustworthy, provenance-signed publish | High | Every npm publish carries a provenance attestation, and the release runs without a long-lived publish token. |
| C8 | Honest, channel-accurate docs | High | The README leads with the shipped install channels (`npx` hero, `npm i -g` daily, curl for no-Node) and states the real requirements, including that kitten must run inside a git repo. |
| C9 | Clean commit input | Medium | Enforced Conventional-Commit PR titles keep the automated versioning and changelog accurate, invisibly to end users. |

## User Experience

**First contact to running (evaluating developer).**
The user lands on the README and the first thing they see is one copy-paste line: `npx kitten`.
Running it shows download progress with a size expectation (the binary embeds a runtime, so it is not tiny), then ends with an explicit `installed kitten vX.Y.Z` success line and a pointer to get started, rather than silence.
On first launch kitten checks its prerequisites and reports what it finds: it must run inside a git repository, and it needs Claude Code and Codex installed and authenticated to be useful.
If one agent is missing or unauthenticated, kitten says exactly which and why, and if at least one agent is ready it drops the user straight into the cockpit with the other still fully usable.

**Regular use (daily user).**
The user can run `kitten --version` any time to see what they are on, and `kitten --help` for usage with examples.
When they hear a new version is out, the README and the GitHub Release tell them the upgrade command that matches how they installed (`npm i -g kitten@latest`, or re-run the curl installer), and the release notes read as human sentences grouped by impact so they can decide whether to upgrade.

**Cutting a release (maintainer).**
The maintainer merges feature and fix PRs whose titles follow Conventional Commits; a release PR quietly accumulates the pending version bump and a grouped, drafted changelog.
When ready, the maintainer curates the notes for wording and merges the release PR.
Within about fifteen minutes the tag, GitHub Release, four platform binaries, and the npm packages are all live, provenance-signed, from one build - one action, no footguns.

**Accessibility and discoverability.**
Help leads with examples and the exact install/upgrade commands; success and error output never goes silent; version appears in error output so bug reports carry it.

## High-Level Technical Constraints

- **Supported platforms (user-facing):** macOS and Linux on arm64 and x64. Windows and musl-libc Linux are not covered in V1.
- **Install reliability:** installing must not depend on a runtime network fetch, so it works offline and behind corporate proxies once the package is resolved.
- **Value prerequisites (must be documented):** kitten delivers value only with Claude Code and Codex installed and authenticated and when launched from inside a git repository.
- **Security:** npm publishes must carry provenance and must not rely on a long-lived publish secret; binaries must be integrity-verifiable.
- **Performance from the user's view:** the `npx` first-run download is heavy because the binary bundles a runtime; the experience must set that expectation and confirm success, and the release must reach users within roughly fifteen minutes of the maintainer merging the release PR.

## Non-Goals (Out of Scope)

- **Proactive update notifier** ("you are outdated, run X") - deferred; V1 gives `--version` and upgrade docs, not a background check.
- **In-app version surface and in-tool changelog** (a `/release-notes` view inside the TUI) - deferred to a later slice.
- **Self-updating binary (`kitten upgrade`)** - the V2 retention play; depends on this train existing first.
- **Binary-channel attestation** (`gh attestation verify` on the curl binaries) - keep checksums for V1; the binary channel is not advertised as "attested" until it is signed.
- **Pre-release / beta / canary channels** - stable only.
- **Additional platforms (Windows, linux-musl, more arches)** and a **Homebrew tap** - linear adds for later.
- **Local commit hooks (commitlint/husky)** - PR-title enforcement at the merge boundary is sufficient.
- **Frictionless dual-agent onboarding (`kitten doctor`)** - the recommended next feature, a different effort; it does not deliver "`npm i` works."

## Phased Rollout Plan

### MVP (Phase 1) - the cut and the fixes users hit first

- One-action release cut (C3) with curated, grouped release notes (C6).
- Fixed curl installer (C2) and a README rewritten to be honest about channels and requirements (C8).
- `--version` / `--help` with the real version wired through (C5).
- PR-title enforcement (C9).
- **Success criteria to proceed:** a release can be cut by merging one PR and produces a human-readable GitHub Release; the README's literal install commands resolve; `kitten --version` reports the published version.

### Phase 2 - `npx kitten` without Bun

- npm-native binary across all four platforms (C1), with an all-or-nothing, ordered publish (C4) and a version-stamped install success line.
- Provenance-signed, token-less publish (C7); README hero finalized to `npx kitten`.
- **Success criteria to proceed:** `npx kitten@<ver> --self-check` is green on all four platforms in a Bun-free environment; 100% of npm publishes carry provenance; zero partial publishes.

### Phase 3 - upgrade awareness (post-V1)

- Update notifier, self-update (`kitten upgrade`), in-tool changelog, binary attestation, and additional platforms.
- **Long-term success:** users stay current with minimal friction and can verify both channels end to end.

## Success Metrics

| Metric | Target | How it is observed |
| ------ | ------ | ------------------ |
| Release-cut effort | <= 1 manual action to ship | Distinct maintainer-triggered steps in the release runbook |
| `npx kitten` works without Bun | 100% boot (`--self-check`) across all 4 platforms | CI smoke job: `npx kitten@<ver> --self-check` in a Bun-free Node container per platform |
| Broken / partial publishes | 0 | Release-workflow success rate = clean publishes / attempts |
| Merge-to-published latency | < 15 min | Timestamp delta: release-PR merge to last publish job green |
| npm provenance coverage | 100% of publishes | Provenance badge / `npm audit signatures` on the published version |
| Version is knowable | `kitten --version` present and reports the published version | Automated check that `--version` output equals the release version |
| Docs stay true | README's literal install commands resolve | CI check that the documented install commands succeed |

## Risks and Mitigations

- **The heavy `npx` download feels slow and reads as a hang.** Mitigation: show progress and the size, confirm success with the installed version, and steer daily users to the persistent global install so they pay the weight once.
- **The "cliff after install" bounces new users** - value needs both agents authenticated and a git-repo cwd. Mitigation: document the real requirements up front and lean on kitten's existing, specific readiness messages; name frictionless onboarding (`kitten doctor`) as the recommended next feature.
- **Dependency on external release infrastructure** (release-please action, npm Trusted Publishing) that could change or misconfigure and silently stall releases. Mitigation: pin action versions, document the one-time OIDC bootstrap, and keep a manual escape hatch that cannot double-publish.
- **First-publish bootstrap delay** - trusted publishing cannot be configured until the packages exist. Mitigation: a first publish with a scoped token, then lock each package to trusted publishing.
- **Curation gets skipped under time pressure**, degrading notes to raw commit logs. Mitigation: the release PR is already the merge gate, so curation is a normal edit, not an extra step.
- **Positioning risk** - reliable install is table stakes, so this raises the floor without itself driving virality. Mitigation: treat it as the enabling foundation and measure it on reliability, not growth.

## Architecture Decision Records

- [ADR-001: V1 scope for the automated release train](adrs/adr-001.md) - release-please cut with the manifest as the single version source, npm-native binary via `optionalDependencies`, atomic ordered token-less publish with OIDC provenance, PR-title enforcement, supersedes ADR-006's npm-secondary framing.
- [ADR-002: V1 product scope - reliable pipeline plus a self-describing install](adrs/adr-002.md) - adopt Approach A: the pipeline plus `--version`/`--help`, an honest README, a version-stamped install, and curated notes; defer the update notifier, in-app version, and in-tool changelog.

## Open Questions

- **Package naming:** do the platform packages use a scoped `@kitten/*` name (is that npm org secured?) or unscoped `kitten-<platform>` names - and which appears in the documented install command?
- **First version:** what is the initial version off `0.0.0` with no existing tags (e.g. `0.1.0`), and how is it seeded?
- **Download-size expectation:** what size do we quote to users for the `npx` install, and is it acceptable or worth reducing before Phase 2?
- **Repo slug casing:** the real remote is `MatheusBBarni/Kitten` (capital K) - confirm the canonical slug used in docs and install URLs to avoid a case-sensitivity 404.
- **Uninstall docs:** should V1 document an uninstall path per channel (a clig.dev convention)?
- **Git-repo requirement:** should the git-repo launch gate be surfaced prominently in install docs, or softened, given it is a likely first-run surprise?
- **Manual escape hatch:** should the release workflow keep a manual `workflow_dispatch`, and how does it avoid double-publishing against the automated path?
