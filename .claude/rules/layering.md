# Architecture Layering

Kitten is layered so that protocol churn, I/O, and UI concerns each stay contained.
Keep every concern in its layer.
The rationale for each boundary is in the ADRs under `.compozy/tasks_done/kitten-agent-tui/adrs/`.

## Rules

- **ACP lives only in `src/agent/`.**
  No `@agentclientprotocol/sdk` wire type may appear in `src/core`, `src/store`, `src/app`, or `src/ui`.
  The adapter (`agentConnection.ts` + `acpTranslate.ts`) is the sole translator of ACP into Kitten's protocol-free `DomainSessionEvent`s.
  If a UI or store change makes you want to import an ACP type, translate it in the adapter instead.

- **`src/core/` is pure.**
  No I/O, no ACP, no React, no timers, no `process`/`Bun` access.
  Same input, same output.
  `sessionReducer` is the single writer of `SessionState`; derived fields (`referencedFiles`, `pendingDiffs`) are recomputed there, never patched by hand elsewhere.

- **The store is the only mutable app state.**
  Mutate it only through its methods, and apply session changes only via `store.applyEvent` (which routes through the reducer).
  Never build a `SessionState` inline in the store or a view.
  State stays immutable with structural sharing, so an untouched session keeps its identity and its selector subscribers stay silent - do not replace whole objects when only a slice changed.

- **The UI reaches agents only through `ControllerActions`** (`src/app/actions.ts`).
  A view never holds an `AgentConnection`, never calls `connection.prompt`, and never writes session state.
  Add a new capability to the action surface, then call it from the view.

- **Views subscribe narrowly.**
  Read state through selectors (`src/store/selectors.ts`) so a streamed token in one session never re-renders another.
  Add a selector rather than reading `getState()` broadly inside a component.

## Quick check

Before adding an import, ask which layer the file is in and whether the import crosses a boundary above.
If it does, the logic belongs in a different layer.
