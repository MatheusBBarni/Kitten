import { describe, expect, test } from "bun:test";

import {
  bindCopyCommands,
  copyCommand,
  copyStatusMessages,
  renderCopyStatus,
  selectCommandText,
  type ClipboardWriter,
  type CopyResult,
} from "./copy-command.ts";

describe("copyCommand", () => {
  test("copies the exact command through the Clipboard API", async () => {
    const writes: string[] = [];
    const command = "git clone https://example.test/Kitten.git && cd Kitten";
    const clipboard: ClipboardWriter = {
      async writeText(value) {
        writes.push(value);
      },
    };

    const copyResult = await copyCommand(command, {
      clipboard,
      selectFallback: () => false,
    });

    expect(writes).toEqual([command]);
    expect(copyResult).toEqual({
      state: "copied",
      message: copyStatusMessages.copied,
    });
  });

  test.each([null, "rejected"] as const)(
    "selects the command when clipboard access is %s",
    async (clipboardState) => {
      let fallbackCalls = 0;
      const clipboard =
        clipboardState === null
          ? null
          : {
              async writeText() {
                throw new Error("Clipboard permission denied");
              },
            };

      const copyResult = await copyCommand("bun start", {
        clipboard,
        selectFallback: () => {
          fallbackCalls += 1;
          return true;
        },
      });

      expect(fallbackCalls).toBe(1);
      expect(copyResult).toEqual({
        state: "selected",
        message: copyStatusMessages.selected,
      });
    },
  );

  test.each([undefined, null, 42, "", "   "])(
    "rejects invalid command input without a false success: %p",
    async (command) => {
      let clipboardCalls = 0;
      let fallbackCalls = 0;

      const copyResult = await copyCommand(command, {
        clipboard: {
          async writeText() {
            clipboardCalls += 1;
          },
        },
        selectFallback: () => {
          fallbackCalls += 1;
          return true;
        },
      });

      expect(clipboardCalls).toBe(0);
      expect(fallbackCalls).toBe(0);
      expect(copyResult.state).toBe("invalid");
      expect(copyResult.message).toBe(copyStatusMessages.invalid);
    },
  );

  test.each([
    () => false,
    () => {
      throw new Error("Selection unavailable");
    },
  ])("reports failure when manual selection cannot be created", async (fallback) => {
    const copyResult = await copyCommand("bun start", {
      clipboard: null,
      selectFallback: fallback,
    });

    expect(copyResult).toEqual({
      state: "failed",
      message: copyStatusMessages.failed,
    });
  });
});

describe("manual selection and status", () => {
  test("focuses and selects the complete rendered command", () => {
    const calls: string[] = [];
    const commandElement = {
      textContent: "bun install && bun start",
      focus() {
        calls.push("focus");
      },
    } as unknown as HTMLElement;
    const range = {
      selectNodeContents(element: Node) {
        expect(element).toBe(commandElement);
        calls.push("selectNodeContents");
      },
    } as unknown as Range;
    const selection = {
      removeAllRanges() {
        calls.push("removeAllRanges");
      },
      addRange(value: Range) {
        expect(value).toBe(range);
        calls.push("addRange");
      },
    } as unknown as Selection;

    expect(
      selectCommandText(commandElement, {
        createRange: () => range,
        getSelection: () => selection,
      }),
    ).toBe(true);
    expect(calls).toEqual([
      "focus",
      "selectNodeContents",
      "removeAllRanges",
      "addRange",
    ]);
  });

  test("does not claim selection for empty content or a missing selection", () => {
    const empty = { textContent: " " } as HTMLElement;
    const command = {
      textContent: "bun start",
      focus() {
        throw new Error("focus should not be called");
      },
    } as unknown as HTMLElement;

    expect(
      selectCommandText(empty, {
        createRange: () => ({}) as Range,
        getSelection: () => ({}) as Selection,
      }),
    ).toBe(false);
    expect(
      selectCommandText(command, {
        createRange: () => ({}) as Range,
        getSelection: () => null,
      }),
    ).toBe(false);
  });

  test("writes the result message and state to the live status model", () => {
    const statusElement = {
      dataset: {},
      textContent: "",
    } as unknown as HTMLElement;
    const copyResult: CopyResult = {
      state: "selected",
      message: copyStatusMessages.selected,
    };

    renderCopyStatus(statusElement, copyResult);

    expect(statusElement.dataset.copyState).toBe("selected");
    expect(statusElement.textContent).toBe(copyStatusMessages.selected);
  });
});

describe("copy control binding", () => {
  test("binds once and reports a successful native-button activation", async () => {
    let click: (() => void) | undefined;
    const commandElement = {
      textContent: "bun start",
    } as HTMLElement;
    const trigger = {
      dataset: {},
      addEventListener(event: string, listener: () => void) {
        expect(event).toBe("click");
        click = listener;
      },
    } as unknown as HTMLButtonElement;
    const statusElement = {
      dataset: {},
      textContent: "",
    } as unknown as HTMLElement;
    const container = {
      querySelector(selector: string) {
        if (selector === "[data-copy-command-text]") return commandElement;
        if (selector === "[data-copy-command-trigger]") return trigger;
        if (selector === "[data-copy-command-status]") return statusElement;
        return null;
      },
    };
    const root = {
      querySelectorAll() {
        return [container];
      },
    } as unknown as ParentNode;
    const writes: string[] = [];

    expect(
      bindCopyCommands(root, {
        clipboard: {
          async writeText(value) {
            writes.push(value);
          },
        },
        selectCommand: () => false,
      }),
    ).toBe(1);
    expect(bindCopyCommands(root)).toBe(0);

    click?.();
    await Bun.sleep(0);

    expect(writes).toEqual(["bun start"]);
    expect(statusElement.dataset.copyState).toBe("copied");
    expect(statusElement.textContent).toBe(copyStatusMessages.copied);
  });

  test("ignores incomplete copy-control markup", () => {
    const root = {
      querySelectorAll() {
        return [{ querySelector: () => null }];
      },
    } as unknown as ParentNode;

    expect(
      bindCopyCommands(root, {
        clipboard: null,
        selectCommand: () => false,
      }),
    ).toBe(0);
  });

  test("uses browser selection defaults when the Clipboard API is unavailable", async () => {
    let click: (() => void) | undefined;
    let focused = false;
    let selected = false;
    const commandElement = {
      textContent: "bun start",
      focus() {
        focused = true;
      },
    } as unknown as HTMLElement;
    const trigger = {
      dataset: {},
      addEventListener(_event: string, listener: () => void) {
        click = listener;
      },
    } as unknown as HTMLButtonElement;
    const statusElement = {
      dataset: {},
      textContent: "",
    } as unknown as HTMLElement;
    const container = {
      querySelector(selector: string) {
        if (selector === "[data-copy-command-text]") return commandElement;
        if (selector === "[data-copy-command-trigger]") return trigger;
        if (selector === "[data-copy-command-status]") return statusElement;
        return null;
      },
    };
    const root = {
      querySelectorAll() {
        return [container];
      },
    } as unknown as ParentNode;
    const range = {
      selectNodeContents(element: Node) {
        expect(element).toBe(commandElement);
      },
    } as unknown as Range;
    const selection = {
      removeAllRanges() {},
      addRange(value: Range) {
        expect(value).toBe(range);
        selected = true;
      },
    } as unknown as Selection;
    const hadDocument = "document" in globalThis;
    const hadWindow = "window" in globalThis;
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createRange: () => range },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { getSelection: () => selection },
    });

    try {
      expect(bindCopyCommands(root)).toBe(1);
      click?.();
      await Bun.sleep(0);

      expect(focused).toBe(true);
      expect(selected).toBe(true);
      expect(statusElement.dataset.copyState).toBe("selected");
      expect(statusElement.textContent).toBe(copyStatusMessages.selected);
    } finally {
      if (hadDocument) {
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: originalDocument,
        });
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
      if (hadWindow) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});
