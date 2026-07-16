---
schema_version: "compozy.tasks/v2"
workflow: managed-child-worktrees
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
    - id: task_08
      file: task_08.md
    - id: task_09
      file: task_09.md
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_03
      to: task_04
    - from: task_04
      to: task_05
    - from: task_05
      to: task_06
    - from: task_02
      to: task_07
    - from: task_05
      to: task_07
    - from: task_02
      to: task_08
    - from: task_06
      to: task_08
    - from: task_05
      to: task_09
    - from: task_06
      to: task_09
---

# Managed Child Worktrees Task List

| Task | Type | Complexity | Summary |
| --- | --- | --- | --- |
| 01 | refactor | high | Add immutable protocol-free managed-worktree state and guarded store transitions. |
| 02 | refactor | low | Add one memoized review presentation for all workspace consumers. |
| 03 | backend | high | Create the injected Git provisioner with verified pre-registration allocation. |
| 04 | backend | high | Add reconciliation and non-force cleanup to the managed Git lifecycle. |
| 05 | backend | high | Make child launch transactional and expose terminal-only cleanup actions. |
| 06 | backend | high | Persist V4 bindings and reconcile them safely during restore. |
| 07 | frontend | medium | Disclose committed-base launch semantics and compact tab identity. |
| 08 | frontend | high | Add detailed terminal review and contextual cleanup confirmation. |
| 09 | backend | medium | Emit opt-in, content-free managed-worktree lifecycle telemetry. |
