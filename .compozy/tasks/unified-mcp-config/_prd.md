# PRD: Unified MCP Configuration for Kitten

## Overview

Kitten runs Claude Code and Codex side by side with a one-keystroke hand-off between them.
MCP (Model Context Protocol) servers give those agents their tools, but today each agent is configured separately, in a different format, so users duplicate setup and the two configurations drift.
When they drift, a hand-off can land on an agent missing a tool the other had, which breaks the exact flow Kitten exists to make seamless.

This feature lets a user declare MCP servers once in Kitten's config, and Kitten gives both agents the same tools automatically on launch.
It is for developers who run both agents through Kitten and depend on MCP tools.
The value is a single source of truth: no duplicate setup, and tool parity across agents by construction rather than by discipline.

## Goals

- Eliminate duplicate, per-agent MCP setup: a user declares servers once and both agents have them.
- Guarantee tool parity across agents so a hand-off never lands on a tool-poor agent.
- Keep the cockpit trustworthy: no plaintext secrets in Kitten's config, no blocked startup, and visible confirmation of what loaded.
- Ship as a focused quick-win that does not slow startup.
- Milestones: V1 is guarded-parity injection; V2 adds standalone persistence and per-agent control.

## User Stories

**Primary persona - the multi-agent developer** (runs Claude Code and Codex through Kitten, relies on MCP tools):

- As a multi-agent developer, I want to declare my MCP servers once so that both agents have the same tools without configuring each separately.
- As a developer handing a task between agents, I want both agents to expose the same tools so that a hand-off never breaks because the receiving agent lacks a tool.
- As a security-conscious user, I want to reference my API keys from environment variables so that I never store raw secrets in a config file.
- As a user, I want to see which MCP servers loaded in each agent so that I can trust the setup worked and spot anything skipped.
- As a user editing my config, I want changes to take effect on the next launch so that behavior is predictable.

**Secondary / edge cases:**

- As a user whose server is not supported by one agent's transport, I want that server skipped with a warning rather than a crash so that the cockpit still opens.
- As a user with a typo or an unresolved environment reference, I want a clear warning that names the server so that I can fix it quickly.

## Core Features

| # | Feature | Priority | What it does |
| --- | --- | --- | --- |
| F1 | Declare-once MCP list | Critical | One MCP server list in Kitten's config is the single place a user defines tools for all agents. |
| F2 | Automatic cross-agent provisioning | Critical | On launch, Kitten gives both agents the declared, compatible servers, with no per-agent setup. |
| F3 | Environment-reference secrets | Critical | The config references environment variables for secret values; Kitten resolves them at launch and never stores raw secrets. |
| F4 | Loaded-servers readout | High | A per-agent view (in selfcheck and status) of which servers loaded, warning on any skipped or failed; startup is never blocked. |
| F5 | Capability-aware provisioning | High | Only servers an agent can actually use are sent to it; unsupported ones are skipped with a warning. Standard stdio tools work everywhere. |
| F6 | Setup documentation and example | Medium | Documentation and a commented example config so a user can author the list by hand with confidence. |

## User Experience

The persona's goal is to get the same MCP tools into both agents from one declaration.

**Primary flow:**

1. The user opens Kitten's config and adds an MCP server entry (name, launch command, arguments, and env values expressed as `${VAR}` references), guided by the documented example.
2. The user sets any referenced environment variables in their shell.
3. The user launches Kitten.
4. Kitten provisions the compatible servers into both agents at startup.
5. The status and selfcheck views show, per agent, which servers loaded, and warn on anything skipped or failed.
6. The user works with the tools in either agent and hands off between them knowing both share the same toolset.

**Discoverability and onboarding:** a documented config location and a commented example; `selfcheck` reports MCP status so a user can verify the setup without opening the cockpit.
**Accessibility:** the readout is text-based and follows the existing TUI status conventions.

## High-Level Technical Constraints

- Provisioning happens through the mechanism Kitten already uses to launch agent sessions; it does not modify the agents' own config files (per ADR-001).
- Standard stdio MCP servers are the guaranteed baseline; remote (http/sse) servers depend on an agent advertising support and are out of V1 scope.
- Data privacy: secret values are referenced from the environment, never stored in Kitten's config; MCP env values and auth headers are redacted from logs and telemetry.
- Performance: MCP provisioning must not meaningfully slow startup, staying within the existing under-60-second time-to-first-response budget.
- A release gate must confirm that the pinned agent adapters actually honor provisioned servers before the feature ships.

## Non-Goals (Out of Scope)

- **Standalone persistence** (writing MCP config into the agents' own files so tools work when running an agent outside Kitten) - deferred to V2; highest risk, not needed for in-cockpit parity.
- **Remote (http/sse) MCP transports** - stdio baseline first.
- **Per-agent MCP assignment** (different lists per agent) - global list in V1; a per-agent exclude is a V2 refinement.
- **Interactive MCP management UI** (add / remove / toggle inside the cockpit) - config-file driven in V1.
- **OAuth or interactive MCP authentication flows.**
- **Live hot-reload** of the config - changes apply on the next launch.

## Phased Rollout Plan

### MVP (Phase 1)

Declare-once list, automatic cross-agent provisioning, environment-reference secrets, loaded-servers readout (warn, never block), capability-aware provisioning, documentation and example, and the release smoke-test gate.
Success criteria to proceed: pinned adapters pass the smoke test; declared stdio servers appear in both agents; no plaintext secrets in config; startup budget preserved.

### Phase 2

Opt-in standalone persistence (consented, safe writes into each agent's own config) plus a per-agent exclude.
Success criteria: users can opt in to standalone use without config corruption, and per-agent differences are supported.

### Phase 3

An MCP control-plane experience: in-cockpit add / enable / disable, health and status, and remote transports.
Long-term success: Kitten becomes the primary place users manage MCP across their agents.

## Success Metrics

| Metric | Target |
| --- | --- |
| Manual per-agent MCP edits after adopting | 0 |
| Cross-agent parity of declared compatible stdio servers | 100% available in both agents |
| Pinned adapters passing the release smoke test | 100% (gate) |
| Added startup cost | < 150ms, within the under-60s budget |
| Time from config edit to working tools in both agents | < 60s (one restart) |
| Secrets written to Kitten's config in plaintext | 0 (environment-reference only) |

## Risks and Mitigations

- **Adoption / discoverability:** users may not find the config or may resist hand-editing it. Mitigation: clear docs, a commented example, and `selfcheck` visibility; a helper command remains a future option.
- **Expectation gap:** users want MCPs to work standalone, but V1 is in-Kitten only. Mitigation: the UI is honest about scope, and standalone persistence is a committed, communicated V2.
- **Trust:** a feature that touches agent tooling could feel invasive. Mitigation: V1 writes no files, references secrets rather than storing them, and never blocks startup.
- **Competitive:** registry or proxy tools could add cross-agent sync. Mitigation: Kitten's ownership of both agents' session lifecycle is a defensible angle; ship the unoccupied niche now.
- **External dependency:** upstream adapters may change whether they honor provisioned servers. Mitigation: pinned adapter versions plus a smoke-test gate that re-runs on version bumps.

## Architecture Decision Records

- [ADR-001: MCP Propagation Mechanism](adrs/adr-001.md) - V1 provisions MCP servers through the agent session, not by writing agent config files.
- [ADR-002: V1 Product Scope](adrs/adr-002.md) - guarded parity with a single global MCP list.

## Open Questions

- Should the loaded-servers readout live in the status strip, in `selfcheck`, or both? (Leaning both; confirm during design.)
- When should the per-agent exclude ship: early V2, or sooner if demand appears?
- What is the exact user-facing wording for a skipped or failed server so it is actionable without revealing secret values?
- Should V1 generate an example config stub on first run, or rely on documentation only? (Leaning docs only.)
