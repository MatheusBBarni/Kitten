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
  "CONTEXT",
] as const

export type StatuslineSimpleKind = (typeof STATUSLINE_SIMPLE_KINDS)[number]
export type StatuslineItemKind = StatuslineSimpleKind | "ELLIPSIS_BRANCH"
export type StatuslineColor = `#${string}`

export type StatuslineItem =
  | StatuslineSimpleKind
  | { readonly kind: StatuslineSimpleKind; readonly color: StatuslineColor }
  | { readonly kind: "ELLIPSIS_BRANCH"; readonly maxChars: number; readonly color?: StatuslineColor }

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
  readonly contextHeadroom?: number | null
}

/** A consumer-ready field. Separators are explicit so consumers cannot reinterpret layout spacing. */
export interface StatuslineSegment {
  readonly kind: StatuslineItemKind
  readonly text: string
  readonly color?: StatuslineColor
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
const OPAQUE_RGB_HEX = /^#[0-9a-f]{6}$/iu
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Opaque named colors from CSS Color 4; special values such as transparent are deliberately excluded. */
const CSS_NAMED_COLORS = {
  aliceblue: "#F0F8FF",
  antiquewhite: "#FAEBD7",
  aqua: "#00FFFF",
  aquamarine: "#7FFFD4",
  azure: "#F0FFFF",
  beige: "#F5F5DC",
  bisque: "#FFE4C4",
  black: "#000000",
  blanchedalmond: "#FFEBCD",
  blue: "#0000FF",
  blueviolet: "#8A2BE2",
  brown: "#A52A2A",
  burlywood: "#DEB887",
  cadetblue: "#5F9EA0",
  chartreuse: "#7FFF00",
  chocolate: "#D2691E",
  coral: "#FF7F50",
  cornflowerblue: "#6495ED",
  cornsilk: "#FFF8DC",
  crimson: "#DC143C",
  cyan: "#00FFFF",
  darkblue: "#00008B",
  darkcyan: "#008B8B",
  darkgoldenrod: "#B8860B",
  darkgray: "#A9A9A9",
  darkgreen: "#006400",
  darkgrey: "#A9A9A9",
  darkkhaki: "#BDB76B",
  darkmagenta: "#8B008B",
  darkolivegreen: "#556B2F",
  darkorange: "#FF8C00",
  darkorchid: "#9932CC",
  darkred: "#8B0000",
  darksalmon: "#E9967A",
  darkseagreen: "#8FBC8F",
  darkslateblue: "#483D8B",
  darkslategray: "#2F4F4F",
  darkslategrey: "#2F4F4F",
  darkturquoise: "#00CED1",
  darkviolet: "#9400D3",
  deeppink: "#FF1493",
  deepskyblue: "#00BFFF",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1E90FF",
  firebrick: "#B22222",
  floralwhite: "#FFFAF0",
  forestgreen: "#228B22",
  fuchsia: "#FF00FF",
  gainsboro: "#DCDCDC",
  ghostwhite: "#F8F8FF",
  gold: "#FFD700",
  goldenrod: "#DAA520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#ADFF2F",
  grey: "#808080",
  honeydew: "#F0FFF0",
  hotpink: "#FF69B4",
  indianred: "#CD5C5C",
  indigo: "#4B0082",
  ivory: "#FFFFF0",
  khaki: "#F0E68C",
  lavender: "#E6E6FA",
  lavenderblush: "#FFF0F5",
  lawngreen: "#7CFC00",
  lemonchiffon: "#FFFACD",
  lightblue: "#ADD8E6",
  lightcoral: "#F08080",
  lightcyan: "#E0FFFF",
  lightgoldenrodyellow: "#FAFAD2",
  lightgray: "#D3D3D3",
  lightgreen: "#90EE90",
  lightgrey: "#D3D3D3",
  lightpink: "#FFB6C1",
  lightsalmon: "#FFA07A",
  lightseagreen: "#20B2AA",
  lightskyblue: "#87CEFA",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#B0C4DE",
  lightyellow: "#FFFFE0",
  lime: "#00FF00",
  limegreen: "#32CD32",
  linen: "#FAF0E6",
  magenta: "#FF00FF",
  maroon: "#800000",
  mediumaquamarine: "#66CDAA",
  mediumblue: "#0000CD",
  mediumorchid: "#BA55D3",
  mediumpurple: "#9370DB",
  mediumseagreen: "#3CB371",
  mediumslateblue: "#7B68EE",
  mediumspringgreen: "#00FA9A",
  mediumturquoise: "#48D1CC",
  mediumvioletred: "#C71585",
  midnightblue: "#191970",
  mintcream: "#F5FFFA",
  mistyrose: "#FFE4E1",
  moccasin: "#FFE4B5",
  navajowhite: "#FFDEAD",
  navy: "#000080",
  oldlace: "#FDF5E6",
  olive: "#808000",
  olivedrab: "#6B8E23",
  orange: "#FFA500",
  orangered: "#FF4500",
  orchid: "#DA70D6",
  palegoldenrod: "#EEE8AA",
  palegreen: "#98FB98",
  paleturquoise: "#AFEEEE",
  palevioletred: "#DB7093",
  papayawhip: "#FFEFD5",
  peachpuff: "#FFDAB9",
  peru: "#CD853F",
  pink: "#FFC0CB",
  plum: "#DDA0DD",
  powderblue: "#B0E0E6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#FF0000",
  rosybrown: "#BC8F8F",
  royalblue: "#4169E1",
  saddlebrown: "#8B4513",
  salmon: "#FA8072",
  sandybrown: "#F4A460",
  seagreen: "#2E8B57",
  seashell: "#FFF5EE",
  sienna: "#A0522D",
  silver: "#C0C0C0",
  skyblue: "#87CEEB",
  slateblue: "#6A5ACD",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#FFFAFA",
  springgreen: "#00FF7F",
  steelblue: "#4682B4",
  tan: "#D2B48C",
  teal: "#008080",
  thistle: "#D8BFD8",
  tomato: "#FF6347",
  turquoise: "#40E0D0",
  violet: "#EE82EE",
  wheat: "#F5DEB3",
  white: "#FFFFFF",
  whitesmoke: "#F5F5F5",
  yellow: "#FFFF00",
  yellowgreen: "#9ACD32",
} as const satisfies Readonly<Record<string, StatuslineColor>>

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
  const available = layout.line.flatMap((item): Array<{
    kind: StatuslineItemKind
    text: string
    color?: StatuslineColor
  }> => {
    const text = valueForItem(item, context)
    if (text === null) return []
    const color = itemColor(item)
    return color === undefined
      ? [{ kind: itemKind(item), text }]
      : [{ kind: itemKind(item), text, color }]
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

  if (typeof input.kind === "string" && SIMPLE_KINDS.has(input.kind)) {
    if (Object.keys(input).length !== 2 || !Object.hasOwn(input, "color")) {
      return invalidLayout(`line item ${index + 1} contains unsupported fields`)
    }
    const color = normalizeColor(input.color)
    return color === null
      ? invalidLayout(`line item ${index + 1} has an unsupported color`)
      : { kind: "valid", item: { kind: input.kind as StatuslineSimpleKind, color } }
  }

  if (Object.keys(input).some((key) => key !== "kind" && key !== "maxChars" && key !== "color")) {
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
  if (!Object.hasOwn(input, "color")) {
    return { kind: "valid", item: { kind: "ELLIPSIS_BRANCH", maxChars: input.maxChars as number } }
  }
  const color = normalizeColor(input.color)
  return color === null
    ? invalidLayout(`line item ${index + 1} has an unsupported color`)
    : { kind: "valid", item: { kind: "ELLIPSIS_BRANCH", maxChars: input.maxChars as number, color } }
}

function normalizeColor(input: unknown): StatuslineColor | null {
  if (typeof input !== "string") return null
  if (OPAQUE_RGB_HEX.test(input)) return input.toUpperCase() as StatuslineColor
  return CSS_NAMED_COLORS[input.toLowerCase() as keyof typeof CSS_NAMED_COLORS] ?? null
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
      const ellipsis = item as Extract<StatuslineItem, { readonly kind: "ELLIPSIS_BRANCH" }>
      return branch === null ? null : ellipsize(branch, ellipsis.maxChars)
    }
    case "PROVIDER":
      return availableValue(context.provider)
    case "MODEL":
      return availableValue(context.model)
    case "EFFORT":
      return availableValue(context.effort)
    case "HELP_TEXT":
      return availableValue(context.helpText)
    case "CONTEXT":
      return contextValue(context.contextHeadroom)
  }
}

function contextValue(value: number | null | undefined): string | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
    ? `ctx ${value}%`
    : null
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

function itemColor(item: StatuslineItem): StatuslineColor | undefined {
  return typeof item === "string" ? undefined : item.color
}

function invalidLayout(reason: string): { readonly kind: "invalid"; readonly reason: string } {
  return { kind: "invalid", reason }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
