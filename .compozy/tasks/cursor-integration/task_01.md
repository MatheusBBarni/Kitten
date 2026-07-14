---
status: pending
title: "Add Cursor provider identity and runtime-profile config"
type: backend
complexity: medium
---

# Task 01: Add Cursor provider identity and runtime-profile config

## Overview

Add Cursor to Kitten's closed provider model and resolve a sealed, protocol-free runtime profile from its final recipe. This establishes a zero-config third local session without allowing user JSON to supply authentication or certification data.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- 1. `ProviderKind`, `PROVIDER_KINDS`, provider display metadata, and default ordering MUST include `cursor`, with the zero-config order `codex`, `claude-code`, then `cursor` so Codex remains initially focused.
- 2. Cursor's built-in recipe MUST be local `agent acp` with an empty environment, and its default display name MUST be `Cursor`.
- 3. `ResolvedAgentConfig` MUST always include a protocol-free runtime profile derived from the fully merged command, ordered arguments, and environment; display labels and requested provider names MUST NOT determine certification.
- 4. User configuration MUST accept ordinary `providers.cursor` and deprecated `agents.cursor` recipe deltas while rejecting runtime-profile, authentication, certification, and version fields as unknown.
- 5. With no declared sessions, resolution MUST create the three default sessions in the launch directory with stable Cursor identity and title; explicit Cursor sessions MUST retain the standard per-session ID, cwd, title, and task behavior.
- 6. Cursor profile metadata MUST remain runtime-only and MUST NOT enter persisted user config or UI content; this task MUST NOT guess or commit a certified Cursor version.
- 7. Provider metadata consumed by UI MUST expose a typed shared compact/tab label rather than requiring a provider-specific conditional in a view.
</requirements>

## Subtasks
- [ ] 1.1 Extend the closed provider identity and shared provider metadata for Cursor.
- [ ] 1.2 Define the runtime-only standard and certified Cursor profile contract.
- [ ] 1.3 Add the default Cursor recipe and strict configuration delta validation.
- [ ] 1.4 Resolve profiles only after complete recipe merging and preserve isolated default clones.
- [ ] 1.5 Cover default, override, rejection, and three-session resolution behavior.

## Implementation Details

Follow the TechSpec sections "Data Models" and "Provider Resolution and Readiness Algorithm." Keep `src/core` protocol-free and make the unresolved default fail closed until the credentialed certification evidence exists.

### Relevant Files
- `src/core/types.ts` — closed provider identity, shared provider metadata, runtime profile, and resolved config contracts.
- `src/core/types.test.ts` — provider metadata/runtime-profile exhaustiveness and SessionId separation coverage.
- `src/config/configLoader.ts` — built-in recipes, strict schemas, clone/merge behavior, profile derivation, and zero-config session resolution.
- `src/config/configLoader.test.ts` — default, override, strict-schema, and resolved-session behavior.

### Dependent Files
- `src/config/readiness.ts` — consumes the sealed runtime profile for preflight and recovery outcomes.
- `src/agent/agentConnection.ts` — consumes the profile without importing configuration code.
- `src/config/clarificationCapability.ts` — must remain exhaustive while classifying Cursor as unsupported.
- `src/ui/StatusStrip.tsx` and `src/ui/ModelSelect.tsx` — consume shared provider metadata rather than binary provider branches.

### Related ADRs
- [ADR-001: Ship Cursor as a Certified Local Third ACP Session](adrs/adr-001.md) — first-class local provider scope.
- [ADR-002: Launch Cursor by Default as an Independently Available Third Session](adrs/adr-002.md) — zero-config ordering and sibling continuity.
- [ADR-003: Use a Certified Native Cursor ACP Profile with Adapter-Owned Login](adrs/adr-003.md) — sealed profile and no guessed certification.

## Deliverables
- Closed Cursor provider identity, typed display metadata, and runtime-profile contracts.
- Strict Cursor recipe deltas and three-session zero-config resolution.
- Fail-closed standard profile pending reviewed certification evidence.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for configuration/session resolution **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Default config includes three provider recipes and resolves Cursor metadata/profile without mutable shared args or env.
  - [ ] Cursor command, args, and env deltas retain unmodified fields while preserving clone isolation.
  - [ ] `providers.cursor.certifiedVersion`, `authenticationMethod`, and `runtimeProfile` fail strict parsing.
  - [ ] Provider constants and metadata are exhaustive for Cursor while SessionId remains a distinct per-session identity.
- Integration tests:
  - [ ] Zero-config resolution yields `codex`, `claude-code`, and `cursor` IDs, provider kinds, and titles in order.
  - [ ] An explicit Cursor session resolves its cwd, title, task, and first-session ID through the normal path.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A zero-configuration launch resolves Cursor as the third local session without user-authored credential metadata.
- Altering a Cursor recipe cannot silently create a certified runtime profile.
