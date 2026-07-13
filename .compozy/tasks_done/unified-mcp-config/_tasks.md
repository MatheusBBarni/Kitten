# Unified MCP Configuration — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | MCP config: domain type, schema, and normalization | pending | medium | — |
| 02 | MCP provisioning resolver (env references + command resolution) | pending | medium | task_01 |
| 03 | ACP MCP translator (domain to SDK McpServer) | pending | low | task_01 |
| 04 | Widen AgentConnection.newSession and update fakes | pending | medium | task_01, task_03 |
| 05 | Controller: thread MCP list, resolve, and record readout | pending | high | task_02, task_04 |
| 06 | Readout surfaces: selfcheck and status strip | pending | medium | task_02, task_05 |
| 07 | Redact MCP secrets in telemetry and logs | pending | low | task_05 |
| 08 | Adapter-honor smoke test and fixture MCP server | pending | medium | task_04 |
| 09 | Setup documentation and example config | pending | low | task_01 |
