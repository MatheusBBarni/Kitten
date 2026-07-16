# Import history before archiving Task Orchestrator

The relevant Task Orchestrator Git history will be imported into the Kitten monorepo alongside the migrated desktop application. After parity, data-migration, and release gates pass, the old GitHub repository will receive a relocation notice and be archived read-only; Kitten then becomes the sole active source of truth.

## Considered Options

- A squashed snapshot was rejected because it would preserve code while severing useful blame and migration history.
- Permanent repository deletion was rejected because it would break historical issue, pull request, commit, and external links without improving source-of-truth clarity beyond archival.

## Consequences

The import procedure must avoid rewriting existing Kitten history, document path mapping, and verify that relevant predecessor commits remain discoverable before archival is allowed.
