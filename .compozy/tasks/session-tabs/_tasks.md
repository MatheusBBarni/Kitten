---
schema_version: "compozy.tasks/v2"
workflow: session-tabs
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
    - from: task_01
      to: task_03
    - from: task_02
      to: task_03
    - from: task_02
      to: task_04
    - from: task_03
      to: task_04
    - from: task_02
      to: task_05
    - from: task_04
      to: task_05
    - from: task_02
      to: task_06
    - from: task_05
      to: task_06
    - from: task_02
      to: task_07
    - from: task_06
      to: task_07
    - from: task_02
      to: task_08
    - from: task_06
      to: task_08
    - from: task_07
      to: task_08
    - from: task_02
      to: task_09
    - from: task_05
      to: task_09
    - from: task_06
      to: task_09
    - from: task_08
      to: task_09
    - from: task_06
      to: task_10
    - from: task_08
      to: task_10
    - from: task_06
      to: task_11
    - from: task_07
      to: task_11
    - from: task_08
      to: task_11
    - from: task_03
      to: task_12
    - from: task_04
      to: task_12
    - from: task_05
      to: task_12
    - from: task_06
      to: task_12
    - from: task_07
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

# Session Tabs Task List

## Scope

Implement the approved Session Tabs PRD and TechSpec as a dependency-safe, test-backed sequence. The graph is the sole source of task ordering.

## Tasks

| ID | Title | Type | Complexity |
|---|---|---|---|
| task_01 | Model session-tab workspace state and reducer | refactor | high |
| task_02 | Integrate workspace state into AppStore and selectors | refactor | high |
| task_03 | Add V2 run persistence and V1 migration | refactor | high |
| task_04 | Replace fixed controller plan with mutable conversation registry | refactor | high |
| task_05 | Implement safe per-tab close and permission teardown | refactor | high |
| task_06 | Expose tab actions and protect nullable-session consumers | refactor | high |
| task_07 | Add capability-gated tab keyboard navigation | frontend | high |
| task_08 | Render tab strip and empty workspace | frontend | high |
| task_09 | Add rename and active-work close dialogs | frontend | medium |
| task_10 | Guard selected-only workspace controls | frontend | medium |
| task_11 | Upgrade Sessions overlay for overflow and background work | frontend | medium |
| task_12 | Harden boot/readiness and instrument the integrated flow | refactor | high |
