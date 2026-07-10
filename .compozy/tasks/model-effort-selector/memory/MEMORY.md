# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- ACP config surface (SDK `@agentclientprotocol/sdk@1.2.1`): `SessionConfigOption` is a discriminated union on `type: "select" | "boolean"`; select `options` is `SessionConfigSelectOption[] | SessionConfigSelectGroup[]` (group detected by absence of `"value"` key). `category` is nullable/opaque. Both `config_option_update` and `SetSessionConfigOptionResponse`/`newSession` carry the FULL option set, not a delta.
- The adapter helper `translateConfigOptions` (in `acpTranslate.ts`, currently module-private) is the single ACP→`ConfigOption[]` mapper: it skips booleans, flattens groups, defaults absent category to `""`. For task_03, export it and reuse for the `setSessionConfigOption` response and `newSession.configOptions` capture instead of re-mapping.

- Live-handshake result (task_03, adapter `claude-agent-acp@0.57.0`): advertises config categories `mode`, `model`, `model_config`, `thought_level` (id `"effort"`, category `"thought_level"`), `agent`. Confirms `model` + `thought_level` are both present. NOTE for task_04: the thought_level option's `id` is `"effort"`, not `"thought_level"` - filter the allowlist by `category`, never by `id`. `model` currentValue example: `"opus"`; option values include `default`, `opus`, `opus[1m]`, `sonnet`, `haiku`, `claude-fable-5[1m]`.
- Adapter `newSession` capture emits `config_options` ONLY when the ACP response carries a `configOptions` field (`!= null`); absent → no emit (reducer default `[]` covers it), explicit `[]` → empty event, never fabricated. `setSessionConfigOption` propagates transport errors (mirrors `cancel`) for the controller action's `onError`; it does NOT emit `status:"error"` and emits no config event on failure, so confirmed state is preserved and the overlay derives `unverified`.

## Open Risks
- Codex adapter (`codex-acp@1.1.0`) config-option surface UNVERIFIED live: this env's `~/.codex/config.toml` is broken (`unknown variant 'priority'`) and a clean `CODEX_HOME` requires interactive auth. The adapter/code degrades safely (empty option set, no picker) if codex advertises neither `model` nor `thought_level` - but whether codex advertises them at all is still owed a real live check before relying on the picker for codex panes.

## Handoffs
