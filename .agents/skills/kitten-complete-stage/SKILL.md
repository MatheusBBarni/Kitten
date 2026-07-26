---
name: kitten-complete-stage
description: Advance a finished non-running Kitten workflow card exactly one stage through kitten api. Use after an agent has completed the work assigned to its current stage and needs the board updated safely.
---

# Complete a Kitten Workflow Stage

When your current stage’s work is complete, advance the card only after the run is no longer active.

1. Read the board and find the card, its current stage, its immediate successor, and its `executionStatus`.

   ```bash
   kitten api get_board '{"boardId":"<board-id>"}'
   ```

2. Stop here if the card is `running` or `needs_attention`. A live task is stage-locked; do not override that safety rule.

3. Move exactly one stage using the stable card ID (the API also accepts `cardId`).

   ```bash
   kitten api move_card '{"boardId":"<board-id>","taskId":"<card-id>","targetStageId":"<immediate-successor-stage-id>"}'
   ```

4. Confirm the response has `result.status: "ok"`, then read the board again if another decision depends on the new state.

If the move is rejected, report the host’s reason. Do not edit the SQLite database, project config, or workflow files as a workaround.
