# Idea: Session-Scoped File Explorer

## Overview

Add a VS Code-style File Explorer that follows the focused Kitten session's Session Workspace. It lets an active agent-session developer inspect the workspace and open a selected regular file in their preferred external editor without losing the cockpit's conversational context.

V1 is a complete, safety-bounded continuity feature—not an embedded editor or general IDE platform. It includes lazy per-session navigation, a docked-first terminal layout, secure file opening, a saved editor preference, and opt-in local content-free telemetry.

### Summary / Differentiator

Most developer tools already make file navigation familiar. Kitten's differentiator is that the explorer follows the currently focused live agent session and preserves independent in-memory explorer positions for each session. It shortens the path from agent conversation to a developer's existing editor without taking ownership of either agent or editor.

## Problem

Developers working with long-lived coding-agent sessions must regularly inspect a repository, compare generated changes, or open a file for deeper editing. Today, this requires leaving the terminal cockpit, locating the session's workspace independently, and later reconstructing which agent session they were using. That interruption is especially costly when several sessions have distinct working directories.

Explorer navigation is an established developer expectation: VS Code presents it as the project-navigation surface, while Cursor gives agents explicit directory-listing and codebase-search tools. Kitten should not duplicate their full editor capabilities. It should preserve the focused agent workflow by making the correct session workspace available beside the conversation. [VS Code Explorer UX](https://code.visualstudio.com/docs/editing/userinterface) [Cursor Agent tools](https://docs.cursor.com/en/agent/tools)

The user should not have to trade convenience for filesystem safety. Path traversal can expose arbitrary files when paths are insufficiently constrained, and out-of-workspace files are treated as a distinct trust boundary by mature editors. The explorer must therefore hide `.git`, reject broken or escaping links, revalidate containment before every traversal or open, and never shell-parse an editor command. [OWASP path traversal guidance](https://owasp.org/www-community/attacks/Path_Traversal) [VS Code Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust)

### Market Data

Stack Overflow's 2025 developer survey reported that 31% of respondents were already using AI agents, and 69% of those users reported productivity gains. It also reported growing use of AI-enabled development tools, while security concerns and a desire to understand generated code remained prominent. This supports a human-controlled, context-preserving workflow rather than an autonomous file-action surface. [Stack Overflow 2025 survey release](https://stackoverflow.co/company/press/archive/stack-overflow-2025-developer-survey/)

## Integration with Existing Features

| Integration Point | How |
| --- | --- |
| Focused Session / Session Workspace | The tree always renders the focused session's workspace and retains one current-run Explorer Position per session. |
| `ControllerActions` | UI requests navigation, refresh, and opening through an app-layer capability; React does not perform filesystem or process work. |
| Existing `@` File Selector | Remains separate: its Git-backed, safe-text-only discovery source has different semantics and must not become the explorer source. |
| Settings | Adds an explicit Editor tab with strict saved System Default or Custom preference. |
| Keymap and slash-command registry | `Ctrl+B` and `/file-explorer` are peers backed by shared metadata and help text. |
| Local telemetry | Records only allow-listed coarse explorer outcomes when the user has opted in. |

## Core Features

| # | Feature | Priority | Description |
| --- | --- | --- |
| F1 | Session Workspace Tree | Critical | Lazily render directories and regular files for the focused session workspace; include hidden and ignored normal entries, exclude `.git`, and retain expanded paths, selection, and scroll position separately for each current-run session. |
| F2 | Explorer Navigation and Layout | Critical | `Ctrl+B` and `/file-explorer` share one toggle contract. Use a docked sidebar at readable widths and a temporary narrow full-pane fallback; arrows, Right/Enter, Left, `R`, and `Escape` follow the settled navigation rules. |
| F3 | Contained Entry Enforcement | Critical | Display only eligible entries; resolve and revalidate canonical containment before traversal or opening, hide broken or escaping links, detect changed targets, and fail closed without disturbing other sessions. |
| F4 | External File Opening | Critical | Only selected regular files open asynchronously. Keep the explorer visible and focused, report a concise outcome, and never launch a directory or block the cockpit. |
| F5 | Saved Editor Preference and Fallback | High | Support System Default or a validated Custom executable plus discrete arguments with exactly one `{file}` placeholder. Spawn direct argument vectors only; a failed custom launch tries the system default once and reports the final outcome. |
| F6 | Privacy-Safe Explorer Telemetry | High | When local telemetry is opted in, record only coarse explorer-open, refresh, file-open, and fallback outcomes—never paths, filenames, tree shape, editor configuration, arguments, error text, or stable identifiers. |

## KPIs

| KPI | Target | How to Measure |
| --- | --- | --- |
| Beta adoption | At least 60% of a defined opt-in beta cohort uses the explorer in 3 or more active sessions within 14 days | Combine a short consented beta check-in with each participant's local aggregate explorer-open count; collect no path or file data. |
| Workflow continuity | At least 80% of beta participants rate the explorer as reducing context switching during agent work | Post-task 5-point survey; count ratings of 4 or 5 only. |
| Launch-dispatch reliability | At least 95% of regular-file open attempts reach a successful final launcher dispatch | Aggregate only coarse local final outcomes: success, final failure, or fallback-success. |
| Fallback effectiveness | At least 90% of attempted custom-launch failures reach a successful system-default fallback dispatch | Aggregate only custom-failed/default-success and custom-failed/default-failed counters. |
| Containment regressions | 0 confirmed workspace-escape, link-race, or shell-invocation regressions before beta | Required deterministic source, launcher, config, and mounted UI security regression suites all pass in CI. |

## Feature Assessment

| Criteria | Question | Score |
| --- | --- | --- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Strong |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: Strategic Bet

## Council Insights

- **Recommended approach:** Ship the complete but narrow issue scope. Treat session ownership, centralized use-time containment, direct argv spawning, deterministic fallback, and content-free telemetry as V1 contracts rather than implementation refinements.
- **Key trade-offs:** Retaining contained links and custom-editor fallback fulfills the intended workflow but raises security and reliability cost; that cost is accepted only through one revalidating controller-owned gateway and exhaustive injected-seam tests.
- **Risks identified:** Symlink and time-of-check/time-of-use escapes, asynchronous cross-session leakage, command injection, fallback ambiguity, large-directory responsiveness, and telemetry privacy drift. Fail closed, use direct argument vectors, capture and recheck session identity, lazy-load, and enforce an allow-list telemetry schema.
- **Stretch goal (V2+):** Add deliberate, separately designed Context Pack curation actions to the explorer after the core external-opening workflow has proven repeat use.

## Out of Scope (V1)

- **Embedded code editing or preview** — Kitten launches the developer's established editor; it does not compete as an editor.
- **File mutations** — Create, rename, delete, move, save, permissions, and Git actions expand the safety boundary beyond the continuity hypothesis.
- **Search, full-text indexing, and watchers** — They add indexing, lifecycle, and performance complexity before repeated navigation demand is validated.
- **Git decorations and repository-specific filtering** — The explorer intentionally shows normal hidden and ignored workspace entries; Git status semantics belong to a separate feature.
- **Multiple roots, remote workspaces, and Windows support** — V1 is one focused Session Workspace on the presently supported macOS and Linux release matrix.
- **Arbitrary shell commands or templating** — Custom editors remain a validated executable plus discrete arguments, never shell text, environment interpolation, or flexible placeholders.
- **Cross-run explorer state persistence** — Expanded paths, selection, and scroll position are current-run session state, avoiding stale path and privacy concerns.

## Architecture Decision Records

- [ADR-001: Keep a safety-complete session explorer as the V1 boundary](adrs/adr-001.md) — Preserve the issue's complete workflow through centralized revalidation and shell-free launching rather than broadening into a workspace platform.

## Open Questions

- What beta cohort size and consent/retention process will make the adoption targets decision-useful while preserving Kitten's local-only telemetry model?
- What exact supported-platform launcher semantics count as a successful dispatch, given that an OS can spawn a handler without proving a GUI editor became usable?
- What terminal width threshold produces a readable docked sidebar across the supported terminal environments?
- When Context Pack work becomes active, what explicit curation action can the explorer expose without coupling navigation to content selection or bypassing review?
