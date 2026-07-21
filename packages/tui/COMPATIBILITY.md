# Temporary relocation bridges

Cockpit production ownership lives under `packages/tui`. The remaining root
surfaces are compatibility bridges only:

| Root bridge | Package owner | Removal owner |
| --- | --- | --- |
| `src/` production-file symlinks | `packages/tui/src/` | Task 03 relocates the remaining tests and removes the source/test bridge. |
| `scripts/build.ts` symlink | `packages/tui/scripts/build.ts` | Task 04 rebases delivery automation and removes the root build bridge. |
| `bin/` symlinks | `packages/tui/bin/` | Task 04 rebases publication paths and removes the root bin bridge. |

No root bridge may gain application logic. Changes belong in the package owner.
