---
schema_version: "compozy.tasks/v2"
workflow: default-models-per-provider
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
    - from: task_02
      to: task_03
    - from: task_03
      to: task_04
    - from: task_03
      to: task_05
    - from: task_05
      to: task_06
    - from: task_04
      to: task_07
    - from: task_05
      to: task_07
    - from: task_04
      to: task_08
---

# Default Models per Provider Task List

| Task | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Add transitional provider-default config and core result contract | backend | high |
| task_02 | Migrate the first typed-fixture group to the new config shape | refactor | medium |
| task_03 | Complete fixture migration and make provider defaults required | refactor | high |
| task_04 | Expose the narrow per-session default-result selector | backend | low |
| task_05 | Add controller-owned default application and content-free outcome telemetry | backend | high |
| task_06 | Bridge valid config reloads without live-session mutation | backend | medium |
| task_07 | Apply defaults after explicit /model selection and render picker feedback | frontend | medium |
| task_08 | Render confirmed default outcomes in the status strip | frontend | medium |
