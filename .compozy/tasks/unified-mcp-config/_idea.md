# Unified MCP Configuration for Kitten

## Overview

Kitten runs Claude Code and Codex side by side and hands a live task between them with one keystroke.
MCP (Model Context Protocol) servers give those agents their tools, but each agent is configured separately, in a different format, so keeping the two in sync is manual and error-prone.
This feature lets a user declare MCP servers once in Kitten's config and have Kitten give both agents the same tools automatically, so there is no duplicate setup and no drift.

V1 is deliberately focused: Kitten injects the shared MCP list into each agent's ACP session on startup.
It is for developers who already run both agents through Kitten and rely on MCP tools.
It is valuable because a clean hand-off depends on both agents exposing the same capabilities, and injection makes that true by construction rather than by discipline.

## Problem

Developers increasingly run more than one coding agent, and Kitten's whole premise is running Claude Code and Codex together with a one-keystroke hand-off.
MCP is how these agents gain tools, and each agent stores its MCP configuration separately and in a different shape: Claude Code in JSON (`.mcp.json` / `~/.claude.json`), Codex in TOML (`~/.codex/config.toml`).
A user who wants the same tools in both agents must configure each one by hand and keep them aligned as servers are added or changed.

That duplicated setup is tedious, and worse, the two configurations drift.
When they drift, a hand-off can move a task to an agent missing a tool the other had, which breaks the exact flow Kitten exists to make seamless.
The current workaround is entirely manual: edit two config files in two formats, remember to update both, and hope they stay in sync.

### Market Data

- Roughly 10,000+ active public MCP servers and 97M+ monthly SDK downloads as of December 2025 (Anthropic ecosystem update).
- MCP is now cross-vendor: OpenAI adopted it (March 2025), Google confirmed Gemini support (April 2025), and Anthropic donated it to the Linux Foundation (December 2025), so syncing to both Claude and Codex is a durable bet.
- Multi-agent use is real: JetBrains' January 2026 survey put Claude Code at 18% and Codex at 3% of developers at work, with 90% using at least one AI coding tool, implying meaningful overlap.
- No existing tool (Docker MCP Toolkit, Smithery, mcphub, ToolHive, MCPM) unifies MCP across the two specific ACP coding agents Kitten runs, automatically, on launch. They are registry, installer, or proxy utilities that still require pointing each client at something.

## Summary / Differentiator

Kitten owns both agents' session lifecycle, so it can inject one shared MCP list through ACP `session/new`.
That means no proxy process, no writes into foreign config files, and no per-project approval prompts.
It is a genuinely unoccupied niche: nobody else unifies MCP across these two agents on launch.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Global `mcpServers` declaration | Critical | A single MCP list in `~/.config/kitten/config.json`, zod-validated and merged over defaults; per-server shape name, command, args, env. |
| F2 | Session-injection into every agent | Critical | Resolve the declared servers and pass them in every `session/new` (and `session/load`) for each configured agent, replacing the hardcoded empty array at `agentConnection.ts:178`. |
| F3 | Adapter-honor smoke test (release gate) | Critical | A CI test injects a trivial stdio server into each pinned adapter and asserts its tool surfaces in the session; a red gate blocks the feature and falls back to documentation. |
| F4 | ACP wire normalization | High | Resolve `command` to an absolute path via `Bun.which` with a loud skip-and-warn, and translate the env map to ACP's `{name,value}` array shape. |
| F5 | Loaded-servers readout per agent | High | A visible per-agent indication of which MCP servers actually loaded, so a silent miss is loud rather than invisible. |
| F6 | Capability-aware transport gating | High | stdio for all agents (guaranteed); detect http/sse capability at `initialize` and skip-with-warning unsupported servers. Invariant: every agent gets every compatible MCP. |
| F7 | MCP parity in selfcheck / hand-off | Medium | Surface each agent's MCP tool set in `selfcheck` and the hand-off preview so divergence is visible exactly where it matters. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Manual per-agent MCP edits after adopting | 0 | User declares once; tools appear in both agents with no per-agent file editing |
| Cross-agent MCP parity | 100% of declared compatible stdio servers live in both agents | Session tool-list assertion / `selfcheck` |
| Added startup cost | < 150ms | Boot-timing delta vs. baseline (well inside the <60s onboarding budget) |
| Adapter honor verified | 100% of pinned adapters pass the smoke test | CI gate result |
| Time to shared MCP across both agents | < 60s from config edit to working tools | Time-to-first-tool |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Must do |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Must do |

Leverage type: **Quick Win** (with a credible path to a Compounding Feature via the V2 control plane).

## Council Insights

- **Recommended approach:** Injection-only V1 over ACP: one global list injected into both agents, stdio-only, gated by a smoke test, with a per-agent loaded-servers readout and capability-aware gating. Write-to-disk persistence is deferred to an explicit opt-in V2.
- **Key trade-offs:** Ephemeral (in-Kitten only) vs. persistent/standalone; simplicity and safety vs. standalone reach; a single global list vs. intentional per-agent divergence.
- **Risks identified:** Silent no-op if an adapter ignores the array (mitigate with the smoke-test gate plus readout); ACP wire-shape mismatch (mitigate with normalization); capability divergence (mitigate with per-transport gating); a green count with the wrong tools (report server identities, not just a count).
- **Stretch goal (V2+):** Explicit opt-in persistence into each agent's own config for standalone use (atomic writes, backups, reference-only secrets, marker-enforced never-clobber), and later an MCP control-plane TUI (add / enable / disable / health).

## Out of Scope (V1)

- **Writing to agent config files / standalone persistence** - deferred to an explicit opt-in V2; it carries the highest risk (clobbering or corrupting a user's config) and is not needed for in-cockpit parity.
- **http/sse (remote) MCP transports** - gated behind advertised capability; stdio is the guaranteed baseline, so remote support waits until a user needs it.
- **Per-agent MCP assignment (different lists per agent)** - one global list is the V1 default; a per-agent exclude is a later refinement.
- **Interactive MCP management UI (add / remove / toggle in the TUI)** - V1 is config-file driven; interactive management is the V2 control-plane stretch.
- **OAuth / interactive MCP auth flows** - out of V1; servers are declared via env or references only.

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| `configLoader.ts` / `AppConfig` | Add a top-level `mcpServers` field (schema, type, default, merge) |
| `createCockpitSession()` boot (`index.ts`) | Resolve and prepare the injected list right after `loadAppConfig()` |
| `agentConnection.newSession` | Widen to accept the resolved server list, replacing the hardcoded `[]` |
| `selfcheck` / readiness | Optionally report the MCP servers each agent loaded |
| `secretRedactor.ts` | Redact MCP env and auth headers in logs and telemetry |

## Architecture Decision Records

- [ADR-001: MCP Propagation Mechanism - ACP Session-Injection vs Writing Agent Config Files](adrs/adr-001.md) - V1 injects over ACP; write-to-disk persistence is deferred to an explicit opt-in V2.

## Open Questions

- Does `claude-agent-acp@0.57.0` honor client-provided stdio `mcpServers` at runtime? (The smoke test is the gate that confirms this.)
- Does `codex-acp@1.1.0` honor them, given reported upstream config-reliability gaps (codex issue #3441)?
- Should MCP env values be inline in Kitten's config or reference-only (`${VAR}`) from the start, to avoid creating a second plaintext-secret location even for injection?
- Should the loaded-servers readout live in the status strip, in `selfcheck`, or both?
- Should a per-agent exclude ship in V1, or wait? (The devils-advocate held firm that the global list should be an overridable default.)
