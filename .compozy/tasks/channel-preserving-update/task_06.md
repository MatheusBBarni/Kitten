---
status: completed
title: "Align update help and public install recovery guidance"
type: docs
complexity: medium
---

# Task 06: Align update help and public install recovery guidance

## Overview

Align the compiled help text, packaged launcher help, README, and documentation contracts with the completed channel-preserving update behavior. Developers must see the same explicit command, supported-channel boundary, and copyable recovery guidance everywhere without implying a channel switch, normal Cockpit boot, or release-publisher guarantee.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
1. MUST add `kitten --update` to help and README guidance as an explicit latest-stable action that does not launch the Cockpit, require a repository, start agents, prompt, or relaunch.
2. MUST use the exact recovery commands `npm install --global @matheusbbarni/kitten@latest` and `curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash` in every update refusal surface.
3. MUST name only verified global npm and installer-managed standalone binaries as updateable, state that unknown/local/source/`npx`/copied contexts remain unchanged, and state that there is no channel fallback.
4. MUST preserve the README's existing initial-install primary command and standalone alternative, existing examples-first help, and version-before-help metadata behavior.
5. MUST describe checksum verification as release-asset integrity only and MUST NOT claim resistance to a compromised release publisher.
6. MUST verify matching help content through source, compiled binary, and packaged Node launcher without invoking a real update, network operation, or package-manager mutation.
</requirements>

## Subtasks

- [ ] 6.1 Add concise public `--update` usage and channel-boundary text to CLI help.
- [ ] 6.2 Add matching update and safe-refusal guidance to the README installation section.
- [ ] 6.3 Normalize every update recovery command to the PRD literal form.
- [ ] 6.4 Preserve existing primary-install, showcase, and metadata-precedence documentation contracts.
- [ ] 6.5 Extend source, compiled-artifact, package-launcher, and README assertions.

## Implementation Details

Implement TechSpec "Documentation and command discovery" only after the command outcomes are finalized. Keep the change limited to public guidance and its contracts; do not change updater, registry, release, package-manager, showcase, or workflow behavior.

### Relevant Files

- `src/index.ts` — sole compiled CLI help surface and examples-first usage text.
- `README.md` — public installation and update guidance.
- `test/firstRunBoot.test.ts` — source help and metadata-precedence assertions.
- `test/build.integration.test.ts` — compiled artifact help contract.
- `test/npm-launcher.integration.test.ts` — packaged Node launcher forwards compiled help.
- `test/package-shim.test.ts` — README/package primary-install and standalone-alternative contract.
- `test/readmeInstall.test.ts` — canonical raw installer URL and repository guidance contract.

### Dependent Files

- `site/src/config/showcase-config.ts` — remains intentionally untouched because its one primary install CTA is governed by a separate showcase contract.
- `scripts/install.sh` — existing canonical installer command remains the documented standalone recovery target.
- `bin/launcher.mjs` — published shim forwards the finalized compiled help without new behavior in this task.

### Related ADRs

- [ADR-001: Preserve Verified Installation Channels with Fail-Closed Updates](adrs/adr-001.md) — defines the supported channels and no-fallback rule.
- [ADR-002: Make Every Update Outcome Self-Describing and Fail Closed](adrs/adr-002.md) — defines output and recovery expectations.
- [ADR-003: Keep Update Mutation at Its Provenance Boundary](adrs/adr-003.md) — defines accurate npm and standalone ownership language.
- [ADR-004: Use Canonical-Path Records and Tagged Releases for Standalone Updates](adrs/adr-004.md) — defines the checksum trust boundary.

## Deliverables

- Updated CLI help and README update/recovery guidance with exact PRD commands.
- Source, compiled-artifact, packaged-launcher, and README documentation contracts.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests proving shipped help parity without live updates **(REQUIRED)**.

## Tests

- Unit tests:
  - [ ] Source `--help` remains examples-first, includes `--update`, both exact recovery commands, and no abbreviated `npm i -g` or `| sh` update form.
  - [ ] Mixed metadata flags preserve version-before-help behavior while help retains update guidance.
  - [ ] README keeps its initial first install command and standalone alternative, documents `kitten --update`, both recovery commands, verified-channel/no-fallback behavior, and no-change wording for source/local/npx/copied/uncertain contexts.
  - [ ] Existing raw installer URL and repository-slug validation remains intact without adding a live-network dependency.
- Integration tests:
  - [ ] Host compiled `--help` contains `--update` and both exact recovery commands with zero stderr.
  - [ ] Packed Node launcher `--help` forwards the same update/recovery text with zero npm update or network activity.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Public source, compiled, package, and README guidance describe one consistent channel-preserving update contract.
- No public guidance claims automatic boot, channel switching, or publisher-compromise protection.
