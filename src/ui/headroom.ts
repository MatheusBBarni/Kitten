export const HEADROOM_UNKNOWN = "—"

export interface HeadroomDisplay {
  label: string
  filled: number
  cells: number
}

const DEFAULT_HEADROOM_CELLS = 5

/** Format a derived headroom percentage without adding any presentation verdict. */
export function formatHeadroom(pct: number | null, cells = DEFAULT_HEADROOM_CELLS): HeadroomDisplay {
  const totalCells = Number.isFinite(cells) ? Math.max(0, Math.floor(cells)) : DEFAULT_HEADROOM_CELLS

  if (pct === null) return { label: HEADROOM_UNKNOWN, filled: 0, cells: totalCells }

  const boundedPct = Number.isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct))
  const filled = Math.min(totalCells, Math.max(0, Math.round((boundedPct / 100) * totalCells)))

  return { label: `${pct}%`, filled, cells: totalCells }
}
