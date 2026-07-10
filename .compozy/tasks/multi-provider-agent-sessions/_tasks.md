# Kitten Multi-Session Fleet - Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Session identity and store refactor | completed | critical | - |
| 02 | Fleet configuration model | completed | high | task_01 |
| 03 | Controller: one runtime per session with its own working directory | completed | high | task_01, task_02 |
| 04 | Extended session states and attention derivation | completed | high | task_01 |
| 05 | Ctrl+S sessions overview and jump-to-next | completed | high | task_03, task_04 |
| 06 | Session-addressed hand-off | completed | high | task_01, task_05 |
| 07 | Safe multi-session approvals labeling | completed | medium | task_03 |
| 08 | Layered attention notifier | completed | high | task_04 |
| 09 | Attention and multi-session telemetry | pending | medium | task_04, task_05 |
