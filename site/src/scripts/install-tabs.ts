const tabsetSelector = "[data-install-tabset]";
const tabSelector = "[data-install-tab]";
const panelSelector = "[data-install-panel]";

export function activateInstallTab(
  activeTab: HTMLButtonElement,
  tabs: readonly HTMLButtonElement[],
  panels: readonly HTMLElement[],
): boolean {
  const panelId = activeTab.getAttribute("aria-controls");
  if (!panelId || !panels.some((panel) => panel.id === panelId)) {
    return false;
  }

  for (const tab of tabs) {
    const isActive = tab === activeTab;
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  }

  for (const panel of panels) {
    panel.hidden = panel.id !== panelId;
  }

  return true;
}

function nextTabIndex(
  currentIndex: number,
  eventKey: string,
  tabCount: number,
): number | null {
  if (eventKey === "Home") return 0;
  if (eventKey === "End") return tabCount - 1;
  if (eventKey === "ArrowRight") return (currentIndex + 1) % tabCount;
  if (eventKey === "ArrowLeft") return (currentIndex - 1 + tabCount) % tabCount;
  return null;
}

export function bindInstallTabs(root: ParentNode): number {
  let boundTabs = 0;

  for (const tabset of root.querySelectorAll<HTMLElement>(tabsetSelector)) {
    const tabs = [...tabset.querySelectorAll<HTMLButtonElement>(tabSelector)];
    const panels = [...tabset.querySelectorAll<HTMLElement>(panelSelector)];

    for (const [index, tab] of tabs.entries()) {
      if (tab.dataset.installTabBound === "true") {
        continue;
      }

      tab.dataset.installTabBound = "true";
      tab.addEventListener("click", () => {
        activateInstallTab(tab, tabs, panels);
      });
      tab.addEventListener("keydown", (event) => {
        const targetIndex = nextTabIndex(index, event.key, tabs.length);
        if (targetIndex === null) {
          return;
        }

        event.preventDefault();
        const target = tabs[targetIndex];
        target?.focus();
        if (target) {
          activateInstallTab(target, tabs, panels);
        }
      });
      boundTabs += 1;
    }
  }

  return boundTabs;
}

if (typeof document !== "undefined") {
  bindInstallTabs(document);
}
