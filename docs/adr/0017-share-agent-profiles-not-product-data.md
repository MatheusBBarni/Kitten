# Share agent profiles, not product data

Kitten Cockpit and Kitten Orchestrator will use one versioned user-level Agent Profile Registry for certified launch recipes and readiness. Cockpit conversations and Orchestrator projects, queue, work lineages, attempts, budgets, and review evidence remain in separate app-owned stores with independent migrations; provider credentials remain owned by the provider tools rather than the registry.

## Considered Options

- Fully separate profile configuration was rejected because it duplicates setup and allows the two apps to disagree about the same local agent readiness.
- One shared application database was rejected because it couples independent releases and broadens every schema migration across unrelated product state.

## Consequences

The profile schema needs backward-compatible versioning across independently released apps. Cross-app workflows exchange explicit artifacts or references rather than reading each other's private stores.
