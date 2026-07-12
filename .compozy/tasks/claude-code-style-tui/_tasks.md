# Claude Code-Style TUI Reskin — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Palette: warm accent and chrome color keys | pending | medium | — |
| 02 | First-run state module and welcomeBanner config field | pending | medium | — |
| 03 | WelcomeBanner component | pending | medium | task_01 |
| 04 | Prompt chevron and spacing restyle | pending | low | task_01 |
| 05 | Transient boot-banner render root | pending | medium | task_02, task_03 |
| 06 | Idle-screen welcome banner | pending | medium | task_02, task_03 |
| 07 | Git branch reader utility | pending | low | — |
| 08 | Status-bar slot contract | pending | medium | — |
| 09 | Branch event, reducer, and refresh wiring | pending | medium | task_07, task_08 |
| 10 | Honest hand-off result | pending | low | — |
| 11 | Dual-agent StatusBar rebuild | pending | high | task_01, task_08, task_09, task_10 |

## Phases

- **Phase 1 - Visual layer:** task_01, task_02, task_03, task_04, task_05, task_06
- **Phase 2 - Dual-agent status bar and hand-off:** task_07, task_08, task_09, task_10, task_11
- **Phase 3 - Additive clarity (delegated, external):** the `agent-usage-gauge` and `model-effort-selector` packets populate the model/context fields and wire the `selectSessionModel`/`selectSessionContext` bodies; not tasks in this list.
