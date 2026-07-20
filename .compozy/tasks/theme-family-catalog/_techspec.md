# TechSpec: Accessible Source-Attributed Theme Family Catalog

## Executive Summary

Implement the PRD's 18-preset catalog by introducing a protocol-free `src/core/themeCatalog.ts` as the single authority for durable preset identity, family metadata, source attribution, display order, and explicit compatibility aliases. Keep terminal color values, renderer-mode handling, and syntax-style caching in `src/ui/theme.ts`. Configuration, telemetry, and Settings derive their valid named values from the core catalog instead of maintaining parallel lists.

The primary trade-off is a small, explicit catalog and row-projection layer versus continuing to extend existing flat UI data. The chosen design adds two focused modules/contracts and exhaustive parity tests, but prevents divergence between persisted preference IDs, public provenance, UI labels, palettes, and telemetry. It preserves immediate apply and local-only telemetry while adding a bounded scrollable Settings list for short terminals.

## System Architecture

### Component Overview

| Component | Responsibility | PRD coverage | Boundary |
| --- | --- | --- | --- |
| `src/core/themeCatalog.ts` | Canonical preset IDs, family/variant/display metadata, public attribution, ordering, aliases, and canonicalization. | Goals 1, 4, 5; F1, F5, F6 | Pure TypeScript; no OpenTUI, React, filesystem, or telemetry imports. |
| `src/core/types.ts` | Re-exports the catalog-derived `ThemePresetId` into the application preference type. | Goal 4; F5 | Protocol-free core type boundary. |
| `src/config/configLoader.ts` | Strictly accepts canonical IDs and recognized aliases, then exposes a canonical resolved preference. | Goals 1, 4; F5 | File parsing and validation only; unknown values remain errors. |
| `src/ui/theme.ts` | Provides one complete `CockpitPalette` per canonical preset, resolves aliases defensively, retains Auto/Light/Dark behavior, and caches syntax styles by canonical palette ID. | Goals 1, 2; F1, F4 | UI and OpenTUI-owned rendering boundary. |
| `src/ui/SettingsView.tsx` | Projects catalog metadata into typed built-in, heading, and preset rows; owns modal keyboard interaction and bounded scrolling. | Goals 2, 3; F2, F3 | UI-only; never reads/writes configuration directly. |
| `src/index.ts` and existing store lifecycle | Seeds canonical preference, persists settled explicit changes, and applies watcher updates through the existing store action. | Goals 3, 4; F3, F5 | Retain debounce, serialized writes, and watcher ownership. |
| `src/telemetry/recorder.ts` | Continues recording only the derived closed theme preference ID in opt-in local events. | Goal 6; F7 | No source URL, display name, or free-form text fields. |
| `docs/theme-catalog.md` | Publishes the attribution, license, stable-ID, and exclusions contract. | Goal 5; F6 | Documentation is the sole V1 provenance surface. |

### Data Flow

1. `themeCatalog.ts` exposes canonical preset metadata, canonical IDs, accepted aliases, and helper functions.
2. `configLoader.ts` validates a persisted raw value against canonical IDs plus aliases, then resolves it to a canonical `ThemePreference` in `AppConfig`.
3. Boot seeds the existing store with that canonical preference. A Settings row change calls the existing `setThemePreference`; the app subscriber debounces and serializes the canonical persisted value.
4. `usePalette()` resolves Auto from the terminal mode or retrieves the canonical named palette. The existing palette-keyed syntax cache follows the same palette identity.
5. `SettingsView` derives typed rows from the catalog, applies only selectable rows, and scrolls the active row into its bounded viewport.
6. `theme_set` and config-write telemetry retain only the existing fixed enum and source fields.

## Implementation Design

### Core Interfaces

Use TypeScript contracts because this Bun/OpenTUI repository has no Go runtime. Keep each contract in the layer that owns it.

```ts
export const THEME_PRESET_IDS = [/* 18 canonical ids */] as const
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number]

export interface ThemePreset {
  readonly id: ThemePresetId
  readonly family: string
  readonly variant: string | null
  readonly displayName: string
  readonly sourceUrl: string
  readonly licenseAttribution: string
}

export const THEME_PRESETS: readonly ThemePreset[]
export const THEME_PRESET_ALIASES: Readonly<Record<string, ThemePresetId>>
export function canonicalThemePresetId(value: string): ThemePresetId | null
```

`THEME_PRESETS` is ordered by family and variant for presentation. It is the source for `ThemePresetId`, metadata, aliases, and the canonical preset-value array. The helper returns `null` for unknown input; callers choose strict rejection or defensive visual fallback according to their existing boundary.

```ts
export type ThemePickerRow =
  | { readonly kind: "builtin"; readonly preference: "auto" | "light" | "dark" }
  | { readonly kind: "family"; readonly family: string }
  | { readonly kind: "preset"; readonly preference: ThemePresetId; readonly family: string }

export function themePickerRows(): readonly ThemePickerRow[]
export function selectableThemePickerRows(rows: readonly ThemePickerRow[]): readonly Extract<ThemePickerRow, { kind: "builtin" | "preset" }>[]
export function themePickerRowId(preference: ThemePreference): string
```

The UI projection is deterministic and derived only from catalog data. It is not a second catalog. A row's `kind` is the authority for whether it can receive focus, apply a preference, or be persisted.

### Data Models

| Model | Owner | Required fields and invariants |
| --- | --- | --- |
| `ThemePreset` | Core catalog | Canonical non-reused ID, family, nullable variant for singleton families, exact display name, public source URL, and compatible license/attribution text. |
| `ThemePresetId` | Core catalog | Closed union derived from all 18 canonical IDs. |
| `ThemePreference` | Core types | `"auto" | "light" | "dark" | ThemePresetId`; resolved application state is always canonical. |
| `ThemePresetAlias` | Core catalog | A string legacy ID mapped to one canonical `ThemePresetId`; no alias may target another alias or itself. |
| `ThemePickerRow` | Settings UI | Built-in selectable row, non-selectable family row, or canonical selectable preset row. |
| `CockpitPalette` | UI theme | One complete palette per built-in mode and per canonical preset; every semantic role is present. |

Configuration parsing accepts the closed set of canonical IDs plus declared alias keys. `mergeAppConfig` canonicalizes a recognized alias before creating `AppConfig`. Configuration writing receives the canonical store value, so an alias load is never written back merely by startup or watcher reconciliation.

### API Endpoints

None. The catalog has no network API, runtime download, remote gallery, or external service integration. Public upstream URLs are immutable metadata for documentation and attribution; they are never fetched at runtime.

## Integration Points

There are no external runtime integrations. Internal integration contracts are:

- **OpenTUI renderer:** retain the existing shared terminal `theme_mode` subscription. Named presets ignore later terminal mode changes; Auto follows them.
- **OpenTUI ScrollBox:** use the existing bounded `<scrollbox>` pattern with stable row IDs, `scrollX={false}`, hidden horizontal scrollbar options, and `scrollChildIntoView` after active-row changes. OpenTUI supports vertical scrolling, viewport culling, and selected-child visibility through this API.
- **User configuration:** retain strict parsing, atomic writer behavior, debounce, serialized persistence, and watcher ownership.
- **Local telemetry:** retain the opt-in JSONL recorder and its structural allow-list; no new user-text fields or external export.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/themeCatalog.ts` | new | Becomes the canonical identity, metadata, and alias authority. High contract risk. | Add immutable catalog and unit coverage for roster, order, metadata, and aliases. |
| `src/core/types.ts` | modified | Replaces the two-ID handwritten union with catalog-derived type import. Medium risk. | Preserve the public `ThemePreference` contract. |
| `src/config/configLoader.ts` | modified | Replaces the handwritten preset enum with catalog-derived canonical and alias inputs. High persistence risk. | Canonicalize known aliases, reject unknown values, and retain strict config errors. |
| `src/ui/theme.ts` | modified | Adds 16 named palettes and derives exhaustive named registry coverage. High visual risk. | Keep renderer-mode, fallback, and syntax-cache behavior while adding complete palette gates. |
| `src/ui/SettingsView.tsx` | modified | Replaces flat rows with typed grouped rows and bounded scrolling. High interaction risk. | Preserve modal priority, keymap, immediate apply, and Reset-to-Auto. |
| `src/index.ts` | retained integration | Existing lifecycle already persists settled store changes and applies watcher values. Medium lifecycle risk. | Verify alias loading creates no startup write; explicit selection writes canonical ID. |
| `src/telemetry/recorder.ts` | retained type integration | Existing event field derives from `ThemePreference`. Privacy risk if widened. | Keep fixed-enum-only shape; update tests for all canonical IDs. |
| `docs/theme-catalog.md`, `README.md`, `CONTEXT.md` | modified | Public contract must match actual catalog and exclusions. Trust risk. | Update and add a documentation-contract test. |
| Theme, Settings, config, lifecycle, telemetry test suites | modified | Existing two-preset fixtures must become exhaustive catalog coverage. Regression risk. | Add layered unit, renderer, integration, and documentation checks. |

## Testing Approach

### Unit Tests

- **Core catalog:** assert exactly 18 unique canonical IDs; exact approved family/variant roster; alphabetical family and variant order; required non-empty display/source/license fields; no duplicate or self-referential aliases; alias targets are canonical.
- **Configuration:** accept every canonical ID; accept every declared alias; resolve aliases to canonical `AppConfig.theme`; reject unknown and inherited-property values; preserve strict errors.
- **Palette registry:** require an exhaustive canonical-ID palette map; assert every `CockpitPalette` semantic field exists; verify all required foreground/surface pairs meet at least 4.5:1 in truecolor and xterm-256 approximation; keep distinct status/tool tones and message/selection surfaces.
- **Resolver and syntax:** resolve canonical IDs and aliases; retain unknown-input terminal fallback; keep explicit palettes pinned across terminal-mode changes; keep syntax-style cache separation by canonical palette ID.
- **Settings rows:** assert Auto/Light/Dark precede grouped rows; headings are non-selectable; selectable rows follow catalog order; labels use catalog display names rather than ID title-casing; visible family context is correct for each active preset.

### Integration Tests

- Render a constrained Settings viewport with all 18 presets; arrow through every selectable row; assert each active row is visible, headings are skipped, no horizontal scrollbar consumes a row, and Reset-to-Auto still works.
- Preserve clarification and approval precedence while Settings is open; ensure no Settings key reaches the prompt editor.
- Exercise immediate repaint from a selected catalog preset through palette and syntax consumers.
- Exercise config write, config watcher, and restart-style reconciliation: a loaded alias changes live state to canonical without writing; a subsequent explicit selection writes the canonical ID.
- Assert `theme_set` and config-write events retain only the existing closed fields for canonical IDs, with no source, theme-name, or content fields.
- Add a documentation-contract test that verifies every core catalog preset is represented by the public source/attribution documentation and that Configuration links to it.
- Run `rtk bun run typecheck && rtk bun test` after the final change. For changed view wiring, also run `rtk bun run selfcheck` and report actual output.

## Development Sequencing

### Build Order

1. Add `src/core/themeCatalog.ts` with the 18 canonical records, source metadata, ordering helpers, alias map, canonicalization helper, and pure catalog tests — no dependencies.
2. Derive `ThemePresetId`, `ThemePreference` inputs, and strict configuration validation from the core catalog; add canonical/alias parsing tests — depends on step 1.
3. Expand `src/ui/theme.ts` to an exhaustive canonical preset palette map and update palette, resolver, contrast, xterm, syntax-cache, and live-repaint tests — depends on steps 1 and 2.
4. Update public catalog documentation and add documentation-contract coverage — depends on step 1 and the final palette roster from step 3.
5. Replace the flat Settings list with the typed row projection and bounded ScrollBox; add grouped navigation, active-context, short-viewport, modal-priority, and immediate-apply tests — depends on steps 1 and 3.
6. Extend configuration writer/watcher, boot lifecycle, and telemetry coverage for aliases, canonical persistence, and fixed-enum privacy — depends on steps 2, 3, and 5.
7. Run the full typecheck, test, and self-check gates; resolve only catalog-scope regressions and update task evidence — depends on steps 1 through 6.

### Technical Dependencies

- Existing Bun, TypeScript, Zod, OpenTUI, and React dependencies are sufficient. Do not add a package.
- Existing OpenTUI `<scrollbox>` and `ScrollBoxRenderable.scrollChildIntoView` patterns in `SessionPicker`, `SessionsOverlay`, and `SlashMenu` are the required scrolling reference.
- Existing config writer, watcher, store selector, and telemetry recorder seams remain the only persistence and measurement paths.
- Public source and license records for all seven families must remain available before finalizing documentation.

## Monitoring and Observability

- Keep the existing local opt-in `theme_set` event with its validated `themeId` field. Canonical IDs are the only permitted theme values.
- Keep existing `settings_opened`, `config_write`, and `config_write_error` events. Do not add source URL, display name, family name, palette values, prompt content, code, paths, or free-form text.
- Use test evidence—not new runtime logging—to establish catalog count, attribution completeness, contrast coverage, grouped navigation, alias behavior, and xterm compatibility before release.
- No new alerts, remote dashboards, network traffic, or telemetry opt-in flow are required.

## Technical Considerations

### Key Decisions

- **Core metadata, UI palettes:** `themeCatalog.ts` owns identity and provenance; `theme.ts` owns OpenTUI-specific palette values and rendering. This preserves core purity at the cost of an explicit exhaustive parity check.
- **Explicit aliases, canonical state:** aliases are declared data and resolve before live state or persistence. This preserves stable user preferences at the cost of accepting a bounded legacy input set.
- **Typed rows, not decorative headings:** one row projection drives selection, rendering, and scroll identity. This removes UI drift at the cost of a small projection helper.
- **Layered automated evidence:** core, config, palette, UI, lifecycle, telemetry, and documentation suites form the release gate. This costs test maintenance but makes the atomic 18-preset claim auditable.
- **TypeScript contracts:** the Core Interfaces section uses the repository's strict TypeScript types, per the technical clarification, rather than non-executable Go examples.

### Known Risks

- **Source-faithful swatches fail after xterm-256 approximation:** quantify both render paths per semantic role; make narrowly documented foreground adjustments only when necessary.
- **Alias parsing weakens strict configuration:** separate accepted aliases from unknown values and assert both paths in config/writer/watcher tests.
- **A fixed-height picker clips selected context:** use a bounded ScrollBox, stable selectable-row IDs, and `scrollChildIntoView`; test at the agreed constrained renderer size.
- **Palette metadata and values drift:** enforce `Record<ThemePresetId, CockpitPalette>`-style completeness and a docs contract test from the canonical catalog.
- **Syntax or terminal-mode behavior regresses under named themes:** retain palette-ID cache tests and explicit-versus-Auto terminal-mode integration coverage.
- **Unrelated repository failures obscure catalog evidence:** run focused suites while developing, then report the full verification gate separately and do not expand scope to repair unrelated failures.

## Architecture Decision Records

- [ADR-001: Deliver a finite, accessibility-gated 18-preset catalog atomically](adrs/adr-001.md) — Defines the durable 18-preset, source-faithful, accessibility-gated product boundary.
- [ADR-002: Preserve instant selection and documentation-first provenance in V1](adrs/adr-002.md) — Keeps immediate durable selection and public documentation as the provenance surface.
- [ADR-003: Make the core theme catalog the identity and compatibility authority](adrs/adr-003.md) — Establishes a pure canonical catalog, derived consumers, and explicit alias canonicalization.
- [ADR-004: Project catalog metadata into typed scrollable Settings rows](adrs/adr-004.md) — Uses one typed row model and existing OpenTUI scrolling patterns for grouped keyboard navigation.
