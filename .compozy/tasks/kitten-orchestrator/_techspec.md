## Executive Summary

Implement PRD **MVP (Phase 1): Invisible Cockpit Parity** by converting the repository root into a private Bun workspace and moving Cockpit as one public application package at `apps/cockpit`. The move preserves Cockpit’s public npm identity, launcher, configuration semantics, session behavior, compiled artifacts, installer, and release evidence. The root becomes a thin coordinator with one lockfile, install policy, release entry points, and filtered delegating scripts.

The primary trade-off is deliberate path migration now versus structural reuse later. App-local source, tests, and command CWD preserve the strongest existing contracts with minimal behavior change, while root-owned release orchestration preserves public URLs and artifact names. This retains a temporary root-to-app release bridge and defers shared packages, data migration, and Orchestrator implementation until parity has evidence.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary and Data Flow |
| --- | --- | --- |
| Workspace root | Private package coordinator, one `bun.lock`, `bunfig.toml`, aggregate commands, root CI/release configuration | Delegates named scripts to Cockpit; owns no Cockpit runtime state. |
| `apps/cockpit` package | Public `@matheusbbarni/kitten` package, binary declaration, source, tests, build, and local scripts | Owns the unchanged Cockpit launch CWD and package-relative paths. |
| Cockpit runtime | Existing ACP adapter, core, store, controller, config, and OpenTUI layers | Moves unchanged under `apps/cockpit/src`; no cross-app imports or new shared runtime. |
| Cockpit contract suite | Colocated and integration tests for runtime, config, package, installer, build, and release claims | Moves under `apps/cockpit/test`; validates app-local behavior and root delegation contracts. |
| Root public release surface | `README.md`, `scripts/install.sh`, release workflow, release-please metadata, release assets | Invokes Cockpit-local build/package scripts and stages app-local artifacts under existing public names. |
| Showcase package | Existing independent site package and Pages flow | Remains unchanged and separately installed/verified by root CI. |

### Target Layout

```text
package.json                 # private workspace coordinator
bunfig.toml, bun.lock        # one install policy and lockfile
apps/cockpit/
  package.json               # public @matheusbbarni/kitten package and scripts
  src/ test/ bin/ scripts/   # moved as one unit
  tsconfig.json              # app-local source and test includes
.github/workflows/           # root CI and public release orchestration
scripts/install.sh           # stable public installer URL
README.md                    # stable public install documentation
site/                        # unchanged separate package
```

## Implementation Design

### Core Interfaces

The workspace coordinator needs only a typed contract for the one app it delegates to. This TypeScript interface replaces the generic Go example required by the workflow because Kitten is a strict TypeScript/Bun codebase.

```ts
export type CockpitScript = "typecheck" | "test" | "test:coverage" | "selfcheck" | "build" | "build:local"

export interface CockpitWorkspaceContract {
  readonly packageName: "@matheusbbarni/kitten"
  readonly directory: "apps/cockpit"
  readonly publicBin: "kitten"
  readonly scripts: readonly CockpitScript[]
  readonly rootDelegatesWith: "bun run --filter"
}
```

Root scripts call app-local scripts by package name, for example `bun run --filter @matheusbbarni/kitten typecheck`. Delegation must return the Cockpit script’s exit status unchanged. Root scripts must never directly invoke an app source path, because that would restore the wrong CWD for existing integration tests.

### Data Models

- **Root workspace manifest**: add `private: true` and `workspaces: ["apps/*"]`; retain only coordinator scripts and workspace-level metadata. Do not create `packages/*` in Phase 1.
- **Cockpit package manifest**: move the current public name, version, `bin`, `files`, optional platform dependencies, runtime dependencies, and Cockpit scripts unchanged to `apps/cockpit/package.json`.
- **Cockpit configuration and local state**: retain the existing external path precedence, strict schema, session identity, and persistence behavior. No configuration file, registry, database, copy, migration, or compatibility reader is added.
- **Build artifacts**: Cockpit stages its local build and npm package outputs below `apps/cockpit/dist`; root release jobs consume these paths while publishing the existing release asset and npm package names.

### API Endpoints

No HTTP, RPC, ACP, or MCP API surface changes in Phase 1. Existing agent transport, configuration, permission, and handoff contracts move with Cockpit unchanged. Root workspace commands are package-script delegation, not a new public API.

## Integration Points

| Integration | Phase-1 treatment | Failure behavior |
| --- | --- | --- |
| Bun workspaces | One private root manifest, one root lockfile, package-filtered delegation | Installation or filtered-script failure blocks the same Cockpit gate it blocks today. |
| Public npm shim and platform packages | Cockpit package retains its names and launcher; root release workflow publishes the existing five-package set | Missing platform artifact, version mismatch, or launcher failure blocks publication. |
| Standalone installer and README | Root path and public URL remain stable; release asset names remain stable | Installer checksum or URL contract failure blocks release evidence. |
| User configuration | Existing environment/XDG/default precedence remains Cockpit-owned | Existing malformed-config failure behavior remains unchanged. |
| Showcase site | Continue as an independent package in root CI | Site dependency or build failure remains visible rather than being folded into Cockpit. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| Root `package.json` | Modified | Becomes private coordinator; risk of losing public npm metadata | Add workspace and filtered delegators; move public metadata to Cockpit. |
| `apps/cockpit/package.json` | New | Becomes the published Cockpit package; risk of shim/version drift | Move metadata and scripts verbatim, then update only workspace-relative paths. |
| `src/`, `test/`, `bin/`, `scripts/`, `tsconfig.json` | Moved | Sibling imports and CWD-sensitive tests can break | Move as one unit; preserve local relationships and command CWD. |
| `bunfig.toml`, `bun.lock` | Retained at root | Install policy and lock must serve the workspace | Keep one root policy and lockfile; refresh only through the approved install flow. |
| CI workflow | Modified | Root commands and Cockpit path assumptions change | Delegate to Cockpit scripts and retain independent site installation. |
| Release workflow | Modified | Build/staging/version paths change while public behavior must not | Invoke app-local build; stage and smoke the existing artifact/package names. |
| Root installer and README | Retained | Public URL and install language must not drift | Keep paths and claims stable; update only internal source references. |
| Cockpit config loader | Moved unchanged | Any semantic change breaks user state compatibility | Keep its existing resolution and strict validation contracts unchanged. |

## Testing Approach

### Unit Tests

- Move all Cockpit unit tests with their implementation modules and retain injected seams for build, boot, config, launcher, and handoff behavior.
- Preserve existing build helper tests, including platform enumeration, checksum rendering, package-manifest generation, and compiled-worker inputs.
- Add focused root-delegation contract tests that assert each aggregate command targets `@matheusbbarni/kitten` and propagates failures.
- Keep configuration tests proving existing precedence, strict validation, and unchanged zero-config semantics.

### Integration Tests

- Run Cockpit typecheck, test, coverage, self-check, and build from `apps/cockpit`; retain CWD-sensitive launch tests without root-emulation wrappers.
- Update package-shim, npm-launcher, installer, release-workflow, release-please, and CI-workflow tests only for approved app-relative paths; preserve their public artifact, package, and command assertions.
- Verify all four native build targets, compiled self-checks, five published package surfaces, checksum installer behavior, and Bun-free npm smoke behavior through the existing release contracts.
- Keep `site/` installation and verification separate; its outcome must not be hidden by a Cockpit workspace pass.

## Development Sequencing

### Build Order

1. **Create the private root workspace manifest and filtered delegators** — no dependencies; retain root `bunfig.toml`, `bun.lock`, installer, README, and release entry points.
2. **Create `apps/cockpit/package.json` and local TypeScript configuration** — depends on step 1; move the public package metadata and local scripts without semantic changes.
3. **Move Cockpit source, tests, launcher, and build scripts as one app unit** — depends on step 2; preserve package-relative imports, source layering, and app-local CWD.
4. **Relocate and update Cockpit contract tests plus root-delegation checks** — depends on steps 2 and 3; change only intentional workspace path assertions and keep the full parity matrix.
5. **Update CI, release, release-please, installer-contract, and documentation paths** — depends on steps 1 through 4; invoke Cockpit-local scripts and consume app-local staged artifacts while retaining public names and URLs.
6. **Run the complete Phase-1 evidence matrix and record inherited exceptions** — depends on steps 1 through 5; block advancement on any unexplained parity, artifact, installer, or published-package deviation.

### Technical Dependencies

- Bun 1.3.13-compatible workspace installation and filtered package-script execution.
- Existing exact dependency pins and root install policy must remain valid for the moved public package.
- Native CI runners for the existing four supported artifacts remain required.
- The current public npm namespace, release assets, trusted publishing, and installer URL remain available.
- No Orchestrator source, shared-capability package, shared persistence, or user-state migration may be introduced into this dependency chain.

## Monitoring and Observability

- Treat the filtered Cockpit typecheck, test, coverage, self-check, build, installer, release-contract, and npm-smoke results as Phase-1 release signals.
- Preserve the existing content-free telemetry behavior; do not add workspace migration telemetry or collect prompt, code, credential, or repository content.
- Emit path and package identity in CI failure output so a failure distinguishes root delegation, Cockpit-local execution, build staging, installer, and publication evidence.
- Use zero-tolerance release thresholds: any failed public contract, unsupported inherited exception, missing artifact, checksum mismatch, or smoke failure blocks the release.

## Technical Considerations

### Key Decisions

- **Whole-app workspace boundary**: move Cockpit as `apps/cockpit` rather than preserving root ownership or extracting packages. This preserves CWD-sensitive contracts and avoids premature runtime sharing.
- **Root release bridge**: retain root public installer, README, and workflow entry points while building Cockpit locally. This preserves public URLs and artifact names at the cost of temporary path bridging.
- **No state migration**: keep existing Cockpit configuration and local state untouched. This avoids migration and rollback risk in a parity-only release.
- **Relocated parity suite**: preserve and move the contract matrix rather than replacing or duplicating it. This keeps the Phase-1 gate meaningful and app-owned.

### Known Risks

- **Package/shim version drift**: moving public metadata can desynchronize the main package and native packages. Mitigate with the existing package-shim, release, and npm-smoke contracts.
- **Build asset omission**: compiled OpenTUI worker assets can disappear when build CWD changes. Mitigate by preserving Cockpit-local build inputs and compiled self-check coverage.
- **Incorrect command CWD**: root execution can break process-relative integration fixtures. Mitigate by using Bun workspace filtering and explicitly testing app-local command execution.
- **Public installer regression**: a moved script path can break the stable installer URL or checksum behavior. Mitigate by retaining the root installer path and its contract tests.
- **Scope leakage**: future shared packages or Orchestrator code would undermine clean parity evidence. Mitigate by rejecting those additions under ADR-001 through ADR-006.

## Architecture Decision Records

- [ADR-001: Gate the two-app migration on Cockpit workspace parity](adrs/adr-001.md) — makes Cockpit parity the first delivery gate.
- [ADR-002: Make Phase 1 an invisible Cockpit parity release](adrs/adr-002.md) — excludes new user-facing product behavior.
- [ADR-003: Move Cockpit as one self-contained Bun workspace app](adrs/adr-003.md) — defines the private root and app-local boundary.
- [ADR-004: Keep root release orchestration while building Cockpit locally](adrs/adr-004.md) — preserves public release contracts through a root-to-app bridge.
- [ADR-005: Preserve Cockpit local state without migration in Phase 1](adrs/adr-005.md) — keeps configuration and local state unchanged.
- [ADR-006: Relocate Cockpit contract tests and delegate them from the workspace root](adrs/adr-006.md) — preserves app-local parity evidence and thin root delegation.
