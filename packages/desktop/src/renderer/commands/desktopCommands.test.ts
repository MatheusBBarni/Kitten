import { describe, expect, test } from "bun:test";
import "../settings/testDom.ts";
import {
  DESKTOP_COMMANDS,
  desktopShortcutReference,
  dispatchDesktopCommand,
  routeDesktopKeydown,
  type DesktopCommandContext,
  type DesktopKeyboardEvent,
} from "./desktopCommands.ts";

function context(overrides: Partial<DesktopCommandContext> = {}) {
  const calls: string[] = [];
  const target = (name: string, selected = false) => ({
    cardId: name,
    selected,
    focus: () => calls.push(`focus:${name}`),
    activate: () => calls.push(`activate:${name}`),
  });
  const value: DesktopCommandContext = {
    modalOpen: false,
    search: target("search"),
    nextActionable: target("host-first"),
    cards: [target("card-a", true), target("card-b"), target("card-c")],
    composer: target("composer"),
    review: target("review"),
    back: target("back"),
    settings: target("settings"),
    help: target("help"),
    announce: (message) => calls.push(`announce:${message}`),
    ...overrides,
  };
  return { value, calls };
}

function keyEvent(
  key: string,
  overrides: Partial<DesktopKeyboardEvent> = {},
): DesktopKeyboardEvent & { prevented: boolean } {
  const event = {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target: document.body,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    ...overrides,
  };
  return event;
}

describe("desktop command registry", () => {
  test("owns one unique ID, binding, visible label, and shortcut reference for every required command", () => {
    expect(DESKTOP_COMMANDS.map(({ id }) => id)).toEqual([
      "search_scope",
      "next_actionable",
      "next_card",
      "previous_card",
      "focus_composer",
      "open_review",
      "close_back",
      "open_settings",
      "shortcut_help",
    ]);
    expect(new Set(DESKTOP_COMMANDS.map(({ id }) => id)).size).toBe(DESKTOP_COMMANDS.length);
    expect(new Set(DESKTOP_COMMANDS.map(({ binding }) => JSON.stringify(binding))).size).toBe(DESKTOP_COMMANDS.length);
    expect(DESKTOP_COMMANDS.every(({ label, shortcut }) => label.length > 0 && shortcut.length > 0)).toBeTrue();
    expect(desktopShortcutReference()).toEqual(
      DESKTOP_COMMANDS.map(({ id, label, shortcut }) => ({ id, label, shortcut })),
    );
  });

  test("suppresses editable, contenteditable, IME, repeated, and modal conflicts", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    const { value, calls } = context();
    const events = [
      keyEvent("k", { metaKey: true, target: input }),
      keyEvent("k", { metaKey: true, target: textarea }),
      keyEvent("k", { metaKey: true, target: editable }),
      keyEvent("k", { metaKey: true, isComposing: true }),
      keyEvent("k", { metaKey: true, keyCode: 229 }),
      keyEvent("k", { metaKey: true, repeat: true }),
    ];
    for (const event of events) expect(routeDesktopKeydown(event, value).status).toBe("ignored");
    expect(routeDesktopKeydown(
      keyEvent("k", { metaKey: true }),
      { ...value, modalOpen: true },
    ).status).toBe("ignored");
    expect(calls).toEqual([]);
  });

  test("dispatches an available command once and announces an unavailable command without mutation", () => {
    const available = context();
    const event = keyEvent("j", { metaKey: true });
    expect(routeDesktopKeydown(event, available.value)).toEqual({
      status: "dispatched",
      commandId: "focus_composer",
    });
    expect(event.prevented).toBeTrue();
    expect(available.calls).toEqual([
      "activate:composer",
      "focus:composer",
      "announce:Composer focused.",
    ]);

    const unavailable = context({ review: null });
    expect(dispatchDesktopCommand("open_review", unavailable.value).status).toBe("unavailable");
    expect(unavailable.calls).toEqual([
      "announce:Open changed-file review is unavailable in the current view.",
    ]);
  });

  test("uses host supervision order for next actionable and deterministic projected order for adjacent cards", () => {
    const nextActionable = context();
    dispatchDesktopCommand("next_actionable", nextActionable.value);
    expect(nextActionable.calls[0]).toBe("activate:host-first");

    const next = context();
    dispatchDesktopCommand("next_card", next.value);
    expect(next.calls[0]).toBe("activate:card-b");

    const previous = context();
    dispatchDesktopCommand("previous_card", previous.value);
    expect(previous.calls[0]).toBe("activate:card-c");
  });
});
