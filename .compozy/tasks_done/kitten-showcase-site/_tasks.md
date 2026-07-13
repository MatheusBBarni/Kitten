---
schema_version: "compozy.tasks/v2"
workflow: kitten-showcase-site
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
    - from: task_04
      to: task_06
    - from: task_05
      to: task_06
    - from: task_06
      to: task_07
    - from: task_07
      to: task_08
---

# Kitten Showcase Site Task List

| # | Title | Status | Complexity | Dependencies |
| --- | --- | --- | --- | --- |
| 01 | Create standalone Astro subproject scaffold | pending | medium | - |
| 02 | Add showcase config model as the source of truth for copy, claims, and links | pending | medium | task_01 |
| 03 | Build core showcase landing page sections and single-page layout | pending | high | task_02 |
| 04 | Add accessible install copy action handling | pending | medium | task_03 |
| 05 | Add live GitHub star count integration with resilient fallback | pending | medium | task_03 |
| 06 | Add motion-safe media behavior, styling, and a11y hardening | pending | high | task_04, task_05 |
| 07 | Add GitHub Pages CI workflow for site build and deploy | pending | high | task_06 |
| 08 | Add launch documentation and final validation workflow in README | pending | medium | task_07 |
