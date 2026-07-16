# Keep curated Theme Presets stable and source-faithful

Kitten will treat every shipped Theme Preset as a durable user preference: a protocol-free core catalog owns its typed ID and metadata, the ID is never renamed or reused, and a retired preset must resolve through an explicit compatibility mapping rather than silently falling back to Auto. Presets use their recognizable public upstream palette and exact display name, with only role-specific readability adjustments allowed; each catalog entry retains its palette source and license or attribution record so future updates remain auditable; paid, private, and source-unverifiable editions do not enter the built-in catalog.

## Consequences

- The palette catalog owns stable IDs, display names, source metadata, and presentation order rather than deriving labels from IDs; family headings and their variants sort alphabetically.
- The initial public catalog contains Catppuccin Latte, Frappe, Macchiato, and Mocha; Dracula and Alucard; One Dark; Nord; Tokyo Night, Storm, Moon, and Day; Gruvbox Dark Hard, Medium, and Soft; and Rosé Pine Main, Moon, and Dawn. Gruvbox Light variants are deferred.
- The first family catalog ships atomically with every listed preset, its source documentation, the grouped picker, compatibility behavior, and the complete visual acceptance gate.
- A future removal requires a compatibility path and migration coverage for persisted config and the content-free `theme_set` enum; loading an alias canonicalizes the live preference without rewriting user config until an explicit theme change.
- Accessibility checks require every rendered foreground role to meet a 4.5:1 contrast floor against its surface in both truecolor and xterm-256 fallback, including any source-faithful color adjustment.
