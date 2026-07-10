# Dependency Discipline

`bunfig.toml` pins dependencies exactly (`exact = true`) and enforces a minimum-release-age supply-chain guard.
This is deliberate, not incidental.

## Rules

- **Never widen a version range.**
  Add and keep dependencies at exact versions.
  Do not change a pin to `^`/`~` or bump a version casually.

- **Pin the fast-moving cores by hand.**
  `@opentui/core`, `@opentui/react`, `@agentclientprotocol/sdk`, and the platform-specific `@opentui/core-*` native packages are pre-1.0 and are hard-pinned and allow-listed against the age guard in `bunfig.toml`.
  A version change to any of these is a deliberate, tested upgrade - not a routine bump.
  Keep the allow-list in sync with what is actually depended on.

- **The ACP adapter packages are pinned on purpose.**
  The default provider recipes launch pinned adapter packages (`@agentclientprotocol/claude-agent-acp`, `@agentclientprotocol/codex-acp`).
  Pinning is the mitigation against an adapter changing its handshake beneath a running install; do not float these to `latest`.

- **Respect the age guard for everything else.**
  New transitive or direct dependencies stay under the minimum-release-age guard.
  If a needed native/transitive package must be exempted, add it to `minimumReleaseAgeExcludes` with a one-line reason, matching the existing entries.

## Before adding a dependency

Prefer the standard library, Bun built-ins, or existing deps first.
A terminal app has no browser DOM; do not pull in DOM-oriented packages.
