# Product Requirements Document: Kitten Showcase Site

## Overview

Build a public, focused landing page for Kitten that helps individual terminal developers understand and install the product. The page targets developers who already use Claude Code or Codex and need a safer, clearer way to move a live coding task between them.

The product promise is narrow and evidence-led: Kitten lets a developer prepare a bounded handoff, review and trim what moves, confirm it deliberately, and continue work with the other agent. The site must make that workflow understandable in under 30 seconds, then provide a verified installation path as the primary action.

The page will be delivered as the user-requested Astro site on GitHub Pages. It is a public-launch surface, not a product redesign, documentation hub, or marketing platform. A secondary GitHub control will display the accurate public star count once the repository is public.

## Goals

- Make at least 8 of 10 target developers able to explain Kitten's reviewed handoff after 30 seconds on the page.
- Produce at least 12 verified install-intent actions per 100 page sessions in the first 30 days.
- Gain at least 25 net-new GitHub stars in the first 30 days after public launch.
- Keep installation-related confusion to no more than 20% of the first 20 substantive launch feedback items or issues.
- Launch only when the repository is public, explicitly licensed, paired with a real handoff recording, and has one verified installation route.
- Preserve user trust by making human review, explicit confirmation, and accurate product claims more prominent than generic claims of agent speed or autonomy.

## User Stories

### Individual Developer Evaluating Kitten

- As a developer who already uses Claude Code or Codex, I want to understand exactly what Kitten adds so that I can decide whether it solves my context-switching problem.
- As a developer evaluating a new agent workflow, I want to see a real handoff before I install so that I can judge whether it preserves my control.
- As a developer ready to try Kitten, I want one clear, verified installation action so that I can start without deciphering release options.

### Trust-Sensitive Developer

- As a developer worried about sending the wrong context or secret to another agent, I want to see that I can review, edit, trim, confirm, or cancel a handoff so that I retain control.
- As a privacy-conscious developer, I want clear separation between Kitten's local opt-in telemetry and website measurement so that I can make an informed decision.

### Open-Source Visitor

- As an open-source visitor, I want an accurate GitHub star count and repository link so that I can assess and participate in the project community.
- As a visitor using a keyboard, reduced motion, or assistive technology, I want the page, demonstration, and calls to action to remain understandable and usable.

### Maintainer

- As a Kitten maintainer, I want public-facing claims to match released behavior so that launch interest does not create trust debt or support burden.

## Core Features

### 1. Focused Product Promise

The first screen must clearly communicate that Kitten supports a reviewed handoff between Claude Code and Codex. It must describe a bounded handoff rather than imply a complete transfer of all task context.

The promise must not market unreleased multi-session, fleet, or broader working-branch capabilities. It must avoid claims of automatic sending, autonomous delegation, or guaranteed secret removal.

### 2. Authentic Reviewed-Handoff Demonstration

The page must feature a real, short recording that shows the essential flow:

1. A developer initiates a handoff.
2. The developer reviews and trims the proposed context.
3. The developer explicitly confirms or can cancel the handoff.
4. The receiving agent continues the task.

The proof must make review, trimming, confirmation, and continuation more visible than raw terminal activity. It must use captions or equivalent accessible explanation and respect reduced-motion preferences.

### 3. Verified Installation Conversion

The primary CTA must lead to one tested installation route and include a copyable command or equally direct start action. The page must state the prerequisites that materially affect a visitor's ability to use Kitten.

The page must not advertise npm, curl, release, or package-install paths until each is publicly available and verified. If a supported path changes, the launch copy must change with it.

### 4. How Kitten Works and Why It Is Safer

The page must explain the bounded bundle in concrete user terms: recent conversation context, touched files, and pending changes. It must explain that the developer controls what crosses the boundary through review, editing, trimming, confirmation, and cancellation.

Trust content must accurately state that redaction occurs before preview while leaving human review as the final safeguard. It must distinguish Kitten from generic multi-agent orchestration by focusing on visible control during the handoff.

### 5. GitHub Community Proof

The page must include a secondary GitHub control with the accurate public star count and a direct repository link. The count must never be fabricated or rendered as a false zero when unavailable.

The star count is supporting proof, not the primary conversion goal. Its presentation must not overshadow the verified installation action or the product demonstration.

### 6. Requirements, FAQ, and Trust Clarification

The page must answer the evaluation questions that block a first attempt: who Kitten is for, which agents it supports, what users need before starting, what happens when one agent is unavailable, how handoff control works, and how app telemetry differs from site measurement.

This section must be concise and factual. It must not become a documentation portal or imply a support promise that the project cannot meet at launch.

### 7. Privacy-Preserving Success Signals

The page must support aggregate measurement of install-intent actions and proof engagement. These signals must not use persistent identifiers, fingerprinting, cross-site tracking, or third-party behavioral analytics.

GitHub stars, release activity, and direct launch feedback will complement the aggregate site signals. The page must disclose measurement in clear, concise language.

### 8. Accessible, Fast Evaluation Experience

The site must be readable and usable on common desktop and mobile viewports. Keyboard users and people using assistive technology must be able to reach, understand, and activate the installation and GitHub controls.

The page must prioritize the product story and real proof over decorative motion, complex interactions, or visual effects that obscure the call to action.

## User Experience

### Primary Journey

1. A developer arrives from GitHub, a community post, or a direct link.
2. The hero states the reviewed Claude Code ↔ Codex handoff and presents the primary install action.
3. The developer watches the short, annotated demonstration and understands that they retain control before anything is sent.
4. The developer scans the concise explanation of what transfers, what they can edit, and how privacy is handled.
5. The developer copies or activates the verified installation route.
6. The developer may star the repository, inspect the source, or return to the final installation CTA.

### Content and Interaction Principles

- Lead with the specific handoff outcome, not “AI coding” or generic multi-agent claims.
- Make proof visible early, close to the install action.
- Keep install as the primary visual and interaction priority.
- Use the GitHub star count as an accurate secondary trust signal.
- Use factual, calm language. Avoid inflated promises, manufactured urgency, or unsupported security claims.
- Provide captions or text alternatives for the recording and ensure every action remains keyboard accessible.

## High-Level Technical Constraints

- The public site must honor the agreed Astro and GitHub Pages delivery constraint; detailed publishing and site design belong in the TechSpec.
- The public repository must be visible before any visitor-facing GitHub star count or repository CTA is enabled.
- The site must only promote a publicly verified installation route.
- The product's local, opt-in application telemetry must remain distinct from any aggregate website measurement.
- No visitor account, sign-in, or product data submission is required for V1 evaluation or installation.

## Non-Goals (Out of Scope)

- Marketing unreleased multi-session, fleet, shell, or other broader working-branch capabilities.
- Building a documentation portal, blog, changelog, roadmap, community forum, or waitlist.
- Building an interactive handoff simulator or browser-based product clone.
- Reworking Kitten's package naming, standalone installer, or release-distribution strategy as part of this site project.
- Advertising unavailable package, curl, or release installation methods.
- Publishing competitor comparisons, testimonials, or usage statistics that lack verifiable evidence.
- Adding third-party behavioral analytics, user profiling, or cross-site tracking.
- Changing the Kitten application handoff, redaction, telemetry, or agent runtime behavior.

## Phased Rollout Plan

### MVP (Phase 1): Public Launch Surface

- Deliver the focused landing page, authentic handoff recording, primary verified installation CTA, accurate GitHub control, concise trust explanation, requirements/FAQ, and aggregate privacy-preserving measurement.
- Make the repository public with an explicit license and verify the promoted install route before publishing the page.
- **Success criteria to proceed:** all launch gates pass; the recording accurately demonstrates the real workflow; no displayed install path is broken; 8 of 10 target users can explain the handoff after 30 seconds.

### Phase 2: Evidence-Led Conversion Refinement

- Improve page copy, proof framing, prerequisites, and FAQ based on aggregate conversion signals and launch feedback.
- Resolve recurring installation confusion and remove content that does not help evaluation or installation.
- **Success criteria to proceed:** reach or establish a credible path toward 12 install-intent actions per 100 sessions, keep installation confusion below 20% of launch feedback, and validate that the narrow handoff message resonates.

### Phase 3: Selective Expansion

- Consider a richer proof experience, additional use cases, or an interactive handoff explainer only if evidence shows the recording and concise page do not meet comprehension or conversion goals.
- Consider package or installer improvements as a separate distribution initiative.
- **Success criteria:** any expansion demonstrably improves comprehension, verified installation, or sustained community growth without diluting the control-first message.

## Success Metrics

| Metric | 30-Day Target | Evidence |
| --- | ---: | --- |
| Qualified install intent | ≥12 actions per 100 page sessions | Aggregate copy and install-action events without persistent identifiers |
| GitHub community growth | ≥25 net-new stars | Public GitHub star count recorded at launch and after 30 days |
| Product comprehension | ≥8 of 10 target users | Short evaluation test after 30 seconds on the page |
| Proof engagement | ≥40% of page sessions | Aggregate demonstration starts or entries into the proof section |
| Installation clarity | ≤20% of first 20 feedback items | Categorized issues and direct feedback related to requirements or installation |

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Public page launches before the project is trustworthy to try | Visitors lose trust and cannot convert | Require public repository, explicit license, authentic recording, and verified installation before publication |
| Copy overstates what the handoff does | Support burden and credibility loss | Review all public claims against released behavior and the real recording |
| Low early star count creates weak social proof | Visitors discount the project before evaluating it | Keep the accurate count secondary and lead with direct product proof |
| Installation is unclear or unavailable | Strong interest does not become product adoption | Promote only one verified path and explain prerequisites concisely |
| The demonstration looks staged or omits review control | The differentiator remains unconvincing | Use a stable, real scenario that visibly includes review, trimming, confirmation, and continuation |
| Measurement conflicts with the local-control message | Privacy-conscious visitors lose trust | Limit data to disclosed aggregate signals and avoid user-level tracking |
| Competitors make generic multi-agent claims | Kitten is perceived as interchangeable | Anchor all content in the reviewable, bounded cross-agent handoff |

## Architecture Decision Records

- [ADR-001: Build a Focused Proof-Led Astro Showcase](adrs/adr-001.md) — Establishes the original focused landing-page scope, accurate GitHub count, annotated proof, and privacy-conscious measurement.
- [ADR-002: Center V1 on a Verified Two-Agent Handoff](adrs/adr-002.md) — Limits the public promise to the released two-agent workflow and requires launch-readiness gates before publication.

## Open Questions

- Which publicly verified installation route will be the sole primary CTA at launch?
- Which open-source license will be selected before the repository becomes public?
- What stable task scenario will best demonstrate review, trimming, confirmation, and continued work without exposing sensitive material?
- Will the public page use the default GitHub Pages address or a custom domain?
- What concise disclosure will explain aggregate website measurement without obscuring the local-only nature of Kitten's application telemetry?
- What public fallback wording should appear if the GitHub star count is temporarily unavailable?
