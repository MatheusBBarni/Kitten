# Theme Catalog

Kitten ships a finite, built-in Theme Catalog alongside Auto, Light, and Dark. This document is the public source of truth for preset identity and provenance; Settings links here instead of duplicating source or license details in the picker.

## Presets

The catalog contains exactly these 18 canonical presets, in the deterministic family-and-variant order used by Settings.

| Family | Variant | Display name | Canonical ID | Public source | License / attribution |
| --- | --- | --- | --- | --- | --- |
| Catppuccin | Frappe | Catppuccin Frappe | `catppuccin-frappe` | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin) | MIT |
| Catppuccin | Latte | Catppuccin Latte | `catppuccin-latte` | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin) | MIT |
| Catppuccin | Macchiato | Catppuccin Macchiato | `catppuccin-macchiato` | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin) | MIT |
| Catppuccin | Mocha | Catppuccin Mocha | `catppuccin-mocha` | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin) | MIT |
| Dracula | Alucard | Dracula Alucard | `dracula-alucard` | [dracula/dracula-theme](https://github.com/dracula/dracula-theme) | MIT, Dracula Theme |
| Dracula | Dracula | Dracula | `dracula` | [dracula/dracula-theme](https://github.com/dracula/dracula-theme) | MIT, Dracula Theme |
| Gruvbox Dark | Hard | Gruvbox Dark Hard | `gruvbox-dark-hard` | [morhetz/gruvbox](https://github.com/morhetz/gruvbox) | MIT/X11, Pavel Pertsev |
| Gruvbox Dark | Medium | Gruvbox Dark Medium | `gruvbox-dark-medium` | [morhetz/gruvbox](https://github.com/morhetz/gruvbox) | MIT/X11, Pavel Pertsev |
| Gruvbox Dark | Soft | Gruvbox Dark Soft | `gruvbox-dark-soft` | [morhetz/gruvbox](https://github.com/morhetz/gruvbox) | MIT/X11, Pavel Pertsev |
| Nord | Single preset | Nord | `nord` | [nordtheme/nord](https://github.com/nordtheme/nord) | MIT, Sven Greb / Nord |
| One Dark | Single preset | One Dark | `one-dark` | [Atom One Dark Syntax](https://github.com/atom/atom/tree/master/packages/one-dark-syntax) | MIT, Atom / GitHub |
| Rosé Pine | Dawn | Rosé Pine Dawn | `rose-pine-dawn` | [rose-pine/rose-pine-palette](https://github.com/rose-pine/rose-pine-palette) | MIT, Rosé Pine |
| Rosé Pine | Main | Rosé Pine Main | `rose-pine-main` | [rose-pine/rose-pine-palette](https://github.com/rose-pine/rose-pine-palette) | MIT, Rosé Pine |
| Rosé Pine | Moon | Rosé Pine Moon | `rose-pine-moon` | [rose-pine/rose-pine-palette](https://github.com/rose-pine/rose-pine-palette) | MIT, Rosé Pine |
| Tokyo Night | Day | Tokyo Night Day | `tokyo-night-day` | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim) | Apache-2.0, folke |
| Tokyo Night | Moon | Tokyo Night Moon | `tokyo-night-moon` | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim) | Apache-2.0, folke |
| Tokyo Night | Night | Tokyo Night | `tokyo-night` | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim) | Apache-2.0, folke |
| Tokyo Night | Storm | Tokyo Night Storm | `tokyo-night-storm` | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim) | Apache-2.0, folke |

## Stable IDs and compatibility

- Canonical IDs are durable persisted identities. They are not renamed or reused.
- Aliases are compatibility input only; they are not separate catalog entries or selectable Settings values. The current catalog declares no aliases because Kitten has no retired or renamed preset IDs to migrate.
- When a declared alias is loaded, Kitten resolves it to the mapped canonical ID for live application state. Loading an alias does not rewrite the user's configuration file during boot. A later explicit theme selection in Settings persists the selected canonical ID.
- Unknown theme values remain configuration errors; they never silently fall back to Auto or masquerade as a curated preset.

## Settings behavior

- Auto, Light, and Dark appear first. Catalog families and variants then follow the deterministic alphabetical order shown above.
- Family headings are non-selectable. Arrow-key navigation moves only among selectable themes, and the active row has a visible marker that does not rely on color alone.
- The picker uses a bounded, vertically scrolling list that keeps the active row visible in short terminals and does not reserve space for a horizontal scrollbar.
- Moving to a selectable theme applies it instantly and saves the settled canonical preference; there is no preview, confirmation, cancellation, or separate save step. Reset returns the preference to Auto.
- Provenance is documentation-first: the picker points to this document and does not embed source or license metadata in Settings.

## Accessibility and catalog boundary

Kitten keeps each preset recognizable to its listed public source while allowing narrowly scoped foreground adjustments needed for readable application roles. Required foreground and surface pairs are gated at a minimum 4.5:1 contrast ratio in both truecolor and xterm-256 rendering. Selection and keyboard focus retain a non-color-only marker, and semantic status, tool, syntax, message, and selection surfaces remain distinguishable.

The V1 catalog does not support custom or imported themes and never downloads palettes at runtime. It excludes theme marketplaces, paid, private, or source-unverifiable editions, Gruvbox Light variants, adaptive contrast tuning, and an in-app credits view. Source and attribution corrections must update the core catalog and this contract together.
