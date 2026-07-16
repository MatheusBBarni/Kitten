# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

## Shared Decisions

## Shared Learnings

## Open Risks

- Tasks 08 and 10 cannot wire the default-off projection from their listed UI surfaces: the resolved `transcriptWindowingEnabled` value remains local to boot config and is not exposed through `SessionController`, `CockpitApp`, cockpit context, or `AppStore`. Task 08 is marked completed despite having no source implementation; downstream UI/telemetry work needs an explicitly authorized flag-delivery seam before proceeding.

## Handoffs
