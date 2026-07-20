# PRD: Hard Stop Continuation

## Overview

Hard Stop Continuation lets an iterative coding user interrupt an active agent turn and safely continue the same live conversation. A user who presses `Esc` can submit one revised instruction; when the interrupted turn has settled safely, Kitten sends that instruction as the next ordinary turn without duplicating the first-turn harness or treating it as steering. The experience preserves the user's working thread instead of leaving an otherwise healthy session at **Safe start unavailable**.

The feature serves developers who use interruption as a normal correction tool: narrowing an over-broad task, replacing an outdated instruction, or stopping work that has drifted. In Stack Overflow's 2025 survey, 51% of professional developers reported using AI tools daily, while positive sentiment declined to 60%. A transparent recovery path protects trust in a workflow that is now routine. Research on software-development interruptions also associates context changes with greater disruption and cites 15–30 minutes of context rebuilding in programming sessions.

V1 is intentionally narrow. It offers visible automatic recovery only when continuity is proven safe. Otherwise, it retains the unsent draft visibly and offers `/new`; it does not guess, retry, create a replacement session, or imply that the provider completed or consumed interrupted work.

## Goals

- Let a developer safely refine a task after an explicit Hard Stop without abandoning the current conversation when continuity is confirmed.
- Ensure every interrupted continuation is either sent exactly once as the next ordinary turn or remains visibly recoverable to the developer.
- Make queued, sent, restored, and fallback states understandable without exposing provider-internal detail.
- Preserve the existing privacy promise: a pending continuation never becomes durable history, telemetry content, diagnostic content, or handoff material.
- Establish safety and privacy evidence before expanding same-session coverage.

## User Stories

### Iterative coding developer

- As a developer refining an active agent task, I want `Esc` to stop the current turn without discarding my ability to continue, so that I can correct course while preserving useful live context.
- As a developer who submits a revised instruction before the interrupted turn settles, I want to see that it is queued and will continue automatically when safe, so that I do not resend or lose it.
- As a developer who changes my mind again, I want a second `Esc` to return the queued instruction to the composer, so that I remain in control of exactly what is sent.

### Developer recovering from uncertainty

- As a developer whose interrupted session cannot be confirmed safe, I want my unsent draft preserved with a clear `/new` path, so that a safety fallback does not become silent data loss.
- As a privacy-conscious developer, I want recovery drafts to remain local to the live composer, so that sensitive task text does not enter other product surfaces.

### Developer handling another interaction

- As a developer responding to an approval or clarification, I want its current interaction flow to keep precedence, so that Hard Stop does not interfere with a decision I must make explicitly.

## Core Features

### Critical

- **Explicit Hard Stop** — `Esc` stops an eligible running turn while retaining the healthy session whenever continuity remains safe to evaluate. It does not redefine approval or clarification interactions.
- **Visible one-continuation recovery** — After a Hard Stop, the user may submit exactly one revised instruction. Kitten shows that it is queued and will continue automatically only after safe settlement.
- **Ordinary next-turn continuation** — A safely released continuation appears and behaves as the next normal conversation turn. It is never represented as steering or a concurrent request.
- **Lossless uncertain-session fallback** — If continuity cannot be proven, Kitten keeps the continuation visibly recoverable and offers `/new`. It never sends the draft into an uncertain session.

### High

- **Second-Escape control** — A second `Esc` removes the queued continuation and restores it to the composer without representing it as sent.
- **Truthful first-turn recovery** — A confirmed interruption of the first harness-bearing turn can continue without duplicate guidance and without claiming that the provider consumed the interrupted request.
- **Live-only privacy boundary** — Queued continuation text remains outside persistence, telemetry, diagnostics, and handoff material. Any product measurement is local, opt-in, and content-free.

## User Experience

1. A developer sees an active agent turn and presses `Esc` to stop it.
2. Kitten confirms the Hard Stop state while retaining the current conversation context. The developer can write and submit one revised instruction.
3. Kitten visibly labels that instruction as queued while the interrupted turn settles. The developer may continue editing a later draft without overwriting the queued instruction.
4. When the session is confirmed safe, Kitten automatically sends the queued instruction as the next ordinary turn and updates the conversation normally.
5. If the developer presses `Esc` again before dispatch, Kitten removes the queued instruction and restores its text to the composer. No second provider cancellation occurs.
6. If continuity becomes uncertain, Kitten retains the queued instruction visibly, explains that same-session continuation is unavailable, and presents `/new` as the deliberate recovery action.
7. When an approval or clarification is active, its existing modal interaction remains the user's primary focus; Hard Stop does not compete with it.

The recovery state must use concise, terminal-readable language. It must make a distinction between **queued**, **sent**, **restored to composer**, and **requires `/new`** clear enough that users do not infer a send that has not occurred.

## High-Level Technical Constraints

- Same-session continuation is available only when the product can affirmatively establish that the interrupted turn and current session are safe to continue; uncertainty always falls back to draft-plus-`/new`.
- The experience must preserve one-continuation, no-concurrency, and no-duplicate-harness boundaries.
- Pending continuation text must stay live-only and excluded from persistence, telemetry, diagnostics, and handoff material.
- Existing approval, clarification, steering, session replacement, and conversation-close user guarantees remain intact.
- Product measurement must remain local, opt-in, and content-free.

## Non-Goals (Out of Scope)

- **Automatic replacement sessions** — V1 does not move a draft into a new conversation without the developer choosing `/new`.
- **Durable draft queues, retries, or replay** — V1 does not store interrupted drafts or retry a message whose delivery state is ambiguous.
- **General interruption management** — Configurable queues, priorities, waiting controls, or an interruption platform are deferred.
- **Provider rollback or workspace undo** — Hard Stop preserves safe conversational continuity; it does not claim to reverse provider or filesystem work.
- **Changed approval or clarification cancellation behavior** — Those flows retain their current ownership and precedence.
- **Immediate provider parity** — V1 expands only where the required safety evidence exists; it does not promise the same continuation outcome from every provider on day one.

## Phased Rollout Plan

### MVP (Phase 1)

- Deliver explicit Hard Stop, one visible queued continuation, automatic ordinary-turn dispatch after confirmed safety, second-Escape restoration, draft-plus-`/new` fallback, truthful first-turn recovery, and the live-only privacy boundary.
- Launch only with the defined lossless-recovery and privacy evidence.
- **Success criteria to proceed:** every defined interruption outcome either sends exactly one ordinary continuation or leaves a visibly recoverable draft; no duplicate sends, harness duplication, or continuation-content leakage is observed.

### Phase 2

- Expand safe same-session coverage where evidence supports it and refine recovery copy from opt-in, content-free outcome data.
- Improve discoverability only if users fail to understand queued or fallback states in normal use.
- **Success criteria to proceed:** proof-eligible recoveries consistently complete in the same session, fallback remains understandable, and the evidence shows no safety or privacy regression.

### Phase 3

- Consider explicit provider recovery profiles or carefully scoped recovery controls only if Phase 2 data demonstrates a meaningful coverage or usability gap.
- Keep durable queues, automatic replay, and broader orchestration out of scope unless a separate product decision validates them.
- **Long-term success criteria:** users treat Hard Stop as a trustworthy iterative correction action rather than avoiding it or routinely abandoning the session.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Lossless interruption outcomes | 100% of defined interruption scenarios end in exactly one ordinary continuation or a visibly recoverable draft | Release-quality scenario evidence and content-free outcome classification. |
| Unsafe or duplicate continuation sends | 0 observed | Release-quality scenario evidence and opt-in local outcome monitoring. |
| Privacy compliance | 0 continuation-text exposures in durable, telemetry, diagnostic, or handoff surfaces | Allowlisted content-free measurement and privacy review evidence. |
| Proof-eligible same-session recovery | At least 95% complete in the original conversation | Local, opt-in aggregate outcome counters without draft text or identifiers. |
| Recovery responsiveness | p95 no more than 250 ms from confirmed safety to ordinary-turn continuation | User-perceived release measurement and local aggregate timing buckets. |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users mistake a queued instruction for a sent instruction | Use persistent, plain-language queued and sent states; preserve an editable later draft. |
| Users interpret `/new` as lost work | Retain the unsent continuation visibly and make `/new` a deliberate recovery action rather than an automatic reset. |
| Safe same-session coverage is initially limited | State the boundary honestly, preserve drafts everywhere, and expand only after evidence supports it. |
| Users expect interruption to undo external work | Describe Hard Stop as conversational recovery, not rollback or workspace undo. |
| Privacy concerns reduce adoption | Keep queued text live-only and make all product measurement local, opt-in, and content-free. |
| The new flow conflicts with an existing interaction | Preserve approval and clarification precedence, and keep their user experience unchanged. |

## Architecture Decision Records

- [ADR-001: Use a bounded, proof-gated same-session continuation](adrs/adr-001.md) — Defines the one-slot, live-only continuation boundary and fail-closed fallback.
- [ADR-002: Prioritize visible automatic recovery with a lossless fallback](adrs/adr-002.md) — Selects automatic safe recovery, draft-plus-`/new` uncertainty handling, and safety-first expansion.

## Open Questions

- Which user-facing wording best explains that a continuation is queued without implying that it has already been sent?
- Which initially supported sessions can demonstrate the safety evidence required for same-session continuation, and how should coverage boundaries be communicated during rollout?
- What opt-in baseline should qualify the 95% proof-eligible recovery target as representative rather than early dogfood noise?
