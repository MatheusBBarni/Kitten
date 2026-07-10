# Resilience: Degrade, Never Crash

A broken agent is a *state*, not an exception.
One agent failing must never take down the cockpit or the other agent.

## Rules

- **Startup degrades per agent.**
  `createSessionController` never rejects.
  A missing binary, a rejected handshake, or a failed `session/new` marks that one session not-ready with a legible reason and leaves every other session fully usable.
  Preserve this: never let one session's failure throw out of the controller build.

- **Every action degrades.**
  An action on a not-ready session is a no-op; a connection that fails mid-call reports through `onError` and returns `null`/void rather than throwing.
  When adding an action, wrap the connection call and route failures to `onError`.

- **A UI callback fired from a keypress must never reject into the React tree.**
  Handlers that call async actions must swallow or route the rejection, not `await` it into an unhandled promise.

- **Surface the reason, never a dead screen.**
  The two boot gates (repo gate, readiness gate) print the exact blocking reason and exit non-zero rather than mounting an inert cockpit.
  Keep new failure paths legible: carry the actionable message (e.g. the agent's own "not logged in") through to the user verbatim.

- **A malformed config is a hard error, not a silent fallback.**
  A config file that exists but fails to parse or validate throws `ConfigError` naming the offending field.
  Never fall back to defaults the user did not ask for.

## Anti-patterns

- `throw` inside controller startup or an action for an expected failure (agent down, bad config value).
- Auto-approving or auto-cancelling a permission request to avoid handling the not-ready path.
- Swallowing an error without routing it to `onError` or a user-visible reason.
