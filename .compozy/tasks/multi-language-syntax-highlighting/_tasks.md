---
schema_version: "compozy.tasks/v2"
workflow: multi-language-syntax-highlighting
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
  edges:
    - from: task_01
      to: task_02
    - from: task_02
      to: task_03
    - from: task_03
      to: task_04
    - from: task_04
      to: task_05
    - from: task_05
      to: task_06
    - from: task_06
      to: task_07
    - from: task_07
      to: task_08
    - from: task_08
      to: task_09
---

# Multi-Language Syntax Highlighting Task List

| Task | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Create parser manifest foundation and Markdown override assets | frontend | high |
| task_02 | Add Rust and Go grammar capabilities | frontend | high |
| task_03 | Add OCaml and ReScript grammar capabilities | frontend | high |
| task_04 | Add JSON and Bash grammar capabilities | frontend | high |
| task_05 | Add Python grammar capability | frontend | medium |
| task_06 | Register syntax capabilities at boot and render entry points | frontend | high |
| task_07 | Add content-free diagnostics and safe fallback contracts | frontend | medium |
| task_08 | Prove the support matrix in self-check and compiled artifacts | test | high |
| task_09 | Publish the supported-label contract | docs | low |

`graph.edges` above is the sole dependency source of truth.
