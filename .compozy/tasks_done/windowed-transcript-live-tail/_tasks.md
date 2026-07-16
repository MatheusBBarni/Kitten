---
schema_version: "compozy.tasks/v2"
workflow: windowed-transcript-live-tail
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
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_03
      to: task_04
    - from: task_03
      to: task_05
    - from: task_03
      to: task_06
    - from: task_03
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
    - from: task_02
      to: task_09
    - from: task_08
      to: task_09
    - from: task_02
      to: task_10
    - from: task_07
      to: task_10
    - from: task_08
      to: task_10
---

# Windowed Transcript Live Tail Task List

1. Task 01 builds the pure projection contract.
2. Task 02 adds transient per-session presentation state and selectors.
3. Task 03 introduces the strict default-off configuration contract.
4. Tasks 04-07 migrate all direct typed configuration consumers in bounded families.
5. Task 08 integrates the projection into the conversation view.
6. Tasks 09-10 add commands and privacy-safe telemetry in parallel after rendering.
