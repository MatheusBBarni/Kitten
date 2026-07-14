# Idea: Slash-Command Menu (`/`)

## Overview

Kitten's capabilities are reachable today only through control and function-key chords, and the focused agent's own slash commands are received over ACP and thrown away.
The result is a cockpit whose best features - above all the one-keystroke hand-off - are invisible to anyone who has not memorized a keymap.

This feature adds a `/` command menu to the prompt editor: a searchable, keyboard-driven list that unifies Kitten's own cockpit actions with the focused agent's advertised commands, grouped by source.
It is aimed squarely at discoverability.
Every cockpit row prints its keyboard shortcut, so the menu also teaches the faster chords rather than replacing them.
V1 is deliberately a Quick Win that also stands up a differentiator: no single-agent CLI can show "what this cockpit does" and "what this agent does" in one place, because none holds two live agent sessions at once.
Alongside the menu, a near-free persistent footer hint makes the marquee Ctrl+T hand-off visible from the first session.

## Problem

Every capability in Kitten sits behind an invisible chord.
Ctrl+T hands a task between agents, Ctrl+O switches focus, F1 opens help - but a returning or first-time user has no way to find any of this short of reading the README.
The cost is highest for the one feature that is the product's entire reason to exist: if a new user never discovers the hand-off, they never experience Kitten as anything more than a plain agent wrapper.

Worse, the focused agent's own slash commands are strictly less reachable inside Kitten than outside it.
The ACP adapter receives the agent's advertised command list over the wire and discards it (`acpTranslate.ts:53`), so a Codex or Claude Code user inside Kitten has fewer commands available than they would in that agent's native CLI.
For that user, it is a reason to go back to the native CLI.

The current mitigation - a static help panel behind F1 - is itself a hidden chord, and it lists only Kitten's bindings, never the agent's live commands.
It cannot filter, and it does not scale as the command surface grows.

### Market Data

- In a Mozilla study of ~69,000 users over seven days, **81% never used Ctrl+F once** (85% among self-identified beginners), and Google research puts the figure near 90% of web users who do not know the shortcut exists.
  Hidden keyboard features get near-zero organic adoption - a direct read on Kitten's undiscovered hand-off.
- **Every mainstream AI coding CLI already ships a `/` menu** - Claude Code, OpenAI Codex, GitHub Copilot CLI, Gemini CLI, Aider, Cursor, and Warp's unified command palette.
  Kitten is the conspicuous outlier without one, so this is table-stakes parity as much as it is an opportunity.
- The pinned ACP SDK (v1.2.1) **already delivers agent commands** via an `available_commands_update` server-push, including per-command argument hints (`input.hint`), and commands can change mid-session, so the agent half needs zero protocol work, only translation Kitten currently skips.
- Claude Code shipped a bug where built-in commands get buried once many commands load, which argues for ranking and grouping from day one rather than a flat list.

## Summary / Differentiator

Every competitor's `/` menu is single-agent: it shows one model's commands plus that tool's own actions.
Kitten holds two live agent sessions, so one palette can group Cockpit, Claude Code, and Codex capabilities in a single searchable surface.
It can also make the signature Ctrl+T hand-off something a new user finds by typing `/`, while learning the chord printed beside it.
The palette is the first screen that shows Kitten working as a cockpit rather than a wrapper.

## Core Features

| #  | Feature | Priority | Description |
| -- | ------- | -------- | ----------- |
| F1 | Unified `/` palette | Critical | Searchable, keyboard-driven dropdown in the prompt editor, grouped by source (Cockpit / focused agent). Up/Down to move, Enter to invoke, Esc to dismiss. |
| F2 | ACP command surface | Critical | Translate `available_commands_update` into live domain state (new event to reducer field to selector, mirroring `plan`) so the focused agent's advertised commands appear and update mid-session. |
| F3 | Token-begin trigger + invoke-not-send | Critical | Menu arms only when `/` begins a token (input start or after whitespace); disarms on no-match or caret leaving the token. Enter runs a Kitten action locally (hand-off opens its preview) or inserts an agent command's text for manual send. Never auto-sends. |
| F4 | Teaching affordances | High | Cockpit actions rank first; each cockpit row prints its keyboard shortcut; agent commands show ACP `input.hint` argument text inline. |
| F5 | Hand-off footer hint | High | A persistent one-line affordance teaching Ctrl+T, so the marquee hand-off is visible from session one without opening any menu. |
| F6 | Resilient states | Medium | A not-ready agent's commands are shown-but-disabled with a reason; an explicit, non-broken no-match state that lets Enter fall through to a normal prompt submit. |

## KPIs

| KPI | Target | How to Measure |
| --- | ------ | -------------- |
| First-session hand-off rate (north-star) | >= 50% of first sessions perform a hand-off | Content-free counter of hand-off events keyed to the session's launch ordinal |
| Menu-driven action share | > 30% of cockpit-action invocations flow through `/` within first month | Per-action counter tagged `source: menu \| chord` |
| Agent-command adoption | >= 25% of sessions invoke >= 1 agent-advertised command via the menu | Counter on agent-command insertions (baseline 0 today) |
| Command breadth per session | Median distinct commands invoked >= 4 (baseline ~2 known chords) | Count distinct command ids per session |
| Filter responsiveness | Open + filter renders < 16ms (one frame); 0 extra transcript re-renders per keystroke | Perf timing in self-check + render-count assertion in tests |

## Feature Assessment

| Criteria | Question | Score |
| -------- | -------- | ----- |
| **Impact** | How much more valuable does this make the product? | Strong |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Strong |
| **Differentiation** | Does this set us apart or just match competitors? | Maybe (Strong via two-agent grouping + discoverable hand-off) |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe (compounds only as it grows into a control surface) |
| **Feasibility** | Can we actually build this? | Strong |

Leverage type: **Quick Win evolving into a Strategic Bet** - table-stakes parity with a real discoverability payoff now, and a clean path to a compounding two-agent control surface later.

## Council Insights

- **Recommended approach:** Build the non-modal, editor-local palette in V1 with the token-begin trigger guard, keep the cheap ACP command slice, and fold in the near-free footer hint.
  Command *data* flows through the reducer as domain state; menu state stays local to the editor.
  Land the ACP slice as its own PR first.
- **Key trade-offs:** Non-modal (filter-as-you-type, editor stays focused) vs. modal (reuses tested infrastructure but blurs the editor), resolved toward non-modal because "the render is the signal" makes Enter deterministic rather than ambiguous.
  Cheap parity vs. differentiated palette, resolved by keeping four low-cost polish details (grouping, cockpit-first ranking, shortcut hints, arg hints) that separate a workbench from a bare command list.
- **Risks identified:** Trigger edge cases on paths/URLs/code (mitigated by token-begin guard plus no-match disarm); ranking burying the hand-off (cockpit-first ordering); live command state (reactive selector); merge conflict with the parallel Ctrl+S sessions task (ship the ACP slice separately, keep keymap additive); a new non-modal overlay concept and fiddly key capture on the highest-traffic surface (cover with tests before enabling).
- **Stretch goal (V2+):** A hand-off-aware cockpit control surface.
  `/handoff` previews inline what will move and to which agent, and the user can hand off directly into the receiver agent's `/review` or `/test` in one gesture.
  This is the compounding, defensible version, deferred because it couples two agents' command lifecycles and adds a second curation surface.

## Integration with Existing Features

| Integration Point | How |
| ----------------- | --- |
| `src/ui/keymap.ts` (`COCKPIT_KEYMAP`) | Single source of cockpit action labels + shortcut hints rendered on menu rows; keymap edits stay additive. |
| `src/agent/acpTranslate.ts` to `core/types.ts` to `sessionReducer.ts` to `selectors.ts` | New command domain state, mirroring the existing `plan` flow end to end; no ACP type escapes the adapter. |
| `src/ui/PromptEditor.tsx` | Hosts the non-modal overlay; `onContentChange` detects the token, `onKeyDown` captures nav keys before submit. |
| `src/app/handoff.ts` (`HandoffFlow`) + `src/app/actions.ts` (`ControllerActions`) | Invoke-thunks route only here; hand-off still opens its preview; agent-command insertion touches only the textarea. |
| `src/ui/StatusStrip.tsx` | Hosts the persistent Ctrl+T footer hint. |

## Sub-Features

- **ACP command slice** - the vertical slice that turns `available_commands_update` into live, selectable domain state.
- **Palette overlay** - the non-modal editor-local menu: trigger, filter, grouping, ranking, key capture, invoke-not-send.
- **Footer affordance** - the persistent hand-off hint in the status strip.

## Out of Scope (V1)

- **Inline hand-off preview in the dropdown** - deferred to V2; it is a second render surface with its own curation state, and forcing it into V1 delays the discoverability win.
- **Cross-agent command routing** (hand off directly into the receiver's `/review`) - V2; it couples two agents' command lifecycles, which is real design and real risk.
- **The non-focused agent's commands in the menu** - V1 shows only the focused agent's list; a full two-agent capability view belongs to the V2 control surface.
- **Nested / subcommand completion** (Gemini-style) - V1 ships a flat filtered list; hierarchical completion is a refinement, not a discoverability blocker.
- **Fuzzy typo-tolerant scoring** - V1 uses simple ranked prefix/substring matching with cockpit-first ordering; relevance scoring (for example, command-score) is a later polish.

## Architecture Decision Records

- [ADR-001: `/` command menu - V1 scope, trigger model, and state ownership](adrs/adr-001.md) - non-modal editor-local palette, token-begin trigger guard, command data as reducer state / menu as local view state, footer affordance adopted, control surface deferred to V2.

## Open Questions

- Baseline and precise target for first-session hand-off rate - needs real opt-in telemetry to calibrate the >= 50% figure.
- How to anchor a dropdown over the OpenTUI textarea without disturbing the transcript (absolutely-positioned box, reserved rows) - a techspec concern.
- Footer content and screen-space budget in `StatusStrip` - static Ctrl+T only, or rotating core chords?
- Agent-command insertion mechanics - include the leading `/` and a trailing space, and where to place the cursor for argument entry?
- Merge/sequencing order with the live Ctrl+S sessions task that touches keymap/store/selectors.
- Ranking beyond cockpit-first (recency or usage boosting) - keep V1 simple and revisit with data?
