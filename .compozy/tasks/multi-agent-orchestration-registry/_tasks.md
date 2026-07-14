---
schema_version: "compozy.tasks/v2"
workflow: multi-agent-orchestration-registry
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
    - from: task_02
      to: task_06
    - from: task_04
      to: task_07
    - from: task_06
      to: task_07
    - from: task_04
      to: task_08
---

# Multi-Agent Orchestration Registry Task List

## Implementation Waves

1. `task_01`
2. `task_02`
3. `task_03`, `task_06`
4. `task_04`, `task_05`
5. `task_07`, `task_08`

## Scope Guardrails

- Keep the V1 graph flat, provider-neutral, and in memory only.
- Preserve the controller as the only owner of live ACP runtimes.
- Keep every child a normal focusable session and never silently detach it.
- Do not add automatic decomposition, nesting, scheduling, retries, role templates, or an agent-facing API.
