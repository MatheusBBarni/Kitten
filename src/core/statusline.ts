/**
 * Pure statusline layout validation and rendering.
 *
 * This module is the sole interpretation boundary for saved layouts and model
 * proposals. It deliberately has no protocol, UI, process, or I/O dependency.
 */

export const STATUSLINE_SIMPLE_KINDS = [
  "FOLDER",
  "FULL_PATH",
  "BRANCH",
  "PROVIDER",
  "MODEL",
  "EFFORT",
  "HELP_TEXT",
] as const

export type StatuslineSimpleKind = (typeof STATUSLINE_SIMPLE_KINDS)[number]
export type StatuslineItemKind = StatuslineSimpleKind | "ELLIPSIS_BRANCH"

export type StatuslineItem =
  | StatuslineSimpleKind
  | { readonly kind: "ELLIPSIS_BRANCH"; readonly maxChars: number }

export interface StatuslineLayout {
  readonly separator: string
  readonly line: readonly StatuslineItem[]
}

export interface StatuslinePreference {
  readonly llmDisclosureAcknowledged: boolean
  readonly layout: StatuslineLayout | null
}

/** Values supplied by the selected-session read model; blank values are unavailable. */
export interface StatuslineContext {
  readonly cwd?: string | null
  readonly branch?: string | null
  readonly provider?: string | null
  readonly model?: string | null
  readonly effort?: string | null
  readonly helpText?: string | null
}

/** A consumer-ready field. Separators are explicit so consumers cannot reinterpret layout spacing. */
export interface StatuslineSegment {
  readonly kind: StatuslineItemKind
  readonly text: string
  readonly separatorBefore: string
}

export type StatuslineLayoutResult =
  | { readonly kind: "valid"; readonly layout: StatuslineLayout }
  | { readonly kind: "invalid"; readonly reason: string }

export type StatuslineProposalResult =
  | { readonly kind: "proposal"; readonly layout: StatuslineLayout }
  | { readonly kind: "invalid-response"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface StatuslinePreset {
  readonly name: "Workspace" | "Agent" | "Compact"
  readonly layout: StatuslineLayout
}

export const DEFAULT_STATUSLINE_SEPARATOR = " · "
export const MIN_ELLIPSIS_BRANCH_GRAPHEMES = 4
export const MAX_ELLIPSIS_BRANCH_GRAPHEMES = 80
export const MAX_STATUSLINE_SEPARATOR_GRAPHEMES = 16

const SIMPLE_KINDS = new Set<string>(STATUSLINE_SIMPLE_KINDS)
const CONTROL_OR_NONLINE_CHARACTER = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export const STATUSLINE_RECOVERY_PRESETS: readonly StatuslinePreset[] = [
  {
    name: "Workspace",
    layout: { separator: DEFAULT_STATUSLINE_SEPARATOR, line: ["FOLDER", "BRANCH"] },
  },
  {
    name: "Agent",
    layout: { separator: DEFAULT_STATUSLINE_SEPARATOR, line: ["PROVIDER", "MODEL", "EFFORT"] },
  },
  {
    name: "Compact",
    layout: {
      separator: DEFAULT_STATUSLINE_SEPARATOR,
      line: ["FOLDER", { kind: "ELLIPSIS_BRANCH", maxChars: 24 }, "MODEL"],
    },
  },
]

/** Validate unknown persisted or proposed data through one strict acceptance boundary. */
export function normalizeStatuslineLayout(input: unknown): StatuslineLayoutResult {
  if (!isRecord(input)) return invalidLayout("layout must be an object")

  const keys = Object.keys(input)
  const hasSeparator = Object.hasOwn(input, "separator")
  const hasLine = Object.hasOwn(input, "line")
  if (hasSeparator !== hasLine) return invalidLayout("separator and line must be provided together")
  if (!hasSeparator) return invalidLayout("separator and line are required")
  if (keys.some((key) => key !== "separator" && key !== "line")) {
    return invalidLayout("layout contains unsupported fields")
  }

  if (typeof input.separator !== "string") return invalidLayout("separator must be a string")
  const separatorLength = graphemes(input.separator).length
  if (separatorLength === 0) return invalidLayout("separator must not be empty")
  if (separatorLength > MAX_STATUSLINE_SEPARATOR_GRAPHEMES) {
    return invalidLayout(`separator must be at most ${MAX_STATUSLINE_SEPARATOR_GRAPHEMES} graphemes`)
  }
  if (CONTROL_OR_NONLINE_CHARACTER.test(input.separator)) {
    return invalidLayout("separator must contain only printable single-line characters")
  }

  if (!Array.isArray(input.line)) return invalidLayout("line must be an array")
  if (input.line.length === 0) return invalidLayout("line must contain at least one item")

  const line: StatuslineItem[] = []
  const seen = new Set<StatuslineItemKind>()
  for (const [index, candidate] of input.line.entries()) {
    const normalized = normalizeItem(candidate, index)
    if (normalized.kind === "invalid") return normalized
    const kind = itemKind(normalized.item)
    if (seen.has(kind)) return invalidLayout(`line contains duplicate field ${kind}`)
    seen.add(kind)
    line.push(normalized.item)
  }

  return { kind: "valid", layout: { separator: input.separator, line } }
}

/** Accept only a complete, sole lowercase-json fenced block with the documented proposal wrapper. */
export function parseStatuslineProposalReply(text: string): StatuslineProposalResult {
  if (text.length === 0) return { kind: "unavailable", reason: "The agent returned no statusline proposal." }

  const match = /^```json\r?\n((?:(?!```)[\s\S])+?)\r?\n```$/.exec(text)
  if (!match) {
    return {
      kind: "invalid-response",
      reason: "The response must contain only one fenced json block with no surrounding prose.",
    }
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(match[1] ?? "")
  } catch {
    return { kind: "invalid-response", reason: "The fenced statusline proposal is not valid JSON." }
  }

  if (!isRecord(decoded) || Object.keys(decoded).length !== 1 || !Object.hasOwn(decoded, "statusline")) {
    return { kind: "invalid-response", reason: "The JSON reply must contain only the statusline proposal." }
  }

  const normalized = normalizeStatuslineLayout(decoded.statusline)
  return normalized.kind === "valid"
    ? { kind: "proposal", layout: normalized.layout }
    : { kind: "invalid-response", reason: normalized.reason }
}

/** Render available fields in declared order and omit trailing fields until the grapheme budget fits. */
export function renderStatusline(
  layout: StatuslineLayout,
  context: StatuslineContext,
  columnBudget: number,
): readonly StatuslineSegment[] {
  const budget = Number.isFinite(columnBudget) ? Math.max(0, Math.floor(columnBudget)) : 0
  const available = layout.line.flatMap((item): Array<{ kind: StatuslineItemKind; text: string }> => {
    const text = valueForItem(item, context)
    return text === null ? [] : [{ kind: itemKind(item), text }]
  })

  while (available.length > 0 && renderedLength(available, layout.separator) > budget) available.pop()

  return available.map((segment, index) => ({
    ...segment,
    separatorBefore: index === 0 ? "" : layout.separator,
  }))
}

/** Join renderer output without giving a consumer any separator policy of its own. */
export function statuslineText(segments: readonly StatuslineSegment[]): string {
  return segments.map(({ separatorBefore, text }) => `${separatorBefore}${text}`).join("")
}

function normalizeItem(
  input: unknown,
  index: number,
): { readonly kind: "valid"; readonly item: StatuslineItem } | { readonly kind: "invalid"; readonly reason: string } {
  if (typeof input === "string") {
    return SIMPLE_KINDS.has(input)
      ? { kind: "valid", item: input as StatuslineSimpleKind }
      : invalidLayout(`line item ${index + 1} is not a supported field`)
  }
  if (!isRecord(input)) return invalidLayout(`line item ${index + 1} is malformed`)
  if (Object.keys(input).some((key) => key !== "kind" && key !== "maxChars")) {
    return invalidLayout(`line item ${index + 1} contains unsupported fields`)
  }
  if (input.kind !== "ELLIPSIS_BRANCH" || !Object.hasOwn(input, "maxChars")) {
    return invalidLayout(`line item ${index + 1} is not a supported field`)
  }
  if (!Number.isInteger(input.maxChars) ||
    (input.maxChars as number) < MIN_ELLIPSIS_BRANCH_GRAPHEMES ||
    (input.maxChars as number) > MAX_ELLIPSIS_BRANCH_GRAPHEMES) {
    return invalidLayout(
      `ELLIPSIS_BRANCH maxChars must be an integer from ${MIN_ELLIPSIS_BRANCH_GRAPHEMES} to ${MAX_ELLIPSIS_BRANCH_GRAPHEMES}`,
    )
  }
  return { kind: "valid", item: { kind: "ELLIPSIS_BRANCH", maxChars: input.maxChars as number } }
}

function valueForItem(item: StatuslineItem, context: StatuslineContext): string | null {
  const kind = itemKind(item)
  switch (kind) {
    case "FOLDER":
      return folderName(availableValue(context.cwd))
    case "FULL_PATH":
      return availableValue(context.cwd)
    case "BRANCH":
      return availableValue(context.branch)
    case "ELLIPSIS_BRANCH": {
      const branch = availableValue(context.branch)
      return branch === null ? null : ellipsize(branch, (item as Extract<StatuslineItem, object>).maxChars)
    }
    case "PROVIDER":
      return availableValue(context.provider)
    case "MODEL":
      return availableValue(context.model)
    case "EFFORT":
      return availableValue(context.effort)
    case "HELP_TEXT":
      return availableValue(context.helpText)
  }
}

function availableValue(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0 || CONTROL_OR_NONLINE_CHARACTER.test(value)) return null
  return value
}

function folderName(cwd: string | null): string | null {
  if (cwd === null) return null
  const withoutTrailingSeparators = cwd.replace(/[\\/]+$/u, "")
  if (withoutTrailingSeparators.length === 0) return cwd.startsWith("/") ? "/" : null
  return withoutTrailingSeparators.split(/[\\/]/u).at(-1) ?? null
}

function ellipsize(value: string, limit: number): string {
  const clusters = graphemes(value)
  return clusters.length <= limit ? value : `${clusters.slice(0, limit - 1).join("")}…`
}

function renderedLength(items: readonly { readonly text: string }[], separator: string): number {
  if (items.length === 0) return 0
  return items.reduce((total, item) => total + graphemes(item.text).length, 0) +
    graphemes(separator).length * (items.length - 1)
}

function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), ({ segment }) => segment)
}

function itemKind(item: StatuslineItem): StatuslineItemKind {
  return typeof item === "string" ? item : item.kind
}

function invalidLayout(reason: string): { readonly kind: "invalid"; readonly reason: string } {
  return { kind: "invalid", reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
