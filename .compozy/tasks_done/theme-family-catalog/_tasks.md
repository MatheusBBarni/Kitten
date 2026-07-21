---
schema_version: "compozy.tasks/v2"
workflow: theme-family-catalog
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
    - id: task_05
      file: task_05.md
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_01
      to: task_04
    - from: task_01
      to: task_05
    - from: task_02
      to: task_05
    - from: task_03
      to: task_04
    - from: task_03
      to: task_05
    - from: task_04
      to: task_05
---

# Theme Family Catalog Task List

This packet delivers the approved, accessibility-gated 18-preset theme-family catalog as one coherent release.
