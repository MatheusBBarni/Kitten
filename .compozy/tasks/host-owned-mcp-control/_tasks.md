---
schema_version: "compozy.tasks/v2"
workflow: host-owned-mcp-control
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
    - id: task_07
      file: task_07.md
  edges:
    - from: task_01
      to: task_02
    - from: task_02
      to: task_03
    - from: task_03
      to: task_05
    - from: task_04
      to: task_05
    - from: task_05
      to: task_06
    - from: task_06
      to: task_07
---

# Host-Owned MCP Child Control Task List

This graph delivers the bounded provider-neutral `agent_run` MCP control surface while retaining visible Kitten-owned child conversations, capability-derived ownership, and content-free telemetry.

## Execution Notes

- The graph above is the sole source of task dependencies.
- Preserve unrelated working-tree changes and keep MCP wire types out of core and store layers.
- Every task must satisfy its embedded unit and integration test requirements before completion.
