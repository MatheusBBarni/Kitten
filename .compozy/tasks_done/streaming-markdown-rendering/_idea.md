# Elevated Markdown - Trustworthy Instrumentation for the Hand-off

## Overview

Kitten's agents speak Markdown, but Kitten barely renders it.
Every heading, bold, list, and blockquote in the transcript currently paints in flat body-text color because the theme registers only code-syntax scopes; only fenced code is styled.
And the one surface where legibility decides whether the product works - the hand-off summary a user reads before forwarding a task to the other agent - is a plain editable text box that never renders Markdown at all.

This idea raises the reading bar across every prose surface cheaply, then concentrates the differentiating polish on the hand-off preview.
The target user is the multi-agent developer who reads dense agent output all day (file tables, code blocks, step lists) and, at the decisive moment, has to trust a redacted summary enough to send it on.
The value is not a prettier transcript for its own sake.
It is that rendering is the medium through which a human reads, trusts, and forwards an agent's work, so quality here compounds with Kitten's actual wedge instead of competing with toad on toad's strongest axis.
V1 is deliberately focused: one shared renderer, an elevated theme, a rendered hand-off preview, and the two fixes that keep the shipped binary honest.

## Problem

Markdown is the default output format of LLMs, so it is not an occasional element of the interface - it is the interface.
Every agent turn arrives as Markdown, which means the render quality of that Markdown is the most-seen, most-felt pixel in the whole product.
Kitten already pipes turns through OpenTUI's `<markdown>` renderable, but because `theme.ts` registers only code scopes, headings, emphasis, lists, blockquotes, and links all render flat.
Worse, the transcript is the only place Markdown renders: the hand-off summary preview is a `<textarea>`, so the prose a reviewer must judge before forwarding shows up unformatted.

That gap sits directly on the wedge.
When a supervisor receives a hand-off bundle and the summary reads as a wall of unformatted text or a table collapsed into noise, they re-read the raw transcript, re-edit by hand, or abandon the hand-off and re-explain the task themselves.
Re-explaining is the exact tax Kitten exists to remove, so a hard-to-read preview does not just look cheap, it actively suppresses the behavior the product is trying to create.

The existing tools do not resolve this the way it looks like they do.
The incumbent field renders Markdown badly, which is a real opening, but the category leader renders it well and treats that as a selling point, which is a real threat.
The trap is to read the problem as "out-render toad" and grade V1 on a blind side-by-side preference test.
That measures Kitten against the incumbent's most-fortified axis with a metric that is easy to bend, and it strips the hand-off - the one thing Kitten has and toad does not - out of the comparison entirely.
The problem worth solving is legibility and trust at the surfaces where a human supervises two agents, not a render beauty contest.

### Market Data

- Markdown is the lingua franca of LLM output; models emit structured Markdown (headers, lists, bold) even when it is not requested, because their training corpora are saturated with it (advocacy/vendor sources; treat as directional, not audited).
- The incumbent field ships visibly broken Markdown: Gemini CLI tables are "misaligned regardless of terminal width" and leak raw `**` inside cells; Claude Code tables "disappear when the terminal is expanded to full screen," it has a standing request to stop showing raw `#`/`**`, and its links expand to full URLs instead of short OSC 8 labels (public GitHub issues).
- toad (Rich/Textual, AGPL-3.0, approximately 3.3k stars) makes Markdown quality a stated pillar: its author calls rivals' rendering "half-hearted," and Simon Willison independently frames toad's flicker-free rendering as its headline advantage over Claude Code and Gemini CLI. Its exact CommonMark/GFM conformance is unpublished, so edge cases are genuinely contestable.
- OSC 8 clickable hyperlinks are broadly supported across 2025-2026 terminals (iTerm2, Kitty, WezTerm, Windows Terminal, Ghostty, VTE, Alacritty), yet OpenTUI does not advertise them and Claude Code has open requests for them - a gap Kitten can fill.
- OpenTUI 0.4.3 (Kitten's engine) has real limits on the critical path: it actively drops GFM task-list checkboxes, does not support footnotes or inline images, carries a finalization-blanking bug (worked around by pinning streaming on), and open bug #807 silently degrades Markdown highlighting to plain text inside `bun build --compile` binaries - the exact artifact Kitten now ships.

## Summary / Differentiator

Kitten does not try to out-pretty toad on a shared axis where toad, built on a decade of Rich and Textual, is strongest and can respond in a week.
It points render quality at the surface only Kitten has: the hand-off.
A legible, redaction-honest preview, clean-copy that carries source rather than box-drawing artifacts, and OSC 8 provenance links make an agent's work trustworthy to forward.
That is an asymmetric proof point - toad has no hand-off to instrument - and it compounds with the moat instead of fighting the incumbent on home ground.
On the ambient transcript, the goal is only to stop looking worse than toad, which the cheap 80% (an elevated theme plus one shared component) already achieves against a broken field.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Shared `<Markdown>` seam | Critical | One owned component every prose surface renders through, with OpenTUI fully behind it - mirroring how `ToolCallDiffView` already isolates the shared `<diff>`. The single place OpenTUI is named. |
| F2 | Elevated Markdown theme (`markup.*`) | Critical | Register the missing `markup.*` scopes (headings 1-6, strong/em/strikethrough, inline code, list, quote, link label/url) so emphasis and structure render properly and stay theme-aware in dark and light. |
| F3 | Rendered hand-off preview | Critical | The hand-off summary renders as Markdown in read mode and reverts to a `<textarea>` on edit, so the reviewer sees exactly what will be forwarded, with redaction shown honestly. The wedge-touching surface. |
| F4 | Compiled-binary highlighting fix (#807) | High | Bundle the tree-sitter worker (Blob or main-thread fallback) so the shipped binary highlights code, guarded by a golden-frame test against the compiled artifact. |
| F5 | OSC 8 clickable links | High | Render `[text](url)` as clickable short links on capable terminals, with a graceful `text (url)` fallback where OSC 8 is unsupported. |
| F6 | Robust tables and graceful degradation | Medium | Stable column wrapping across resize via OpenTUI's `columnFitter`/`wrapMode`; display-only checkbox glyphs; malformed Markdown and unsupported elements degrade without crashing or leaking raw markers. |
| F7 | Clean-copy fidelity | Medium | Selecting rendered output copies the words or source without box-drawing artifacts, extending the transcript's existing `getSelectedText` behavior to tables and code. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Hand-off preview comprehension (primary) | In >= 70% of hand-offs, the reviewer forwards or edits directly from the rendered preview without expanding the raw transcript | Opt-in telemetry: preview-only vs transcript-expanded before send |
| Render conformance floor | >= 95% of a CommonMark + supported-GFM corpus renders with zero visual defects | Automated snapshot tests in CI |
| Compiled-binary parity | 100% render/highlight parity between `bun run` and the shipped compiled binary | Golden-frame test against the artifact (guards #807) |
| Streaming smoothness | 0 flicker/reflow above the streaming tail at >= 100 tokens/sec; the block above the tail never repaints | Instrumented streaming test (extends `ConversationView` tests) |
| Malformed-Markdown resilience | 100% of a malformed-Markdown corpus renders with no crash and no raw-marker leak | Fuzz/snapshot corpus (LLMs emit broken Markdown routinely) |
| Not-worse-than-toad floor | Kitten's ambient render is judged at least as readable as toad in >= 50% of pairs | Blind pairwise eval, pre-registered non-curated corpus, N >= 20 |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Must do (~100%, every turn) |
| **Frequency** | How often would users encounter this value? | Must do (every agent response) |
| **Differentiation** | Does this set us apart or just match competitors? | Strong (Must-do on the hand-off surface; parity-plus on ambient prose) |
| **Defensibility** | Is this easy to copy or does it compound over time? | Strong (hand-off instrumentation compounds with the moat) |
| **Feasibility** | Can we actually build this? | Strong (80% is theme + component; the differentiating tail stays above the dependency) |

Leverage type: Strategic Bet with a compounding instrumentation element.

## Council Insights

- **Recommended approach:** Elevate Markdown as instrumentation for the hand-off, not as a standalone render contest. Extract one owned `<Markdown>` seam, register the `markup.*` theme scopes (the cheap, high-yield 80%) across every surface, make the hand-off preview the center of gravity, fix bug #807, and add only above-the-dependency wins (OSC 8, display-only checkbox glyphs, robust table wrapping). Grade V1 on comprehension and forward-decision quality; keep the toad comparison as a hygiene floor and lagging launch collateral.
- **Key trade-offs:** Beat-toad-on-render vs comprehension-for-the-hand-off (resolved: comprehension primary, comparison demoted). Thin seam vs thick owned pipeline (resolved: seam now, above-the-line thickness only, renderer-internal work deferred). Ambient prettiness vs wedge-aligned polish (resolved: cap ambient at the hygiene floor, invest in the preview).
- **Risks identified:** A pre-1.0 OpenTUI on the critical path (dropped checkboxes, no footnotes/images, finalization bug, #807), mitigated by keeping everything behind the owned seam and shipping only above-the-line extensions. A riggable preference metric, mitigated by grading on comprehension and using a pre-registered, non-curated comparison corpus. Cosmetic-fake checkbox glyphs, mitigated by rendering them display-only and honestly. Distraction from the wedge, mitigated by making the hand-off preview the center of gravity.
- **Stretch goal (V2+):** Own the streaming/finalization pipeline and, once OpenTUI reaches 1.0, close full-GFM parity (real task-list checkboxes, footnotes); extend the shared renderer to conductor-grade N-agent output.

## Out of Scope (V1)

- **Full CommonMark + GFM parity (real checkboxes, footnotes, inline images)** - blocked by OpenTUI 0.4.3 engine limits; would require upstreaming or forking. Deferred to V2+.
- **Streaming finalization fix / owning the streaming pipeline** - renderer-internal surgery against a pre-1.0 dependency and unbounded maintenance debt; keep the pin-streaming-on workaround and revisit at OpenTUI 1.0.
- **Forking OpenTUI or writing a native renderer** - aimed at rendering rather than the wedge, and premature; revisit only if the comprehension metric proves render quality converts.
- **"Beat toad" as the headline objective** - grades Kitten on the incumbent's strongest axis via a bendable metric with no proven line to adoption; retained only as a hygiene floor.
- **Markdown authoring assist in the prompt editor** (toad-style highlight-as-you-type) - a separate surface not needed to test the instrumentation thesis. Deferred.
- **Rich rendering of help and approval chrome** - structured labels read fine as `<text>`; routing them through Markdown adds surface without moving the metric.

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| `MessageView` / `ConversationView` transcript | Becomes a consumer of the shared `<Markdown>`; the theme scopes light up existing content with no call-site change. |
| `HandoffPreview` summary | Read-mode renders through `<Markdown>`; edit-mode keeps the `<textarea>`; the redaction notice is preserved. |
| `theme.ts` `SyntaxStyle` | Extended with `markup.*` scopes, reusing the existing per-mode cache and `theme_mode` reactivity. |
| `ToolCallDiffView` (`<diff>`) | The existing shared-component precedent the `<Markdown>` seam mirrors. |
| Compiled-binary packaging pipeline | Gains a golden-frame test guarding #807. |

## Sub-Features

- **The `<Markdown>` seam** - owns `usePalette`/`useSyntaxStyle`, the streaming pin, `conceal`, and link handling; the only place OpenTUI is named.
- **`markup.*` theme registration** - headings (1-6), strong/em/strikethrough, inline code, list, quote, and link label/url, in both dark and light.
- **Rendered hand-off preview** - read/edit toggle, redaction-honest.
- **#807 worker-bundling fix** - plus the golden-frame test against the compiled artifact.
- **OSC 8 link layer** - capability detection and fallback, implemented above the seam as post-processing.

## Cost Estimate

| Type | Volume | Estimated Cost |
| --- | --- | --- |
| Rendering / compute | Local, on-device per turn | ~USD 0 |
| Comprehension study + blind eval | One-off, N >= 20 evaluators | Evaluator time only; ~USD 0 direct |
| Hosting / backend | None (local-first) | ~USD 0 |

## Architecture Decision Records

- [ADR-001: V1 Scope - Elevate Markdown as Trustworthy Instrumentation for the Hand-off, Behind an Owned Seam](adrs/adr-001.md) - one owned `<Markdown>` seam plus the cheap-80% theme everywhere, the hand-off preview as the center of gravity, a #807 fix, and above-the-line-only extensions, graded on comprehension.

## Open Questions

- How does the comprehension KPI instrument preview-vs-transcript behavior without capturing prompt content? (Same privacy constraint as the existing opt-in hand-off telemetry.)
- What is the concrete #807 fix path on OpenTUI 0.4.3 - inline worker via Blob URL, or a main-thread tree-sitter fallback?
- Does OpenTUI 0.4.3 emit OSC 8 today, or does F5 need an above-the-seam post-process? (Research suggests the code path exists but is capability-gated and undocumented.)
- Display-only checkbox glyph vs an honest literal `[ ]` / `[x]` in text - which reads better and avoids the "cosmetic fake" critique?
- What is the pre-registered corpus and evaluator pool for the not-worse-than-toad floor?
- License is still unset; the "permissive vs toad's AGPL" angle stays aspirational until a `LICENSE` lands.
- What is the read/edit UX when the rendered summary is also user-editable Markdown - toggle, inline, or split?
