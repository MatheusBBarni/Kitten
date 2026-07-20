# PRD: Cursor ACP Readiness and Truthful Model Controls

## Overview

Kitten must restore a trustworthy local Cursor path for macOS Cursor subscribers. Today, a user can select Cursor even though their local CLI is not yet certified, then receive a generic message about missing model and reasoning choices. That message describes the wrong problem: the session is not ready to advertise any capability.

V1 gives one reviewed local Cursor profile a clear support contract. A supported user can reach a ready Cursor session and complete a first coding task in Kitten. Every unsupported user sees a specific, safe recovery state that distinguishes a local action they can take from a profile that Kitten has not yet reviewed. The product never turns an installed binary, a version range, or a direct CLI option into an unverified support claim.

### Market Context

Local coding-agent products make authentication and status explicit. Cursor documents sign-in, account status, and sign-out as distinct user actions; GitHub Copilot CLI similarly names sign-in and account state; Claude Code directs users to a diagnostic after installation. This supports a product experience that explains readiness as a sequence of visible, recoverable states rather than a binary installation check. [Cursor CLI authentication](https://docs.cursor.com/en/cli/reference/authentication) · [GitHub Copilot CLI authentication](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli) · [Claude Code getting started](https://docs.anthropic.com/en/docs/claude-code/getting-started)

Cursor's CLI remains in beta and changed its primary command in January 2026. ACP also bases optional features on a live handshake and exchanged capabilities. These facts support an exact-profile, session-authoritative support promise rather than inferred compatibility. [Cursor CLI overview](https://docs.cursor.com/en/cli/overview) · [Cursor CLI update](https://cursor.com/changelog/cli-jan-08-2026) · [ACP architecture](https://agentclientprotocol.com/get-started/architecture)

## Goals

- Let a supported local macOS Cursor subscriber complete a first coding task in Kitten without a misleading readiness or model-control state.
- Give every blocked Cursor user a concise explanation of the actual state and their next safe action.
- Make the first support claim narrow and trustworthy: one reviewed local profile only, with later renewal or revocation when its evidence no longer applies.
- Preserve Kitten's local-only, no-credential-collection posture and keep product measurement content-free and opt-in.
- Ensure a Cursor problem never reduces the availability of Claude Code or Codex.

## User Stories

### Local macOS Cursor subscriber — first supported task

- As a local Cursor subscriber, I want Kitten to show when my reviewed Cursor setup is ready so that I can start and complete a coding task with confidence.
- As a local Cursor subscriber, I want model and reasoning choices to appear only when my ready Cursor session supports them so that I do not choose a setting that will not apply.
- As a local Cursor subscriber, I want an explicit message when no switchable model or reasoning choice is available so that I understand this is a capability limit rather than a broken control.

### Local macOS Cursor subscriber — recovery

- As a user whose Cursor setup is blocked, I want to see the specific readiness cause and the next safe local action so that I can recover when possible without guessing.
- As a user whose installed Cursor profile is not yet reviewed, I want Kitten to state that clearly so that I do not mistake a maintainer-owned certification gap for a problem I can fix myself.
- As a user who has completed a recovery action, I want to recheck Cursor's status so that I know whether I can proceed.

### Privacy-conscious multi-agent user

- As a Kitten user, I want Cursor authentication to remain in Cursor's normal flow so that Kitten never asks for, stores, or displays my credentials.
- As a developer using several agents, I want a blocked Cursor session to leave my ready Claude Code and Codex sessions usable so that one provider does not interrupt my work.

### Kitten maintainer

- As a maintainer, I want a clear support boundary for the first Cursor profile so that release communication stays truthful when Cursor changes.
- As a maintainer, I want content-free outcome signals after release so that I can judge first-task reliability without collecting prompts, code, paths, credentials, or raw errors.

## Core Features

### Critical — Exact-profile support status

Kitten presents Cursor as supported only after one exact local macOS profile has completed reviewed, content-free proof of the full user journey from local readiness through a completed task. A supported label applies only to that reviewed profile and is withdrawn or renewed when its evidence no longer applies. Kitten does not claim broad Cursor compatibility.

### Critical — First-task readiness journey

For a supported profile, the user can select Cursor, see that the session is ready, start work, and complete a first coding task. The product makes the ready state visible before the user is asked to rely on the session.

### Critical — Specific blocked-state guidance

For every blocked state, Kitten shows the actual reason and the next safe action. The experience distinguishes a missing local prerequisite, a user sign-in or re-sign-in need, a local setup mismatch, a failed attempt to establish a session, and a profile that Kitten has not yet reviewed. The last state explicitly says that support is pending review rather than asking the user to repair a product-owned gap.

### High — Session-authoritative model and reasoning choices

Kitten displays model or reasoning choices only after a ready Cursor session makes them available. When a ready session offers no switchable choices, the product says so directly. When Cursor is unready, the product shows recovery guidance instead of an empty-capability explanation.

### High — Local-first onboarding and support language

Cursor onboarding explains the local requirement, native sign-in expectation, exact-profile support boundary, and recovery path in plain language. It never implies Cursor cloud or background-agent support, credential handling by Kitten, or a direct CLI control path for an active session.

### Medium — Content-free reliability learning

When users opt in, Kitten records only bounded local outcome categories needed to assess readiness-to-first-task reliability. The product must not record prompts, code, paths, account details, credentials, model content, or raw provider errors.

## User Experience

### Supported first-task flow

1. A local macOS Cursor subscriber opens Kitten and selects Cursor.
2. Kitten shows a clear ready state for the reviewed local profile.
3. If the session offers switchable model or reasoning choices, the user can see and use them; otherwise, Kitten explicitly states that this ready session does not offer those choices.
4. The user starts a coding task and receives the normal in-session experience.
5. Completing the first task satisfies the MVP's primary user outcome.

### User-remediable blocked flow

1. The user selects Cursor and Kitten identifies a blocked readiness state.
2. Kitten states the condition in plain language and gives the next safe local action, such as installing the local CLI, signing in again through Cursor, or restoring the expected local setup.
3. The user completes that action outside Kitten's credential boundary.
4. The user rechecks Cursor and either reaches ready state or receives the next accurate blocked state.

### Profile-not-yet-reviewed flow

1. The user selects Cursor with a local profile that Kitten has not reviewed.
2. Kitten states that the local profile is detected but not supported yet and makes clear that this is not a user repair task.
3. The user can continue working with any other ready Kitten provider without interruption.
4. Onboarding and support language explain what verified support means without promising that every installed Cursor version will work.

### Accessibility and clarity

- Every readiness state uses plain language that names the problem and next action.
- Status is understandable without color alone and remains legible in a terminal at narrow widths.
- Unsupported and no-capability states remain distinguishable from each other and from a ready session.
- No state asks users to paste secrets, API keys, or account data into Kitten.

## High-Level Technical Constraints

- The product supports a local Cursor path only; cloud and background Cursor experiences are outside this PRD.
- Native Cursor authentication remains outside Kitten, and Kitten must never collect or retain credentials.
- A support claim requires reviewed evidence for one exact local profile and remains fail-closed for unreviewed configurations.
- Model and reasoning choices must reflect only what the active Cursor session makes available.
- Product measurement is off by default, local when enabled, and content-free.
- A Cursor failure must not block Claude Code or Codex from remaining usable.

## Non-Goals (Out of Scope)

- Supporting Cursor cloud or background agents.
- Collecting, storing, displaying, or proxying Cursor credentials or API keys.
- Treating an installed CLI, a version range, or a direct CLI model list as proof of active-session support.
- Promising model or reasoning controls when the ready session does not make them available.
- Hiding Cursor merely because the current local profile is unsupported.
- Creating a general provider-certification platform before this exact Cursor journey proves user value and operating cost.
- Requiring a pre-release pilot before the first exact-profile support claim; pilot evidence follows that narrowly reviewed claim.

## Phased Rollout Plan

### MVP (Phase 1)

- Publish support for one exact reviewed local Cursor profile only after it completes the full reviewed first-task journey.
- Replace the misleading generic model-options message with specific Cursor readiness and recovery states.
- Make ready-state model and reasoning choices session-authoritative, including an explicit ready-but-no-switchable-options state.
- Update local onboarding and recovery language to state the support boundary and protect the credential boundary.

**Success criteria to proceed to Phase 2:** The reviewed profile reaches ready state and completes its first task; every defined blocked state has accurate recovery guidance; no Cursor failure affects other ready providers.

### Phase 2

- Run a voluntary, opt-in reliability observation period for the supported profile.
- Refine recovery language from bounded, content-free outcome categories.
- Establish a recurring review and revocation practice for the supported profile as Cursor evolves.

**Success criteria to proceed to Phase 3:** At least 10 opt-in supported-profile attempts produce a first-task completion rate of 90% or higher, and no recurring blocked state lacks a clear safe recovery message.

### Phase 3

- Consider additional exact local Cursor profiles only when demand, review capacity, and Phase 2 reliability justify expansion.
- Consider a reusable provider-qualification workflow only if the evidence process proves valuable across more than one provider.

**Long-term success criteria:** Each newly supported profile retains the same truthful support, recovery, privacy, and revocation boundaries as MVP.

## Success Metrics

| Metric | Target | Measurement |
|---|---:|---|
| Exact-profile proof | 100% of required first-task lifecycle conditions completed before the first support claim | Reviewed, content-free local evidence for the one claimed profile. |
| First-task completion | >=90% across at least 10 voluntary, opt-in supported-profile attempts in Phase 2 | Local content-free outcome categories from readiness through first task. |
| Blocked-state clarity | 100% of defined Cursor blocked states provide a specific cause and next safe action | Product review of every defined state and user-facing message. |
| Capability honesty | 0 model or reasoning choices shown when the ready session does not make them available | Product acceptance review of ready and unready user journeys. |
| Provider isolation | 0 cases where a blocked Cursor state prevents a ready Claude Code or Codex session from being used | End-to-end product acceptance review. |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Cursor changes faster than reviewed support can be renewed | Keep the support promise exact-profile and revocable; never imply broad compatibility. |
| Users interpret a visible Cursor option as a supported profile | Name readiness and certification state plainly and distinguish it from user-remediable actions. |
| Users cannot tell authentication, setup, and capability states apart | Use one specific cause and next safe action per blocked state; reserve no-options language for ready sessions only. |
| Privacy concerns reduce willingness to try the feature | Keep authentication native to Cursor and use default-off, content-free local measurement only. |
| Early reliability is lower than expected | Limit the first claim to one profile, observe voluntary outcomes, improve guidance, and renew or revoke the claim when evidence warrants. |
| Scope expands into a general compatibility initiative | Enforce the non-goals and evaluate broader qualification only after the exact-profile journey proves demand and reliability. |

## Architecture Decision Records

- [ADR-001: Keep Cursor support evidence-gated and fail closed](adrs/adr-001.md) — Limits support to a revocable, exact-profile evidence snapshot.
- [ADR-002: Define support by a completed first Cursor task after reviewed proof](adrs/adr-002.md) — Sets the first completed task as the MVP outcome and recovery guidance as the unsupported-user contract.

## Open Questions

- Which exact local macOS Cursor profile will first satisfy the reviewed support threshold?
- Who owns renewal and revocation communications when the reviewed profile changes?
- What user-facing wording best distinguishes an unreviewed profile from a user-fixable local setup problem?
- Does the Phase 2 opt-in cohort reach the ten-attempt threshold quickly enough to inform a decision about another profile?
