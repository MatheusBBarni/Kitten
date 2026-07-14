# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

- Renderer tests that explicitly preload a non-Markdown grammar must first await `getTreeSitterClient().initialize()`; preloading an uninitialized OpenTUI client returns false even when its local assets are valid.
- OpenTUI may normalize an injected fence alias to its canonical parser filetype inside `CodeRenderable`; test declared labels at the manifest injection boundary and source preservation at the rendered selection boundary.

## Open Risks

## Handoffs
