---
schema_version: "compozy.tasks/v2"
workflow: clarification-question-picker
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
    - id: task_10
      file: task_10.md
    - id: task_11
      file: task_11.md
    - id: task_12
      file: task_12.md
  edges:
    - from: task_01
      to: task_02
    - from: task_02
      to: task_03
    - from: task_01
      to: task_04
    - from: task_02
      to: task_04
    - from: task_02
      to: task_05
    - from: task_01
      to: task_06
    - from: task_04
      to: task_06
    - from: task_05
      to: task_06
    - from: task_06
      to: task_07
    - from: task_07
      to: task_08
    - from: task_07
      to: task_09
    - from: task_07
      to: task_10
    - from: task_03
      to: task_11
    - from: task_05
      to: task_11
    - from: task_06
      to: task_11
    - from: task_01
      to: task_12
    - from: task_03
      to: task_12
    - from: task_04
      to: task_12
    - from: task_06
      to: task_12
    - from: task_08
      to: task_12
    - from: task_09
      to: task_12
    - from: task_10
      to: task_12
    - from: task_11
      to: task_12
---

# Clarification Question Picker Task List

| ID | Task | Type | Complexity |
|---|---|---|---|
| task_01 | Add fail-closed ACP capability classification and contract gate | backend | high |
| task_02 | Add core clarification model and status compatibility | backend | high |
| task_03 | Complete clarification attention presentation and regression coverage | frontend | medium |
| task_04 | Map verified ACP elicitation into the adapter boundary | backend | high |
| task_05 | Replace the permission queue with a controller interaction coordinator | refactor | high |
| task_06 | Project clarification interactions through actions, store, and selectors | backend | high |
| task_07 | Build the clarification dialog and keyboard workflow | frontend | high |
| task_08 | Suspend approval and handoff modal handlers during clarification preemption | frontend | high |
| task_09 | Suspend sessions, session-picker, and model-selector handlers during clarification preemption | frontend | high |
| task_10 | Suspend settings modal handler during clarification preemption | frontend | medium |
| task_11 | Extend content-free clarification telemetry and notification coverage | backend | high |
| task_12 | Add end-to-end clarification lifecycle regression coverage | test | high |
