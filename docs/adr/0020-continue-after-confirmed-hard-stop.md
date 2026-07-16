# Continue after a confirmed Hard Stop without duplicating the harness

## Status

Accepted

## Decision

Kitten distinguishes a confirmed **Hard Stop** from an indeterminate first-prompt failure. When the controller has requested cancellation and the original prompt reaches its terminal boundary in the same live generation, it records a fresh-session harness as `settled_interrupted`. This terminal state permits one **Post-Interrupt Continuation** to be queued while cancellation settles and sent as the next ordinary prompt in the same session. The same queue behavior applies after every explicit Hard Stop; only the first harness-bearing turn receives the additional `settled_interrupted` bookkeeping. Kitten sends no duplicate harness and does not claim that the provider consumed the original harness.

If cancellation fails, times out, the connection errors, or the session generation changes before terminal settlement, the harness delivery remains failed. The pending continuation stays visible and `/new` is the explicit recovery path; Kitten never sends it into an uncertain session.

## Considered Options

- Keep every post-dispatch cancellation failed and require `/new`. This preserved the earlier conservative delivery rule but made an explicit interrupt prevent ordinary continued work.
- Treat cancellation settlement as `delivered`. This enabled continuation but incorrectly represented provider consumption as known.
- Resend the harness with the continuation. This could duplicate host guidance after the first request had reached the provider.

## Consequences

- The harness lifecycle gains a truthful `settled_interrupted` terminal state, distinct from both `delivered` and `failed`, and its content-free checkpoint persists that state.
- The composer may hold exactly one visible Post-Interrupt Continuation until the active turn settles; it must not create a concurrent prompt or route the message through steering. A later draft remains editable, and a second Escape cancels the queued continuation back into the composer without issuing another provider cancellation.
- Pending continuation text remains live-only and is excluded from persistence, telemetry, diagnostics, and handoff content.
- This supersedes the cancellation portion of the fail-closed policy in [harness-delivery ADR-001](../../.compozy/tasks_done/harness-delivery/adrs/adr-001.md); its other generation, privacy, and indeterminate-failure protections remain in force.
