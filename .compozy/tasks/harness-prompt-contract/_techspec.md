# TechSpec: Versioned Kitten Harness Prompt Contract

## Executive Summary

Implement the PRD's reviewer-first contract as one new pure TypeScript module, `src/core/harnessPrompt.ts`, with colocated tests. The module owns the reviewed base `v1` text, supported-version constants, strict optional-block validation, deterministic rendering, escaping, and typed render outcomes. It returns protocol-free text only; it neither imports ACP nor changes the session, transcript, permission, telemetry, configuration, or UI paths.

The primary trade-off is a deliberately small generic seam versus a complete fragment platform. The renderer accepts already-selected static blocks so #20 can compose future confirmed capabilities, but it owns no registry or capability inference. This preserves an extensible contract without adding delivery behavior that belongs to #19.

## System Architecture

### Component Overview

| Component | Responsibility | Boundary |
| --- | --- | --- |
| `src/core/harnessPrompt.ts` | Owns V1 text, version recognition, block validation, escaping, ordering, bounds, and rendering. | Pure domain core; no ACP, I/O, UI, state, or telemetry imports. |
| `src/core/harnessPrompt.test.ts` | Proves exact output, semantic invariants, validation, immutability, and source boundaries. | Test-only source inspection may read the module; production code remains pure. |
| Future #19 delivery adapter | Converts rendered text to ACP prompt blocks and decides fresh-session delivery. | Consumer only; not modified by this card. |
| Future #20 composition policy | Builds the reviewed static block set from confirmed capabilities. | Producer of valid blocks only; not implemented by this card. |

Data flow for V1 is `requested version + static blocks -> renderHarnessPrompt -> rendered text or rejection`. The base is always rendered first. Valid optional blocks render after the base in lexical ID order, independent of caller order. No content crosses into `src/agent/` in this card.

### PRD-to-Component Mapping

| PRD section | Technical component or enforcement |
| --- | --- |
| Goals: canonical concise contract | Private V1 base constant and deterministic whitespace-token guard in `harnessPrompt.ts`. |
| Goals: reviewable versions and change classification | Immutable supported-version constants, exact base-only golden, and semantic assertions. |
| Goals: explicit unsupported state | `unsupported_version` typed result with no fallback. |
| Goals: guidance-only trust boundary | Static base wording plus validation and tests proving no dynamic source is introduced. |
| Core Features: bounded future guidance path | Caller-supplied `readonly HarnessBlock[]`, ID validation, lexical ordering, and block/token limits. |
| Core Features: content-free accountability | Fixed result codes and IDs only; no recorder, log, or telemetry write in V1. |

## Implementation Design

### Core Interfaces

```ts
export type HarnessPromptVersion = "v1"

export interface HarnessBlock { readonly id: string; readonly text: string }

export type HarnessRenderResult =
  | { readonly kind: "rendered"; readonly version: HarnessPromptVersion; readonly text: string; readonly blockIds: readonly string[] }
  | { readonly kind: "rejected"; readonly code: HarnessRejectCode; readonly version: string }

export type HarnessRejectCode = "unsupported_version" | "invalid_block_id" | "duplicate_block_id" | "block_limit_exceeded" | "extension_budget_exceeded" | "invalid_block_text"

export function renderHarnessPrompt(
  version: string, blocks: readonly HarnessBlock[] = [],
): HarnessRenderResult
```

`HarnessPromptVersion` is a closed union generated from the reviewed V1 constants. The public function accepts `string` so an unsupported requested version is representable and can produce `rejected` rather than an exception. `blockIds` appears only in the successful result and preserves the canonical rendered order; it is safe as content-free metadata because valid IDs are reviewed identifiers.

Validation rules:

- Recognize only `v1`; return `rejected/unsupported_version` for every other requested version and do not render a fallback.
- Allow only lowercase dot-separated IDs with printable ASCII segments. Reject empty, malformed, duplicate, or reserved base IDs.
- Accept at most 8 optional blocks and at most 800 deterministic whitespace tokens across their unescaped bodies.
- Reject empty text, carriage returns, tabs, and control or bidi characters. Preserve LF-only line breaks after trimming outer whitespace.
- Escape `&`, `<`, and `>` in optional block text before putting it inside fixed `kitten_harness_fragment` delimiters. The private reviewed base text is emitted verbatim.
- Emit exactly one base envelope, no trailing newline, and optional block envelopes separated by two LF characters.

### Data Models

| Model | Fields | Lifecycle |
| --- | --- | --- |
| Supported version catalog | `v1` and private base body | Module constant, reviewed with source changes, never persisted. |
| `HarnessBlock` | Stable `id`, reviewed static `text` | Caller-owned immutable input; V1 ships with an empty list. |
| `HarnessRenderResult` | `kind`, requested/resolved version, canonical text or fixed code, block IDs | Ephemeral return value; no storage or logging in V1. |
| Render limits | 150 base tokens, 8 blocks, 800 extension tokens | Module constants; a future change requires review and tests. |

No database, configuration file, session state, API request model, or persisted version marker is introduced. #19 may later decide whether content-free delivery metadata is necessary, but that decision is outside this TechSpec.

### API Endpoints

Not applicable. This card exposes an in-process TypeScript domain API only and adds no HTTP, CLI, ACP, or provider-facing endpoint. ACP conversion remains a future #19 adapter concern.

## Integration Points

This card has no external-service integration. Its only planned internal consumers are deliberately deferred:

- #19 consumes a successful `rendered.text` result before encoding it at the ACP boundary. It must surface or degrade a `rejected` outcome without sending an alternate hidden contract.
- #20 supplies a canonical immutable set of static `HarnessBlock` values after it has confirmed capabilities. It must not source text from user, repository, provider, environment, or configuration data.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
| --- | --- | --- | --- |
| `src/core/harnessPrompt.ts` | new | New pure domain contract; low integration risk, high review sensitivity. | Add module with constants, validation, escaping, renderer, and typed outcomes. |
| `src/core/harnessPrompt.test.ts` | new | Defines the contract's regression boundary. | Add exact, semantic, negative, determinism, and source-boundary tests. |
| `src/agent/agentConnection.ts` | unchanged | ACP prompt blocks remain adapter-owned. | Assert no import or modification in this card. |
| `src/app/actions.ts` and controller paths | unchanged | Visible prompts and session lifecycle remain #19 scope. | Assert no routing or transcript change in this card. |
| Configuration, persistence, telemetry | unchanged | V1 has no dynamic policy, stored metadata, or emitted diagnostics. | Do not add config, storage, recorder, or event changes. |

## Testing Approach

### Unit Tests

- Exact base-only golden: verify the entire V1 envelope, LF rules, tag spelling, and no trailing newline.
- Semantic base assertions: verify required host, precedence, verification, confirmation, and exposed-capability statements; verify absence of provider names, user content placeholders, and authorization claims.
- Version behavior: V1 renders; unknown, blank, and malformed versions produce only `rejected/unsupported_version`.
- Block validation: malformed, reserved, duplicate, empty, control-bearing, over-count, and over-budget inputs produce their documented fixed codes.
- Determinism: reverse caller order and frozen inputs produce equal canonical output and unchanged input values.
- Escaping and whitespace: verify `&`, `<`, and `>` are escaped; CR, tabs, bidi controls, and trailing-whitespace ambiguity are rejected or normalized as specified.
- Size discipline: verify the base is at most 150 whitespace tokens and valid extensions are at most 800 whitespace tokens.
- Layering: inspect `harnessPrompt.ts` and reject `@agentclientprotocol/sdk`, adapter-relative imports, `Bun`, `process`, timers, React, recorder, or telemetry imports.

### Integration Tests

No cross-layer integration test belongs in #18 because it must not deliver a prompt or mutate a session. Existing full-repository `bun run typecheck && bun test` remains the regression gate after the pure module tests are added. #19 owns ACP delivery integration coverage, including transcript invisibility and exactly-once lifecycle behavior.

## Development Sequencing

### Build Order

1. Add `src/core/harnessPrompt.ts` with the V1 constants, closed version type, models, bounds, and fixed rejection-code union — no dependencies.
2. Add validation, token counting, escaping, canonical ordering, and `renderHarnessPrompt` — depends on step 1's models and bounds.
3. Add base-only golden, semantic, version, block-validation, escaping, ordering, and immutability tests — depends on steps 1 and 2.
4. Add the source-boundary test and run the full typecheck/test gate — depends on steps 1 through 3.
5. Update only the contract's review documentation if required by the rendered artifact policy — depends on steps 1 through 4; do not begin #19 or #20 behavior.

### Technical Dependencies

- No new packages, services, configuration, persistence, or generated artifacts are required.
- Existing Bun, TypeScript, and colocated-test tooling are sufficient.
- #19 and #20 are downstream consumers, not blockers for #18. Their implementation must consume the frozen protocol-free contract rather than expanding this card's scope.

## Monitoring and Observability

V1 emits no telemetry or logs. Its observable surface is the content-free `HarnessRenderResult`: requested version, canonical block IDs after rendering, and a fixed rejection code. The rendered text itself must not be logged by default.

If #19 later needs diagnostics, it may record only the rendered contract version, selected block IDs/count, fresh-versus-loaded delivery decision, and fixed failure category. It must not add prompt text, repository content, transcripts, paths, environment values, adapter commands, or raw errors to this contract module.

## Technical Considerations

### Key Decisions

- **Pure TypeScript core module.** Keep contract construction in `src/core/harnessPrompt.ts`; ACP block conversion stays in the adapter. This follows the repository's anti-corruption boundary and makes output independently testable. The alternative ACP-aware renderer was rejected because it couples policy to transport.
- **Caller-supplied static blocks.** Accept blocks after a caller has selected them, but do not implement a registry or capability inference. This preserves the #20 seam while avoiding a new policy subsystem in V1. The alternative internal registry was rejected as premature scope.
- **Typed rejections rather than exceptions.** Return fixed `rejected` codes for expected invalid requests. This mirrors strict core validation and avoids future asynchronous error leakage. Silent omission and fallback were rejected because they violate the PRD's explicitness goal.
- **Deterministic whitespace-token cap.** Use a documented whitespace-token counter for the static base and extension budgets. This is stable, dependency-free, and sufficient for a reviewed fixed string. Model-specific tokenization was rejected because it adds a package and provider coupling without changing V1 behavior.
- **No V1 telemetry.** Keep result metadata content-free and ephemeral. Emission, retention, and delivery diagnostics belong to #19 once a runtime event exists.

### Known Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Future caller passes text that was not reviewed static guidance | Medium | Keep V1 block list empty; make #20's registry/evidence policy the only producer; retain strict text validation and review tests. |
| Changes to tags or whitespace create unnoticed behavioral drift | Medium | Exact golden output plus semantic assertions and change classification. |
| Future requirements exceed the eight-block or 800-token bounds | Low | Require an explicit reviewed contract change and version-impact decision rather than silent limit expansion. |
| Consumers treat prompt text as authorization | Medium | Preserve guidance-only wording and keep real permission controls outside the module. |
| Source-boundary test becomes brittle after harmless refactors | Low | Assert prohibited imports and runtime dependencies, not line order or internal implementation details. |

## Architecture Decision Records

- [ADR-001: Keep the Harness Contract Static, Deterministic, and Narrowly Extensible](adrs/adr-001.md) — establishes the static base and bounded extension principle.
- [ADR-002: Release the Harness Contract as a Reviewer-First Foundation](adrs/adr-002.md) — separates immediate review value from later runtime delivery.
- [ADR-003: Use a Pure TypeScript Renderer with Caller-Supplied Static Blocks](adrs/adr-003.md) — selects the core module, typed outcome, static-block seam, and no-storage design.
