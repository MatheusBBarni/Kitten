# Theme Catalog

Kitten ships a finite, curated Theme Catalog alongside Auto, Light, and Dark. It does not download palettes at runtime, accept imported themes, or include paid, private, or source-unverifiable editions.

## Public sources

| Family | Included presets | Canonical source | License / attribution |
| --- | --- | --- | --- |
| Catppuccin | Latte, Frappe, Macchiato, Mocha | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin) | MIT |
| Dracula | Dracula, Alucard | [dracula/dracula-theme](https://github.com/dracula/dracula-theme) | MIT, Dracula Theme |
| One Dark | One Dark | [Atom One Dark Syntax](https://github.com/atom/atom/tree/master/packages/one-dark-syntax) | MIT, Atom / GitHub |
| Nord | Nord | [nordtheme/nord](https://github.com/nordtheme/nord) | MIT, Sven Greb / Nord |
| Tokyo Night | Night, Storm, Moon, Day | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim) | Apache-2.0, folke |
| Gruvbox Dark | Hard, Medium, Soft | [morhetz/gruvbox](https://github.com/morhetz/gruvbox) | MIT/X11, Pavel Pertsev |
| Rosé Pine | Main, Moon, Dawn | [rose-pine/rose-pine-palette](https://github.com/rose-pine/rose-pine-palette) | MIT, Rosé Pine |

## Catalog contract

- Every Theme Preset has a stable persisted ID. An ID is never renamed or reused.
- A future retirement requires an explicit compatibility mapping. Loading a mapped ID resolves its canonical successor for the live session without rewriting user config until an explicit theme change.
- Palette values follow their listed public source. Kitten may make narrowly scoped foreground adjustments only when needed to meet its 4.5:1 readability gate in truecolor and xterm-256 fallback.
- Settings presents Auto, Light, and Dark first, then the catalog as a grouped, scrollable keyboard list. Family headings and variants sort alphabetically; headings are non-selectable, variants are selectable, and each applies immediately.
