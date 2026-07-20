# PRD: Channel-Preserving CLI Update

## Overview

Kitten needs an explicit, trustworthy way for an installed developer CLI to reach the latest stable release. `kitten --update` will serve developers using either supported distribution channel—global npm or the checksum-verified standalone installer—without launching the Cockpit.

The feature makes maintenance convenient only when Kitten can justify the change. A verified installation updates through its original channel and reports the channel plus version outcome. An ambiguous, unsupported, local, copied, or otherwise unverified invocation remains unchanged and receives both supported recovery commands. This protects developers from accidental channel switching while making the safe path clear.

## Goals

- Give every verified npm or standalone user one explicit command to reach the latest stable Kitten release.
- Preserve the original installation channel in 100% of supported update outcomes.
- Ensure 100% of ambiguous or unsupported invocations make no change and provide actionable recovery guidance.
- Make every update result self-describing: channel, prior version, resulting version, or already-current status.
- Establish zero unsafe mutations or channel-switch incidents as the prerequisite for expanding the update experience.

## User Stories

### Global npm developer

- As a developer who installed Kitten globally with npm, I want `kitten --update` to update through npm so that my package-manager-owned installation stays under the package manager's control.
- As a global npm developer, I want to see the channel and version result so that I know the command updated the installation I invoked.

### Standalone-binary developer

- As a developer who installed Kitten through the checksummed standalone installer, I want `kitten --update` to safely update that installed binary so that I do not need to repeat the installer manually for ordinary releases.
- As a standalone-binary developer, I want an already-current result to make no change so that I can run the command confidently when unsure of my version.

### Developer with an unsupported or uncertain installation

- As a developer running Kitten from source, `npx`, a local dependency, a copied binary, or another uncertain context, I want Kitten to refuse safely and explain both supported recovery paths so that I can return to a supported installation without risking the executable I ran.

### Maintainer

- As a Kitten maintainer, I want one consistent update promise across documentation and the CLI so that users receive accurate expectations and fewer manual-update support requests.

## Core Features

### Critical: Explicit latest-stable update action

- `kitten --update` is the sole public V1 invocation.
- It performs one update attempt, exits with a clear result, and never launches the Cockpit, starts agents, requires a Git repository, prompts the user, or relaunches itself.
- It targets the latest published stable release only.

### Critical: Channel-preserving updates

- A verified global npm installation updates only through npm.
- A verified standalone installation updates only through the standalone release channel.
- The feature never replaces an executable merely because it is named `kitten`, and it never changes a user's installation channel as a fallback.

### Critical: Safe standalone release delivery

- A standalone update uses the matching supported release artifact and verifies its published integrity information before replacing the installed program.
- An already-current standalone installation reports that status without rewriting the executable.
- Any failed update attempt leaves the previous standalone program available to the user.

### High: Self-describing outcomes and recovery

- Every verified update reports its channel, prior version, and resulting version; an already-current outcome says so explicitly.
- Every unsafe or inconclusive invocation states that Kitten made no change, exits nonzero, and prints both supported recovery commands:
  - `npm install --global @matheusbbarni/kitten@latest`
  - `curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash`
- Output remains concise, sequential, and copyable in an ordinary terminal.

### High: Discoverable release guidance

- `--help`, README installation guidance, and the packaged command experience document `--update` accurately.
- Existing metadata behavior remains predictable: callers combining existing metadata flags retain the established `--version` before `--help` precedence.

## User Experience

### Verified update journey

1. The developer runs `kitten --update` from any directory.
2. Kitten announces that it is checking the current supported installation channel.
3. Kitten updates only when it can verify ownership of that installation.
4. The developer sees the channel used and the prior and resulting version, then returns to the shell.
5. The developer launches `kitten` separately when ready; the update command never enters the Cockpit.

### Already-current journey

1. The developer runs `kitten --update` when unsure whether an update is needed.
2. Kitten verifies the supported installation and reports the channel and already-current version.
3. Kitten makes no executable change and exits successfully.

### Safe-refusal journey

1. The developer runs `kitten --update` from an installation Kitten cannot positively identify.
2. Kitten explains that it did not make a change because it could not update the invocation safely.
3. Kitten presents both supported, copyable recovery commands without guessing the user's channel.
4. Kitten exits nonzero; the developer chooses an intentional supported reinstallation path.

### Accessibility and discoverability

- All essential status and recovery information is plain terminal text, never color-only or hidden behind a TUI interaction.
- The command requires no confirmation prompt, reducing friction for a deliberate one-shot action.
- Help and README language use the same channel names and recovery commands as the command output.

## High-Level Technical Constraints

- V1 supports the product's existing global npm and standalone installation channels only.
- The command must work independently of repository state, Cockpit startup, agent availability, and network-dependent background behavior.
- Standalone updates are available only for the currently shipped macOS/Linux arm64/x64 release artifacts.
- Integrity verification must prevent corrupted, missing, mismatched, or ambiguous release assets from replacing an installed standalone binary.
- The product must not claim protection against a compromised release publisher; stronger publisher provenance is a future trust decision.

## Non-Goals (Out of Scope)

- Background update checks, notifications, scheduled updates, or automatic retries.
- Cockpit/TUI update controls, automatic relaunch, and release-note views.
- Prerelease, pinned-version, rollback, or downgrade selection.
- Homebrew, pnpm, Yarn, Nix, and other package-manager update paths.
- Windows support beyond the existing release matrix.
- Publisher attestation, signing, or broader release-provenance work.

## Phased Rollout Plan

### MVP (Phase 1)

- Ship the explicit `kitten --update` action for verified global npm and verified standalone installations.
- Provide channel-and-version result output, already-current behavior, and safe refusal with both recovery commands.
- Update help and public installation guidance.
- **Success criteria to proceed:** zero unsafe mutations or channel switches in release validation and early production use; every unsupported context receives a safe, actionable outcome.

### Phase 2

- Evaluate opt-in, content-free outcome evidence and manual-update support demand.
- Improve confidence and discoverability only where Phase 1 evidence identifies a real user need, without adding automated update behavior by default.
- **Success criteria to proceed:** trustworthy verified completion remains at or above 95% after a meaningful opt-in sample, with no unresolved integrity incidents.

### Phase 3

- Consider check-only visibility, stronger publisher provenance, or additional channel-specific update journeys only when each can preserve the same ownership and safe-refusal standard.
- **Long-term success criteria:** every expanded channel demonstrates an independently trustworthy update and recovery experience before it becomes a supported default.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Supported-channel preservation | 100% | Every verified update uses its original supported channel. |
| Unsafe mutation incidents | 0 | No ambiguous, unsupported, or failed invocation changes the executable or package installation. |
| Safe-refusal guidance | 100% | Every inconclusive invocation reports no change and shows both supported recovery commands. |
| Verified update completion | ≥95% | Opt-in, content-free outcome data after a meaningful sample records a successful verified update or already-current result. |
| Critical update-integrity incidents | 0 in the first 90 days | Maintainer incident review records no critical integrity or channel-switch defect after release. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Developers interpret a safe refusal as a broken command. | State that no change was made, explain the safety reason succinctly, and show both recovery paths. |
| Users expect the command to update every Kitten invocation. | Name the two supported channels consistently in help, docs, and failure output. |
| Users overestimate what checksum verification guarantees. | Describe the integrity boundary honestly and defer publisher-provenance claims. |
| Convenience pressure expands scope before the core promise is trusted. | Require zero trust failures before considering background behavior, more channels, or richer lifecycle UI. |
| Release availability issues leave users unable to update. | Keep the current installation untouched and provide the established manual recovery commands. |

## Architecture Decision Records

- [ADR-001: Preserve Verified Installation Channels with Fail-Closed Updates](adrs/adr-001.md) — Requires positive ownership and verified replacement before any update mutation.
- [ADR-002: Make Every Update Outcome Self-Describing and Fail Closed](adrs/adr-002.md) — Requires channel/version feedback and both recovery paths for every safe refusal.

## Open Questions

- What minimum opt-in sample makes the ≥95% verified-completion metric meaningful for future phase decisions?
- Which user-facing wording most clearly distinguishes a safe refusal from a failed supported update?
- Which future installation channel, if any, has enough user demand to justify its own independently verified update journey?
