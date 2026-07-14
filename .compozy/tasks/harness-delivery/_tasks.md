---
schema_version: "compozy.tasks/v2"
workflow: harness-delivery
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
      to: task_03
    - from: task_02
      to: task_03
    - from: task_01
      to: task_04
    - from: task_03
      to: task_04
    - from: task_03
      to: task_05
    - from: task_04
      to: task_05
---

# Harness Delivery Task List

Implement the fresh-conversation harness lifecycle in five independently executable slices. Issue #18's protocol-free harness contract is an external prerequisite for task_01 and task_02.

| Task | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Define Generation-Scoped Harness Delivery State | refactor | medium |
| task_02 | Add Certified Runtime Profiles and Adapter Envelope | refactor | high |
| task_03 | Route First Prompts Through Controller-Owned Delivery | refactor | high |
| task_04 | Persist Content-Free Delivery Checkpoints Across Restore | refactor | high |
| task_05 | Add Degraded-Start Recovery UI Without Content Leakage | frontend | high |
