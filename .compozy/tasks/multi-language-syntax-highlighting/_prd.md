# Product Requirements Document: Multi-Language Syntax Highlighting

## Overview

Multi-Language Syntax Highlighting makes agent-generated code immediately recognizable in Kitten's live conversations and hand-off summaries. It serves developers who must quickly understand mixed-language code, configuration, shell commands, Markdown, and diffs before acting on an agent's work.

The feature will be enabled by default once the documented V1 language set is ready. It improves scanning without changing source: every code block retains clear boundaries and its language label, while unknown or unavailable languages remain readable, copy-safe plaintext.

## Goals

- Help developers identify and scan agent-generated code faster than unstyled prose.
- Deliver a consistent code-reading experience in live conversations and hand-off summaries.
- Support JavaScript, TypeScript, Rust, Go, OCaml, ReScript, JSON, Bash, Python, Markdown, and diff, including documented common labels.
- Preserve readable, selectable, copy-safe source for every code block, including unsupported or malformed input.
- Make the verified experience available by default to all Kitten users.

## User Stories

- As a developer reading a live agent response, I want code blocks to stand apart from prose so that I can recognize the language and assess the proposal quickly.
- As a developer reviewing a hand-off summary, I want the same code-reading experience as the live conversation so that I can decide whether to accept work without reinterpreting formatting.
- As a developer working with Rust, Go, OCaml, ReScript, or common configuration and shell formats, I want my labelled code to receive the same trustworthy treatment as JavaScript and TypeScript.
- As a developer whose language is unavailable or whose agent output is incomplete, I want a clearly labelled plaintext block so that I can still read and copy the original source safely.
- As a developer using limited terminal color or a theme with low contrast, I want labels and code-block boundaries to convey that content is code even when colors are subtle.

## Core Features

### Default-On Code Recognition

Kitten presents verified code blocks as visually distinct from surrounding prose in every Markdown-reading surface. The feature is available by default; it does not require users to discover or configure a preference.

### Documented Language and Label Coverage

Kitten recognizes the V1 language and format set—JavaScript, TypeScript, Rust, Go, OCaml, ReScript, JSON, Bash, Python, Markdown, and diff—plus its documented common labels. The product documentation states the supported labels so users know what to expect.

### Trustworthy Plaintext Fallback

When a language label is unknown, unavailable, malformed, or not yet supported, Kitten retains the original label and shows the source as a bounded, readable plaintext code block. Enhancement never changes, guesses, removes, or obscures the source users can select and copy.

### Accessible Reading Cues

Language labels and code-block boundaries remain visible independently of color. Color improves scanning but does not become the sole way to distinguish code from prose or identify the declared language.

### Consistent Diff Reading

Diffs continue to be a first-class code-reading experience. Kitten enhances diffs only when a real, declared language context is available and otherwise keeps them clearly readable without guessing.

## User Experience

1. An agent streams a response containing prose and a labelled code block.
2. The developer can immediately see the block boundary and language label, then scan visually distinct code without waiting for the response to finish.
3. The developer selects and copies any portion of the block; the copied source contains only the intended code, not reading chrome.
4. If the label is unavailable, malformed, or unsupported, the developer still sees the original label and a legible plaintext block rather than a warning, blank area, or misleading enhancement.
5. When the developer opens a hand-off summary, the same content receives the same code-reading treatment, preserving continuity at the moment they decide whether to transfer work.

## High-Level Technical Constraints

- The user-visible behavior must be consistent in all Kitten Markdown-reading surfaces and in the installed application.
- The feature must never alter the source a user reads, selects, or copies.
- Only declared, documented labels may receive language-specific enhancement; unlabelled or unknown source must not be guessed.
- Color must enhance, not exclusively convey, code-block meaning.

## Non-Goals (Out of Scope)

- User-installed or dynamically loaded language support.
- Automatic language detection for unlabelled code.
- Code editing, formatting, navigation, or transformation features.
- Per-surface formatting preferences that make conversation and hand-off rendering diverge.
- Expanding beyond the documented V1 language set before user feedback identifies a need.

## Phased Rollout Plan

### MVP (Phase 1)

- Define and validate the complete documented V1 reading experience across live conversations and hand-off summaries.
- Confirm that unsupported and incomplete input remains labelled, readable, and copy-safe.
- Success criterion: every documented V1 language class and fallback scenario meets the release-quality bar.

### Phase 2

- Enable the verified experience by default for all Kitten users.
- Publish the supported language-label contract and fallback behavior.
- Success criterion: developers can rely on consistent recognition without enabling a feature or learning a workaround.

### Phase 3

- Review developer feedback on scanning clarity and unsupported language demand.
- Prioritize additional languages only when feedback demonstrates a meaningful reading need.
- Success criterion: at least 4 out of 5 surveyed developers report that agent-generated code is faster to scan and identify.

## Success Metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| Developer scanning clarity | ≥4/5 average rating from at least 10 developers | Post-release dogfood survey asking whether agent-generated code is faster to scan and identify |
| V1 recognition coverage | 100% of documented language classes visibly distinguish code from prose | Release-quality acceptance matrix |
| Plaintext fallback fidelity | 100% of unsupported and malformed scenarios retain original label and copy-safe source | Release-quality acceptance matrix |
| Cross-surface consistency | 100% of documented language classes behave consistently in live conversation and hand-off summary | Release-quality acceptance matrix |
| Default availability | 100% of verified installs receive the feature without an opt-in step | Release verification and configuration review |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Users expect every labelled language to be enhanced | Publish a specific supported-label contract and retain labelled plaintext when coverage is unavailable. |
| Color is difficult to perceive or becomes low contrast in a terminal theme | Keep labels and code-block boundaries meaningful without color. |
| Inconsistent reading behavior reduces trust during a hand-off | Treat live conversation and hand-off summary as one product experience for release readiness. |
| Niche-language demand is uncertain | Review post-release developer feedback before expanding coverage. |
| The feature becomes confused with an editor | Keep V1 focused on recognition and safe reading, not code manipulation. |

## Architecture Decision Records

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — Treat language coverage as a trustworthy, release-gated shared capability.
- [ADR-002: Default-on trustworthy code recognition](adrs/adr-002.md) — Make verified code recognition default-on, accessible beyond color, and safe when fallback is needed.

## Open Questions

- Which additional language labels should be prioritized after V1 based on developer feedback?
- What survey cadence will produce enough post-release feedback without interrupting developer flow?
- If ReScript cannot meet the documented release bar, should it remain a clearly documented plaintext case or move to the first post-V1 expansion?
