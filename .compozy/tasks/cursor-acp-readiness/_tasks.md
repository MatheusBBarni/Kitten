---
schema_version: "compozy.tasks/v2"
workflow: cursor-acp-readiness
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
      to: task_07
    - from: task_07
      to: task_03
    - from: task_02
      to: task_04
    - from: task_03
      to: task_04
    - from: task_04
      to: task_05
    - from: task_05
      to: task_06
---

# Cursor ACP Readiness Task List

## Graph

`task_01` establishes the fail-closed contract. `task_02` provides native config evidence while `task_07` projects bounded recovery state; that safe state unblocks the targeted recheck in `task_03`. Native evidence and targeted recovery then unblock `task_04`; `task_05` aligns the user-facing boundary, and `task_06` is the reviewed native-certification gate.
