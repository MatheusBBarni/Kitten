---
schema_version: "compozy.tasks/v2"
workflow: t3code-ui-revamp
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
  edges:
    - from: task_01
      to: task_03
    - from: task_02
      to: task_03
    - from: task_03
      to: task_04
    - from: task_01
      to: task_05
    - from: task_03
      to: task_05
    - from: task_04
      to: task_05
    - from: task_01
      to: task_06
    - from: task_04
      to: task_06
    - from: task_05
      to: task_06
    - from: task_01
      to: task_07
    - from: task_02
      to: task_07
    - from: task_03
      to: task_07
    - from: task_01
      to: task_08
    - from: task_03
      to: task_08
    - from: task_04
      to: task_08
    - from: task_04
      to: task_09
    - from: task_07
      to: task_09
    - from: task_08
      to: task_09
    - from: task_05
      to: task_10
    - from: task_06
      to: task_10
    - from: task_09
      to: task_10
    - from: task_05
      to: task_11
    - from: task_10
      to: task_11
    - from: task_07
      to: task_12
    - from: task_09
      to: task_12
    - from: task_10
      to: task_12
    - from: task_06
      to: task_13
    - from: task_08
      to: task_13
    - from: task_09
      to: task_13
    - from: task_10
      to: task_13
    - from: task_01
      to: task_14
    - from: task_05
      to: task_14
    - from: task_07
      to: task_14
    - from: task_08
      to: task_14
    - from: task_09
      to: task_14
    - from: task_10
      to: task_15
    - from: task_11
      to: task_15
    - from: task_12
      to: task_15
    - from: task_13
      to: task_15
    - from: task_14
      to: task_15
    - from: task_11
      to: task_16
    - from: task_12
      to: task_16
    - from: task_13
      to: task_16
    - from: task_15
      to: task_16
    - from: task_11
      to: task_17
    - from: task_12
      to: task_17
    - from: task_13
      to: task_17
    - from: task_14
      to: task_17
    - from: task_16
      to: task_17
---

# T3 Code-Inspired Desktop Supervision Loop Task List

The graph above is the sole canonical source of task topology. Each task includes
its own focused tests and remains independently implementable after its graph
prerequisites are complete.

1. Define shared supervision, review-evidence, and prompt-submission contracts
2. Replace confirmation queue states with authorized FIFO queue-v2 and recovery
3. Add migration v9 and immutable review-evidence persistence
4. Build canonical review-evidence capture, revalidation, and chunking
5. Derive the cross-project supervision projection and host query
6. Expose review manifest and chunk RPC with renderer query bindings
7. Implement unified direct prompt submission and safe-boundary dispatch
8. Gate review readiness and approval on current evidence
9. Admit evidence-bound Request changes on the same card and stage
10. Add renderer workbench state and board-context restoration
11. Build the cross-project Work Inbox
12. Build the conversation-first timeline and direct composer presentation
13. Build the review panel and bounded per-file diff viewer
14. Add opt-in content-free workflow measurement and diagnostics
15. Add commands, Settings restoration, and critical-path accessibility
16. Apply the responsive T3-inspired desktop shell and visual system
17. Build the packaged native lifecycle verification harness
