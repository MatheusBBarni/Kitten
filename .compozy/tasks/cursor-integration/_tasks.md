---
schema_version: "compozy.tasks/v2"
workflow: cursor-integration
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
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_03
      to: task_02
    - from: task_01
      to: task_05
    - from: task_01
      to: task_06
    - from: task_02
      to: task_04
    - from: task_03
      to: task_04
    - from: task_02
      to: task_07
    - from: task_03
      to: task_07
    - from: task_04
      to: task_07
    - from: task_05
      to: task_07
    - from: task_06
      to: task_07
    - from: task_01
      to: task_08
    - from: task_02
      to: task_08
    - from: task_03
      to: task_08
    - from: task_04
      to: task_08
    - from: task_05
      to: task_08
    - from: task_06
      to: task_08
    - from: task_07
      to: task_08
---

# Cursor Integration Task List

| Task | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Add Cursor provider identity and runtime-profile config | backend | medium |
| task_02 | Add Cursor readiness preflight and recovery messages | backend | medium |
| task_03 | Authenticate certified Cursor profiles at the ACP boundary | backend | medium |
| task_04 | Extend runtime orchestration and content-free telemetry for Cursor | backend | high |
| task_05 | Preserve fail-closed clarification and persistence behavior | backend | medium |
| task_06 | Render Cursor through shared provider metadata | frontend | medium |
| task_07 | Add Cursor onboarding, docs, and reviewed-handoff regression coverage | docs | high |
| task_08 | Add the opt-in Cursor contract and certify the production profile | infra | high |
