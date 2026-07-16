---
schema_version: "compozy.tasks/v2"
workflow: mid-turn-steering
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
    - id: task_06
      file: task_06.md
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_01
      to: task_04
    - from: task_02
      to: task_05
    - from: task_03
      to: task_05
    - from: task_04
      to: task_05
    - from: task_02
      to: task_06
    - from: task_05
      to: task_06
---

# Mid-Turn Steering Task List

This graph implements the lossless, provider-neutral mid-turn steering contract in the approved PRD and TechSpec. Graph topology belongs only to this manifest; each task contains its own required unit and integration coverage.

## Execution Notes

- Preserve the core/store/controller/adapter/UI boundaries defined in the TechSpec.
- Treat raw queued or recovered steering text as live-only data; never persist, replay, or emit it.
- Preserve unrelated working-tree changes and validate the graph before execution.
