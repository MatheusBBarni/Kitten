## Overview

Transform Kitten into a two-application Bun monorepo for an individual developer who needs both live Cockpit sessions and governed unattended coding work. V1 is deliberately narrow: move Cockpit into the workspace while preserving every published behavior and prove its existing contract matrix before importing the desktop product. This is a strategic foundation, not a redesign or an automation expansion.

### Summary / Differentiator

The product bet is governed unattended work: durable evidence, bounded authority, review-controlled publication, and explicit cross-app handoffs. Competitors normalize asynchronous coding agents; Kitten differentiates by making trust and verifiable parity first-class.

## Problem

The current Cockpit is a root-owned public CLI with tightly coupled source paths, package metadata, config resolution, native builds, installer, and release contracts. A mechanical move risks breaking the very experience existing users rely on before the desktop predecessor can be safely migrated.

Developers increasingly expect agents to work asynchronously, expose progress, accept steering, and arrive in normal PR review. But confidence remains the adoption constraint: 46% of developers in Stack Overflow’s 2025 survey distrust AI accuracy, while 86.9% report accuracy concerns and 81.4% security/privacy concerns. Kitten should therefore earn broader autonomy through parity and evidence, not bundle it into the first repository change.

### Market Data

- GitHub Copilot’s coding agent establishes issue-assignment, concurrent execution, transparent progress, steering, and PR review as baseline expectations ([GitHub documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview)).
- Cursor warns that unattended background agents with terminal and internet access create prompt-injection and exfiltration risk ([Cursor documentation](https://docs.cursor.com/background-agent)).
- Agent use is meaningful—84% of surveyed agent users use them for software engineering—yet trust and safety concerns support a review-and-evidence product ([Stack Overflow 2025 AI survey](https://survey.stackoverflow.co/2025/ai/)).

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Cockpit workspace parity | Critical | Convert the root into a private Bun workspace while retaining Cockpit’s public package, CLI, config behavior, source tests, self-check, installer, binaries, and release contract. |
| F2 | Evidence-gated migration | Critical | Require the complete Cockpit automated contract matrix before importing Orchestrator; record inherited failures rather than masking them. |
| F3 | Independent application boundaries | High | Keep Cockpit and Orchestrator entry points, UI runtimes, stores, persistence, tests, and releases separate; share only stable, JSX-free capabilities. |
| F4 | Parity-first Orchestrator import | High | Import Task Orchestrator history and behavior without redesign, preserving its trusted-folder, queue, worktree, gate, review, and rollback contracts. |
| F5 | Governed execution and continuity | Medium | After parity, deliver certified execution routes, durable work/attempt evidence, bounded clarification, and reviewed Cross-App Handoffs without live-session sharing. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Cockpit contract preservation | 100% of the pre-move Cockpit contract suite passes, or every inherited exception is explicitly recorded before phase advance | Compare a recorded baseline with the post-move test matrix. |
| Native artifact parity | 4/4 supported platform artifacts build and pass compiled `--self-check` | Release workflow artifacts and smoke-test logs. |
| Published package parity | 5/5 published package surfaces remain valid (shim plus four native packages) | Existing package-shim and npm-launcher integration contracts. |
| Config compatibility | 0 undocumented behavior changes across the three supported config-path precedence cases | Config-loader contract tests and a migration checklist. |
| Post-parity learning | 1 representative live Cockpit workflow documented before broad cross-app investment | Recorded acceptance walkthrough and evidence link. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Strong |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Strategic Bet**. The first delivery is foundational, but its evidence and boundaries compound into safer later delivery.

## Council Insights

- **Recommended approach:** deliver the narrow, contract-preserving Cockpit workspace conversion first; use the automated parity matrix as the formal engineering unlock.
- **Key trade-offs:** fastest visible Orchestrator value versus reversible migration evidence; automated confidence versus real-user learning; shared capabilities versus accidental lifecycle coupling.
- **Risks identified:** root-path and native-release drift, scope creep, and mistaking parity for product validation. Mitigate through explicit exclusions, contract evidence, and a separate lightweight learning signal before broader investment.
- **Stretch goal (V2+):** an explicitly reviewed Cross-App Handoff learning slice that tests trust and continuity without shared live-session ownership.

## Out of Scope (V1)

- **Task Orchestrator import or redesign** — must follow Cockpit parity and preserve predecessor behavior rather than combine migration with redesign.
- **Shared controller, store, UI, database, or release train** — would violate independent application ownership and expand blast radius.
- **Shared-capability extraction** — defer until duplication and stable boundaries are proven in both apps.
- **Direct ACP rollout, Compozy governance changes, autonomous delegation, parallel scheduling, auto-merge, or deploy** — these change the unattended-work trust model and require separate refinement.
- **Archiving Task Orchestrator** — requires later history, data-import, certification, release, and retirement evidence.

## Architecture Decision Records

- [ADR-001: Gate the two-app migration on Cockpit workspace parity](adrs/adr-001.md) — use full Cockpit contract parity as the formal Phase-1 unlock.

## Open Questions

- Which representative live Cockpit workflow should supplement the automated parity evidence?
- What exact user outcome and measurement will gate investment after the first reviewed Cross-App Handoff learning slice?
- What source-to-destination history mapping and supported predecessor schema inventory will define the import contract?
- Which already-planned Kitten work must complete before Phase 1 is scheduled?

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| `package.json`, `bin/`, `scripts/`, `src/`, `test/` | Preserve Cockpit’s public package and root-coupled contract surface as it moves into an app package. |
| `src/config/configLoader.ts` | Preserve strict config resolution and failure behavior. |
| `.github/workflows/release.yml` | Preserve four-platform binary, package, and smoke-test evidence while enabling later independent releases. |
| Existing ADRs 0006–0018 | Enforce app separation, parity-first import, independent data/releases, and reviewed handoffs. |
