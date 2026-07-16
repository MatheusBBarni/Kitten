# Copy predecessor data idempotently

On first launch, Kitten Orchestrator will detect supported Task Orchestrator data and offer a previewed, explicit Predecessor Import. The importer copies projects, queue/work history, review evidence, budgets, and supported settings through versioned migrations into Orchestrator-owned storage, records completion, and leaves the predecessor store untouched for rollback.

## Considered Options

- Starting fresh was rejected because repository retirement should not strand useful local work and review history.
- Migrating the predecessor database in place was rejected because it makes rollback destructive and lets independently versioned applications contend for one mutable store.

## Consequences

The import must be idempotent, resumable after failure, schema-version-aware, and explicit about unsupported or skipped records. Archive readiness requires fixtures and verification evidence for every supported predecessor schema version.
