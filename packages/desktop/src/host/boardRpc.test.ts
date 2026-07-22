import { afterEach, describe, expect, test } from "bun:test";
import { createEventJournal } from "../persistence/eventJournal.ts";
import { migrateDatabase } from "../persistence/migrations.ts";
import { closeSqliteDatabase, openSqliteDatabase } from "../persistence/sqliteDatabase.ts";
import { createWorkflowCommandHandler } from "../workflow/workflowCommands.ts";
import { workflowIds } from "../workflow/workflowTypes.ts";
import { createDesktopBoardRpc } from "./boardRpc.ts";

const databases: ReturnType<typeof openSqliteDatabase>[] = [];

afterEach(() => {
  while (databases.length > 0) closeSqliteDatabase(databases.pop()!);
});

describe("DesktopBoardRpc workspace projection", () => {
  test("lists the most recently changed project boards and exposes a blank board setup projection", async () => {
    const database = openSqliteDatabase({ filename: ":memory:" });
    databases.push(database);
    migrateDatabase(database, { now: () => 1 });
    const journal = createEventJournal(database);
    let now = 10;
    const rpc = createDesktopBoardRpc(journal, createWorkflowCommandHandler(journal, { now: () => ++now }));

    const firstBoardId = workflowIds.board("board-first");
    const secondBoardId = workflowIds.board("board-second");
    await rpc.executeWorkflowCommand({
      commandId: "bind-first",
      command: {
        kind: "bind_repository",
        mutationId: workflowIds.mutation("mutation-first"),
        boardId: firstBoardId,
        repositoryPath: "/Users/name/projects/first",
      },
    });
    await rpc.executeWorkflowCommand({
      commandId: "bind-second",
      command: {
        kind: "bind_repository",
        mutationId: workflowIds.mutation("mutation-second"),
        boardId: secondBoardId,
        repositoryPath: "/Users/name/projects/second",
      },
    });

    const workspace = await rpc.getWorkspace?.({});
    expect(workspace).toMatchObject({
      result: {
        status: "ok",
        projection: {
          boards: [
            { boardId: secondBoardId, repositoryPath: "/Users/name/projects/second" },
            { boardId: firstBoardId, repositoryPath: "/Users/name/projects/first" },
          ],
        },
      },
    });
    expect(await rpc.getBoard({ mode: "new" })).toMatchObject({
      result: { status: "ok", projection: { board: null, stages: [], edges: [], cards: [] } },
    });
  });
});
