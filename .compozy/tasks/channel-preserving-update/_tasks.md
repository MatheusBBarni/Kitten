---
schema_version: "compozy.tasks/v2"
workflow: channel-preserving-update
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
    - from: task_02
      to: task_03
    - from: task_03
      to: task_04
    - from: task_01
      to: task_05
    - from: task_04
      to: task_05
    - from: task_04
      to: task_06
    - from: task_05
      to: task_06
---

# Channel-Preserving Update Task List

## Execution Plan

1. `task_01` defines the standalone update contracts and deterministic validation primitives.
2. `task_02` establishes installer-created standalone provenance records.
3. `task_03` implements the fail-closed standalone update transaction.
4. `task_04` exposes the standalone transaction through the compiled CLI before normal boot.
5. `task_05` adds the separately proven global npm update path.
6. `task_06` aligns help and public documentation with the completed command behavior.

## Graph Notes

- The graph is intentionally acyclic. `task_01` is the shared contract root; `task_02` and `task_03` build the standalone path; `task_04` gates the public CLI surface; `task_05` adds the Node-owned npm path; `task_06` documents both verified channels.
- Every task owns its behavioral and integration tests. No node exists only to add tests.
