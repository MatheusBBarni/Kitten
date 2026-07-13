/**
 * Stateless presentation for prompt-local repository-file completion.
 *
 * The owner supplies prevalidated repository-relative paths, status, and highlight.
 * This leaf performs no discovery, filtering, navigation, telemetry, or state access.
 */

import type { ReactNode } from "react"

import { usePalette } from "./theme.ts"

export type FileSelectorStatus = "loading" | "ready" | "empty" | "unavailable"

export interface FileSelectorProps {
  readonly status: FileSelectorStatus
  readonly paths: readonly string[]
  readonly highlightedIndex: number
}

/** The selector's fixed terminal row budget. */
export const MAX_VISIBLE_FILE_ROWS = 8

/** Concise, non-modal status copy shown while repository discovery runs. */
export const FILE_SELECTOR_LOADING = "Finding repository files…"

/** No-result feedback that leaves ordinary prompt typing available. */
export const FILE_SELECTOR_EMPTY = "No files match. Keep typing."

/** Fail-soft feedback that leaves manual path composition available. */
export const FILE_SELECTOR_UNAVAILABLE = "Files unavailable. Keep typing."

/** Stable identity for the bordered list, absent from every non-ready state. */
export const FILE_SELECTOR_READY_ID = "file-selector-ready"

/** Stable identity for the one row keyboard navigation currently targets. */
export const HIGHLIGHTED_FILE_ROW_ID = "file-selector-highlighted-row"

/** Render only the already-decided file-completion presentation state. */
export function FileSelector({ status, paths, highlightedIndex }: FileSelectorProps): ReactNode {
  const palette = usePalette()

  if (status !== "ready" || paths.length === 0) {
    const message = status === "loading"
      ? FILE_SELECTOR_LOADING
      : status === "unavailable" ? FILE_SELECTOR_UNAVAILABLE : FILE_SELECTOR_EMPTY

    return (
      <box style={{ height: 1, flexShrink: 0, paddingLeft: 1 }}>
        <text fg={palette.muted}>{message}</text>
      </box>
    )
  }

  const visiblePaths = paths.slice(0, MAX_VISIBLE_FILE_ROWS)
  const visibleHighlight = Math.min(Math.max(highlightedIndex, 0), visiblePaths.length - 1)

  return (
    <box
      id={FILE_SELECTOR_READY_ID}
      style={{
        flexDirection: "column",
        flexShrink: 0,
        border: true,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        overflow: "hidden",
      }}
      title="Files"
      titleColor={palette.accent}
    >
      {visiblePaths.map((path, index) => {
        const highlighted = index === visibleHighlight
        return (
          <box key={path} style={{ height: 1, flexShrink: 0 }}>
            <text id={highlighted ? HIGHLIGHTED_FILE_ROW_ID : undefined}>
              <span fg={palette.accent}>{highlighted ? "▸" : " "}</span>
              <span fg={highlighted ? palette.text : palette.muted}>{` ${path}`}</span>
            </text>
          </box>
        )
      })}
    </box>
  )
}
