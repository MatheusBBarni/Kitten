---
schema_version: "compozy.tasks/v2"
workflow: statusline-item-colors
graph:
  nodes:
    - id: task_01
      file: task_01.md
    - id: task_02
      file: task_02.md
    - id: task_03
      file: task_03.md
    - id: task_04
      file: task_04.md
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_01
      to: task_04
---

# Statusline Item Colors Task List

This graph delivers the field-only, canonical foreground-color capability
defined by the statusline-item-colors PRD and TechSpec. Every task owns its
test coverage; graph relationships exist only in the frontmatter above.

## Task Summary

| ID | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Extend Core Statusline Color Contract | refactor | medium |
| task_02 | Persist Canonical Statusline Colors Safely | refactor | high |
| task_03 | Define Strict Colored Statusline Proposal Grammar | refactor | medium |
| task_04 | Render Shared Colored Statusline Segments | frontend | high |

## Execution Notes

- Run the focused tests named by each task before moving to the full regression
  gate owned by the completing implementation work.
- Preserve the existing no-write-before-confirmation and no-watcher-writeback
  contracts while exercising color-aware layouts.
- Keep generated task dependencies in this manifest; individual task files do
  not duplicate graph topology.
