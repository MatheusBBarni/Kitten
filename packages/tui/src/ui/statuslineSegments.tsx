/** Shared presentation policy for already-rendered, width-bounded statusline segments. */

import type { ReactNode } from "react"

import type { StatuslineSegment } from "../core/statusline.ts"
import type { CockpitPalette } from "./theme.ts"

export interface StatuslineSegmentsProps {
  readonly segments: readonly StatuslineSegment[]
  readonly palette: Pick<CockpitPalette, "text" | "muted">
}

/** Apply foregrounds without reinterpreting core-owned text, order, separators, or widths. */
export function StatuslineSegments({ segments, palette }: StatuslineSegmentsProps): ReactNode {
  return segments.flatMap((segment, index) => [
    segment.separatorBefore.length > 0
      ? <span key={`separator-${index}`} fg={palette.muted}>{segment.separatorBefore}</span>
      : null,
    <span key={`field-${index}`} fg={segment.color ?? palette.text}>{segment.text}</span>,
  ])
}
