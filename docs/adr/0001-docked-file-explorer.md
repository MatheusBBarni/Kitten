# Dock the File Explorer beside the focused conversation

Kitten will present its File Explorer as a toggleable docked sidebar beside the focused conversation, rather than as a modal or a separate normal workflow. This deliberately relaxes the cockpit's single-pane layout to preserve file-navigation context, while a terminal too narrow for readable shared panes uses a temporary full-pane explorer fallback until focus returns to the composer.

## Considered Options

- **Docked sidebar** — selected because it matches editor expectations and permits navigation without obscuring the agent conversation.
- **Modal explorer** — rejected because it blocks the conversation while browsing.
- **Always full-pane explorer** — rejected because normal-width terminals can retain both useful contexts at once.
