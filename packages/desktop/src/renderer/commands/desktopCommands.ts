export type DesktopCommandId =
  | "search_scope"
  | "next_actionable"
  | "next_card"
  | "previous_card"
  | "focus_composer"
  | "open_review"
  | "close_back"
  | "open_settings"
  | "shortcut_help";

export interface DesktopCommandTarget {
  focus?(): void;
  activate?(): void;
}

export interface DesktopCardCommandTarget extends DesktopCommandTarget {
  readonly cardId: string;
  readonly selected: boolean;
}

export interface DesktopCommandContext {
  readonly modalOpen: boolean;
  readonly search: DesktopCommandTarget | null;
  readonly nextActionable: DesktopCommandTarget | null;
  readonly cards: readonly DesktopCardCommandTarget[];
  readonly composer: DesktopCommandTarget | null;
  readonly review: DesktopCommandTarget | null;
  readonly back: DesktopCommandTarget | null;
  readonly settings: DesktopCommandTarget | null;
  readonly help: DesktopCommandTarget | null;
  announce(message: string): void;
}

interface DesktopBinding {
  readonly key: string;
  readonly primary?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}

export interface DesktopCommandDefinition {
  readonly id: DesktopCommandId;
  readonly label: string;
  readonly binding: DesktopBinding;
  readonly shortcut: string;
  readonly available: (context: DesktopCommandContext) => boolean;
  readonly dispatch: (context: DesktopCommandContext) => void;
}

export interface DesktopKeyboardEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly target: EventTarget | null;
  preventDefault(): void;
}

export type DesktopCommandRouteResult =
  | { readonly status: "ignored" }
  | { readonly status: "unavailable"; readonly commandId: DesktopCommandId }
  | { readonly status: "dispatched"; readonly commandId: DesktopCommandId };

function activate(target: DesktopCommandTarget | null, announcement: string, context: DesktopCommandContext): void {
  target?.activate?.();
  target?.focus?.();
  context.announce(announcement);
}

function adjacentCard(context: DesktopCommandContext, direction: 1 | -1): DesktopCardCommandTarget | null {
  if (context.cards.length === 0) return null;
  const selectedIndex = context.cards.findIndex(({ selected }) => selected);
  if (selectedIndex < 0) return direction === 1 ? context.cards[0]! : context.cards.at(-1)!;
  if (context.cards.length === 1) return context.cards[0]!;
  return context.cards[(selectedIndex + direction + context.cards.length) % context.cards.length]!;
}

export const DESKTOP_COMMANDS: readonly DesktopCommandDefinition[] = [
  {
    id: "search_scope",
    label: "Search and scope repositories",
    binding: { key: "k", primary: true },
    shortcut: "⌘K",
    available: ({ search }) => search !== null,
    dispatch: (context) => activate(context.search, "Search focused.", context),
  },
  {
    id: "next_actionable",
    label: "Open next actionable card",
    binding: { key: "Enter", primary: true },
    shortcut: "⌘Enter",
    available: ({ nextActionable }) => nextActionable !== null,
    dispatch: (context) => activate(context.nextActionable, "Opened the next actionable card.", context),
  },
  {
    id: "next_card",
    label: "Open next card",
    binding: { key: "ArrowDown", alt: true },
    shortcut: "⌥↓",
    available: ({ cards }) => cards.length > 0,
    dispatch: (context) => activate(adjacentCard(context, 1), "Opened the next card.", context),
  },
  {
    id: "previous_card",
    label: "Open previous card",
    binding: { key: "ArrowUp", alt: true },
    shortcut: "⌥↑",
    available: ({ cards }) => cards.length > 0,
    dispatch: (context) => activate(adjacentCard(context, -1), "Opened the previous card.", context),
  },
  {
    id: "focus_composer",
    label: "Focus card composer",
    binding: { key: "j", primary: true },
    shortcut: "⌘J",
    available: ({ composer }) => composer !== null,
    dispatch: (context) => activate(context.composer, "Composer focused.", context),
  },
  {
    id: "open_review",
    label: "Open changed-file review",
    binding: { key: "r", primary: true, shift: true },
    shortcut: "⇧⌘R",
    available: ({ review }) => review !== null,
    dispatch: (context) => activate(context.review, "Review opened.", context),
  },
  {
    id: "close_back",
    label: "Close or return to board",
    binding: { key: "Escape" },
    shortcut: "Esc",
    available: ({ back }) => back !== null,
    dispatch: (context) => activate(context.back, "Returned to the previous workspace.", context),
  },
  {
    id: "open_settings",
    label: "Open Settings",
    binding: { key: ",", primary: true },
    shortcut: "⌘,",
    available: ({ settings }) => settings !== null,
    dispatch: (context) => activate(context.settings, "Settings opened.", context),
  },
  {
    id: "shortcut_help",
    label: "Show keyboard shortcuts",
    binding: { key: "/", primary: true },
    shortcut: "⌘/",
    available: ({ help }) => help !== null,
    dispatch: (context) => activate(context.help, "Keyboard shortcuts opened.", context),
  },
] as const;

export function desktopShortcutReference(): readonly Pick<
  DesktopCommandDefinition,
  "id" | "label" | "shortcut"
>[] {
  return DESKTOP_COMMANDS.map(({ id, label, shortcut }) => ({ id, label, shortcut }));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest("input, textarea, select, [contenteditable]");
  if (editable === null) return false;
  return editable.getAttribute("contenteditable") !== "false";
}

function matchesBinding(event: DesktopKeyboardEvent, binding: DesktopBinding): boolean {
  const primary = event.metaKey || event.ctrlKey;
  return event.key.toLocaleLowerCase() === binding.key.toLocaleLowerCase()
    && primary === (binding.primary === true)
    && event.altKey === (binding.alt === true)
    && event.shiftKey === (binding.shift === true);
}

export function dispatchDesktopCommand(
  commandId: DesktopCommandId,
  context: DesktopCommandContext,
): DesktopCommandRouteResult {
  const command = DESKTOP_COMMANDS.find(({ id }) => id === commandId)!;
  if (!command.available(context)) {
    context.announce(`${command.label} is unavailable in the current view.`);
    return { status: "unavailable", commandId };
  }
  command.dispatch(context);
  return { status: "dispatched", commandId };
}

export function routeDesktopKeydown(
  event: DesktopKeyboardEvent,
  context: DesktopCommandContext,
): DesktopCommandRouteResult {
  if (
    event.repeat
    || event.isComposing === true
    || event.keyCode === 229
    || context.modalOpen
    || isEditableTarget(event.target)
  ) {
    return { status: "ignored" };
  }
  const command = DESKTOP_COMMANDS.find(({ binding }) => matchesBinding(event, binding));
  if (command === undefined) return { status: "ignored" };
  event.preventDefault();
  return dispatchDesktopCommand(command.id, context);
}
