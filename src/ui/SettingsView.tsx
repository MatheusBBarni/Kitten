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

import type { KeyEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useCallback, type ReactNode } from "react"

import type { ThemePreference } from "../core/types.ts"
import {
  selectIsApprovalOpen,
  selectIsClarificationOpen,
  selectSettingsOverlay,
  selectThemePreference,
} from "../store/selectors.ts"
import { useAppSelector, useController } from "./cockpitContext.tsx"
import { matchSettingsCommand, SETTINGS_HINT } from "./keymap.ts"
import { PALETTES, usePalette } from "./theme.ts"

/** The frame title shown while settings owns the overlay slot. */
export const SETTINGS_TITLE = "Settings"

/** The active-tab marker; brackets remain meaningful without color. */
export const THEME_TAB_LABEL = "[Theme]"

/** The current preference marker, shared with the cockpit's other selectable lists. */
export const THEME_OPTION_MARKER = "▸"

/** The apply behavior promised beside the setting, not hidden in help text. */
export const THEME_APPLY_LABEL = "Applies immediately"

const BUILTIN_THEME_IDS = new Set<ThemePreference>(["light", "dark"])
const PRESET_THEME_IDS = (Object.keys(PALETTES) as ThemePreference[]).filter((id) => !BUILTIN_THEME_IDS.has(id))

/** Theme order from the product contract; named presets are sourced from the registry. */
export const THEME_OPTIONS: readonly ThemePreference[] = ["auto", "light", "dark", ...PRESET_THEME_IDS]

/** Turn a stable preference id into the label shown to the user. */
export function themePreferenceLabel(preference: ThemePreference): string {
  return preference
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ")
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
  const preference = useAppSelector(selectThemePreference)
  const selected = Math.max(THEME_OPTIONS.indexOf(preference), 0)

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
        flexDirection: "column",
        border: true,
        borderColor: palette.accent,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={SETTINGS_TITLE}
      titleColor={palette.accent}
    >
      <text style={{ flexShrink: 0 }}>
        <span fg={palette.accent}>{THEME_TAB_LABEL}</span>
        <span fg={palette.muted}>{`  ${THEME_APPLY_LABEL}`}</span>
      </text>

      <box style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
        {THEME_OPTIONS.map((option, index) => {
          const current = index === selected
          return (
            <text key={option}>
              <span fg={current ? palette.accent : palette.muted}>{current ? THEME_OPTION_MARKER : " "}</span>
              <span fg={current ? palette.text : palette.muted}>{` ${themePreferenceLabel(option)}`}</span>
            </text>
          )
        })}
      </box>

      <text style={{ flexShrink: 0, marginTop: 1 }} fg={palette.muted}>
        {SETTINGS_HINT}
      </text>
    </box>
  )
}
