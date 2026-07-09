# Resumable Cross-Agent Sessions - Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | persistenceEnabled config flag | pending | low | - |
| 02 | Run store: record type and one-file-per-run I/O | pending | high | - |
| 03 | Autosave writer wired at boot | pending | medium | task_01, task_02 |
| 04 | ACP adapter loadSession and capability capture | pending | medium | - |
| 05 | Reload confirmation probe in selfcheck | pending | medium | task_04 |
| 06 | Store restoration state and session-picker slot | pending | medium | - |
| 07 | Restore orchestration with per-agent degradation | pending | high | task_02, task_04, task_06 |
| 08 | Resume-last-run startup fast-path | pending | medium | task_02, task_07 |
| 09 | Ctrl+R session picker overlay | pending | high | task_02, task_06, task_07 |
| 10 | Session delete from the picker | pending | medium | task_02, task_09 |
| 11 | First-run persistence disclosure | pending | low | task_01 |
| 12 | Restoration degradation UX | pending | medium | task_06, task_07 |
| 13 | Resume telemetry counters | pending | medium | task_07, task_09 |
