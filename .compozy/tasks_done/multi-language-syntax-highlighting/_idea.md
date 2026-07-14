# Multi-Language Syntax Highlighting

## Overview

Kitten should make agent-generated code immediately recognizable in streamed Markdown. V1 targets JavaScript, TypeScript, Rust, Go, OCaml, ReScript, JSON, Bash, Python, Markdown, and diff, including common language labels.

The experience must be trustworthy: a language is highlighted only when it is genuinely supported; otherwise its source remains readable, selectable, and copy-safe as plaintext. V1 is a focused quality feature for developers reading live agent output, not a general-purpose code editor.

## Summary / Differentiator

Kitten will pair broad, practical language coverage with honest fallback behavior across both source runs and shipped terminal binaries—avoiding the common failure mode where highlighting works during development but silently disappears for users.

## Problem

Agent responses routinely mix implementation code, configuration, shell commands, diffs, and niche languages. When those blocks share the same visual treatment as prose, developers must spend extra attention identifying structure before they can evaluate a proposal, verify a patch, or decide to hand work to the other agent.

Kitten already renders Markdown through a shared, theme-aware surface, but its current parser coverage does not match the languages agents commonly produce. A partial or misleading highlighter would be worse than no highlighter: it could obscure code, distort copied source, or behave differently in the compiled application.

### Market Data

Among professional developers using AI tools, the 2025 Stack Overflow survey reports JavaScript (70.5%), Python (56.1%), TypeScript (51.4%), Bash/Shell (48.3%), Go (18.1%), and Rust (13.9%) usage—supporting a core-plus-common-formats V1 while retaining OCaml and ReScript as valuable niche cases. [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/technology/)

Terminal tools such as [bat](https://github.com/sharkdp/bat#syntax-highlighting) and [Glow](https://github.com/charmbracelet/glow) establish syntax highlighting, theme adaptation, and readable fallback as normal expectations for terminal code reading.

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Shared language capability | Critical | Apply highlighting consistently wherever Kitten renders Markdown, without transcript and preview behavior drifting apart. |
| F2 | V1 language coverage | Critical | Support the selected languages and formats, including common labels such as `js`, `ts`, `golang`, `sh`, and `py`. ReScript remains an explicit acceptance item; if no compatible grammar passes the release gate, it stays visibly plaintext rather than being misrepresented. |
| F3 | Honest fallback | Critical | Preserve unknown, malformed, unavailable, or failed code fences as readable and copy-safe source. Never guess a language or partially rewrite code. |
| F4 | Theme-consistent readability | High | Make recognized code distinct from prose while retaining legibility in supported terminal themes and during streaming output. |
| F5 | Release-grade verification | High | Verify recognized code and fallback behavior in both development runs and the compiled binary before declaring a language supported. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Supported language coverage | 100% of the defined V1 language classes pass their release gate | Automated matrix of language, alias, theme, and rendering fixtures |
| Alias accuracy | 100% of documented aliases resolve to the intended language class | Alias contract tests |
| Fallback fidelity | 100% of unknown and failed-fence fixtures remain copy-identical | Selection and copy regression tests |
| Compiled-binary parity | 100% of supported representative fixtures highlight in the shipped binary | Binary self-check and release integration tests |
| Dogfood readability | ≥4/5 average rating from at least 10 developers | Structured post-release dogfood survey |

## Feature Assessment

| Criteria | Score |
| --- | --- |
| Impact | Strong |
| Reach | Strong |
| Frequency | Must do |
| Differentiation | Maybe |
| Defensibility | Maybe |
| Feasibility | Strong |

Leverage type: **Quick Win with a compounding foundation**

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Shared Markdown renderer | One behavior applies to agent messages and hand-off previews. |
| Terminal theme palette | Highlighted code uses the same semantic color system as the cockpit. |
| Diff rendering | Diff remains a first-class code-reading surface alongside fenced Markdown. |
| Compiled distribution | Language support is verified in the same artifact users install. |

## Council Insights

- **Recommended approach:** Deliver the requested V1 language set through one capability-gated shared highlighting surface.
- **Key trade-offs:** Broad coverage improves mixed-language readability but increases parser, alias, startup, and packaged-binary risk.
- **Risks identified:** Alias drift, binary-only regressions, bad theme contrast, and altered copy behavior. Mitigate with explicit support gates and plaintext fallback.
- **Stretch goal (V2+):** A declarative capability platform that makes new languages data additions, with demand-based expansion.

## Out of Scope (V1)

- **Dynamic or user-installed grammars** — expands the trust, packaging, and support surface before the core capability is proven.
- **Language guessing for unlabelled code** — may misrepresent source; V1 favors explicit labels and honest fallback.
- **Code-editor actions or transformations** — navigation, formatting, and editing do not solve the immediate recognition problem.
- **Per-surface highlighting rules** — would create inconsistent agent-message and hand-off-preview behavior.
- **Best-effort regex coloring** — cannot provide reliable syntax or copy fidelity.

## Architecture Decision Records

- [ADR-001: Capability-gated multi-language syntax highlighting](adrs/adr-001.md) — Support only languages that pass shared alias, rendering, fallback, and binary-release gates.

## Open Questions

- Which compatible ReScript grammar can meet the same release and maintenance standard as the other V1 languages?
- What startup-time and binary-size budget should limit the grammar bundle?
- Should content-free, opt-in telemetry measure unsupported fence labels after V1, or should language expansion rely on direct user feedback first?
