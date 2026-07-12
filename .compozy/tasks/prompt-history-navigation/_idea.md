# Prompt History Navigation

## Overview

Kitten should let any user recover a recently sent prompt with ↑, edit it, and resend it without retyping. V1 is a small, private convenience feature: history exists only for the active run and only within the originating agent session.

### Summary / Differentiator

Unlike persistent prompt libraries, Kitten’s V1 optimizes the immediate “retry with a small change” loop without retaining sensitive prompt content after the run ends.

## Problem

Revising a prompt is common in agent workflows, but Kitten currently requires users to retype or copy a previous prompt from the conversation. This is unnecessarily slow, especially when only a few words need changing.

Arrow-key history is familiar in terminal tools. GitHub Copilot CLI documents ↑/↓ command-history navigation, while Bash treats the current input line as the end of history. Kitten will deliberately clear at that endpoint, as selected by the user. [GitHub Copilot CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) [GNU Bash history](https://www.gnu.org/software/bash/manual/html_node/Commands-For-Manipulating-The-History.html)

### Market Data

The 2025 Stack Overflow Developer Survey reports that 84% of developers use or plan to use AI tools. This supports reducing repeated prompt-entry friction, though it does not measure this feature’s demand directly. [Stack Overflow Developer Survey 2025](https://survey.stackoverflow.co/2025/)

## Integration with Existing Features

| Integration point | How |
| --- | --- |
| Focused prompt composer | Provide recall only in the plain, focused composer. |
| Slash-command menu | The menu retains arrow-key navigation whenever open. |
| Agent sessions | Keep each history private to its originating session and current run. |
| Help experience | Explain recall behavior and its multiline boundary alongside existing keyboard guidance. |

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- | --- |
| F1 | Session-local recall | Critical | Retain recently submitted prompts in chronological order for the current run and owning agent session only. |
| F2 | Predictable arrow navigation | Critical | ↑ recalls newer-to-older prompts; ↓ returns older-to-newer; endpoints do not wrap. ↓ after the newest recalled prompt clears the composer. |
| F3 | Safe multiline precedence | Critical | Preserve normal vertical cursor movement whenever it is available; activate recall only at an unambiguous editor boundary and never while the slash menu is open. |
| F4 | Privacy and lifecycle boundaries | High | Discard history at run end and prevent any cross-agent or cross-session retrieval. |
| F5 | Keyboard discoverability | Medium | Document recall behavior and its multiline boundary in the keyboard help. |

## KPIs

| KPI | Target | How to Measure |
| --- | ---: | --- |
| Recall adoption | ≥25% of eligible sessions | Content-free count of sessions with at least two submitted prompts that use recall. |
| Edit-and-resend rate | ≥50% of recalled prompts | Count recalled prompts followed by an edited resubmission. |
| Cross-session exposure | 0 cases | Automated isolation coverage across agents and lifecycle boundaries. |
| Accidental-clear incidents | 0 in 10 usability sessions | Observe scripted multiline and menu interaction scenarios. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Maybe |
| **Differentiation** | Does this set us apart or just match competitors? | Maybe |
| **Defensibility** | Is this easy to copy or does it compound over time? | Pass |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Quick Win**

## Council Insights

- **Recommended approach:** ship bounded, in-memory, session-local recall first.
- **Key trade-offs:** honor clear-on-↓ only after intentional recall; prioritize multiline cursor movement and slash-menu navigation otherwise.
- **Risks identified:** accidental draft loss, key conflicts, and session leakage; mitigate with explicit recall state, key precedence, and lifecycle cleanup.
- **Stretch goal (V2+):** a privacy-controlled persistent, searchable prompt library.

## Out of Scope (V1)

- **Persistence across restarts** — expands the feature into prompt-data retention.
- **Cross-agent or cross-session history** — violates the privacy and ownership boundary.
- **Search, pinning, favorites, and management UI** — premature before reuse demand is proven.
- **Unconditional arrow interception** — would break expected multiline editing.
- **Draft restoration after history navigation** — the selected interaction explicitly clears at the newest boundary.

## Architecture Decision Records

- [ADR-001: Scope Prompt Recall to the Active Agent Session](adrs/adr-001.md) — defines the private, current-run scope and safe arrow-key precedence.

## Open Questions

- What bounded history capacity best balances reuse with memory footprint?
- What is the clearest help-panel wording for the multiline activation boundary?
- Should opt-in telemetry measure only outcome counts, or should V1 rely on usability testing first?
