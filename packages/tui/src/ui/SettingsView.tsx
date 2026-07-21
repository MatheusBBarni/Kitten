/**
 * The settings overlay: a keyboard-only home for live cockpit preferences.
 *
 * V1 has one tab, Theme. Moving the highlight is the commit action: the store-backed
 * preference changes synchronously, every `usePalette` subscriber repaints, and the
 * app-layer persistence subscriber owns writing the settled value to disk. The view
 * never performs I/O.
 *
 * Like the other overlays, the component self-gates and mounts its keyboard listener
 * only while its slot is open. Agent interactions outrank settings: clarification
 * owns top priority, followed by a pending approval.
 */

import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useCallback, useRef, type ReactNode } from "react"

import { THEME_PRESETS, type ThemePresetId } from "../core/themeCatalog.ts"
import type { ThemePreference } from "../core/types.ts"
import {
  selectIsApprovalOpen,
  selectIsClarificationOpen,
  selectSettingsOverlay,
  selectThemePreference,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { matchSettingsCommand, SETTINGS_HINT } from "./keymap.ts"
import { usePalette } from "./theme.ts"

/** The frame title shown while settings owns the overlay slot. */
export const SETTINGS_TITLE = "Settings"

/** The active-tab marker; brackets remain meaningful without color. */
export const THEME_TAB_LABEL = "[Theme]"

/** The current preference marker, shared with the cockpit's other selectable lists. */
export const THEME_OPTION_MARKER = "▸"

/** The apply behavior promised beside the setting, not hidden in help text. */
export const THEME_APPLY_LABEL = "Applies immediately"

/** The public documentation route for source and attribution details. */
export const THEME_CATALOG_DOCUMENTATION = "Theme Catalog: docs/theme-catalog.md"

/** Stable renderer identity for the bounded theme list. */
export const THEME_PICKER_SCROLLBOX_ID = "settings-theme-picker"

type BuiltinThemePreference = Exclude<ThemePreference, ThemePresetId>

/** One rendered row in the grouped Settings theme catalog. */
export type ThemePickerRow =
  | {
    readonly kind: "builtin"
    readonly id: string
    readonly label: string
    readonly preference: BuiltinThemePreference
  }
  | {
    readonly kind: "family"
    readonly id: string
    readonly label: string
    readonly family: string
  }
  | {
    readonly kind: "preset"
    readonly id: string
    readonly label: string
    readonly family: string
    readonly preference: ThemePresetId
  }

export type SelectableThemePickerRow = Extract<ThemePickerRow, { readonly preference: ThemePreference }>

/** Stable identity for a selectable preference row. */
export function themePickerRowId(preference: ThemePreference): string {
  return `settings-theme-option:${preference}`
}

/** Stable identity for a non-selectable family heading. */
export function themePickerFamilyRowId(family: string): string {
  return `settings-theme-family:${family}`
}

/** Project the canonical catalog into the rows Settings renders and navigates. */
export function themePickerRows(): readonly ThemePickerRow[] {
  const rows: ThemePickerRow[] = [
    { kind: "builtin", id: themePickerRowId("auto"), label: "Auto", preference: "auto" },
    { kind: "builtin", id: themePickerRowId("light"), label: "Light", preference: "light" },
    { kind: "builtin", id: themePickerRowId("dark"), label: "Dark", preference: "dark" },
  ]
  let previousFamily: string | null = null

  for (const preset of THEME_PRESETS) {
    if (preset.family !== previousFamily) {
      rows.push({
        kind: "family",
        id: themePickerFamilyRowId(preset.family),
        label: preset.family,
        family: preset.family,
      })
      previousFamily = preset.family
    }
    rows.push({
      kind: "preset",
      id: themePickerRowId(preset.id),
      label: preset.displayName,
      family: preset.family,
      preference: preset.id,
    })
  }

  return Object.freeze(rows)
}

/** Keep headings visible but out of keyboard navigation and persistence. */
export function selectableThemePickerRows(
  rows: readonly ThemePickerRow[],
): readonly SelectableThemePickerRow[] {
  return rows.filter((row): row is SelectableThemePickerRow => row.kind !== "family")
}

export const THEME_PICKER_ROWS = themePickerRows()
export const SELECTABLE_THEME_PICKER_ROWS = selectableThemePickerRows(THEME_PICKER_ROWS)

/** Theme order from the product contract, derived from the same rows users see. */
export const THEME_OPTIONS: readonly ThemePreference[] = Object.freeze(
  SELECTABLE_THEME_PICKER_ROWS.map((row) => row.preference),
)

const THEME_LABELS = new Map<ThemePreference, string>(
  SELECTABLE_THEME_PICKER_ROWS.map((row) => [row.preference, row.label]),
)

/** OpenTUI otherwise reserves a row for a horizontal scrollbar. */
const HIDDEN_HORIZONTAL_SCROLLBAR = { visible: false } as const

/** Turn a stable preference id into the label shown to the user. */
export function themePreferenceLabel(preference: ThemePreference): string {
  return THEME_LABELS.get(preference) ?? preference
}

/** The overlay, or nothing. The shell may mount it unconditionally in task 10. */
export function SettingsView(): ReactNode {
  const overlay = useAppSelector(selectSettingsOverlay)
  const clarificationOpen = useAppSelector(selectIsClarificationOpen)
  const approvalOpen = useAppSelector(selectIsApprovalOpen)

  if (!overlay || clarificationOpen || approvalOpen) return null
  return <SettingsDialog />
}

/** The dialog proper. It exists only while settings is allowed to own the keyboard. */
function SettingsDialog(): ReactNode {
  const { store } = useController()
  const palette = usePalette()
  const { height } = useTerminalDimensions()
  const preference = useAppSelector(selectThemePreference)
  const selected = Math.max(THEME_OPTIONS.indexOf(preference), 0)
  const themeList = useRef<ScrollBoxRenderable | null>(null)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const attachThemeList = useCallback((node: ScrollBoxRenderable | null): void => {
    if (scrollTimer.current !== null) clearTimeout(scrollTimer.current)
    themeList.current = node
    if (node === null) {
      scrollTimer.current = null
      return
    }
    // ScrollBox resolves child positions during its native layout pass. Defer one
    // task after attachment so initial, remounted, and keyboard-selected rows exist.
    scrollTimer.current = setTimeout(() => {
      if (themeList.current === node) node.scrollChildIntoView(themePickerRowId(preference))
      scrollTimer.current = null
    }, 0)
  }, [preference])

  const move = useCallback(
    (delta: -1 | 1): void => {
      const nextIndex = Math.max(0, Math.min(selected + delta, THEME_OPTIONS.length - 1))
      const next = THEME_OPTIONS[nextIndex]
      if (next) store.setThemePreference(next)
    },
    [selected, store],
  )

  const onKey = useCallback(
    (key: KeyEvent): void => {
      // Modal: even an unbound key belongs to settings while this dialog is visible.
      key.preventDefault()

      switch (matchSettingsCommand(key)) {
        case "prev-option":
          move(-1)
          return
        case "next-option":
          move(1)
          return
        case "reset-to-default":
          store.setThemePreference("auto")
          return
        case "close":
          store.closeSettings()
          return
        case "switch-tab":
          // Theme is the sole V1 tab. Consuming Tab keeps the interaction modal and
          // leaves the dispatch shape ready for the committed Keys fast-follow.
          return
        default:
          return
      }
    },
    [move, store],
  )
  useKeyboard(onKey)

  return (
    <box
      style={{
        position: "absolute",
        top: 2,
        left: 6,
        right: 6,
        height: Math.max(height - 4, 1),
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title={SETTINGS_TITLE}
      titleColor={palette.accent}
    >
      <text style={{ flexShrink: 0 }}>
        <span fg={palette.accent}>{THEME_TAB_LABEL}</span>
        <span fg={palette.muted}>{`  ${THEME_APPLY_LABEL}`}</span>
      </text>

      <scrollbox
        id={THEME_PICKER_SCROLLBOX_ID}
        ref={attachThemeList}
        style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, marginTop: 1 }}
        scrollX={false}
        horizontalScrollbarOptions={HIDDEN_HORIZONTAL_SCROLLBAR}
      >
        {THEME_PICKER_ROWS.map((row) => {
          if (row.kind === "family") {
            return (
              <text id={row.id} key={row.id} style={{ flexShrink: 0 }} fg={palette.accent}>
                {row.label}
              </text>
            )
          }

          const current = row.preference === preference
          return (
            <text id={row.id} key={row.id} style={{ flexShrink: 0 }}>
              <span fg={current ? palette.accent : palette.muted}>{current ? THEME_OPTION_MARKER : " "}</span>
              <span fg={current ? palette.text : palette.muted}>
                {`${row.kind === "preset" ? "   " : " "}${row.label}`}
              </span>
            </text>
          )
        })}
      </scrollbox>

      <text style={{ flexShrink: 0 }} fg={palette.muted}>
        {THEME_CATALOG_DOCUMENTATION}
      </text>

      <text style={{ flexShrink: 0 }} fg={palette.muted}>
        {SETTINGS_HINT}
      </text>
    </box>
  )
}
