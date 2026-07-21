---
schema_version: "compozy.tasks/v2"
workflow: kitten-orchestrator
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
      to: task_04
    - from: task_02
      to: task_03
    - from: task_02
      to: task_04
    - from: task_02
      to: task_05
    - from: task_03
      to: task_04
    - from: task_03
      to: task_05
    - from: task_04
      to: task_05
    - from: task_05
      to: task_06
---

# Kitten Orchestrator Task List

This packet delivers the invisible Cockpit-parity phase of the two-app Bun workspace. It keeps Kitten’s published package, native release assets, installer URL, configuration, and user-facing behavior intact while making the repository ready for a future Orchestrator app.

| Task | Scope | Type |
| --- | --- | --- |
| 01 | Create the workspace and public Cockpit package boundary | infra |
| 02 | Move Cockpit runtime, launcher, build, and TypeScript project atomically | refactor |
| 03 | Move the Cockpit contract suite and retain app-local execution | test |
| 04 | Delegate root developer commands and CI | infra |
| 05 | Route native release and publish orchestration through Cockpit artifacts | infra |
| 06 | Preserve root installer and documentation behavior and run the parity gate | docs |
