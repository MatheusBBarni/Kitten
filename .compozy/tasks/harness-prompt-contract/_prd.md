# PRD: Versioned Kitten Harness Prompt Contract

## Overview

Kitten needs one concise, versioned contract for the stable host guidance associated with fresh ACP sessions. Today, maintainers have no single artifact to review, so future guidance could drift across provider behavior, hide meaningful changes, or imply permissions that Kitten has not granted.

This release serves Kitten maintainers, reviewers, and security-minded feature owners first. It establishes a canonical, provider-neutral contract with clear version behavior and review evidence. Developers benefit in the next delivery card, #19; this PRD does not promise immediate changes to a live agent session.

The value is trust through clarity: reviewers can see exactly what the host guidance says, distinguish semantic changes from editorial edits, and know that an unsupported version was not silently replaced.

## Goals

- Give maintainers one canonical, concise base contract for stable Kitten host guidance, capped at 150 tokens.
- Make every supported contract version reproducible and easy to review as rendered text.
- Require every contract change to show an exact rendered diff and declare whether it changes behavioral meaning.
- Make unsupported requested versions explicit rather than silently falling back to newer guidance or no guidance.
- Preserve Kitten's trust boundary: the contract is guidance only; real permission and confirmation controls remain authoritative.
- Establish a bounded future path for confirmed capability guidance without shipping dynamic or user-configurable content in V1.

Timeline: #18 is the reviewer-first foundation. #19 follows with fresh-session delivery, and #20 follows with evidence-gated capability-specific guidance.

## User Stories

Primary persona — Kitten maintainer:

- As a maintainer, I want one canonical version of stable host guidance, so that I can change it deliberately instead of searching through scattered instructions.
- As a maintainer, I want the exact rendered contract and a behavior-impact classification in review, so that I can distinguish an editorial correction from a change in what Kitten asks agents to do.
- As a maintainer, I want an unsupported requested version to be explicit, so that I never accidentally approve a different contract than the one intended.

Secondary persona — security and reliability reviewer:

- As a reviewer, I want the contract to state that host controls remain authoritative, so that guidance cannot be mistaken for a permission or security boundary.
- As a reviewer, I want the base contract to contain no user, repository, transcript, provider, environment, or credential content, so that its safety properties are inspectable.

Future beneficiary — Kitten developer:

- As a developer using Kitten, I want future fresh sessions to receive consistent, truthful host guidance, so that agent behavior reflects confirmed Kitten capabilities without changing my visible messages or permissions. This outcome is delivered by #19 and #20, not this release.

## Core Features

Critical:

- **Canonical base contract.** One concise `v1` host-guidance artifact states only universally true behavior: Kitten is the host, repository instructions and user requests retain normal precedence, agents report and verify results honestly, real confirmation controls remain authoritative, and agents use only exposed capabilities.
- **Reviewable version lifecycle.** Each supported version has a stable rendered form. Reviewers receive the complete rendered change and a clear classification of its behavioral effect. Meaning-changing edits create a new version; purely editorial corrections retain the version while remaining visible in review.
- **Explicit unsupported-version outcome.** If a requested version is unavailable, Kitten presents that state explicitly. It never silently substitutes the newest contract, omits guidance without notice, or redefines the requested behavior.
- **Guidance-only trust boundary.** The contract expressly avoids authorization claims, permission grants, security guarantees, or statements about unavailable tools and workflows.

High:

- **Bounded future guidance path.** V1 reserves a small, reviewable path for future static capability guidance. It ships no optional guidance, accepts no user-configurable text, and keeps any later capability claim contingent on confirmed evidence.
- **Content-free accountability metadata.** Any future contract status may identify the contract version, stable guidance identifiers, count, and fixed outcome category, but never the guidance body, user content, repository content, transcript, paths, environment values, or credentials.

## User Experience

Maintainer workflow: a maintainer opens the single canonical contract when proposing a change. The review shows the exact rendered before-and-after text, the affected version, and a short classification: editorial only or behavior-changing. A behavior-changing edit is visibly a new version rather than an invisible rewrite.

Review workflow: a security or reliability reviewer can confirm from the artifact itself that the base remains concise, static, provider-neutral, content-free, and guidance-only. The reviewer does not need to infer hidden tool permissions or provider assumptions from the wording.

Unsupported version workflow: when a reviewer or future feature requests a version Kitten does not support, the result is explicit and actionable. The experience never substitutes a newer contract behind the reviewer’s back.

Developer experience: this phase intentionally adds no prompt editor, visible transcript entry, permission bypass, or new interaction. Release notes explain that the contract is a reviewed foundation; #19 introduces consistent fresh-session delivery later.

Discoverability and accessibility: the contract and version policy are readable as ordinary project artifacts. Review evidence is textual and complete, not dependent on color, hover state, or provider-specific tooling.

## High-Level Technical Constraints

- The base contract must remain provider-neutral, deterministic, and independent of agent-session transport behavior.
- The base contract may contain only reviewed static guidance. It must not include user requests, repository files, transcripts, provider output, configuration text, paths, environment values, credentials, or secrets.
- Contract wording and delimiters are for clear review only; they cannot grant permissions, override confirmation flows, or function as a prompt-injection defense.
- The release must preserve the separation between this contract, later session delivery (#19), and later confirmed-capability guidance (#20).
- Any future status evidence must remain content-free and must not expose the contract body by default.

## Non-Goals (Out of Scope)

- Delivering the contract into ACP sessions, including first-prompt timing, retries, resume, replacement, or exactly-once behavior — #19 owns these outcomes.
- Changing visible transcripts, prompt history, handoff bundles, or user-facing session controls.
- Discovering, inferring, or selecting runtime capabilities and optional guidance — #20 owns this work.
- Provider-specific instruction formats or behavior profiles.
- A user-facing prompt editor, arbitrary configuration text, or dynamic content in the base contract.
- Using contract wording as authorization, a permission grant, a security guarantee, or a complete prompt-injection defense.
- Copying RepoPrompt wording or embedding repository-context strategies in the base contract.

## Phased Rollout Plan

### MVP (Phase 1)

- Publish the concise, canonical `v1` contract and its explicit version policy.
- Establish reviewer-visible rendered output, behavior-impact classification, and an explicit unsupported-version outcome.
- State and enforce the guidance-only, content-free boundary.

Success criteria to proceed to Phase 2:

- Every supported contract version has a canonical reviewable rendering.
- Every contract change is classified as editorial or behavior-changing.
- Unsupported-version handling is explicit in the product contract.
- The release contains no dynamic base content and makes no authorization claim.

### Phase 2

- Deliver the approved contract once to each genuinely fresh agent session through #19.
- Preserve the user-visible transcript, prompt history, handoffs, and real permission controls while delivery occurs.

Success criteria to proceed to Phase 3:

- Developers receive consistent base guidance in fresh sessions without duplicate or visible hidden content.
- Loaded and follow-up sessions preserve their existing history without unwanted guidance insertion.
- Delivery status remains explainable without exposing prompt or repository content.

### Phase 3

- Add confirmed-capability guidance through #20, using the V1 boundary without changing the base contract.
- Enable only guidance that corresponds to a verified available capability.

Long-term success criteria:

- Sessions with no confirmed optional capability receive the valid base contract.
- No session is told that an unavailable tool, permission, role, or workflow exists.
- Contract growth remains concise, attributable, and reviewable as features evolve.

## Success Metrics

| Metric | Target | Review cadence |
| --- | ---: | --- |
| Base-contract size | <=150 tokens | Every contract change |
| Supported versions with a canonical rendered form | 100% | Every release |
| Contract changes with rendered diff and behavior-impact classification | 100% | Every review |
| Unsupported-version requests silently substituted | 0 | Every release and review |
| Dynamic or sensitive content fields in the base contract | 0 | Every review |
| Unverified optional capability claims in V1 | 0 | Every release |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Stakeholders expect immediate agent behavior changes | State clearly in release notes and the contract policy that #18 establishes the reviewer-first foundation; #19 delivers runtime behavior. |
| Reviewers mistake guidance for authorization or a security guarantee | Use explicit guidance-only language and name Kitten's real host controls as authoritative. |
| The contract grows into an unreadable instruction manual | Keep the base at 150 tokens, defer optional capability guidance, and require visible change classification. |
| A later feature claims capabilities that are not available | Reserve optional guidance for #20, where claims are gated on confirmed evidence. |
| Version changes become opaque or silently alter behavior | Require canonical rendered output, impact classification, and explicit unsupported status rather than automatic fallback. |

## Architecture Decision Records

- [ADR-001: Keep the Harness Contract Static, Deterministic, and Narrowly Extensible](adrs/adr-001.md) — keeps the base contract static and deterministic while reserving a narrow future extension boundary.
- [ADR-002: Release the Harness Contract as a Reviewer-First Foundation](adrs/adr-002.md) — makes reviewability the immediate product outcome and defers runtime delivery to #19.

## Open Questions

- After #19 is available, what baseline and observation window should Kitten use to measure whether the guidance improves honest verification behavior without over-attributing outcomes to prompt text alone?
- Before #20 enables optional guidance, which release-communication format best explains the difference between confirmed, absent, and unknown capabilities to maintainers?
