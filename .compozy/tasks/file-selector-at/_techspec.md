# TechSpec: @ File Selector

## Executive Summary

The @ File Selector extends the existing prompt-local completion model with a Git-backed repository-file source. `src/app/fileDiscovery.ts` resolves the explicitly captured focused session's Git root, applies the normal-file and safe-path policy, and returns a fail-soft result through `ControllerActions`. `PromptEditor` keeps only its token, filtered rows, request generation, dismissal suppression, and one-focus in-memory path cache; a new stateless `FileSelector` renders the selector above the textarea.

The primary trade-off is a potentially slower first discovery in exchange for accurate Git boundaries, terminal-safe paths, binary exclusion, and no persistent index. Once the active session's list is available, all path filtering stays local and must render at p95 <=100 ms. Selection inserts visible text only—`@relative/path` or an escaped quoted form when necessary—without creating an ACP attachment, changing `referencedFiles`, or promising provider-specific context.

## System Architecture

### Component Overview

**Repository file source — new `src/app/fileDiscovery.ts`.** Owns local Git and filesystem I/O. It resolves the worktree root, lists paths with `git ls-files --cached --others --exclude-standard -z`, removes every path matching current Git ignore rules, applies `.gitattributes` and bounded binary policy, rejects unsafe/escaping/non-regular paths, and returns only safe repository-relative paths or an unavailable reason. It follows `src/config/gitBranch.ts` with injected Bun subprocess and filesystem seams.

**Controller and action boundary — `src/app/controller.ts`, `src/app/actions.ts`.** `SessionControllerOptions` receives an injectable `RepositoryFileSource`. `ControllerActions.listRepositoryFiles(sessionId: SessionId)` captures the session's `cwd` before awaiting the source and converts every expected source rejection into an unavailable result. It allows configured but not-ready sessions to discover files; the existing readiness gate still prevents prompt submission. No ACP type or agent request participates.

**Prompt-local completion — `src/ui/PromptEditor.tsx`.** Generalizes slash-only state to a discriminated slash-or-file completion union. `fileTokenAt` recognizes an unquoted `@` only at the beginning of a whitespace-delimited token. On a valid token, it requests paths for the captured `SessionId`, caches only that ready list while the same session remains focused, and filters it locally. A session/cwd generation discards late results. Escape suppresses reopening for the current token until the trigger is removed, the cursor leaves the token, a new token starts, or focus changes.

**Presentation and keymap — new `src/ui/FileSelector.tsx`, `src/ui/keymap.ts`.** The new leaf renders safe repository-relative rows plus loading, empty, and unavailable copy. `PromptEditor` reuses `MENU_KEYMAP` and `matchMenuCommand`; it adds no binding table. `EDITOR_KEYMAP` gains the `@` discovery entry.

**Telemetry — `src/telemetry/recorder.ts`.** When existing `telemetryEnabled` is true, it records content-free invocation, discovery outcome/latency, warm-query render latency, acceptance duration, and correction events. It never records a query, candidate path, source bytes, or prompt text.

**PRD mapping.** The source and action enforce focused-session and normal-file scope. The editor and selector satisfy keyboard search, visible relative-path references, no-send selection, and non-blocking empty/unavailable states. The telemetry lifecycle supports the PRD latency, adoption, completion, and correction metrics.

**Data flow.**

`@` at a token boundary -> capture `focusedSessionId` -> `ControllerActions.listRepositoryFiles(sessionId)` -> source uses that session's captured `cwd` -> eligible safe relative paths -> prompt-local cache -> local filter/rank -> `FileSelector` -> Enter replaces the active range with a formatted visible reference.

A focus change -> increment request generation -> dismiss file completion and clear cache/suppression -> ignore prior async results. Slash completion remains unchanged except that exactly one completion variant is active.

## Implementation Design

### Core Interfaces

Required Go-format equivalent of the production async contract; the following TypeScript is authoritative:

```go
type RepositoryFileList struct {
    Kind   string // "ready" or "unavailable"
    Paths  []string
    Reason string
}
type RepositoryFileSource interface {
    List(cwd string) <-chan RepositoryFileList
}
```

Production TypeScript contract:

```ts
export type RepositoryFileList =
  | { kind: "ready"; paths: readonly string[] }
  | { kind: "unavailable"; reason: "unknown_session" | "not_repository" | "discovery_failed" }

export interface RepositoryFileSource {
  list(cwd: string): Promise<RepositoryFileList>
}
export interface ControllerActions {
  listRepositoryFiles(sessionId: SessionId): Promise<RepositoryFileList>
}
```

Prompt-local file completion and safe formatting contract:

```ts
export interface FileToken { start: number; end: number; filter: string }

export type FileCompletionState =
  | { kind: "file"; token: FileToken; status: "loading"; generation: number }
  | { kind: "file"; token: FileToken; status: "ready"; paths: readonly string[]; selected: number; generation: number }
  | { kind: "file"; token: FileToken; status: "empty" | "unavailable"; generation: number }

export function formatFileReference(path: string): string
// "src/a.ts" -> "@src/a.ts"; "src/My File.ts" -> '@"src/My File.ts"'
```

The action wraps the source in `try/catch` and always resolves an unavailable result after an expected rejection. The editor also attaches a rejection handler to its fire-and-forget load callback; it generation-checks both paths before converting the current menu to unavailable. Absolute roots and inspected source bytes never cross the source boundary.

### Data Models

- **Repository file candidate:** a normalized repository-relative POSIX path containing no C0/C1 control characters. It has no content or provider attachment metadata.
- **Discovery result:** `ready` contains the complete eligible list for one captured session; `unavailable` contains only a stable reason for concise UI copy.
- **File token:** the replacement range and current unquoted query after `@`. It exists only while the cursor remains in that token.
- **File completion state:** React-local status, subset, highlight, generation, and optional suppression marker. It is never in `AppStore`.
- **Safe visible reference:** `@path` for paths without whitespace, double quotes, or backslashes; otherwise `@` plus a JSON-style quoted/escaped path. The quote syntax is display/insertion only, not a second query grammar.
- **Active-focus cache:** a `useRef` record keyed by current `SessionId` and `cwd` that retains only eligible path strings. It clears on focus change; binary filtering remains internal to the source.
- **Pending accepted reference:** React-local `{ text, start, end, sessionId }` entries used only until submit or correction. They never enter telemetry.

Path matching case-folds for comparison but preserves the original safe path for display and insertion. Rank basename-prefix matches first, then full-path substring matches, and break ties by stable lexical path order. Render at most eight rows; retain the complete eligible list in the active-focus cache.

To measure corrections, keep the prior draft plus each pending accepted range. On every content change, compute the minimal changed range. Shift an entry when a change is strictly before it; retain it when strictly after it; record one correction and remove it when the change overlaps its range. Clear every pending entry after submission. A selected reference’s text can exist only in this local tracker, never in serialized telemetry.

### API Endpoints

Not applicable. Kitten has no HTTP API, and this feature adds no ACP request, response, capability, or provider-specific attachment. Its internal action contract is defined above.

## Integration Points

**Local Git executable.** The source executes these fixed root-scoped commands using NUL-delimited path transport:

1. `git rev-parse --show-toplevel`.
2. `git ls-files --cached --others --exclude-standard -z`.
3. `git check-ignore --no-index -z --stdin`; exit code 1 means no supplied path is ignored, while other failures are unavailable.
4. `git check-attr -z --stdin linguist-generated text`, parsed as `path\0attribute\0value\0` triples.

It excludes `linguist-generated=set` and every explicit non-`false` value, and excludes `text=unset` or `text=false`. `unspecified`, `text=set`, `text=auto`, and `linguist-generated=unset` remain eligible for the next checks. Malformed output is unavailable, never permissive.

**Filesystem.** Injected `lstat`, real-path containment, and a 4 KiB prefix-read seam enforce regular-file, root containment, and binary policy. A named bounded worker-pool concurrency constant limits discovery work. Prefix bytes become a boolean immediately and are discarded; there is no candidate cap or pagination, so every eligible path remains searchable.

**Existing telemetry recorder.** New methods are no-ops while `telemetryEnabled` is false. A post-render effect measures elapsed time from each warm local query update until its rows/empty state are committed, then sends only duration and result-state through the controller/action facade.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/app/fileDiscovery.ts` | new | Git, attributes, ignore, path, and binary policy; high correctness risk. | Add injected source, fixed command parsers, worker pool, named constants, and tests. |
| `src/app/actions.ts` | modified | Explicit-session, fail-soft list action and telemetry facade; medium boundary risk. | Add typed result, captured-cwd implementation, total rejection handling, and unit tests. |
| `src/app/controller.ts` | modified | Wires source and recorder into actions; low-medium wiring risk. | Add option default and session-cwd/not-ready tests. |
| `src/ui/PromptEditor.tsx` | modified | Adds file token parsing, async state, suppression, correction tracking, cache invalidation, and insertion; highest interaction risk. | Generalize completion state and add focused UI tests. |
| `src/ui/FileSelector.tsx` | new | Stateless terminal presentation; medium path-safety risk. | Render only prevalidated paths and non-blocking status copy with tests. |
| `src/ui/keymap.ts` | modified | Documents `@`; reuses existing menu commands. | Extend help entry and test; add no bindings. |
| `src/telemetry/recorder.ts` | modified | Adds opt-in content-free events; medium privacy risk. | Extend closed event union/interface and prove disabled mode emits nothing. |
| `test/fakeController.ts` | modified | UI double must implement explicit-session list action and metric calls. | Add configurable results and recorded calls. |
| `src/core/*`, `src/store/*`, `src/agent/*` | unchanged | No domain state, reducer event, store slice, or ACP protocol change. | Preserve boundaries; add no placeholders. |

## Testing Approach

### Unit Tests

- **Repository source** (`fileDiscovery.test.ts`): fake Git spawn asserts fixed commands, root/cwd capture, NUL path parsing, malformed triples, expected exit codes, ignore subtraction (including tracked ignored paths), and all failures returning unavailable.
- **Eligibility:** injected filesystem tests cover attribute-marked generated/non-text paths, unmarked NUL-prefix binaries, root escape, non-regular paths, spaces/quotes/backslashes, and rejected newline, carriage return, tab, ESC, C0, and C1 paths. Assert bytes are not retained.
- **Source bounds:** verify the 4 KiB prefix limit, worker-pool concurrency, stable lexical output, and no candidate cap.
- **Actions/controller:** an explicit session uses its captured cwd even if focus changes during discovery; unknown session is unavailable; not-ready session may list files; source throw/rejection resolves unavailable and cannot affect another session.
- **Prompt helpers:** test token boundaries, email/embedded `@`, suppression lifecycle, matching/ranking, and conditional quoted reference formatting.
- **Keymap/presentation:** reuse every `MENU_KEYMAP` command, include `@` in editor help, and render loading/no-match/unavailable copy without control bytes or an empty border.
- **Telemetry:** enabled mode permits only event kind, session reference, timing, and outcome. Disabled mode emits nothing. Query, path, prompt, candidate count, and source bytes are absent.
- **Correction lifecycle:** edits before/after an inserted reference update or retain its range; overlap/removal/replacement emits exactly one correction; a submit clears pending entries without correction.

### Integration Tests

Use the existing `testRender` + Kitty keyboard + `createFakeController` harness in `PromptEditor.test.tsx`.

- Typing `@` at a token boundary shows loading then safe repository-relative paths; duplicate basenames remain disambiguated by full paths.
- Typing filters locally; arrow, Tab, Shift+Tab, Enter, and keypad Enter navigate or select exactly as the existing menu does.
- Selecting a normal path inserts `@src/ui/PromptEditor.tsx `; selecting `src/My File.ts` inserts `@"src/My File.ts" `; neither calls `sendPrompt`.
- Escape closes the selector, then continued typing inside the same token does not reopen it. Removing the trigger, leaving the token, or starting a new `@` token permits a new selector.
- Empty and unavailable states leave printable typing active and never clear or submit the draft.
- Switching focus while discovery is pending or while a cache is warm clears the selector, suppression, and cache, and ignores late paths from the prior session.
- A not-ready focused session preserves the existing no-send gate; discovery failure remains a legible prompt-local state.
- The prompt’s original slash completion continues to function, and no transcript or unrelated session selector rerenders because of local typing.

## Development Sequencing

### Build Order

1. **Repository source and tests** — create `fileDiscovery.ts` with injectable Git/filesystem seams, exact ignore/attribute/path policy, and direct tests. No dependencies.
2. **Action contract and controller wiring** — add `RepositoryFileList`, explicit-session `listRepositoryFiles`, source injection/default, total rejection handling, and controller/action tests. Depends on step 1.
3. **Fake controller and telemetry contract** — update the UI double, closed telemetry union/recorder methods, warm-query event, and disabled-mode tests. Depends on step 2.
4. **File selector presentation and help copy** — add `FileSelector.tsx`, its rendering tests, and the `@` help entry while reusing `MENU_KEYMAP`. Depends on step 3 for shared status/metrics contracts.
5. **Prompt parsing, formatting, and local lifecycle** — add pure token, path-formatting, filtering/ranking, suppression, correction-range, and focus-generation helpers with tests. Depends on steps 2 and 4.
6. **Prompt interaction integration** — generalize `PromptEditor` completion state, call the action, render `FileSelector`, record warm query timing, and intercept menu keys. Depends on steps 4 and 5.
7. **End-to-end interaction and regression coverage** — add mounted editor tests for selection, whitespace paths, dismissal, no-match, unavailable, focus switches, keypad Enter, correction, telemetry, and slash-menu preservation. Depends on step 6.
8. **Verification gate** — run `bun run typecheck && bun test`, plus `bun run selfcheck` because the view tree changes. Depends on steps 1 through 7.

### Technical Dependencies

No new dependency, package, API credential, or network service is required. Bun, Git, OpenTUI, React, the controller action surface, and opt-in telemetry already exist. Repositories may optionally use `.gitattributes` to mark generated/non-text paths; the bounded binary check covers unmarked binaries.

## Monitoring and Observability

When telemetry is enabled, emit these content-free records through the existing local recorder:

- `file_selector_opened`: a valid `@` token opened the interaction.
- `file_selector_discovery`: ready/unavailable outcome and elapsed time for source discovery.
- `file_selector_query_rendered`: elapsed time from a warm local query change until rows, empty, or unavailable feedback render; this measures the PRD’s p95 <=100 ms warm interaction target.
- `file_selector_selected`: acceptance and elapsed time from opening; this supports completion and median selection-speed metrics.
- `file_selector_corrected`: a pending inserted reference was edited through before submission; this supports wrong-file correction rate.

Every record contains only the existing session reference, event kind, timing, and an outcome flag. It excludes paths, query text, prompt text, candidate counts, and inspected bytes. There is no alerting path for this local CLI feature; release review compares opt-in aggregates against the PRD gates.

## Technical Considerations

### Key Decisions

- **Git-backed controller source** (ADR-003): use injected Git discovery rooted at an explicit focused session. It preserves repository semantics and layering. The accepted cost is a cold discovery; a filesystem walk and persistent store catalog are rejected.
- **Focus-lifetime local cache** (ADR-003): cache only ready path strings while one session stays focused. It enables fast warm filtering but deliberately gives up reuse after focus changes.
- **Prompt-local token completion** (ADR-004): keep token ranges, suppression, and menu state in `PromptEditor`; use whitespace-boundary `@` and reuse `MENU_KEYMAP`. Modal/global pickers and trigger-anywhere parsing are rejected because they interrupt or hijack composition.
- **Visible unambiguous reference** (ADR-001, ADR-004): selection inserts a plain or JSON-style quoted `@relative/path` form and does not auto-send, attach content, or mutate agent-observed file history.
- **Conservative generated, exact ignore, and bounded binary filtering** (ADR-005): use Git attributes and ignore checks plus a NUL-prefix test. This avoids brittle denylists, at the accepted cost of allowing unmarked generated text files.
- **Opt-in content-free telemetry**: extend the established recorder only with interaction/timing events. Paths, queries, prompts, candidate counts, and source bytes remain outside telemetry.

### Known Risks

- **Cold discovery in large repositories** — likelihood medium. Mitigation: bounded worker pool, loading state, focus-lifetime cache, capped visible rows, and opt-in discovery/warm-query measurement. No persistent index in V1.
- **Stale cross-workspace results** — likelihood medium. Mitigation: explicit session id and captured cwd, request generation, cache/suppression clearing on focus change, and pending-result tests.
- **Unsafe or unusual filenames** — likelihood medium. Mitigation: NUL-delimited Git transport, control-character rejection, root containment, regular-file checks, and quoted visible references for whitespace/special characters.
- **Binary/generated classification gaps** — likelihood medium. Mitigation: exact Git attributes plus bounded sniffing; document that unmarked generated text remains eligible and use adoption feedback before expanding heuristics.
- **Enter submits instead of selects** — likelihood medium. Mitigation: key interception only while a selectable file row is armed, including keypad Enter tests; Escape/no-result flows never change the draft.
- **Telemetry privacy drift** — likelihood low. Mitigation: a closed event union, typed recorder methods, and tests that assert paths, queries, prompts, counts, and bytes are absent.

## Architecture Decision Records

- [ADR-001: Keep @ File Selection as an Honest, On-Demand Single-File Reference](adrs/adr-001.md) — V1 inserts one visible provider-neutral file reference without persistent indexing or attachment claims.
- [ADR-002: Limit V1 to Normal Repository Files and Preserve Composition on No Match](adrs/adr-002.md) — Candidate scope stays narrow and empty results never interrupt the draft.
- [ADR-003: Discover Repository Files Through an Injected Controller-Owned Git Source](adrs/adr-003.md) — Explicit-session Git discovery remains fail-soft behind the action boundary with a focus-lifetime cache.
- [ADR-004: Keep @ Completion Local to the Prompt Token](adrs/adr-004.md) — Token-bound editor state, suppression, safe formatting, and reused menu navigation preserve composition.
- [ADR-005: Use Conservative Attributes and Bounded Binary Detection](adrs/adr-005.md) — Ignore checks, explicit attributes, safe paths, and a bounded NUL-prefix check define V1 eligibility.
