# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- ACP config surface (SDK `@agentclientprotocol/sdk@1.2.1`): `SessionConfigOption` is a discriminated union on `type: "select" | "boolean"`; select `options` is `SessionConfigSelectOption[] | SessionConfigSelectGroup[]` (group detected by absence of `"value"` key). `category` is nullable/opaque. Both `config_option_update` and `SetSessionConfigOptionResponse`/`newSession` carry the FULL option set, not a delta.
- The adapter helper `translateConfigOptions` (in `acpTranslate.ts`, currently module-private) is the single ACP→`ConfigOption[]` mapper: it skips booleans, flattens groups, defaults absent category to `""`. For task_03, export it and reuse for the `setSessionConfigOption` response and `newSession.configOptions` capture instead of re-mapping.

- Live-handshake result (task_03, adapter `claude-agent-acp@0.57.0`): advertises config categories `mode`, `model`, `model_config`, `thought_level` (id `"effort"`, category `"thought_level"`), `agent`. Confirms `model` + `thought_level` are both present. NOTE for task_04: the thought_level option's `id` is `"effort"`, not `"thought_level"` - filter the allowlist by `category`, never by `id`. `model` currentValue example: `"opus"`; option values include `default`, `opus`, `opus[1m]`, `sonnet`, `haiku`, `claude-fable-5[1m]`.
- Adapter `newSession` capture emits `config_options` ONLY when the ACP response carries a `configOptions` field (`!= null`); absent → no emit (reducer default `[]` covers it), explicit `[]` → empty event, never fabricated. `setSessionConfigOption` propagates transport errors (mirrors `cancel`) for the controller action's `onError`; it does NOT emit `status:"error"` and emits no config event on failure, so confirmed state is preserved and the overlay derives `unverified`.

- Store/selector surface (task_04): allowlist constants + `visibleConfigOptions(options)` live in `src/core/types.ts` (pure), with `MODEL_CATEGORY="model"`/`EFFORT_CATEGORY="thought_level"`/`VISIBLE_CATEGORIES`. Selectors (`src/store/selectors.ts`): `selectAgentConfigOptions` returns the RAW `configOptions` slice (referentially stable - apply+memoize `visibleConfigOptions` in the UI, never in the selector); `selectAgentModel`/`selectAgentEffort` return `string | undefined`. Overlay slot: `ModelSelectOverlay={sessionId}`, `store.openModelSelect({sessionId})`/`closeModelSelect()`, read via `selectModelSelectOverlay`; already OR'd into `selectHasOpenOverlay`. NOTE: codebase uses `sessionId` not `agentId`; there is no `selectAgentStatus` (it's `selectSessionStatus`) - task files predate the AgentId->SessionId rename.

- Controller action surface (task_05): `actions.setSessionConfigOption(configId, value, sessionId?)` -> `Promise<void>`, sessionId defaults to focused, mirrors `sendPrompt`/`cancel` (no-op on not-ready, errors -> `onError`). It updates the store ONLY from the adapter-reported set via `applyEvent({kind:"config_options"})` - never optimistic (ADR-004), so `selectAgentModel`/`selectAgentEffort` follow confirmed state. task_06 UI and task_08 hand-off call this exact method; `test/fakeController.ts` records calls in `calls.setSessionConfigOption`. Session-start options are seeded in the controller's `startSession` by capturing the `config_options` the adapter emits during `newSession` (temporary `onUpdate` around `newSession`, replayed via `applyEvent` after `store.startSession` resets the slice).

- UI selector (task_06): `src/ui/ModelSelect.tsx` is the model/effort overlay - confirmed-state only, `unverified` tag when a requested switch is unconfirmed (never renders the requested value), inline mid-switch confirm gated on `turns.length > 0`. Chord is `Ctrl+E` (`model-select` command in `COCKPIT_KEYMAP`, placed after `sessions`); keymap adds `MODEL_SELECT_KEYMAP`/`matchModelSelectCommand`/`MODEL_SELECT_HINT`/`MODEL_SELECT_CONFIRM_HINT`. Dispatch in `CockpitApp` is under the `selectHasOpenOverlay` guard and opens for the focused pane. task_08 hand-off preview should reuse this model/effort control. Rendered-frame gotcha: multi-line overlay text (the warning) wraps across box lines, so assert on single-line fragments, not the full string.

## Open Risks
- Codex adapter (`codex-acp@1.1.0`) config-option surface UNVERIFIED live: this env's `~/.codex/config.toml` is broken (`unknown variant 'priority'`) and a clean `CODEX_HOME` requires interactive auth. The adapter/code degrades safely (empty option set, no picker) if codex advertises neither `model` nor `thought_level` - but whether codex advertises them at all is still owed a real live check before relying on the picker for codex panes.

## Handoffs
