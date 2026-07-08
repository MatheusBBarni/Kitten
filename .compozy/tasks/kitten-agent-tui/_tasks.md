# Kitten - Cross-Agent Hand-off Cockpit — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Project scaffold and tooling | completed | medium | — |
| 02 | Domain core types and session reducer | completed | medium | task_01 |
| 03 | Agent adapter layer and ACP translation | completed | high | task_01, task_02 |
| 04 | Config loading and agent readiness | completed | medium | task_03 |
| 05 | Reactive app store | completed | medium | task_02, task_03 |
| 06 | Deterministic hand-off bundle assembler and secret redactor | completed | medium | task_02 |
| 07 | Session controller and orchestration | completed | high | task_03, task_04, task_05 |
| 08 | UI shell, cockpit, and status strip | pending | medium | task_05, task_07 |
| 09 | Conversation view | pending | medium | task_08 |
| 10 | Prompt editor and send flow | pending | medium | task_07, task_08 |
| 11 | Approval prompt overlay | pending | medium | task_07, task_08 |
| 12 | Hand-off and hand-back flow | pending | high | task_06, task_07, task_08 |
| 13 | Telemetry recorder and heuristics | pending | medium | task_02, task_05, task_12 |
| 14 | First-run flow and packaging | pending | medium | task_04, task_08 |
