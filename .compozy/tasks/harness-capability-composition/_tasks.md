---
schema_version: "compozy.tasks/v2"
workflow: harness-capability-composition
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
    - from: task_02
      to: task_04
---

# Harness Capability Composition Task List

This packet implements truthful optional harness guidance through a pure, default-deny capability composer, fresh-generation controller integration, an envelope-only adapter, and bounded opt-in telemetry. The graph keeps the domain contract independent and makes the two post-controller concerns safely parallel.

