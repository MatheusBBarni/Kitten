export const copyStatusMessages = {
  copied: "Install command copied.",
  selected:
    "Automatic copy is unavailable. The install command is selected; copy it manually.",
  invalid: "No install command is available to copy.",
  failed: "Could not copy the install command. Select and copy it manually.",
} as const;

export type CopyState = keyof typeof copyStatusMessages;

export type CopyResult = {
  readonly state: CopyState;
  readonly message: (typeof copyStatusMessages)[CopyState];
};

export type ClipboardWriter = {
  writeText(text: string): Promise<void>;
};

type CopyDependencies = {
  readonly clipboard: ClipboardWriter | null;
  readonly selectFallback: () => boolean;
};

type SelectionEnvironment = {
  readonly createRange: () => Range;
  readonly getSelection: () => Selection | null;
};

type BindDependencies = {
  readonly clipboard: ClipboardWriter | null;
  readonly selectCommand: (commandElement: HTMLElement) => boolean;
};

const commandSelector = "[data-copy-command-text]";
const triggerSelector = "[data-copy-command-trigger]";
const statusSelector = "[data-copy-command-status]";

function result(state: CopyState): CopyResult {
  return { state, message: copyStatusMessages[state] };
}

export async function copyCommand(
  command: unknown,
  dependencies: CopyDependencies,
): Promise<CopyResult> {
  if (typeof command !== "string" || command.trim().length === 0) {
    return result("invalid");
  }

  if (dependencies.clipboard) {
    try {
      await dependencies.clipboard.writeText(command);
      return result("copied");
    } catch {
      // A rejected Clipboard API call uses the same manual-selection fallback
      // as browsers where the API is unavailable.
    }
  }

  try {
    return dependencies.selectFallback() ? result("selected") : result("failed");
  } catch {
    return result("failed");
  }
}

export function selectCommandText(
  commandElement: HTMLElement,
  environment: SelectionEnvironment = {
    createRange: () => document.createRange(),
    getSelection: () => window.getSelection(),
  },
): boolean {
  if (!commandElement.textContent?.trim()) {
    return false;
  }

  const selection = environment.getSelection();
  if (!selection) {
    return false;
  }

  commandElement.focus();
  const range = environment.createRange();
  range.selectNodeContents(commandElement);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function renderCopyStatus(
  statusElement: HTMLElement,
  copyResult: CopyResult,
): void {
  statusElement.dataset.copyState = copyResult.state;
  statusElement.textContent = copyResult.message;
}

export function bindCopyCommands(
  root: ParentNode,
  dependencies: BindDependencies = {
    clipboard:
      typeof navigator !== "undefined" && navigator.clipboard
        ? navigator.clipboard
        : null,
    selectCommand: (commandElement) => selectCommandText(commandElement),
  },
): number {
  let boundControls = 0;

  for (const container of root.querySelectorAll<HTMLElement>(
    "[data-install-command]",
  )) {
    const commandElement =
      container.querySelector<HTMLElement>(commandSelector);
    const trigger = container.querySelector<HTMLButtonElement>(triggerSelector);
    const statusElement = container.querySelector<HTMLElement>(statusSelector);

    if (!commandElement || !trigger || !statusElement) {
      continue;
    }
    if (trigger.dataset.copyCommandBound === "true") {
      continue;
    }

    trigger.dataset.copyCommandBound = "true";
    trigger.addEventListener("click", () => {
      void copyCommand(commandElement.textContent, {
        clipboard: dependencies.clipboard,
        selectFallback: () => dependencies.selectCommand(commandElement),
      }).then((copyResult) => renderCopyStatus(statusElement, copyResult));
    });
    boundControls += 1;
  }

  return boundControls;
}

if (typeof document !== "undefined") {
  bindCopyCommands(document);
}
