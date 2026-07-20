---
schema_version: "compozy.tasks/v2"
workflow: context-packs
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
    - id: task_13
      file: task_13.md
    - id: task_14
      file: task_14.md
    - id: task_15
      file: task_15.md
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_04
    - from: task_01
      to: task_05
    - from: task_02
      to: task_03
    - from: task_02
      to: task_06
    - from: task_02
      to: task_07
    - from: task_03
      to: task_08
    - from: task_04
      to: task_06
    - from: task_04
      to: task_07
    - from: task_04
      to: task_08
    - from: task_04
      to: task_14
    - from: task_04
      to: task_15
    - from: task_05
      to: task_06
    - from: task_05
      to: task_08
    - from: task_05
      to: task_12
    - from: task_06
      to: task_07
    - from: task_06
      to: task_14
    - from: task_06
      to: task_15
    - from: task_07
      to: task_08
    - from: task_07
      to: task_11
    - from: task_07
      to: task_13
    - from: task_07
      to: task_15
    - from: task_08
      to: task_09
    - from: task_08
      to: task_10
    - from: task_08
      to: task_11
    - from: task_08
      to: task_14
    - from: task_09
      to: task_14
    - from: task_10
      to: task_11
    - from: task_10
      to: task_14
    - from: task_11
      to: task_12
    - from: task_11
      to: task_13
    - from: task_12
      to: task_14
    - from: task_13
      to: task_14
---

# Context Packs Task List

This graph implements the approved Context Packs V1 in small, independently verifiable slices: pure custody rules and store ownership first; then persistence, verified capability, materialization, bridge, and controller authority; finally sealed consumption, focused UI, privacy measurement, and an opt-in real-adapter contract test.
