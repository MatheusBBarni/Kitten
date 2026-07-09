# PRD: Elevated Markdown - The Trustworthy Hand-off Review Console

## Overview

Kitten's whole reason to exist is the hand-off: the moment a developer forwards a live task from one AI agent to another.
The last thing they see before that task leaves is the hand-off preview, described in the code itself as "the emotional core of the product, and its last safety gate."
Yet the summary on that screen renders as flat, unformatted text, so the reviewer cannot quickly read the structure of what they are about to send, confirm where a claim came from, or trust that nothing sensitive is riding along.
When the preview is hard to read, the reviewer re-reads the raw transcript, over-edits the summary, or abandons the hand-off and re-explains the task by hand, which is the exact tax Kitten set out to remove.

This product turns the hand-off preview into a rich, trustworthy review console.
It is built for the hand-off reviewer: the multi-agent developer deciding, in a few seconds, whether to forward a curated bundle to the other agent.
The value is confidence at the decision point.
A legible summary, visible provenance, and unmistakable redaction make forwarding a task something the reviewer does with trust instead of doubt, which is what makes the hand-off a habit rather than a gamble.
Ambient rendering across the rest of the app is brought only to correctness in this release; the differentiated investment goes entirely to the console.

## Goals

- Let the hand-off reviewer read, trust, and forward a curated bundle from the rendered preview alone, without falling back to the raw transcript.
- Make provenance and redaction legible at a glance, so the reviewer can confirm sources and see exactly what is kept, dropped, and stripped before sending.
- Establish a minimal rendering foundation so no surface renders flat and the shipped binary highlights code as well as the source build does.
- Prove, through a task-based comprehension study, that the rendered preview improves forward-decision accuracy and speed versus today's unrendered preview.
- Support the product's core hand-off-adoption thesis by removing legibility and trust as reasons a reviewer hesitates or bails.

## User Stories

**Primary - the hand-off reviewer:**

- As a reviewer, I want the hand-off summary rendered with its headings, lists, and emphasis so I can grasp its structure at a glance instead of parsing raw Markdown.
- As a reviewer, I want to see clearly what was redacted, what is kept, and what is dropped so I trust exactly what will reach the other agent.
- As a reviewer, I want to confirm a referenced file named in the summary before I forward, so I am not sending a claim I cannot trace.
- As a reviewer, I want to copy a snippet out of the preview and get clean text, not box-drawing characters, so what I paste elsewhere is usable.
- As a reviewer, I want to edit the summary when it needs trimming and return to the readable view, so curation and reading are one flow.

**Secondary - the transcript reader:**

- As a developer reading agent output, I want headings, lists, tables, quotes, and code to render properly so dense turns are legible rather than a wall of markers.

**Secondary - the evaluator:**

- As someone trying Kitten, I want output that does not look worse than the tools I already use, so nothing turns me off in the first session.

**Edge cases:**

- As a reviewer on a terminal without clickable-link support, I want references to degrade to readable text rather than break.
- As a reviewer whose agent emitted malformed Markdown, I want it to still render legibly instead of crashing or leaking raw markers.

## Core Features

**Foundation (minimal enabler):**

| Feature | Priority | What it does and why it matters |
| --- | --- | --- |
| Shared rendered surface | Critical | One consistent rendering used by both the preview and the transcript, so emphasis, headings, lists, quotes, tables, and code render properly and theme-aware. Nothing renders flat; the preview and transcript look like one product. |
| Highlighting parity in the shipped app | Critical | Code fences and diffs highlight identically whether Kitten runs from source or from the distributed binary, so the shipped product never silently degrades to plain text (closes bug #807). |

**Hand-off review console (the core investment):**

| Feature | Priority | What it does and why it matters |
| --- | --- | --- |
| Rendered hand-off summary | Critical | The summary renders as Markdown in read mode and stays editable on demand, so the reviewer reads structure at a glance and still trims when needed. The heart of the release. |
| Redaction and keep/drop clarity | Critical | The reviewer sees unmistakably what was stripped, what is kept, and what is dropped before sending, so the safety gate reads as trustworthy rather than opaque. |
| Provenance links | High | References in the summary connect to the files they name - clickable where the terminal supports it, readable text where it does not - so the reviewer can trace a claim to its source before forwarding. |
| Clean-copy fidelity | High | Selecting content in the preview yields the words or source without chrome, so copied snippets paste cleanly. |

**Polish:**

| Feature | Priority | What it does and why it matters |
| --- | --- | --- |
| Robust tables and graceful degradation | Medium | Tables stay aligned across terminal resize, and malformed or engine-unsupported Markdown degrades legibly instead of breaking. |

## User Experience

The primary flow is the hand-off itself.
The reviewer presses the hand-off key, and the preview opens over the focused agent's session.
They read the summary as rendered Markdown - headings, lists, and emphasis visible - rather than as raw text.
Above it, the redaction notice states plainly what was stripped; below it, the referenced files and pending diffs show what is kept and what is dropped, with the selected diff rendered in place.
If a claim in the summary names a file, the reviewer can confirm its source through a provenance link.
When the summary needs trimming, the reviewer switches it to an editable field and back without leaving the flow.
They forward with Enter, which sends the curated bundle and moves focus to the other agent, or back out with Escape, which sends nothing.

UX considerations that shape the work: the summary must have a clear read state and an edit state, and redaction must never be silent.
Rendering must stay legible against both dark and light terminal themes and must not introduce flicker or reflow as content streams.
Provenance links must degrade gracefully where clickable links are unsupported, and malformed Markdown must still render legibly.
Discoverability needs no new onboarding: the preview already exists and is reached by the same keystroke; this release makes what is already there legible and trustworthy.

## High-Level Technical Constraints

- Must integrate with the existing hand-off preview overlay, its redaction safety gate, and the modal keyboard model, without weakening the "nothing is sent until the reviewer confirms" guarantee.
- Must preserve the privacy stance: any measurement uses the existing opt-in, content-free, local-only telemetry, and the comprehension study is run with participant consent; no prompt or code content is captured.
- Rendering must stay legible against both dark and light terminal themes.
- The product must render correctly in the distributed compiled binary, not only from source.
- Provenance links must degrade gracefully on terminals without clickable-link support.
- Rendering must degrade gracefully on the malformed Markdown that LLMs routinely emit.
- Streaming legibility in the transcript must not regress.

## Non-Goals (Out of Scope)

- **Broad ambient rendering polish beyond correctness** - the transcript gets the shared theme fix for free, but deeper ambient investment is deferred; this release spends its differentiating budget on the console.
- **Beating toad on ambient render quality as a tracked goal** - demoted to an informal pre-launch hygiene check ("not visibly worse than toad"), not a success metric.
- **Full CommonMark + GFM parity (real task-list checkboxes, footnotes, inline images)** - blocked by the current rendering engine; deferred.
- **Owning or fixing the streaming finalization pipeline** - deferred; the existing streaming behavior is retained.
- **Rendering help and approval chrome as Markdown** - those read fine as plain labels and would add surface without moving the metric.
- **Markdown authoring assist in the prompt editor** - a separate surface, not needed to test this thesis.

## Phased Rollout Plan

### MVP (Phase 1) - Foundation

- The shared rendered surface (nothing renders flat) and highlighting parity in the shipped binary.
- **Success criteria to proceed:** rendering is correct and theme-aware across the transcript and the preview; code highlights in the compiled binary exactly as in source; no streaming regression.

### Phase 2 - The Review Console

- Rendered hand-off summary, redaction and keep/drop clarity, provenance links, and clean-copy fidelity.
- **Success criteria to proceed:** the comprehension study shows the rendered preview improves forward-decision accuracy and/or reduces time-to-decision versus the unrendered preview.

### Phase 3 - Polish

- Robust tables and graceful-degradation refinements; extend clean-copy to tables and code.
- **Long-term success:** sustained hand-off confidence, with supporting telemetry (downstream re-explanation, bundle-edit volume) trending favorably.

## Success Metrics

- **Primary - comprehension study (Phase 2 gate):** in a pre-registered, blind comparison of the rendered versus the current unrendered preview, N >= 20 developers make forward decisions with measurably higher accuracy and lower time-to-decision (target margins to be pre-registered).
- **Supporting - continuous via existing opt-in telemetry:** downstream re-explanation after a hand-off decreases; bundle-edit volume steadies or falls (the summary is trusted more); hand-off completion (invoked to sent) holds or rises.
- **Quality bars:** 100% highlighting/render parity between source and shipped binary; a malformed-Markdown corpus renders with no crash and no raw-marker leak; no streaming flicker regression.
- **Hygiene floor (informal, not tracked):** ambient render judged not visibly worse than toad on a pre-registered corpus.

## Risks and Mitigations

- **Intermittent value (adoption):** the differentiated benefit appears only at hand-off time. Mitigation: the hand-off is the product's core action, and the foundation improves everyday legibility for free.
- **Competitive:** toad ships more ambient polish and out-renders Kitten's transcript. Mitigation: compete on the wedge - the hand-off console toad has no equivalent for - and hold ambient at parity.
- **Soft measurement:** the comprehension study could be too loose to trust. Mitigation: pre-registered tasks, blind rendered-vs-unrendered, N >= 20, both accuracy and time.
- **Dependency:** the rendering engine is pre-1.0 with real limits (no checkboxes/footnotes/images, plus #807). Mitigation: scope to what the engine renders, fix #807, defer engine-blocked features.
- **Trust in instrumentation:** measuring comprehension could feel invasive. Mitigation: the study is consented; continuous signals reuse the existing content-free, local-only telemetry.
- **Scope creep on the console:** integrated diffs and provenance could balloon. Mitigation: phase gates - Phase 2 ships the console, refinements land in Phase 3.

## Architecture Decision Records

- [ADR-001: V1 Scope - Elevate Markdown as Trustworthy Instrumentation for the Hand-off, Behind an Owned Seam](adrs/adr-001.md) - one owned rendering seam plus a cheap theme everywhere, the hand-off preview as the center of gravity, a #807 fix, and above-the-line-only extensions.
- [ADR-002: PRD Product Approach - Preview-Deep, Concentrate V1 on the Hand-off Review Console](adrs/adr-002.md) - hold ambient rendering to correctness and put nearly all V1 weight on the preview as a trustworthy review console, graded by a comprehension study.

## Open Questions

- What target thresholds define success for the comprehension study (accuracy delta, time delta)?
- What is the pre-registered task set and participant pool for the study?
- Does tracing provenance require clickable links specifically, or is a visible, readable file reference enough where clickable links are unsupported?
- Should the summary's read and edit states be a toggle, or should editing happen inline?
- Do we add a "preview abandoned" (opened, then Escaped without sending) telemetry event as a supporting trust signal, or rely on re-explanation and bundle-edit volume only?
- For redaction clarity, is the current count and notice enough, or should the reviewer see what category was stripped without revealing the secret itself?
- License is still unset; the "permissive versus toad's AGPL" framing stays out of this PRD until a `LICENSE` lands.
