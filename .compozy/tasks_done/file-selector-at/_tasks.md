---
schema_version: "compozy.tasks/v2"
workflow: file-selector-at
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
    - from: task_02
      to: task_03
    - from: task_02
      to: task_06
    - from: task_03
      to: task_06
    - from: task_04
      to: task_06
    - from: task_05
      to: task_06
---

# @ File Selector Task List

| ID | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Repository file discovery source and safety policy | backend | high |
| task_02 | Explicit-session discovery action and controller wiring | backend | medium |
| task_03 | Opt-in file-selector telemetry through controller actions | backend | high |
| task_04 | Stateless file selector presentation and @ help entry | frontend | medium |
| task_05 | Pure file-completion parsing, formatting, and edit tracking | frontend | medium |
| task_06 | PromptEditor async @ selector integration and regressions | frontend | high |

## Execution Notes

The graph frontmatter is the canonical dependency plan. Tasks 01, 04, and 05 can begin independently; task_06 integrates their completed contracts after tasks 02 and 03 establish controller and telemetry seams.
