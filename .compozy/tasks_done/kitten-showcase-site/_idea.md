# Kitten Showcase Site

## Overview

Create a focused Astro landing page on GitHub Pages that explains Kitten, proves its cross-agent handoff workflow, and persuades individual Claude Code or Codex users to install it.

V1 is a single conversion-focused page—not a documentation platform or community hub. Installation is the primary action; an accurate GitHub star count provides secondary community proof.

## Summary / Differentiator

**Hand a live coding task between Claude Code and Codex without blind copy-paste—and review exactly what crosses over.**

Kitten is not another coding agent. It is a terminal cockpit that keeps agent sessions live and transfers bounded task context through an editable, redacted, user-confirmed handoff.

## Problem

Developers who move work between coding agents must manually reconstruct context: conversation history, relevant files, and pending changes. This is slow, incomplete, and risky. Kitten solves that problem, but its value is difficult to understand from repository text alone because the differentiator is a temporal workflow—prepare, review, confirm, continue.

The project currently lacks a public product surface, authentic demonstration, and clear conversion path. First-time visitors cannot quickly see what Kitten does, why its handoff is safer than copy-paste, or how to try it.

Competitors such as [Conductor](https://www.conductor.build/), [OpenADE](https://openade.ai/), and [Paneflow](https://paneflow.dev/) already market multi-agent development. Generic “multiple agents” positioning is therefore insufficient. Kitten must lead with its reviewable handoff and demonstrate it visibly.

### Market Data

The [2025 Stack Overflow Developer Survey](https://survey.stackoverflow.co/2025) reports that 84% of respondents use or plan to use AI development tools. Adoption is high, but trust remains weak: only about one-third trust AI accuracy, while “almost right” output remains a leading frustration.

Google's [2025 DORA research](https://research.google/pubs/dora-2025-state-of-ai-assisted-software-development-report/) found 90% AI adoption among surveyed technology professionals and widespread productivity gains, while concluding that AI amplifies the quality of the surrounding workflow. This supports positioning Kitten around control and coordination—not generic AI capability.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Outcome-led hero | Critical | Immediately explain the reviewed Claude Code-to-Codex handoff and present installation as the primary action. |
| F2 | Authentic handoff proof | Critical | Show a 20–30 second real recording annotated around prepare, review, and confirm, ending with the receiving agent continuing the task. |
| F3 | Install conversion | Critical | Provide one prominent, copyable, verified installation command. Never advertise unavailable npm, curl, or release methods. |
| F4 | GitHub star control | Critical | Display a secondary “Star on GitHub” control with the accurate repository count sourced from GitHub and linked to the repository. Never fabricate a zero when retrieval fails. |
| F5 | Capability and trust story | High | Explain bounded context, touched files, pending diffs, editing and trimming, explicit confirmation, secret redaction, and live agent sessions. |
| F6 | Requirements and FAQ | High | State supported agents, authentication expectations, Bun or release requirements, Git-repository requirement, privacy behavior, and common setup constraints. |
| F7 | Privacy-conscious measurement | High | Measure aggregate install actions and proof engagement without cookies, fingerprints, persistent identifiers, cross-site tracking, or third-party analytics. |
| F8 | Accessible static experience | High | Deliver a fast, responsive page whose CTAs, recording, annotations, and star control remain usable with keyboards, reduced motion, and assistive technology. |

## Integration With Existing Features

| Integration Point | How |
| --- | --- |
| Handoff workflow | The demonstration and primary product narrative use the existing assemble → preview → confirm → switch flow. |
| Secret redaction | Trust copy accurately explains that bundles are redacted before preview. |
| Local telemetry | Website copy distinguishes site measurement from Kitten's opt-in, local-only application telemetry. |
| Existing visual identity | Reuse Kitten's dark surfaces, yellow accent, neutral text, border tokens, and kitten icon. |
| GitHub repository | Link the repository and retrieve its public `stargazers_count` through GitHub-supported repository data. [GitHub documentation](https://docs.github.com/en/rest/repos/repos#get-a-repository) |
| GitHub Pages | Publish the static Astro experience through the supported Pages workflow. [Astro documentation](https://github.com/withastro/docs/blob/main/src/content/docs/en/guides/deploy/github.mdx) |

## KPIs

Initial targets cover the first 30 days after launch.

| KPI | Target | How to Measure |
| --- | ---: | --- |
| Qualified install-intent conversion | ≥12 install actions per 100 page sessions | Aggregate install-command copies and install CTA activations, deduplicated within the page session without persistent identifiers. |
| GitHub growth | ≥25 net-new stars | Record the public GitHub star count at launch and compare daily snapshots after 30 days. |
| Product comprehension | ≥8 of 10 target users | After 30 seconds on the page, ask test users to describe Kitten and its handoff without prompting. |
| Proof engagement | ≥40% of page sessions | Aggregate recording starts or entries into the annotated proof section. |
| Onboarding clarity | ≤20% of launch feedback | Classify the first 20 substantive feedback items and issues; count those caused by unclear requirements or installation. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What percentage of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set Kitten apart? | Strong |
| **Defensibility** | Is this difficult to copy? | Pass |
| **Feasibility** | Can this be built successfully? | Must do |

**Leverage type:** Quick Win

## Council Insights

- **Recommended approach:** Build one proof-led page around the reviewed handoff, an authentic annotated recording, a verified install action, and accurate GitHub community proof.
- **Key trade-offs:** A low star count may create negative social proof, but the explicit requirement favors transparency. Keep it secondary. Conversion measurement is valuable, but it must not weaken Kitten's privacy story. An annotated recording offers most of the explanatory value of an interactive simulator at substantially lower scope.
- **Risks identified:** Broken installation commands, unsupported claims based on unreleased work, ambiguous open-source licensing, unreliable GitHub data, privacy drift, and a staged demonstration that fails to prove the real workflow.
- **Dissent:** Most advisors recommended hiding the numeric count until it reaches 25–50 stars. The selected direction keeps the accurate count from launch.
- **Stretch goal:** Build an accessible interactive handoff lab if user testing shows that the annotated recording cannot communicate the workflow.

## Out of Scope (V1)

- **Documentation portal** — the initial page validates acquisition and comprehension, not long-form support content.
- **Interactive handoff simulator** — adds significant implementation and accessibility scope before its value is proven.
- **Blog, changelog, and roadmap** — create recurring editorial obligations unrelated to the initial conversion hypothesis.
- **Community accounts or waitlist** — unnecessary because Kitten will be publicly available.
- **Competitor comparison matrix** — risks unverified claims and distracts from direct product proof.
- **Testimonials and fabricated usage statistics** — no credible evidence exists yet.
- **Packaging redesign** — npm naming, signed installers, and broader distribution are separate initiatives; the site advertises only methods that work.
- **Unreleased capabilities** — multi-session branch features and other unfinished work must not appear as available functionality.
- **Third-party behavioral analytics** — conflicts with the trust positioning and expands privacy scope.
- **Backend application services** — V1 remains a static Astro site.

## Architecture Decision Records

- [ADR-001: Build a Focused Proof-Led Astro Showcase](adrs/adr-001.md) — Selects the original focused landing page, accurate GitHub count, annotated proof, and privacy-conscious measurement while excluding the three opportunity-scan alternatives.

## Open Questions

- Which installation method will be verified and promoted at launch: running from source or a completed release artifact?
- Which open-source license will Kitten use before the repository becomes public?
- What stable task scenario will the authentic handoff recording demonstrate?
- Will V1 use the GitHub Pages project URL or a custom domain?
- What privacy-preserving measurement mechanism can satisfy the KPI requirements on a static site?
- Which recently verified value should appear if live GitHub retrieval temporarily fails?
