import { describe, expect, test } from "bun:test";
import { dispatchWorkflowApiCli } from "./workflowApiCli.ts";

describe("workflow API CLI", () => {
  test("sends a concise move_card command to the running desktop host", async () => {
    const requests: string[] = [];
    const output: string[] = [];
    const exits: number[] = [];
    const handled = await dispatchWorkflowApiCli([
      "kitten",
      "api",
      "move_card",
      '{"boardId":"board:main","taskId":"card:review","targetStageId":"stage:ready"}',
    ], {
      homePath: "/Users/example",
      readManifest: () => JSON.stringify({ schemaVersion: 1, endpoint: "/tmp/kitten.sock", capability: "x".repeat(32) }),
      requestId: () => "request-1",
      connect: async ({ socket }) => {
        const hostSocket = {
          write(data: string) {
            requests.push(data);
            queueMicrotask(() => socket.data(hostSocket, new TextEncoder().encode('{"kind":"result","requestId":"request-1","result":{"kind":"workflow_command_result","result":{"status":"ok"}}}\n')));
            return data.length;
          },
          end() {},
        };
        socket.open(hostSocket);
        return hostSocket;
      },
      write: (value) => output.push(value),
      exit: (code) => exits.push(code),
    });

    expect(handled).toBeTrue();
    expect(JSON.parse(requests[0]!)).toMatchObject({
      requestId: "request-1",
      action: "move_card",
      input: { boardId: "board:main", taskId: "card:review", targetStageId: "stage:ready" },
    });
    expect(output).toEqual(['{"kind":"workflow_command_result","result":{"status":"ok"}}\n']);
    expect(exits).toEqual([0]);
  });

  test("does not claim unrelated invocations", async () => {
    expect(await dispatchWorkflowApiCli(["kitten", "--version"], { exit() {} })).toBeFalse();
  });
});
