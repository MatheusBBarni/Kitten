---
status: pending
title: "Session identity and store refactor"
type: refactor
complexity: critical
dependencies: []
---

# Task 01: Session identity and store refactor

## Overview
Replace Kitten's two-agent-keyed model with an N-session model keyed by a Kitten-assigned `SessionId`, splitting provider kind from instance identity so two sessions of the same provider can coexist.
This is the behavior-preserving foundation every later task builds on: the app still boots exactly two sessions in one directory and every existing test stays green, but the store, types, and selectors now speak in sessions rather than agents.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details - do not duplicate here
- FOCUS ON "WHAT" - describe what needs to be accomplished, not how
- MINIMIZE CODE - show code only to illustrate current structure or problem areas
- TESTS REQUIRED - every task MUST include tests in deliverables
</critical>

<requirements>
- MUST rename the `AgentId` union to `ProviderKind` and introduce an opaque `SessionId` instance identity assigned at construction, per the TechSpec "Core Interfaces" section and ADR-004.
- MUST reshape `SessionState` to carry `id`, `providerKind`, `title`, `cwd`, optional `task`, and `acpSessionId` (the ACP id renamed from `sessionId`), per the TechSpec "Data Models" section.
- MUST change `AppState` to `sessions: Record<SessionId, SessionState>`, `order: SessionId[]`, and `focusedSessionId`, and re-key every selector in `store/selectors.ts` by `SessionId`.
- MUST preserve behavior: seed one session per configured provider in a single working directory, keep focus semantics identical, and keep the entire existing `bun test` suite green.
- MUST NOT introduce `finished`/`error` states, the sessions overlay, per-session `cwd` configuration, or notifications; those belong to later tasks.
</requirements>

## Subtasks
- [ ] 1.1 Rename `AgentId` to `ProviderKind` and add the `SessionId` type in the core.
- [ ] 1.2 Reshape `SessionState` with `id`, `providerKind`, `title`, `cwd`, `task`, and `acpSessionId`.
- [ ] 1.3 Convert the store to `Record<SessionId>` + `order` + `focusedSessionId`, updating `startSession`, `setFocus`, and `applyEvent` to key by `SessionId`.
- [ ] 1.4 Re-key all selectors and their UI call sites by `SessionId`.
- [ ] 1.5 Seed two sessions from the existing default config and confirm the whole suite stays green.

## Implementation Details
The change is a project-wide, behavior-preserving rename plus a store reshape.
Follow the TechSpec "Core Interfaces" and "Data Models" sections for the target type shapes; do not add new behavior.
`AGENT_IDS` becomes the seed order for the two default sessions, each given a generated `SessionId` and the process working directory as its `cwd`.
The controller's `Map<AgentId, AgentRuntime>` and the actions' `nextAgentId`/`switchFocus` targeting move to `SessionId`.

### Relevant Files
- `src/core/types.ts` - defines `AgentId`, `AgentStatus`, `SessionState`; home of the union rename and the reshaped session record.
- `src/store/appStore.ts` - `AppState`, `AGENT_IDS`, `initialSessions`, `setFocus`, `startSession`; the collection and focus reshape.
- `src/store/selectors.ts` - every selector keys by `AgentId` today and must key by `SessionId`.
- `src/app/actions.ts` - `switchFocus`, `nextAgentId`, `AgentSession` targeting move to `SessionId`.
- `src/app/controller.ts` - `runtimes` map keying and `startSession(id, acpSessionId)` calls.

### Dependent Files
- `src/ui/StatusStrip.tsx`, `src/ui/ConversationView.tsx`, `src/ui/PromptEditor.tsx`, `src/ui/CockpitApp.tsx`, `src/ui/cockpitContext.tsx` - read selectors keyed by the old `AgentId`.
- `src/app/handoff.ts`, `src/agent/agentConnection.ts`, `src/telemetry/recorder.ts`, `src/config/*` - reference `AgentId` across roughly 114 sites.

### Related ADRs
- [ADR-004: N-Session Identity Model - Split Provider Kind from Instance Identity](../adrs/adr-004.md) - defines the `SessionId`/`ProviderKind` split and the store collection shape.
- [ADR-001: N-Session Model as Infrastructure Beneath the Hand-off Wedge](../adrs/adr-001.md) - why this is the load-bearing substrate.

## Deliverables
- `ProviderKind`/`SessionId` types and a reshaped `SessionState`.
- An N-capable store (`Record<SessionId>` + `order` + `focusedSessionId`) with all selectors re-keyed.
- Two default sessions seeded with identical behavior to today.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration test booting two sessions with unchanged behavior **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] `setFocus(sessionId)` moves `focusedSessionId` and notifies only that session's focus subscribers, leaving other slices' identity unchanged under `Object.is`.
  - [ ] `applyEvent(sessionId, event)` updates only the target session's slice; a second session's slice keeps reference identity.
  - [ ] `initialSessions` seeds one session per provider with distinct `SessionId`s, the default `cwd`, and `title` from the provider display name.
  - [ ] `startSession(sessionId, acpSessionId)` binds the ACP id onto that session and resets its transcript.
- Integration tests:
  - [ ] Boot the controller with the two default providers against mock connections and assert two ordered sessions, focus on the first ready session, and that the existing approval and hand-off flows still pass unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No `AgentId` references remain except the deliberate `ProviderKind` rename
- Boot behavior, focus, and the existing hand-off and approval flows are unchanged
