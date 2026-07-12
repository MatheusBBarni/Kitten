# Kitten Showcase Site Technical Specification

## Executive Summary

`kitten-showcase-site` will be implemented as a standalone static Astro site in a dedicated `site/` project so browser-facing content stays isolated from the terminal CLI runtime.  
The launch page will be one conversion-focused route that proves the reviewed handoff flow, exposes one verified installation command path, and presents accurate repository star count.

Primary technical trade-off: V1 maximizes trust and reliability by accepting limited automatic measurement and a smaller JS runtime surface (client-side GitHub star fetch only) in exchange for lower privacy risk and less operational complexity.

## System Architecture

### Component Overview

- `site/` (new boundary): independent Astro project, own `package.json`, own lockfile, dedicated build output.
  - `site/src/pages/index.astro`: single-page shell and section ordering.
  - `site/src/components/*.astro`: focused sections (`Hero`, `Proof`, `Install`, `Requirements`, `Faq`, `SiteControls`).
  - `site/src/scripts/star-count.ts`: browser fetch for live star count.
  - `site/src/scripts/copy-command.ts`: install command copy-to-clipboard behavior and a11y announcements.
  - `site/public/`: static media and docs assets (recording, poster, icons).
- `.github/workflows/showcase-site.yml`: builds `site/` and publishes `site/dist` to GitHub Pages.
- `site/src/config/showcase-config.ts`: typed configuration for install command and scenario metadata.

Data flow:

1. `showcase-config.ts` defines the one approved install route and proof metadata as build-time literals.
2. `index.astro` renders all required trust, feature, and FAQ sections from config.
3. On page hydration, `star-count.ts` reads `data-repo` attributes and updates star number from GitHub REST.
4. The CTA interaction writes to clipboard only; no analytic event is emitted in V1.

### Mapping PRD goals and stories to components

- **Focus Promise / Trust** → `Hero`, `Proof`, and `Requirements` components.
- **Authentic demonstration** → `Proof` component with annotated clip + reduced-motion safe playback.
- **Verified install intent** → `Install` component with a single command path.
- **Public proof / community signal** → `SiteControls` star component.
- **Requirement clarity and FAQ** → `Faq` component.
- **Accessibility and responsiveness** → shared layout tokens in `index.astro` plus semantic sectioning.

## Implementation Design

### Core Interfaces

```go
type ShowcaseConfig struct {
    SiteTitle           string
    PrimaryInstallCmd   string
    PrimaryInstallText  string
    RepoOwner           string
    RepoName            string
    DemoSrc             string
    ProofFallbackLabel  string
}
```

```ts
export type ShowcaseSection = {
  id: string;
  heading: string;
  body: string;
};

export type InstallCommandSpec = {
  command: string;
  source: "verified-route";
  shellCopyHint: string;
};
```

### Data Models

- `ShowcaseConfig`:
  - Source-of-truth object for install command and repository metadata.
  - Includes:
    - `title`
    - `proof` label and transcript cues
    - `requirements` bullets
    - `faq` groups
    - `install` command metadata
    - `measurementNotes` (for launch copy, not telemetry output)
- `SiteStarState` (runtime state, DOM only):
  - `stars: number | null`
  - `status: "loading" | "ready" | "unavailable"`
  - `fallbackText: string`
- `RecordingState`:
  - `videoUrl`
  - `posterUrl`
  - `hasReducedMotion`: read from media query only for render-safe UX behavior.

### API Endpoints

- `GET https://api.github.com/repos/{owner}/{repo}`
  - Purpose: fetch `stargazers_count`, `html_url`, and canonical repo metadata for the star badge.
  - Query: none.
  - Error behavior: on fetch failure, do not render zero; surface fallback text and keep the repo link clickable.

## Integration Points

- **GitHub Pages**
  - Workflow in `.github/workflows/showcase-site.yml` deploys `site/dist`.
  - Requires Pages `public` source with `gh-pages` deployment permissions.
- **GitHub REST API**
  - Rate-limit aware single request per page view.
  - No credentials and no third-party analytics library.
- **Source Verification**
- Verified install command is defined in repo-local config and only displayed when explicitly set to `primaryInstallCmd` in `showcase-config.ts`.
- **Browser constraints**
  - Clipboard API use guarded (`navigator.clipboard.writeText`) with manual-select fallback for secure-context failures.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `.compozy/tasks/kitten-showcase-site/adrs/` | new | New ADR coverage for web architecture decisions and rollout constraints | Created during this TechSpec pass |
| `site/package.json` | new | New dependency graph (Astro + runtime support for build) | Add scripts: `dev`, `build`, `preview`, `format` |
| `site/src/pages/index.astro` | new | Primary rendering surface for all launch content | Implement sectioned page and semantic heading hierarchy |
| `site/src/components/*` | new | Content modularization | Add minimal reusable components for hero/proof/faq/install |
| `site/src/scripts/star-count.ts` | new | Client-side star fetch + fallback behavior | Add resilient fetch/update logic |
| `site/src/scripts/copy-command.ts` | new | Copy CTA behavior | Add focus/aria confirmation state |
| `site/public/*` | new | Adds recording and visual assets | Ensure asset sizes and alt text |
| `.github/workflows/showcase-site.yml` | new | Pages deployment pipeline for site output | Add environment/permissions and build commands |
| `.compozy/tasks/kitten-showcase-site/_techspec.md` | new | This artifact | Ready for `cy-create-tasks` |

## Testing Approach

### Unit Tests

- `npm run format` and `npm run lint` (if configured in `site/package.json`) for HTML/TS style.
- Script-level assertions in a minimal build check:
  - `showcase-config.ts` contains exactly one install command.
  - Required headings and IDs exist in rendered markup (via `astro check` or build-time smoke script).
- Manual keyboard/a11y smoke:
  - `Tab` reaches install CTA and star link.
  - Install copy button announces success through `aria-live`.

### Integration Tests

- `npm run build` in `site/`:
  - Must output `site/dist/index.html`, CSS/JS assets, and deterministic section structure.
  - Build must fail if the CTA includes an unavailable placeholder command.
- GitHub Pages deployment dry-run:
  - Simulate workflow build and validate deploy step copies files to Pages path.
- Browser runtime smoke (manual or simple scripted):
  - Star count shows fallback, then populates when API succeeds.
  - Demo playback starts, pauses, and remains accessible with reduced-motion mode.
  - Copy button copies text reliably in supported browsers; fallback selection path still works.

## Development Sequencing

### Build Order

1. Create `site/` Astro scaffold (`astro.config.mjs`, `package.json`, `src/`, `public/`) — no dependencies.
2. Add `site/src/config/showcase-config.ts` with one approved install command, repo metadata, and section content models — depends on step 1.
3. Implement `site/src/pages/index.astro` composition and static section markup for hero/proof/install/faq — depends on step 2.
4. Add `site/src/scripts/star-count.ts` and `data-repo` attributes for runtime star fetch/fallback behavior — depends on step 3.
5. Add `site/src/scripts/copy-command.ts` with accessible clipboard fallback and status messages — depends on steps 2 and 3.
6. Add responsive styling and motion-safe media strategy (poster + reduced-motion) in Astro style blocks/components — depends on steps 3 and 4.
7. Add `.github/workflows/showcase-site.yml` deploy job for `site/dist` to GitHub Pages and lock workflow permissions — depends on steps 1 through 6.
8. Add launch validation checklist in repo docs (`README.md` link only, if required by scope) — depends on step 7.
9. Run `cd site && npm run build` and smoke-render checks against `site/dist/index.html` — depends on steps 1 through 8.

### Technical Dependencies

- Repository visibility and release ownership for the advertised install route and repo link.
- GitHub API availability from visitor browsers.
- A stable, pre-recorded handoff demonstration asset and consented editing of the install command string.
- Existing build/runtime constraints in this repo; site tooling is isolated in `site/` to avoid cross-impact.

## Monitoring and Observability

No automatic site telemetry is emitted in V1 by design. Observation is manual and external:

- Verified install command usage is inferred from feedback and explicit post-launch support channels.
- Proof engagement is inferred from direct visit feedback and GitHub/release public activity.
- Star visibility is verified from GitHub UI/API and explicit page rendering checks.

## Technical Considerations

### Key Decisions

- **Single-page conversion layout**: one route avoids routing complexity and keeps the primary message short and direct.
  - Trade-off: less SEO surface versus lower implementation risk.
- **No V1 analytics**: matches trust-first constraints and keeps data handling minimal.
  - Trade-off: less precise install-intent measurement.
- **Client-side star fetch**: keeps count relatively fresh without extra deployment steps.
  - Trade-off: browser network + rate-limit dependencies and fallback messaging.
- **Externalized install command in config**: allows launch-safe updates without touching narrative component structure.
  - Trade-off: requires disciplined release process to verify command before publish.

### Known Risks

- **Release route drift**: the config could advertise an unverified route after build.
  - Mitigation: gate merges on a checked install command.
- **API flakiness**: star count request can fail in browser.
  - Mitigation: show explicit fallback text, no fake zero.
- **Motion sensitivity**: recorded video can overwhelm users.
  - Mitigation: static poster, controls, and reduced-motion handling.
- **Copy-on-web constraints**: clipboard API unavailable in some contexts.
  - Mitigation: fallback to select-all + instruction text.

## Architecture Decision Records

- [ADR-001: Build a Focused Proof-Led Astro Showcase](adrs/adr-001.md) — Establishes the launch scope, proof-led product narrative, and privacy-first measurement boundary.
- [ADR-002: Center V1 on a Verified Two-Agent Handoff](adrs/adr-002.md) — Constrains public promise to the released reviewed handoff workflow.
- [ADR-003: Keep showcase delivery as a separate Astro subproject in `site/`](adrs/adr-003.md) — Isolates website implementation from the CLI toolchain.
- [ADR-004: Defer site telemetry collection until post-launch](adrs/adr-004.md) — Keeps V1 launch free of behavioral event plumbing.
- [ADR-005: Resolve GitHub star count client-side with resilient fallback](adrs/adr-005.md) — Uses runtime GitHub count with safe fallback behavior.
