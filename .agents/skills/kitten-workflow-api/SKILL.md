---
name: kitten-workflow-api
description: Inspect and mutate the currently running Kitten desktop workflow board through the local kitten api CLI. Use when an agent needs board, stage, card, or workflow-path state without touching SQLite directly.
---

# Kitten Workflow API

Use the local `kitten api` command while the Kitten desktop app is running. It reaches the active desktop host, so the mutation is validated, persisted, and reflected in the board together.

## Read before acting

```bash
kitten api get_workspace '{}'
kitten api get_board '{"boardId":"<board-id>"}'
kitten api get_catalog '{}'
```

Read the board immediately before mutating it. Copy stable IDs from the result; never edit the workflow SQLite database or `.kitten/config.json` yourself.

## Commands

Each command takes one JSON object and returns a JSON envelope. The host fills in current workflow/card versions so callers do not need to guess concurrency fences.

```bash
kitten api create_stage '{"boardId":"<board-id>","label":"Ready"}'
kitten api update_stage '{"boardId":"<board-id>","stageId":"<stage-id>","label":"In review"}'
kitten api delete_stage '{"boardId":"<board-id>","stageId":"<empty-stage-id>"}'
kitten api assign_stage_skill '{"boardId":"<board-id>","stageId":"<stage-id>","defaultSkillId":"skill:<digest>"}'
kitten api connect_stages '{"boardId":"<board-id>","edges":[{"sourceStageId":"<from>","targetStageId":"<to>"}]}'
kitten api reorder_stages '{"boardId":"<board-id>","orderedStageIds":["<first>","<second>"]}'
kitten api create_card '{"boardId":"<board-id>","stageId":"<stage-id>","title":"...","description":"...","provider":"codex","model":"gpt-5.6","effort":"high","skillOverrideId":null,"runnable":true}'
kitten api update_card '{"boardId":"<board-id>","taskId":"<card-id>","title":"...","description":"...","provider":"codex","model":"gpt-5.6","effort":"high","skillOverrideId":null,"runnable":true}'
kitten api set_card_execution_status '{"boardId":"<board-id>","taskId":"<card-id>","executionStatus":"idle"}'
```

## Constraints

- A `move_card` can only target the card’s immediate next stage.
- Never move a card whose `executionStatus` is `running` or `needs_attention`.
- A stage can be deleted only when it contains no cards; the host removes its path connections safely.
- If a command returns `conflict` or `rejected`, reread the board and resolve the stated reason; do not retry blind.
- Use an explicit `mutationId` only when safely retrying the same exact command.
