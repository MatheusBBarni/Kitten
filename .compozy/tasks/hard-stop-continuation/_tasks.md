---
schema_version: "compozy.tasks/v2"
workflow: hard-stop-continuation
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
      to: task_04
    - from: task_03
      to: task_04
    - from: task_04
      to: task_05
    - from: task_03
      to: task_06
    - from: task_04
      to: task_06
---

# Hard Stop Continuation Task List

This graph implements Issue #32's safe, same-session continuation path. Each task includes its own focused verification; topology belongs exclusively to this manifest.

## Execution Notes

- Read `_prd.md`, `_techspec.md`, and the ADRs before implementation.
- Preserve the ACP-to-core-to-store-to-UI ownership boundaries and all fail-closed rules.
- Do not persist, emit, log, diagnose, or hand off queued continuation content.
- Preserve unrelated working-tree changes.
