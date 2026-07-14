---
schema_version: "compozy.tasks/v2"
workflow: statusline-customization
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
  edges:
    - from: task_01
      to: task_02
    - from: task_01
      to: task_03
    - from: task_01
      to: task_05
    - from: task_01
      to: task_07
    - from: task_02
      to: task_04
    - from: task_03
      to: task_04
    - from: task_03
      to: task_07
    - from: task_04
      to: task_06
    - from: task_05
      to: task_06
---

# Statusline Customization Task List

This graph delivers the conversational, declarative `/statusline` feature defined by the PRD and TechSpec. Each task owns its tests; task relationships exist only in the frontmatter graph above.

## Task Summary

| ID | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Add Pure Statusline Layout Contract and Renderer | backend | medium |
| task_02 | Add Strict Statusline Config and Symlink-Safe Persistence | backend | high |
| task_03 | Add Reactive Statusline Preference and Modal State | backend | medium |
| task_04 | Wire Statusline Confirmation and External Reload Lifecycle | backend | high |
| task_05 | Add Strict Focused-Agent Proposal Orchestration | backend | medium |
| task_06 | Build the Keyboard-First Statusline Command and Modal Workflow | frontend | high |
| task_07 | Render Saved Custom Layouts While Retaining the Legacy Footer | frontend | medium |
