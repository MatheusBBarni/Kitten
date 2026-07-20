---
schema_version: "compozy.tasks/v2"
workflow: concurrent-mcp-calls
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
    - from: task_03
      to: task_04
    - from: task_03
      to: task_05
---

# Reliable Concurrent MCP Calls for Supervised Work Task List

This packet repairs same-session MCP concurrency without adding a scheduler,
persistence, shared capacity, or automatic replay. The graph first establishes
the controller lifecycle contract and the protocol-free failure state; bridge,
ACP, and UI work then proceed along their independent, declared paths.
