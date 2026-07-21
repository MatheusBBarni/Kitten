---
schema_version: "compozy.tasks/v2"
workflow: kitten-kanban-orchestrator
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
    - id: task_16
      file: task_16.md
    - id: task_17
      file: task_17.md
    - id: task_18
      file: task_18.md
  edges:
    - from: task_01
      to: task_02
    - from: task_02
      to: task_03
    - from: task_03
      to: task_04
    - from: task_02
      to: task_05
    - from: task_01
      to: task_06
    - from: task_05
      to: task_06
    - from: task_06
      to: task_07
    - from: task_07
      to: task_08
    - from: task_07
      to: task_09
    - from: task_05
      to: task_10
    - from: task_08
      to: task_10
    - from: task_09
      to: task_10
    - from: task_05
      to: task_11
    - from: task_08
      to: task_11
    - from: task_09
      to: task_11
    - from: task_10
      to: task_11
    - from: task_08
      to: task_12
    - from: task_11
      to: task_12
    - from: task_12
      to: task_13
    - from: task_11
      to: task_14
    - from: task_12
      to: task_14
    - from: task_06
      to: task_15
    - from: task_08
      to: task_15
    - from: task_09
      to: task_15
    - from: task_06
      to: task_16
    - from: task_12
      to: task_16
    - from: task_13
      to: task_16
    - from: task_14
      to: task_16
    - from: task_15
      to: task_16
    - from: task_06
      to: task_17
    - from: task_09
      to: task_17
    - from: task_11
      to: task_17
    - from: task_15
      to: task_17
    - from: task_04
      to: task_18
    - from: task_08
      to: task_18
    - from: task_11
      to: task_18
    - from: task_12
      to: task_18
    - from: task_13
      to: task_18
    - from: task_14
      to: task_18
    - from: task_15
      to: task_18
    - from: task_16
      to: task_18
    - from: task_17
      to: task_18
---

# Local-first governed Workflow Board Task List

The graph above is the sole canonical source of task topology. The scopes below
are intentionally small enough to deliver independently once their graph
prerequisites are complete.

1. Establish private workspace and TUI package boundary
2. Relocate Cockpit runtime, launcher, and build surface into packages/tui
3. Relocate Cockpit contract suite and remove source/test compatibility bridges
4. Rebase CLI, CI, release, installer, and docs on packages/tui
5. Extract minimal protocol-free engine contracts
6. Scaffold Electrobun desktop host, typed RPC, renderer, and test harness
7. Build SQLite migrations, immutable journal, and projection rebuild
8. Add workflow board, stage, edge, and card projections/commands
9. Add deterministic project-plus-user Skill Catalog and snapshots
10. Add card-owned managed worktrees
11. Add readiness, runnable validation, global scheduler, Run Context, and fresh ACP startup
12. Persist normalized ACP activity and expose inspector/transcript projections
13. Add confirmable, non-cancelling follow-up queue
14. Bind scoped ask_user, Attention Blockers, stage lock, and notifications
15. Build accessible canvas, stage setup, and board card interactions
16. Build inspector, persistent composer, queue, and attention presentation
17. Build settings for profiles, catalog roots, defaults, and execution limit
18. Add interrupted-attempt recovery, review disposition, and layered acceptance gates
