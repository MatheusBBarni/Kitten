# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- ACP config surface (SDK `@agentclientprotocol/sdk@1.2.1`): `SessionConfigOption` is a discriminated union on `type: "select" | "boolean"`; select `options` is `SessionConfigSelectOption[] | SessionConfigSelectGroup[]` (group detected by absence of `"value"` key). `category` is nullable/opaque. Both `config_option_update` and `SetSessionConfigOptionResponse`/`newSession` carry the FULL option set, not a delta.
- The adapter helper `translateConfigOptions` (in `acpTranslate.ts`, currently module-private) is the single ACP→`ConfigOption[]` mapper: it skips booleans, flattens groups, defaults absent category to `""`. For task_03, export it and reuse for the `setSessionConfigOption` response and `newSession.configOptions` capture instead of re-mapping.

## Open Risks

## Handoffs
