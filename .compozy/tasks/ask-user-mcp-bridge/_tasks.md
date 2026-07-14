---
schema_version: "compozy.tasks/v2"
workflow: ask-user-mcp-bridge
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
    - from: task_01
      to: task_03
    - from: task_01
      to: task_07
    - from: task_03
      to: task_04
    - from: task_04
      to: task_05
    - from: task_02
      to: task_06
    - from: task_05
      to: task_06
    - from: task_07
      to: task_06
---

# Ask User MCP Bridge Task List

This graph implements the provider-independent, session-bound `ask_user` bridge described in the PRD and TechSpec. The graph is acyclic; every task contains its own required unit and integration coverage.

## Execution Notes

- Task topology belongs only to this manifest.
- Follow the TechSpec build order and retain all protocol boundaries.
- Preserve unrelated working-tree changes.
