# Cursor ACP Readiness and Truthful Model Controls

## Overview

Restore Cursor as a trustworthy local Kitten provider for macOS Cursor subscribers. V1 certifies exactly one reviewed `agent acp` configuration after a successful native lifecycle, keeps all unreviewed configurations fail-closed, explains recovery states accurately, and exposes model or reasoning controls only when the live ACP session advertises them. It is an evidence-led quick win, not a broad Cursor compatibility program.

## Summary / Differentiator

Kitten’s differentiator is not another Cursor terminal UI. It is an honest multi-agent cockpit: each local provider is visibly ready, recoverable when it is not, and controlled only through the capabilities negotiated by its own live session.

## Problem

A correctly installed Cursor CLI currently cannot become ready in Kitten because no Cursor runtime profile is certified. The safety behavior is correct, but the model selector masks the actual cause with a generic notice about missing model and reasoning options. A developer sees a configuration limitation when the real problem is a blocked native lifecycle.

The local-agent market makes this distinction consequential. Cursor, Claude Code, Gemini CLI, and Copilot CLI all make installation, authentication, permission, and session state explicit. Cursor's CLI has changed rapidly during 2026, while its public documentation does not establish a stable ACP compatibility promise. Kitten must therefore prove one exact path rather than infer support from discovery or direct-CLI flags.

### Market Data

GitHub reports that more than 1.1 million public repositories use an LLM SDK, up 178% year-over-year; it also reports that nearly 80% of new developers use Copilot in their first week. These are ecosystem signals, not Kitten adoption estimates, but they support treating visible, controllable agent readiness as baseline developer-tool hygiene. [GitHub Octoverse 2025](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)

Cursor made `agent` its primary CLI command in January 2026 and continues to add agent controls. ACP’s client/server model is designed for custom clients that launch and manage local agents over stdio, which fits Kitten’s cockpit role without terminal scraping. [Cursor CLI update](https://cursor.com/changelog/cli-jan-08-2026) · [ACP architecture](https://agentclientprotocol.com/get-started/architecture)

## Core Features

| # | Feature | Priority | Description |
|---|---|---|---|
| F1 | Evidence-gated Cursor profile | Critical | Mark one local macOS Cursor configuration supported only after reviewed, content-free proof of the exact executable/runtime, native login, ACP initialization, session creation, and completed prompt. |
| F2 | Truthful readiness and recovery | Critical | Replace the generic empty-options state for an unready Cursor session with its normalized cause and concrete local recovery action; keep Claude Code and Codex unaffected. |
| F3 | ACP-authoritative model controls | High | Render and apply model or reasoning choices only when the ready Cursor ACP session advertises supported options; make absent capability explicit. |
| F4 | Revocable support snapshot | High | Treat certification as a named, reviewable evidence snapshot that is renewed or revoked when the local runtime changes—not a version-range compatibility promise. |
| F5 | Accurate local onboarding | Medium | Explain the local `agent acp` requirement and recovery path without implying cloud/background Cursor, credential storage, or direct-CLI control of a live ACP session. |

## Integration with Existing Features

| Integration Point | How |
|---|---|
| Runtime-profile and readiness gates | Preserve exact-profile, fail-closed validation and per-agent degradation. |
| Native ACP lifecycle | Use the existing local lifecycle and content-free contract evidence as the support gate. |
| Model and reasoning selector | Supply a Cursor-specific recovery state when unready; retain session-advertised options as the sole ready-state source. |
| Onboarding and local telemetry | Keep guidance local and evidence/telemetry content-free and opt-in. |

## KPIs

| KPI | Target | How to Measure |
|---|---:|---|
| Certified lifecycle proof | 100% of required lifecycle gates pass for the one release candidate profile | Review the content-free native contract artifact: exact runtime, recipe, login, initialize, session creation, and prompt completion. |
| Pilot first-prompt completion | >=90% across at least 10 opt-in supported-profile attempts | Count local, content-free lifecycle outcomes by profile and first completed prompt. |
| Recovery-message fidelity | 100% of defined Cursor failure fixtures show a specific normalized recovery state | Focused selector and controller/UI tests for every supported failure class. |
| Capability-source fidelity | 0 direct-CLI-derived model or reasoning controls | Code/test audit that every displayed or applied option originates from live ACP `config_options`. |
| Regression isolation | 0 readiness regressions for Claude Code or Codex | Per-agent controller and end-to-end test suite. |

## Feature Assessment

| Criteria | Question | Score |
|---|---|---|
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Maybe |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong, evidence-gated |

Leverage type: **Quick Win with a compounding qualification path**.

## Council Insights

- **Recommended approach:** Certify one exact local Cursor profile only after a reviewed native contract succeeds; ship the accurate recovery state independently once correct, but never call it provider support.
- **Key trade-offs:** Narrow reach and recurring recertification in exchange for truthful support; immediate diagnostic value versus waiting for a complete lifecycle proof.
- **Risks identified:** Runtime drift, expired login, unsupported ACP option changes, sensitive contract artifacts, and a stale “certified” claim. Mitigate through fail-closed matching, native authentication, content-free evidence, explicit unavailable states, and revocation/renewal ownership.
- **Stretch goal (V2+):** A reusable, content-free provider-qualification pipeline that creates reviewable support snapshots across providers without widening default trust.

## Out of Scope (V1)

- **Cursor cloud or background agents** — the value is a local ACP lifecycle, not a parallel hosted-agent product.
- **Credential storage or API-key collection in Kitten** — authentication remains in Cursor’s native flow.
- **`agent --list-models` or `--model` as live ACP controls** — they are not verified sources for an existing ACP session.
- **Version ranges or auto-certification** — support stays tied to reviewed evidence for one exact local configuration.
- **General provider qualification platform** — defer the reusable pipeline until the Cursor path proves demand and operating cost.
- **Terminal-only Cursor command dialogs** — Kitten will not promise UX the ACP session does not negotiate.

## Architecture Decision Records

- [ADR-001: Keep Cursor support evidence-gated and fail closed](adrs/adr-001.md) — Define certified support as a revocable exact-profile evidence snapshot.

## Open Questions

- Which exact macOS Cursor CLI version, executable identity, architecture, and native login outcome will pass the reviewed contract?
- Does Cursor ACP support live `session/set_config_option` for its advertised model or reasoning options, and under what failure behavior?
- Who owns recertification/revocation and what review horizon is appropriate after a Cursor update?
- Will a ten-attempt opt-in pilot be available before claiming broad support?
