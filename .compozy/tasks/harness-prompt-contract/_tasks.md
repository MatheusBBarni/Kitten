---
schema_version: "compozy.tasks/v2"
workflow: harness-prompt-contract
graph:
  nodes:
    - id: task_01
      file: task_01.md
  edges: []
---

# Harness Prompt Contract Task List

## Graph

`task_01` is the complete V1 pure-core change. Its renderer and contract tests stay together so no unverified harness policy surface is introduced.

## Tasks

| ID | Title | Type | Complexity |
| --- | --- | --- | --- |
| task_01 | Add deterministic V1 harness prompt renderer | backend | medium |
