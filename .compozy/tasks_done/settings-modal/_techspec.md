# Settings Modal - Technical Specification

## Executive Summary

This spec implements the V1 settings modal from `_prd.md`: an instant-apply, live-preview tabbed overlay whose only V1 category is theme (`auto/light/dark` plus 1-2 named presets), built on a new reactive, persisted configuration path.
The core architectural move is turning configuration from a boot-time constant into reactive state: a `preferences` slice in the existing app store drives a live cockpit repaint, a delta-preserving atomic writer persists changes to `~/.config/kitten/config.json`, and a file-watcher reconciles external hand-edits so there is one source of truth (ADR-004).
Theme resolution changes from a two-palette terminal-mode branch to a small palette registry consulted ahead of the terminal mode (ADR-005).
The modal itself reuses the existing store-backed overlay pattern (`ApprovalPrompt`, `HandoffPreview`).

The primary trade-off: choosing instant-apply plus a file-watcher (over a preview-then-confirm modal with no watcher) buys the lowest-friction UX and a single reconciled config path, at the cost of debouncing the write path and carrying a self-write guard in the watcher to avoid a write-reload loop.
All new disk I/O stays in the config layer; no view writes to disk (ADR-003).

## System Architecture

### Component Overview

- **Config schema and types** (`src/core/types.ts`, `src/config/configLoader.ts`, modified): `AppConfig` and `USER_CONFIG_SCHEMA` gain a `theme: ThemePreference` field, default `"auto"`. The loader and `mergeAppConfig` carry it through, staying zod-strict and delta-over-defaults.
- **Config writer** (`src/config/configWriter.ts`, new): `persistUserConfig(patch)` re-reads the on-disk delta file, applies only the changed key, validates against `USER_CONFIG_SCHEMA`, and writes atomically (temp file + rename). Preserves keys the modal does not own.
- **Config watcher** (`src/config/configWatcher.ts`, new): `watchUserConfig(onConfig)` watches the config path and, debounced, reloads and reports the fresh `AppConfig` on external change; tolerates a transient mid-edit parse failure.
- **Store preferences slice** (`src/store/appStore.ts`, `src/store/selectors.ts`, modified): a `preferences: { theme }` slice seeded at store creation, mutated by `setThemePreference`; a `settings` overlay slot with `openSettings`/`closeSettings`; `selectThemePreference`, `selectSettingsOverlay`, and `selectHasOpenOverlay` extended to include the settings slot.
- **Theme registry and resolver** (`src/ui/theme.ts`, modified): a keyed `PALETTES` registry (built-in `dark`/`light` plus 1-2 presets, each with a stable `id`), `resolvePalette(pref, mode)`, and `usePalette` reading the preference slice; `syntaxStyleFor` re-keyed by palette id.
- **Keymap additions** (`src/ui/keymap.ts`, modified): an `open-settings` global binding (`Ctrl+,`), plus `SettingsCommand`, `SETTINGS_KEYMAP`, `matchSettingsCommand`, and `SETTINGS_HINT` for the modal's internal keys.
- **SettingsView** (`src/ui/SettingsView.tsx`, new): the overlay. Self-gating mount, `useKeyboard` capture with `preventDefault`, tabbed (Theme in V1), instant-apply on navigation via `setThemePreference`, reset-to-default, live-vs-restart label, yields to a pending approval.
- **Shell wiring** (`src/ui/CockpitApp.tsx`, `src/ui/StatusStrip.tsx`, modified): dispatch `open-settings`, mount `<SettingsView />` directly below `<ApprovalPrompt />`, surface the chord in the status hint and help panel.
- **App-layer persistence and watcher wiring** (`src/index.ts` `createCockpitSession`, modified): seed store preferences from the loaded config, subscribe to preference changes and debounce-persist, and start the watcher feeding external changes back into the store.
- **Telemetry** (`src/telemetry/recorder.ts`, modified): new content-free event types for the PRD metrics.

Data flow (theme change): `Ctrl+,` -> `store.openSettings()` -> shell stands down (`selectHasOpenOverlay`), composer releases focus -> `SettingsView` captures keys -> arrow selects a theme -> `store.setThemePreference(pref)` -> `usePalette` subscribers repaint the live cockpit -> app-layer subscriber debounce-calls `persistUserConfig({ theme: pref })` -> atomic write -> watcher observes its own write, reloads, finds the value unchanged, no-ops.
External hand-edit: watcher reload -> `store.setThemePreference` -> live repaint.

## Implementation Design

### Core Interfaces

```ts
// src/core/types.ts
export type ThemePresetId = "catppuccin-mocha" // 1-2 curated presets in V1 (ADR-003)
export type ThemePreference = "auto" | "light" | "dark" | ThemePresetId

export interface AppConfig {
  agents: AgentConfig[]
  telemetryEnabled: boolean
  theme: ThemePreference // NEW; default "auto"
}
```

```ts
// src/store/appStore.ts
export interface Preferences { theme: ThemePreference }
export interface SettingsOverlay { tab: "theme" } // one tab in V1; keys added in Phase 2

export interface OverlayState {
  approval: ApprovalOverlay | null
  handoffPreview: HandoffPreviewOverlay | null
  settings: SettingsOverlay | null // NEW
}

export interface AppStore {
  // ...existing members...
  openSettings(overlay?: SettingsOverlay): void
  closeSettings(): void
  setThemePreference(theme: ThemePreference): void // patches preferences with structural sharing
}
```

```ts
// src/config/configWriter.ts (new)
export interface WriteConfigOptions { path?: string; env?: Record<string, string | undefined> }

/** Read-modify-write one field into the delta file: re-read, set key, zod-validate, atomic rename. */
export async function persistUserConfig(patch: Partial<UserConfig>, options?: WriteConfigOptions): Promise<void>
```

```ts
// src/config/configWatcher.ts (new)
export interface ConfigWatcher { close(): void }

/** Watch the config path; on external change, reload and report the fresh config (debounced). */
export function watchUserConfig(
  onConfig: (config: AppConfig) => void,
  options?: { path?: string; env?: Record<string, string | undefined>; debounceMs?: number },
): ConfigWatcher
```

```ts
// src/ui/theme.ts
export const PALETTES: Readonly<Record<string, CockpitPalette>> // keyed by a stable palette id
export function resolvePalette(pref: ThemePreference, mode: ThemeMode): CockpitPalette
// usePalette(): reads selectThemePreference + terminal mode, returns resolvePalette(pref, mode)
```

### Data Models

- `ThemePreference` (above) is the one new persisted value. Default `"auto"`; an unknown persisted id (e.g. a removed preset left in a hand-edited file) resolves to the terminal-derived palette rather than erroring.
- `Preferences` is the reactive slice added to `AppState` beside `sessions`, `focusedAgentId`, and `overlays`. `AppStoreOptions` gains an optional `preferences` seed.
- `CockpitPalette` gains a stable `id: string` used as the `syntaxStyleFor` cache key (replacing the current per-`ThemeMode` key).
- No database or network schema: the only persistent store is the existing JSON config file, unchanged in shape except for the added optional `theme` delta.

### API Endpoints

Not applicable.
Kitten is a local terminal application with no network surface; the "API" of this feature is the in-process store actions and config functions defined under Core Interfaces.

## Integration Points

- **Config file** at `resolveConfigPath()` (honoring `KITTEN_CONFIG`): read at boot, written by `persistUserConfig`, and watched by `watchUserConfig`. The writer targets the same directory for its temp file so the final step is a same-filesystem rename.
- **File-watch caveats**: editors often save via their own rename/replace, which some platforms report as `rename` rather than `change`; the watcher must react to both and re-resolve the path. `fs.watch` semantics differ across platforms, so the watcher debounces and always re-reads the file rather than trusting the event payload. A mid-write read that fails to parse is treated as transient and ignored.
- **Terminal theme reporting** (OSC, via OpenTUI `theme_mode`): unchanged. It continues to drive the palette only while the preference is `"auto"`.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/types.ts` | modified | Add `ThemePreference`, `AppConfig.theme`. Low risk. | Add types; default `"auto"`. |
| `src/config/configLoader.ts` | modified | Schema, merge, and default gain `theme`. Low-med: must stay strict and default safely. | Extend `USER_CONFIG_SCHEMA`, `mergeAppConfig`, `defaultAppConfig`. |
| `src/config/configWriter.ts` | new | First disk-write path; corruption risk if non-atomic. Medium. | Atomic rename + validate-before-commit + tests. |
| `src/config/configWatcher.ts` | new | fs.watch reload; loop and platform-event risk. Medium. | Debounce, idempotent reload, parse-error tolerance. |
| `src/store/appStore.ts` | modified | Preferences slice, settings overlay slot, actions, seed option. Low-med. | Follow structural-sharing patch pattern. |
| `src/store/selectors.ts` | modified | New selectors; `selectHasOpenOverlay` must include settings. Low but a miss breaks modality. | Add selectors; extend the aggregate. |
| `src/ui/theme.ts` | modified | Palette registry, resolver, syntax cache re-key. Medium: preset legibility. | Registry + `resolvePalette`; review presets on light/dark. |
| `src/ui/keymap.ts` | modified | `open-settings` (`Ctrl+,`), settings keymap, hints. Low-med: `Ctrl+,` delivery. | Add bindings; document terminal caveat. |
| `src/ui/SettingsView.tsx` | new | The modal; modality correctness. Medium. | Capture keys, yield to approval, release composer focus. |
| `src/ui/CockpitApp.tsx` | modified | Dispatch + mount below `ApprovalPrompt`. Low-med. | Add `case`, mount order. |
| `src/ui/StatusStrip.tsx` | modified | Surface the settings chord. Low. | Add hint. |
| `src/index.ts` | modified | Seed prefs, persistence subscriber, watcher lifecycle. Medium. | Wire in `createCockpitSession`; close watcher on dispose. |
| `src/telemetry/recorder.ts` | modified | New content-free event types + fixed `themeId` enum. Low. | Extend union; keep content-free. |

## Testing Approach

### Unit Tests

- **configWriter**: writing `{ theme }` preserves an existing hand-added agent/telemetry delta; output re-parses through `USER_CONFIG_SCHEMA`; an invalid patch is rejected before any rename; a write to a missing directory creates it; atomicity verified by asserting no partial file is observable (inject path into a temp dir).
- **configWatcher**: an external change fires `onConfig` once after debounce; a reload equal to the current value is a no-op at the store level (tested via the wiring); a transient invalid file does not throw and keeps the prior config; `close()` stops callbacks.
- **theme**: `resolvePalette` returns the terminal palette for `"auto"`, the pinned palette for `"light"/"dark"`, the preset palette for a known id, and the terminal fallback for an unknown id; `syntaxStyleFor` returns distinct styles per palette id and caches per id.
- **appStore/selectors**: `openSettings`/`closeSettings` patch only the settings slot; `setThemePreference` patches only preferences; `selectHasOpenOverlay` is true when settings is open; store seeds preferences from `AppStoreOptions`.
- **keymap**: `matchCommand` maps `Ctrl+,` to `open-settings`; `matchSettingsCommand` maps the modal's keys; the settings chord appears in help entries.
- **SettingsView** (component, snapshot + interaction): renders the Theme tab; arrowing applies `setThemePreference` and the persisted call fires; reset returns to default; renders nothing while an approval is open; Esc closes.

### Integration Tests

- Boot `createCockpitSession` with a config `theme: "dark"` and assert the cockpit renders the dark palette regardless of terminal mode.
- Open the modal, assert `selectHasOpenOverlay` is true and the composer is unfocused, arrow to a preset, assert the palette changes live and `persistUserConfig` was invoked, then assert the watcher's subsequent reload is a no-op.
- Simulate an external edit to the config file and assert the store preference and palette update live.
- Reuse the existing `bun test` runner and the UI snapshot pattern (`src/ui/__snapshots__`); inject writer/watcher/clock seams the way `recorder.ts` injects its sink and clock, and point config paths at a temp dir.

## Development Sequencing

### Build Order

1. **Config type + schema** - add `ThemePreference`/`ThemePresetId`, `AppConfig.theme`, default `"auto"`, and the `USER_CONFIG_SCHEMA`/`mergeAppConfig`/`defaultAppConfig` changes. No dependencies.
2. **Palette registry + resolver** - `PALETTES`, palette `id`s, `resolvePalette`, and re-keying `syntaxStyleFor`. Depends on step 1 (the `ThemePreference` type).
3. **Store preferences + settings overlay** - `Preferences`, `SettingsOverlay`, the `settings` slot, `openSettings`/`closeSettings`/`setThemePreference`, `AppStoreOptions.preferences`, and the new selectors including the `selectHasOpenOverlay` extension. Depends on step 1.
4. **usePalette wiring** - `usePalette` reads `selectThemePreference` and resolves through step 2. Depends on steps 2 and 3.
5. **Config writer** - `persistUserConfig` with atomic read-modify-write and validation. Depends on step 1.
6. **Config watcher** - `watchUserConfig` with debounce and parse tolerance. Depends on step 1 (and shares path resolution with step 5).
7. **Keymap additions** - `open-settings` (`Ctrl+,`), `SettingsCommand`, `SETTINGS_KEYMAP`, `matchSettingsCommand`, `SETTINGS_HINT`, updated `KEYMAP_HINT`. No structural dependencies.
8. **SettingsView component** - the overlay UI and its keyboard handling. Depends on steps 3 (store), 4 (palette), and 7 (keymap).
9. **App-layer persistence + watcher wiring** - in `createCockpitSession`: seed preferences from config, subscribe-and-debounce-persist on preference change, start `watchUserConfig` feeding `setThemePreference`, and close the watcher on dispose. Depends on steps 3, 5, and 6.
10. **Shell wiring** - `case "open-settings"` in `CockpitApp`, mount `<SettingsView />` below `<ApprovalPrompt />`, add the status/help hint. Depends on steps 7 and 8.
11. **Telemetry counters** - extend `recorder.ts` with the content-free event types and emit them from the modal and persistence layer. Depends on steps 3, 8, and 9.

### Technical Dependencies

- No external services, infrastructure, or team deliverables block this work. Everything is additive to the existing `src/` tree and the existing `bun` toolchain.

## Monitoring and Observability

The recorder gains content-free events (a fixed `themeId` enum, never free text, preserving the structural content-free guarantee):

- `settings_opened` - the modal was opened (PRD modal-reach metric).
- `theme_set` with `themeId` - a theme was applied (PRD sustained-override and explicit-adoption metrics; the sustained part is derived offline from `theme_set` plus the anonymous session ref across a week).
- `config_write` with a `source` tag (`modal`) - a persisted write succeeded (PRD config-via-modal share).
- `config_write_error` with `source` - a modal write failed validation or I/O (PRD config-write-safety metric; target zero).

These append to the existing local JSONL sink; no new sink or network path is introduced.

## Technical Considerations

### Key Decisions

- **Decision**: Reactive config via a `preferences` slice in the one app store. **Rationale**: reuses the existing subscription and structural-sharing model. **Trade-off**: config becomes mutable runtime state. **Rejected**: a separate preferences store, React context.
- **Decision**: Read-modify-write atomic persistence. **Rationale**: preserves unmodeled hand-edited keys and cannot brick boot. **Trade-off**: a read on every save. **Rejected**: serialize-from-memory (clobbers keys), full-merged dump (abandons delta design).
- **Decision**: Include a debounced file-watcher with idempotent reload. **Rationale**: one reconciled source of truth for modal-edits and hand-edits. **Trade-off**: a watcher and self-write guard. **Rejected**: deferring the watcher.
- **Decision**: Palette registry consulted ahead of terminal mode. **Rationale**: named presets scale as data, `auto` behavior unchanged. **Trade-off**: syntax cache re-keyed by palette id. **Rejected**: extending the two-palette branch.
- **Decision**: `Ctrl+,` opens the modal. **Rationale**: the familiar VS Code settings convention. **Trade-off**: not reliably delivered without the Kitty keyboard protocol.

### Known Risks

- **`Ctrl+,` delivery** (medium likelihood on legacy terminals): the chord may not reach the app without the Kitty keyboard protocol. Mitigation: document it, surface the modal in the help panel and status hint, and treat a fallback binding as a fast-follow if reports warrant. Recorded as an open item.
- **Write thrash under instant-apply** (medium): rapid arrow navigation could write repeatedly. Mitigation: the store update is synchronous but the disk write is debounced; only the settled value is persisted.
- **Watcher feedback loop** (low-med): the modal's own write triggers the watcher. Mitigation: idempotent compare-before-apply reload plus a self-write skip.
- **Preset legibility** (low-med): a preset may read poorly on some backgrounds. Mitigation: 1-2 presets in V1, each reviewed against light and dark; unknown ids fall back safely.

## Architecture Decision Records

- [ADR-001: Settings modal V1 scope - theme-first on a reactive-config foundation](adrs/adr-001.md) - Foundation first; theme in the modal shell as V1; keymap fast-follow.
- [ADR-002: Instant-apply, live-preview interaction model](adrs/adr-002.md) - Arrow to apply-and-persist live; tabbed shell; reset-to-default.
- [ADR-003: Include 1-2 named theme presets in V1](adrs/adr-003.md) - `auto/light/dark` plus 1-2 curated presets via a small palette registry.
- [ADR-004: Reactive, persisted configuration](adrs/adr-004.md) - Preferences slice, atomic read-modify-write, and a file-watcher.
- [ADR-005: Theme override via a palette registry](adrs/adr-005.md) - Registry consulted ahead of terminal mode; syntax style keyed by palette id.
