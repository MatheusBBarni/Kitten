---
schema_version: "compozy.tasks/v2"
workflow: statusline-context-field
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
    - from: task_02
      to: task_03
    - from: task_03
      to: task_04
---

# Statusline Context Headroom Field Task List

## Graph

The graph is intentionally linear: each UI surface depends on the validated pure contract that precedes it.

| Task | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Harden per-session headroom validity | bugfix | low |
| task_02 | Add CONTEXT to pure statusline and proposal contracts | backend | medium |
| task_03 | Supply focused-session CONTEXT to the saved footer | frontend | medium |
| task_04 | Supply captured-session CONTEXT to preview and prove saved-layout parity | frontend | medium |
