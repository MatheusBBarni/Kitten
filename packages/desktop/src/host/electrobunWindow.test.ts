import { expect, test } from "bun:test";
import {
  createElectrobunDesktopWindowPort,
  type ElectrobunDesktopWindow,
} from "./electrobunWindow.ts";

test("reveals the native window and stops delivering messages after handlers are removed", () => {
  const calls: string[] = [];
  const messages: string[] = [];
  const window: ElectrobunDesktopWindow = {
    webview: {
      rpc: {
        send: {
          hostMessage(message) {
            messages.push(message.kind);
          },
        },
      },
      remove() {
        calls.push("remove");
      },
    },
    show() {
      calls.push("show");
    },
    close() {
      calls.push("close");
    },
  };

  const port = createElectrobunDesktopWindowPort(window);
  expect(calls).toEqual(["show"]);

  port.sendHostMessage({ kind: "projection_committed", messageId: "projection-1", revision: 1 });
  expect(messages).toEqual(["projection_committed"]);

  port.removeHandlers();
  port.removeHandlers();
  port.sendHostMessage({ kind: "projection_committed", messageId: "projection-2", revision: 2 });
  port.close();

  expect(calls).toEqual(["show", "remove", "close"]);
  expect(messages).toEqual(["projection_committed"]);
});
