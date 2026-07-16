# Release the applications independently

Kitten Cockpit and Kitten Orchestrator will have independent versions, tags, changelogs, artifacts, and release workflows. Shared Capability packages remain internal workspace dependencies consumed at the monorepo revision each application releases, so a change in one app does not force an unrelated release of the other.

## Considered Options

- A lockstep Kitten version was rejected because the TUI binary/npm distribution and Electrobun desktop distribution have different build matrices and release cadences.
- Leaving Orchestrator unversioned was rejected because it would postpone defining update, migration, and rollback contracts until after users have persistent desktop data.

## Consequences

The monorepo release configuration must scope changes and gates per app, while shared-package changes must trigger all affected app test matrices without forcing simultaneous publication.
