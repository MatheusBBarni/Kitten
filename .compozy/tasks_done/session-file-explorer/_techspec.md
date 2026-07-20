# TechSpec: Session-Scoped File Explorer

## Executive Summary

Implement the File Explorer as a session-addressed, current-run workspace tree owned by the external store and supplied by new injected app-layer capabilities. A `WorkspaceExplorerSource` lists and revalidates eligible entries inside a captured session workspace; an `ExternalEditorLauncher` dispatches a validated system-default or custom editor without shell parsing. `ControllerActions` coordinates all I/O and commits results only to the captured `SessionId` and operation generation. The UI renders narrow store selectors, contributes no filesystem or process work, and composes the approved docked or narrow layout in `CockpitApp`.

The primary trade-off is deliberate: separate explorer source, launcher, store, config, and UI contracts add focused wiring, but prevent the Git-backed prompt `@` file source from acquiring incompatible workspace semantics. The design favors containment, session isolation, deterministic failure handling, and injected tests over a component-local shortcut. It introduces no dependencies or new package directories.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/app/workspaceExplorer.ts` (new) | List one lazy directory, classify eligible entries, and revalidate a target against the captured Session Workspace. | Filesystem only; no React, store, config persistence, or process launch. |
| `src/app/externalEditor.ts` (new) | Dispatch the system default or validated custom editor and perform the one allowed fallback. | Process spawning only; receives an already revalidated regular file. |
| `src/app/actions.ts` | Expose typed explorer actions and own asynchronous orchestration, session capture, generation fencing, notices, and telemetry facade calls. | The only explorer I/O path reachable from UI. |
| `src/app/controller.ts` | Install production source and launcher defaults through existing injection seams. | Controller construction and dependency ownership. |
| `src/store/appStore.ts`, `src/store/selectors.ts` | Own visible/focused state and per-session lazy tree snapshots, position, selection, notices, and loading generations. | Current-run mutable application state; no I/O. |
| `src/ui/FileExplorer.tsx` (new) | Render the tree, focusable navigation, notices, and layout-independent explorer content. | Selector and `ControllerActions` consumer only. |
| `src/ui/CockpitApp.tsx`, `src/ui/keymap.ts` | Route the peer `Ctrl+B` and `/file-explorer` command, preserve overlay precedence, and compose docked versus narrow explorer presentation. | Global input and layout only. |
| `src/ui/SettingsView.tsx` | Add an Editor tab with a component-local custom-editor draft and explicit Save/Cancel behavior. | No persistence or launcher I/O. |
| `src/config/*`, `src/index.ts` | Validate, merge, atomically persist, watch, and live-apply the editor preference. | Strict durable user configuration. |
| `src/telemetry/recorder.ts` | Record a closed, opt-in, content-free explorer event vocabulary. | Local observability only. |

### Data Flow

1. `Ctrl+B` or `/file-explorer` reaches the existing `COCKPIT_COMMANDS` dispatch in `CockpitApp` and toggles store-owned explorer visibility for the currently focused visible session.
2. `FileExplorer` reads the focused session's narrow explorer selector. On first reveal, expand, or explicit refresh, it calls a typed `ControllerActions` explorer operation with that `SessionId`.
3. The action captures the session `cwd`, a workspace identity, and the operation generation before awaiting. `WorkspaceExplorerSource` resolves the root and requested relative path, filters entries, and returns a typed ready or unavailable result.
4. The action commits only if the captured session still exists with the same workspace and current generation. The store updates that session's lazy snapshot, selection, scroll state, and short notice without affecting another session.
5. Opening a selected file repeats final containment and regular-file validation immediately before `ExternalEditorLauncher` receives the canonical target. A custom dispatch failure triggers exactly one system-default dispatch; the final typed outcome is stored as a notice and recorded through the allow-listed telemetry facade.
6. The config watcher applies a valid external preference reload to the in-memory preference used by the next user-initiated open. The Settings Editor tab never applies a local draft until Save succeeds.

## Implementation Design

### Core Interfaces

`src/app/workspaceExplorer.ts` defines a source separate from the Git-backed `RepositoryFileSource`. `relativePath` is always workspace-relative; callers never supply an absolute path or an unvalidated external path.

```ts
export type ExplorerEntryKind = "directory" | "file" | "contained_link"

export interface ExplorerEntry {
  readonly relativePath: string
  readonly name: string
  readonly kind: ExplorerEntryKind
}

export type ExplorerListing =
  | { readonly kind: "ready"; readonly entries: readonly ExplorerEntry[] }
  | { readonly kind: "unavailable"; readonly reason: ExplorerUnavailableReason }

export interface WorkspaceExplorerSource {
  list(cwd: string, relativePath: string): Promise<ExplorerListing>
  openableFile(cwd: string, relativePath: string): Promise<OpenableFile>
}
```

`src/app/externalEditor.ts` owns process dispatch only. It cannot inspect or resolve arbitrary workspace paths.

```ts
export type EditorPreference =
  | { readonly kind: "system-default" }
  | { readonly kind: "custom"; readonly executable: string; readonly args: readonly string[] }

export type EditorLaunchOutcome =
  | { readonly kind: "system-default-dispatched" }
  | { readonly kind: "custom-dispatched" }
  | { readonly kind: "fallback-dispatched" }
  | { readonly kind: "failed" }

export interface ExternalEditorLauncher {
  launch(file: OpenableFile, preference: EditorPreference): Promise<EditorLaunchOutcome>
}
```

`ControllerActions` gains session-addressed operations rather than exposing either dependency to the UI:

- `toggleFileExplorer(): void`
- `expandExplorerDirectory(sessionId, relativePath): Promise<void>`
- `collapseExplorerDirectory(sessionId, relativePath): void`
- `refreshExplorer(sessionId): Promise<void>`
- `openExplorerFile(sessionId, relativePath): Promise<void>`
- `saveEditorPreference(preference): Promise<EditorPreferenceWriteResult>`

All operations are fail-soft. They return or commit fixed unavailable/failure categories; no callback rejects into React and no raw filesystem or process error reaches telemetry.

### Data Models

Add current-run explorer state to `AppState`, separate from persisted config:

```ts
interface ExplorerPosition {
  readonly expandedPaths: readonly string[]
  readonly selectedPath: string | null
  readonly scrollTop: number
  readonly directories: Readonly<Record<string, ExplorerDirectorySnapshot>>
  readonly generation: number
}

interface ExplorerState {
  readonly visible: boolean
  readonly positions: Readonly<Record<SessionId, ExplorerPosition>>
  readonly notice: ExplorerNotice | null
}
```

- `visible` starts `false` for every new Kitten launch.
- `positions` is created lazily for a session's `cwd`, is never serialized, and is removed with the session lifecycle.
- A directory snapshot contains its current loading/ready/unavailable status plus entries sorted directories-first and then lexical by name. It never retains a canonical absolute path or an error string for display or telemetry.
- `generation` increments for refresh or a workspace reset. A pending read may not overwrite a newer generation.
- Explorer focus extends the existing focused-pane model. `Escape` moves focus to the composer while leaving a visible docked sidebar intact. Existing approval and clarification overlays remain modal and take precedence.

Extend `AppConfig` and `UserConfig` with a strict `editor` delta. The resolved value defaults to `{ kind: "system-default" }`. The `custom` variant requires a non-empty executable, an argument array, and exactly one full `{file}` placeholder across that array. No environment interpolation, shell text, aliases, or extra placeholder forms are accepted. `persistUserConfig({ editor })` preserves unrelated fields through the existing read-merge-validate-atomic-write path.

### Workspace Source and Containment Policy

`WorkspaceExplorerSource` accepts the configured session `cwd` and a relative path from the store. For every list, traversal, refresh, and open operation it:

1. Resolves the current canonical workspace root from `cwd`.
2. Rejects absolute paths, traversal segments, invalid relative encodings, and any requested path whose canonical location is outside that root.
3. Reads only the requested directory; the initial tree contains the collapsed root, and no background recursive scan or watcher is introduced.
4. Excludes an entry named `.git` at every depth. It retains normal hidden and ignored entries without consulting Git.
5. Uses `lstat` to classify entries. For a symlink, it resolves the target and emits a `contained_link` only when the target resolves inside the current root and is a directory or regular file; it hides broken, escaping, looped, or unsupported targets.
6. Before traversing a `contained_link` or opening any selected file, repeats root and target resolution. An entry that changed since a prior listing, no longer resolves inside the root, or is no longer an allowed target fails closed.
7. Returns only fixed unavailable reasons to callers. It does not expose absolute paths, diagnostics, or directory contents to telemetry.

The production source uses Bun and Node filesystem primitives behind injected filesystem seams. It follows `fileDiscovery.ts` only for injection, result-union, containment, and fail-soft conventions—not for Git candidate selection or text/binary policy.

### Editor Launch Policy

`ExternalEditorLauncher` supports the current release matrix only:

- **macOS system default:** direct spawn of the OS opener with the resolved file path as an argument.
- **Linux system default:** direct spawn of the platform opener with the resolved file path as an argument.
- **Custom editor:** direct spawn of the validated executable with the configured argument vector after replacing its one `{file}` item with the resolved file path.

The launcher never runs a shell, parses a command string, interpolates environment variables, or opens a directory. It reports dispatch-level outcomes only. On custom spawn failure it attempts the system default once; it does not retry a failed system default or cascade through other applications. The stored notice distinguishes custom dispatch, system-default dispatch, fallback dispatch, and final failure without exposing command text or error details.

### Config, Settings, and Reload

Add `editor` to the strict config schema, defaults, merge logic, loader fixtures, writer tests, and watcher reload application. Existing config-write rules remain unchanged: serialize a complete validated delta, write privately to a sibling temporary file, and atomically rename it over the config while preserving unrelated fields.

`SettingsOverlay.tab` expands from the Theme-only union to include `"editor"`. `SettingsView` renders an Editor tab with System Default and Custom modes, executable and argument fields, inline fixed validation copy, and Save/Cancel controls. Its local draft initializes from the resolved current preference when the Editor tab opens. Save validates the entire preference and calls a controller/app persistence action; only a successful write updates the resolved preference and closes or confirms the draft. Cancel and `Escape` discard the draft. A valid watched config change updates the saved preference used for the next open; it does not mutate an in-progress local draft.

### API Endpoints

Not applicable. The feature has no HTTP, RPC, or ACP API surface. Its interfaces are in-process TypeScript contracts at the app/controller boundary.

## Integration Points

| Boundary | Integration | Failure Behavior |
| --- | --- | --- |
| Session configuration | Read the immutable configured `cwd` for the explicitly addressed `SessionId`. | Unknown or removed session returns a fixed unavailable result. |
| Strict user config | Reuse loader, writer, and watcher for the `editor` delta. | Invalid Save retains the draft; invalid external reload is ignored until a later valid reload. |
| Operating system opener | Spawn the supported macOS or Linux system-default opener directly. | Final failed dispatch retains explorer focus and displays a concise failure notice. |
| Custom external editor | Spawn validated executable and argument vector with one replaced `{file}` argument. | One system-default fallback attempt after custom dispatch failure. |
| Existing command registry | Add one `toggle-file-explorer` cockpit intent to the union, registry, slash menu, help, and shared dispatch switch. | Missing registry metadata remains a compile/test failure, not a silent unlisted command. |
| Local telemetry | Extend the closed recorder and action facade with explorer-specific events. | Disabled telemetry remains a complete no-op. |

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/app/workspaceExplorer.ts` | New | Filesystem tree and containment policy; high security risk. | Add injected filesystem contract, fixed result unions, lazy directory listing, and revalidation. |
| `src/app/externalEditor.ts` | New | Platform process dispatch and fallback; high user-trust risk. | Add injected spawn contract, direct argv policy, supported-platform behavior, and fixed outcomes. |
| `src/app/actions.ts` | Modified | Explorer orchestration, session capture, notices, preference save, telemetry facade. | Add typed actions and fail-soft stale-result handling. |
| `src/app/controller.ts` | Modified | Production dependency ownership. | Add source and launcher options/defaults and pass them once to actions. |
| `src/store/appStore.ts`, `src/store/selectors.ts` | Modified | Current-run explorer state, focus, notices, narrow projections. | Add immutable per-session transitions, lifecycle cleanup, and selectors. |
| `src/ui/FileExplorer.tsx` | New | Keyboard tree interaction and notices. | Render selector state and call actions only; add dedicated non-modal explorer keymap. |
| `src/ui/CockpitApp.tsx`, `src/ui/keymap.ts` | Modified | Command routing and responsive layout composition. | Add peer `Ctrl+B`/slash toggle, registry-derived help, overlay precedence, docked/narrow rendering. |
| `src/ui/SettingsView.tsx` | Modified | Explicit Editor tab draft, validation, Save/Cancel. | Keep draft local and persistence outside the view. |
| `src/config/configLoader.ts`, `configWriter.ts`, `configWatcher.ts`, `src/index.ts` | Modified | Strict editor preference persistence and next-open reload behavior. | Extend schema, merge, atomic write, watcher propagation, fixtures, and boot wiring. |
| `src/telemetry/recorder.ts` | Modified | Content-free explorer observability. | Add only allow-listed events/outcomes and schema tests. |

## Testing Approach

### Unit Tests

- **Workspace source:** injected filesystem fixtures cover collapsed root, directories-first lexical order, hidden/ignored entries, `.git` exclusion at every depth, regular files, unsupported types, contained/broken/escaping/chained/looping links, `..` and absolute-path refusal, workspace-root changes, and revalidation after a prior listing.
- **Open eligibility:** prove directories and non-regular targets cannot reach the launcher; a file changed after refresh is revalidated and refused when no longer contained or regular.
- **Launcher:** injected spawn asserts exact macOS/Linux argument vectors, no shell use, one `{file}` replacement, malformed custom preference rejection, custom-success, custom-failure/system-success, and final-failure behavior.
- **Store and selectors:** cover hidden-by-default state, per-session independent expansion/selection/scroll, focus return, session lifecycle cleanup, refresh generations, stale result rejection, and notice replacement without cross-session mutation.
- **Config:** cover strict system-default/custom schema variants, exact placeholder cardinality, merge preservation of unrelated deltas, atomic persistence, reload application on next open, and unchanged local Settings draft during external reload.
- **Telemetry:** test disabled no-op behavior and allow-listed explorer events only. Assert serialized records contain no path, name, workspace, executable, argument, error text, tree, or stable file identity.

### Integration Tests

- **Controller actions:** inject source, launcher, store, and recorder doubles to prove explicit-session operations capture the correct `cwd`, keep other sessions untouched, and contain every expected rejection.
- **Mounted UI:** prove `Ctrl+B`, `/file-explorer`, help text, slash-menu dispatch, explorer navigation, `Escape`, `R`, session switching, docked/narrow transitions, and approval/clarification modal precedence.
- **Settings flow:** mount the Editor tab to prove Draft → valid Save → next open, invalid Save → retained draft, and Cancel/Escape → no persisted change.
- **Config watcher:** prove a validated external `editor` update changes the next open while malformed external content retains the last known-valid preference.
- **Regression coverage:** retain full `bun run typecheck`, `bun test`, and `bun run selfcheck` verification after implementation.

## Development Sequencing

### Build Order

1. **Types and store contract** — add explorer state, position snapshots, notices, focus intent, and narrow selectors; no dependencies.
2. **Workspace source and launcher** — add injected app-layer source/launcher contracts, production implementations, and direct unit coverage; depends on step 1's shared result and state types.
3. **Controller actions and wiring** — add session-addressed orchestration, captured-generation commits, launcher fallback, and controller options; depends on steps 1 and 2.
4. **Strict editor preference configuration** — extend config schema, defaults, merger, writer, watcher, and boot propagation; depends on step 2's `EditorPreference` contract.
5. **Command, layout, and explorer UI** — add registry/keymaps, `FileExplorer`, docked/narrow composition, focus behavior, and selector-driven actions; depends on steps 1 and 3.
6. **Settings Editor tab** — add local draft, validation presentation, Save/Cancel, and live-reload handling; depends on steps 3 and 4.
7. **Telemetry and full integration coverage** — add closed event vocabulary, action facade, controller/UI/config regression suites, and end-to-end gates; depends on steps 2 through 6.

### Technical Dependencies

- Existing Bun runtime and Node filesystem/process APIs already used by the repository.
- The macOS system opener and Linux `xdg-open` are the only supported default-launch platform dependencies.
- No network service, database, new package, persistent explorer cache, or filesystem watcher is required.

## Monitoring and Observability

Telemetry remains opt-in, local, and JSONL-backed through the existing recorder. Add only these closed event families:

| Event | Allowed fields | Explicitly forbidden |
| --- | --- | --- |
| `explorer_opened` | Existing anonymous run/session ordinal | Paths, names, workspace identity, tree content |
| `explorer_refreshed` | Existing anonymous run/session ordinal, fixed final outcome | Paths, names, error text, entry counts |
| `explorer_file_opened` | Existing anonymous run/session ordinal, fixed final dispatch outcome | File data, editor preference, executable, arguments, error text |
| `explorer_fallback` | Existing anonymous run/session ordinal, fixed fallback outcome | File data, custom editor data, error text |

The recorder must retain its disabled no-op behavior and must not add timing, tree-size, command, or content fields for this feature. Product evaluation combines the permitted local aggregates with the consented beta check-in defined by the PRD.

## Technical Considerations

### Key Decisions

- **Separate explorer source from prompt file discovery:** the explorer's whole-workspace visibility contract differs from the prompt selector's Git and safe-text contract. ADR-003 records the separation.
- **Controller-owned I/O and store-owned current-run state:** keeps filesystem/process work out of React, preserves per-session isolation, and makes asynchronous commits generation-safe.
- **Lazy explicit loading:** reads only the root or a developer-expanded/refreshed directory, preventing a full workspace scan or background watcher.
- **Direct argv editor invocation:** strict structured preference plus one `{file}` placeholder removes shell parsing and supports deterministic fallback. ADR-004 records the policy.
- **Dispatch-level notices:** Kitten can truthfully report launch dispatch, not external GUI readiness.
- **Content-free telemetry:** closed outcomes provide product learning without making file activity observable.

### Known Risks

| Risk | Mitigation |
| --- | --- |
| Symlink, path, or post-refresh target change escapes the workspace | Resolve the root and target at every use, require containment and regular-file status immediately before traversal/open, and fail closed. |
| Focus switch or stale async read mixes session trees | Capture `SessionId`, workspace identity, and generation before awaiting; commit only if all still match. |
| Large directories degrade terminal responsiveness | List only explicit directories, avoid recursive scanning/prefetch, and preserve an in-progress/loading row. |
| External editors behave differently by platform | Limit default launch to macOS/Linux, use direct argv, report dispatch only, and test injected outcomes. |
| Settings draft or external reload overwrites a user edit | Keep drafts component-local, persist only explicit Save, and leave an active draft untouched by watcher reloads. |
| Telemetry accidentally carries sensitive data | Use closed types, small recorder methods, serialized-record tests, and no generic metadata field. |

## Architecture Decision Records

- [ADR-001: Keep a safety-complete session explorer as the V1 boundary](adrs/adr-001.md) — Defines the complete narrow V1 and containment-first product boundary.
- [ADR-002: Validate repeat multi-session use before expanding the explorer](adrs/adr-002.md) — Makes repeated multi-session use the product expansion gate.
- [ADR-003: Keep explorer I/O behind separate controller-owned capabilities](adrs/adr-003.md) — Separates workspace tree and launcher I/O from prompt discovery and React.
- [ADR-004: Persist editor preferences as validated direct argument vectors](adrs/adr-004.md) — Defines strict Save/Cancel config, direct argv spawning, reload, and fallback semantics.
