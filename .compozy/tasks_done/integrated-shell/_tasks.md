# Integrated Shell — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Shell domain types and reducer | completed | medium | — |
| 02 | Shell store slice, pane focus, and selectors | completed | medium | task_01 |
| 03 | ShellRuntime over Bun.Terminal and @xterm/headless | completed | high | task_01 |
| 04 | Shell integration: OSC 133/OSC 7 command and cwd events | completed | high | task_03 |
| 05 | Controller ownership and event wiring for the shell | pending | medium | task_02, task_03 |
| 06 | Shell configuration block | pending | low | task_01, task_03 |
| 07 | Key-to-VT input encoder | pending | low | — |
| 08 | ShellPane render bridge | pending | high | task_02, task_05 |
| 09 | Pane focus, toggle chord, input forwarding, and Ctrl+C routing | pending | high | task_02, task_07, task_08, task_11 |
| 10 | In-pane interactive application support | pending | medium | task_08, task_09 |
| 11 | Telemetry recorder surface for shell events | pending | low | task_01 |
| 12 | Hand-off shell snapshot assembly | pending | medium | task_01, task_04, task_05 |
| 13 | Hand-off preview Shell context section | pending | medium | task_11, task_12 |
| 14 | Discovery affordances and run-externally action | pending | medium | task_09, task_11, task_13 |
