# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts obvious from the repository, PRD documents, or git history.

## Current State
- Done + verified: task_01..task_12. Remaining: telemetry (13), packaging/first-run (14).
- Baseline after task_12: `bun test` 373/373 pass, `bun run typecheck` clean, `bun test --coverage` exits 0 (per-file 0.8 threshold).
- Entry chain: `src/index.ts` -> `src/ui/main.tsx` (`renderCockpit`) -> `src/ui/CockpitApp.tsx` -> `src/ui/ConversationView.tsx`.

## Follow-ups
- Submission is not gated while the focused agent is `working`: a second Enter mid-turn still reaches `sendPrompt` (task_10 gated on readiness only, per spec).
- Prompt editor grows with logical lines only; one long wrapped line does not enlarge it (`virtualLineCount` unusable, see Shared Learnings).
- `StatusStrip` cramps below ~60 columns: keymap hint collides with the last chip and wraps. Pre-existing from task_08.
- Agent thoughts are still unrendered (no domain turn kind); deliberately deferred, not silently widened.
- `<markdown>`/`<diff>` syntax highlighting unobservable under the test renderer; `theme.ts` registers real token styles but colored output is unverified in a real terminal.

## Shared Decisions
- ACP SDK is `@agentclientprotocol/sdk` (pinned 1.2.1). Import ACP types only inside `src/agent` (ADR-003); re-export protocol constants as plain values.
- Exact version pinning is mandatory (bunfig `install.exact = true`); new deps must respect `minimumReleaseAge`.
- `src/index.ts` stays import-side-effect-free (`import.meta.main` guard). JSX only in `.tsx`.
- `src/ui/keymap.ts` is the single source of truth for dispatch and the help panel. Only chords/function keys for the shell, so the prompt editor keeps every printable key. Never bind inline in a component. Overlays (`APPROVAL_KEYMAP`, `HANDOFF_KEYMAP`) are the exception: while modal they swallow every key, so plain arrows/Enter/Space/letters are theirs. `HELP_ENTRIES` = shell chords + `EDITOR_KEYMAP`; overlay keys are intentionally excluded (F1 unreachable while they are live) and each overlay prints its own hint.
- Key precedence: all global `useKeyboard` handlers run first (in **mount order**, not tree order), then renderable handlers. `preventDefault()` skips renderable handlers; `stopPropagation()` also cuts off *later* global listeners. Neither outranks an *earlier*-mounted global handler. `CockpitFrame` mounts before any overlay, so an overlay cannot take a key from the shell by `preventDefault`/`stopPropagation` alone - the shell must stand down explicitly. It does so via `selectHasOpenOverlay` (covers approval + handoff preview) - modal overlays own the keyboard outright.
- All UI colors come from `src/ui/theme.ts` (`usePalette()`). Never hard-code a color. Palette carries `status` (agent lifecycle) and `tool` (tool-call status) records; unreported terminal theme falls back to dark.
- Domain `tool_call` event carries a partial `ToolCallUpdate` (toolCallId required, rest optional, `diff: null` clears). Reducer upserts by toolCallId.
- `referencedFiles` and `pendingDiffs` are pure reducer derivations, never written directly. Per-agent `AgentStatus` lives ONLY in `sessions[agentId].status`.
- No Zustand. Hand-rolled store + `useSyncExternalStore` binding satisfies ADR-004. No Portal for overlays: conditional absolutely-positioned boxes inside a `position:"relative"` root.
- OpenTUI tracks exactly ONE focused renderable. When an overlay owns a textarea (handoff summary editor), the composer must blur (`focused={!overlayOpen}`) or focus is contested; the composer refocuses when the overlay closes. Drafts survive blur (the buffer is the draft).
- Config: optional JSON (`KITTEN_CONFIG` -> `$XDG_CONFIG_HOME/kitten/config.json` -> `~/.config/kitten/config.json`), zod-`.strict()`, field-level merge over `defaultAppConfig()`. Invalid config throws `ConfigError`.
- Default spawn commands (verified, ACP v1): `npx -y @agentclientprotocol/claude-agent-acp@0.57.0`, `npx -y @agentclientprotocol/codex-acp@1.1.0`.
- Redaction is biased to false negatives; the human preview is the safety control. `assemble` redacts as it builds - callers must NOT redact again.
- Factories over classes for public constructors (`createX(...)`), interfaces as the seam.
- V1 does not surface agent thoughts: `translateSessionUpdate` maps `agent_thought_chunk` to `null` and `Turn` has no thought variant. Adding them means touching types + reducer + translator together.

## Shared Learnings
- Verification gates: `bun run typecheck` + `bun test` + `bun test --coverage`. `bun build --compile` FAILS at baseline (@opentui/core cannot resolve platform binaries) - owned by task_14, not a per-task regression.
- Never gate on `rtk tsc`: no `tsc` on PATH, so the wrapper turns empty output into a false "No errors found". Use `bun run typecheck`.
- Bun enforces `coverageThreshold` (0.8) PER FILE, not on aggregate. A non-zero `bun test --coverage` exit is a real regression. It also gates non-test helpers under `test/`, so every helper there needs its own test.
- `bun build <file> --target=bun | grep -c <pkg>` proves a type-only import did not breach the ADR-003 boundary.
- zsh has no `PIPESTATUS`; redirect to a file and read `$?` when verification needs a real exit code.
- Non-TTY UI tests: `createTestRenderer({width,height})` from `@opentui/core/testing` + `testRender(<C/>, {width,height})` from `@opentui/react/test-utils`. Use `test/reactTui.ts` (`actAsync`, `destroyMounted`); React updates and renderer teardown must run inside `act()`. Drive the controller with `test/fakeController.ts`.
- `testRender` returns no `rerender`. Re-render by pushing store events inside `actAsync`, or expose a setter from a probe component.
- OpenTUI test-renderer gotchas: `captureCharFrame()` ends with a trailing newline; right after `resize()` a frame can hold uninitialized filler cells (`U+0A00`), so gate `waitForFrame` on real content. A lone `ESC` is buffered ~20ms; two `pressKey` calls with no delay merge into one sequence. A keystroke lands in a renderable's buffer immediately but only paints on the next pass, so assert through `waitForFrame`, never a bare capture.
- `testRender(..., {kittyKeyboard: true})` is the only way to press Shift+Enter (and to send Escape as a complete sequence, skipping the 20ms wait). Real terminals need the Kitty protocol for the same reason.
- Frame predicates must be specific: a placeholder mentioning "Shift+Enter" makes a naive `includes` predicate match the first frame.
- Two ways a UI assertion silently proves nothing. (1) `expect(calls).toEqual([])` also passes for `[undefined]` - a no-arg action call (`switchFocus()`) hides there; use `toHaveLength(0)`. (2) `waitForFrame(p)` returns the *current* frame when `p` already holds, so it does not force a new pass; to assert a key did NOT reach a renderable, change the tree (close the overlay) and read the frame after.
- The cockpit root is `overflow:"hidden"` and `captureCharFrame()` is viewport-bounded, so an oversized absolute overlay can never paint out of bounds. Overflow-artifact checks cannot detect an unbounded overlay - assert its controls are still visible instead. Overlays that must shrink should bound `maxHeight` to the viewport and let low-priority children (`flexShrink:1`) give up rows.
- A focused `TextareaRenderable` handles bracketed paste itself, ANSI-stripped and whole, however many stdin chunks it spans. Do NOT also register `usePaste` (double insert). Pasted newlines never reach the keypress path, so a paste cannot trigger submit.
- `TextareaRenderable.virtualLineCount` is stale inside `onContentChange` (reflects last laid-out view). Size an editor off `lineCount`. Read the buffer once via `ref.current?.plainText` on send.
- Yoga `gap` applies between every pair of row children, including a `flexGrow` spacer. Group gapped items in an inner box rather than gapping the outer row.
- ACP SDK error semantics: an agent throwing a plain `Error` from a handler reaches the client as JSON-RPC "Internal error" with the real text in `error.data.details`; `connect()` unwraps it. A thrown `RequestError` keeps its message.
- ACP SDK v1.2.1: values `ClientSideConnection`, `AgentSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION` (=1); `Stream` + schema types are type-only. SDK delivers session/update notifications before the prompt response resolves. `ndJsonStream`'s writable only implements `write`; process teardown belongs in `AgentTransport.dispose()`.

## Open Risks
- Pre-1.0 churn: @opentui/* and the ACP SDK ship breaking changes; keep them behind adapter boundaries and re-pin deliberately.
- **@opentui/core 0.4.3 `<markdown>` bug**: a `MarkdownRenderable` paints NOTHING unless `streaming` is true. Kitten passes `streaming` permanently (`src/ui/MessageView.tsx`). Re-check on every @opentui bump.
- **@opentui/core 0.4.3 `<scrollbox>` bug**: the horizontal scrollbar reserves its row even under `scrollX: false`, so content measures one row taller than it paints; with `stickyStart: "bottom"` this scrolls the first line out of view. Pass `horizontalScrollbarOptions={{visible:false}}` (`src/ui/ConversationView.tsx`).

## Handoffs
Public APIs downstream tasks depend on (signatures live in source; these are the non-obvious contracts):

- **task_03 `src/agent/agentConnection.ts`** - `createAgentConnection({config, transport?, scheduler?})` → connect/newSession/prompt/cancel/onUpdate/onPermission/dispose. Emits `status` domain events, coalesces `onUpdate` per frame. Doubles: `test/mockAgent.ts` `startMockAgent(...)`, `createInMemoryTransportPair()`.
- **task_04 config/readiness** - `loadAppConfig`, `defaultAppConfig`, `findAgentConfig`, `ConfigError`; `checkAllAgentsReadiness(appConfig)` → `AgentReadiness[]` in config order, never throws. `NotReadyReason = binary_not_found | handshake_failed | handshake_timeout | capability_mismatch`, each with a display-ready `message`.
- **task_05 store** - `createAppStore(...)` → `getState`, `subscribe`, `subscribeSelector`, `applyEvent`, `startSession`, `setFocus`, `openApproval`/`closeApproval`, `openHandoffPreview`/`closeHandoffPreview`; plus `AGENT_IDS`. Every action no-ops when nothing changes; state immutable with structural sharing. Does NOT batch. `src/store/selectors.ts` curried per-agent selectors return a new function per call, so React callers must `useMemo` them. `selectHasOpenOverlay` covers approval + handoff preview.
- **task_06 bundle** - `createDeterministicAssembler({limits?, redactor?}).assemble(session, target)` already redacts and reports `redactionCount`; callers must NOT redact again.
- **task_07 controller** (the only path the UI may use to reach an agent) - `await createSessionController({config, cwd?, store?, createConnection?, onError?})` → `{ store, actions, runtimes(), runtime(agentId), isReady(agentId), dispose() }`. Never rejects: a failed connect/handshake/`session/new` yields `AgentRuntimeState {ready:false, error}` for that agent only and focus falls through to the first ready agent. `ControllerActions = { sendPrompt(input, agentId?) → Promise<PromptResult|null>, cancel(agentId?), switchFocus(agentId?) (omitted = cycle), respondPermission(outcome) }`; `agentId` defaults to focused. `sendPrompt` records the `user_message` turn synchronously (so focus may move immediately after), drops blank prompts, returns `null` (via `onError`) instead of throwing. Permission requests queue FIFO behind the store's single approval slot.
- **task_08 UI shell** - `src/ui/cockpitContext.tsx`: `<CockpitProvider controller>`, `useController()`, `useAppSelector(selector, isEqual?)` (selector must be referentially stable - `useMemo` curried per-agent selectors). `src/ui/CockpitApp.tsx` renders the focused-pane frame + `StatusStrip`, mounts overlays as absolutely-positioned boxes inside a `position:"relative"` root, renders `props.children` in the conversation region, replaces that region with `AgentRuntimeState.error` when the focused agent is not ready.
- **task_09 conversation** - `src/ui/ConversationView.tsx`, `src/ui/MessageView.tsx` (`MARKDOWN_SYNTAX_STYLE`), `src/ui/ToolCallRow.tsx` (`filetypeFor(path)`, `TOOL_KIND_LABELS`, `ToolCallDiffView({diff})`). `src/ui/main.tsx` mounts `<ConversationView/>` as `<CockpitApp>`'s child. Diff gutter/signs are non-selectable (clean copy).
- **task_10 prompt editor** - `src/ui/PromptEditor.tsx` (no props). Fixed chrome between the conversation region and the strip, not a `children` slot. Owns terminal focus but blurs while any overlay is open (`focused={!overlayOpen}`) and refocuses on close. Submits via `actions.sendPrompt(text)` on Enter, interrupts via `actions.cancel()` on Escape while `working`, no-ops on submit when `isReady(focused)` is false. Draft survives focus switches and blocked submits.
- **task_11 approval overlay** - `src/ui/ApprovalPrompt.tsx` (no props; reads `overlays.approval`, renders nothing when empty). Mounted last so it paints over everything. Modal: `preventDefault()`s every key; shell stands down via `selectHasOpenOverlay`/`selectIsApprovalOpen`. Answers via `actions.respondPermission` and NEVER calls `closeApproval()` - the controller settles the request then opens the next queued one. Keys in `keymap.ts` (`APPROVAL_KEYMAP`, `matchApprovalCommand`, `approvalOptionIndex`, `APPROVAL_HINT`).
- **task_12 hand-off** - `src/app/handoff.ts` `createHandoffFlow({controller, assembler?})` → `{ begin(): boolean, confirm(edits): Promise<PromptResult|null>, cancel() }`. `begin` assembles the focused session and calls `openHandoffPreview` (returns false if any overlay open / empty transcript / target not ready); direction derived from focus (`nextAgentId`), so hand-off and hand-back are one flow. `confirm` composes prompt blocks and calls `sendPrompt(blocks, target)` then `switchFocus(target)`; empties compose to `[]` (nothing sent, preview stays up). `composeHandoffBlocks`/`createHandoffEdits`/`HandoffEdits` are pure and exported. `src/ui/HandoffPreview.tsx` `<HandoffPreview flow={...}/>` is the modal editable overlay; `CockpitApp` builds one flow with `useMemo` and binds `Ctrl+T`. Nothing auto-sends: keystroke→`sendPrompt` only through the preview.

Consumers still to build:
- task_13 observes transitions via `store.subscribe`, reads `AppConfig.telemetryEnabled`, and records hand-off events (the hand-off path is in `src/app/handoff.ts`).
- task_14's first-run flow renders `AgentReadiness.message` per `NotReadyReason`.
