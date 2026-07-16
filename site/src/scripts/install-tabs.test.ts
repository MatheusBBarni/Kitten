import { describe, expect, test } from "bun:test";

import { activateInstallTab, bindInstallTabs } from "./install-tabs.ts";

type TabHarness = HTMLButtonElement & {
  readonly listeners: Record<string, () => void>;
};

function createTab(id: string, panelId: string): TabHarness {
  const attributes = new Map<string, string>([["aria-controls", panelId]]);
  const listeners: Record<string, () => void> = {};

  return {
    id,
    dataset: {},
    tabIndex: -1,
    listeners,
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    addEventListener(name: string, listener: () => void) {
      listeners[name] = listener;
    },
    focus() {},
  } as unknown as TabHarness;
}

function createPanel(id: string): HTMLElement {
  return { id, hidden: true } as HTMLElement;
}

describe("install method tabs", () => {
  test("updates ARIA state and shows only the matching command panel", () => {
    const npm = createTab("npm-tab", "npm-panel");
    const pnpm = createTab("pnpm-tab", "pnpm-panel");
    const panels = [createPanel("npm-panel"), createPanel("pnpm-panel")];

    expect(activateInstallTab(pnpm, [npm, pnpm], panels)).toBe(true);
    expect(npm.getAttribute("aria-selected")).toBe("false");
    expect(npm.tabIndex).toBe(-1);
    expect(pnpm.getAttribute("aria-selected")).toBe("true");
    expect(pnpm.tabIndex).toBe(0);
    expect(panels[0]?.hidden).toBe(true);
    expect(panels[1]?.hidden).toBe(false);
  });

  test("does not change state when the controlled panel is missing", () => {
    const tab = createTab("npm-tab", "missing-panel");
    const panel = createPanel("npm-panel");

    expect(activateInstallTab(tab, [tab], [panel])).toBe(false);
    expect(panel.hidden).toBe(true);
  });

  test("binds each tab once and activates the clicked tab", () => {
    const npm = createTab("npm-tab", "npm-panel");
    const pnpm = createTab("pnpm-tab", "pnpm-panel");
    const panels = [createPanel("npm-panel"), createPanel("pnpm-panel")];
    const tabset = {
      querySelectorAll(selector: string) {
        if (selector === "[data-install-tab]") return [npm, pnpm];
        if (selector === "[data-install-panel]") return panels;
        return [];
      },
    };
    const root = {
      querySelectorAll(selector: string) {
        expect(selector).toBe("[data-install-tabset]");
        return [tabset];
      },
    } as unknown as ParentNode;

    expect(bindInstallTabs(root)).toBe(2);
    expect(bindInstallTabs(root)).toBe(0);

    pnpm.listeners.click?.();
    expect(pnpm.getAttribute("aria-selected")).toBe("true");
    expect(panels[1]?.hidden).toBe(false);
  });
});
