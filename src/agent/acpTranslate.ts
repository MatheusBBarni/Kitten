/**
 * ACP → domain translation (the anti-corruption boundary, ADR-003).
 *
 * This module is the ONLY place that reads ACP `SessionUpdate` wire shapes and
 * turns them into Kitten's protocol-free {@link DomainSessionEvent}s. It is pure:
 * no I/O, no subprocess, no ACP connection object. `agentConnection.ts` owns the
 * transport and lifecycle; this file owns the shape mapping so no ACP field ever
 * escapes upward.
 *
 * The ACP SDK is imported here (and in the sibling adapter/transport modules)
 * only; nothing under `src/core` or above `src/agent` may import it.
 */

import type {
  AvailableCommand as AcpAvailableCommand,
  ContentBlock,
  CreateElicitationResponse,
  Diff,
  McpServer,
  PlanEntry as AcpPlanEntry,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionUpdate,
  ToolCall,
  ToolCallContent,
  ToolCallUpdate as AcpToolCallUpdate,
  ToolKind,
  UsageUpdate,
} from "@agentclientprotocol/sdk"

import type {
  AvailableCommand,
  ClarificationAnswer,
  ClarificationField,
  ClarificationOption,
  ClarificationOutcome,
  ClarificationPayload,
  ConfigOption,
  ConfigSelectOption,
  DomainSessionEvent,
  McpServerConfig,
  PlanEntry,
  ToolCallDiff,
  ToolCallKind,
  ToolCallUpdate,
} from "../core/types.ts"
import { CLARIFICATION_LIMITS } from "../core/types.ts"

/**
 * Normalize the narrow ACP form subset Kitten can faithfully present in V1.
 *
 * The SDK validates the outer wire request before this function runs, but the
 * experimental schema intentionally accepts future/custom variants and salvages
 * some malformed optional fields. Revalidate the complete shape here so an
 * unsupported construct can never leak into the protocol-free domain model.
 */
export function translateElicitationForm(message: string, schema: unknown): ClarificationPayload | null {
  if (!isBoundedNonEmptyString(message) || !isRecord(schema)) return null

  const properties = schema.properties
  if (!isRecord(properties)) return null
  const propertyIds = Object.keys(properties)
  if (propertyIds.length === 0 || propertyIds.length > CLARIFICATION_LIMITS.maxFields) return null

  const required = normalizeRequired(schema.required, properties)
  if (required === null) return null

  const fields: ClarificationField[] = []
  for (const [id, property] of Object.entries(properties)) {
    if (!isBoundedNonEmptyString(id) || !isRecord(property)) return null
    const field = normalizeElicitationField(id, property, required.has(id))
    if (field === null) return null
    fields.push(field)
  }

  return { prompt: message, fields }
}

/**
 * Map one protocol-free terminal outcome back to ACP, validating all submitted
 * values first. Invalid values cancel the original request instead of returning
 * content that does not satisfy the form Kitten displayed.
 */
export function toAcpElicitationOutcome(
  payload: ClarificationPayload,
  outcome: ClarificationOutcome,
): CreateElicitationResponse {
  if (outcome.kind !== "submitted" || !isRecord(outcome.answers)) return { action: "cancel" }
  if (payload.title !== undefined || payload.context !== undefined) return { action: "cancel" }

  const fields = new Map(payload.fields.map((field) => [field.id, field]))
  if (fields.size !== payload.fields.length) return { action: "cancel" }
  for (const key of Object.keys(outcome.answers)) {
    if (!fields.has(key)) return { action: "cancel" }
  }

  const content: Record<string, string | string[]> = {}
  for (const field of payload.fields) {
    const present = Object.hasOwn(outcome.answers, field.id)
    if (!present) {
      if (field.required) return { action: "cancel" }
      continue
    }
    const value = toAcpClarificationValue(field, outcome.answers[field.id])
    if (value === null) return { action: "cancel" }
    content[field.id] = value
  }

  return { action: "accept", content }
}

function normalizeRequired(
  raw: unknown,
  properties: Record<string, unknown>,
): Set<string> | null {
  if (raw == null) return new Set()
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !Object.hasOwn(properties, id))) return null
  const required = new Set(raw)
  return required.size === raw.length ? required : null
}

function normalizeElicitationField(
  id: string,
  property: Record<string, unknown>,
  required: boolean,
): ClarificationField | null {
  const label = optionalString(property.title)
  const description = optionalString(property.description)
  if (label === null || description === null || !isBoundedOptionalString(label) || !isBoundedOptionalString(description)) {
    return null
  }
  const base = {
    id,
    label: label ?? id,
    ...(description === undefined ? {} : { description }),
    required,
  }

  if (property.type === "string") {
    if (hasNonNull(property, "minLength", "maxLength", "pattern", "format", "default")) return null
    const options = normalizeStringOptions(property)
    if (options === null) return null
    return options === undefined
      ? { ...base, mode: "text" }
      : { ...base, mode: "single", options, allowsCustom: false }
  }

  if (property.type === "array") {
    if (hasNonNull(property, "minItems", "maxItems", "default") || !isRecord(property.items)) return null
    const options = normalizeMultiOptions(property.items)
    return options === null ? null : { ...base, mode: "multi", options, allowsCustom: false }
  }

  return null
}

function normalizeStringOptions(property: Record<string, unknown>): ClarificationOption[] | undefined | null {
  const enumValues = property.enum
  const oneOf = property.oneOf
  const hasEnum = enumValues != null
  const hasOneOf = oneOf != null
  if (hasEnum && hasOneOf) return null
  if (!hasEnum && !hasOneOf) return undefined
  return hasEnum ? optionsFromEnum(enumValues) : optionsFromTitled(oneOf)
}

function normalizeMultiOptions(items: Record<string, unknown>): ClarificationOption[] | null {
  const enumValues = items.enum
  const anyOf = items.anyOf
  const hasEnum = enumValues != null
  const hasAnyOf = anyOf != null
  if (hasEnum === hasAnyOf) return null
  if (hasEnum && items.type !== "string") return null
  return hasEnum ? optionsFromEnum(enumValues) : optionsFromTitled(anyOf)
}

function optionsFromEnum(raw: unknown): ClarificationOption[] | null {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > CLARIFICATION_LIMITS.maxOptionsPerField ||
    raw.some((value) => !isBoundedNonEmptyString(value))
  ) {
    return null
  }
  const values = raw as string[]
  if (new Set(values).size !== values.length) return null
  return values.map((value) => ({ id: value, label: value }))
}

function optionsFromTitled(raw: unknown): ClarificationOption[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > CLARIFICATION_LIMITS.maxOptionsPerField) return null
  const options: ClarificationOption[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || !isBoundedNonEmptyString(entry.const)) return null
    if (!isBoundedNonEmptyString(entry.title)) return null
    const description = optionalString(entry.description)
    if (description === null || !isBoundedOptionalString(description)) return null
    options.push({
      id: entry.const,
      label: entry.title,
      ...(description === undefined ? {} : { description }),
    })
  }
  return new Set(options.map((option) => option.id)).size === options.length ? options : null
}

function toAcpClarificationValue(
  field: ClarificationField,
  answer: ClarificationAnswer | undefined,
): string | string[] | null {
  if (!isRecord(answer) || !Array.isArray(answer.selectedOptionIds)) return null
  if (Object.keys(answer).some((key) => key !== "selectedOptionIds" && key !== "customText")) return null
  if (answer.selectedOptionIds.some((id) => typeof id !== "string")) return null
  if (new Set(answer.selectedOptionIds).size !== answer.selectedOptionIds.length) return null
  const hasCustomText = Object.hasOwn(answer, "customText")
  if (hasCustomText && (typeof answer.customText !== "string" || answer.customText.length > CLARIFICATION_LIMITS.maxTextLength)) {
    return null
  }
  if (field.mode === "text") {
    if (answer.selectedOptionIds.length !== 0 || !hasCustomText) return null
    return field.required && answer.customText!.length === 0 ? null : answer.customText!
  }
  if (field.allowsCustom || hasCustomText) return null
  const optionIds = new Set(field.options.map((option) => option.id))
  if (answer.selectedOptionIds.some((id) => !optionIds.has(id))) return null
  if (field.mode === "single") {
    return answer.selectedOptionIds.length === 1 ? answer.selectedOptionIds[0]! : null
  }
  if (field.required && answer.selectedOptionIds.length === 0) return null
  return [...answer.selectedOptionIds]
}

function optionalString(value: unknown): string | undefined | null {
  return value == null ? undefined : typeof value === "string" ? value : null
}

function isBoundedNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= CLARIFICATION_LIMITS.maxTextLength
}

function isBoundedOptionalString(value: string | undefined): boolean {
  return value === undefined || value.length <= CLARIFICATION_LIMITS.maxTextLength
}

function hasNonNull(value: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => value[key] != null)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Map resolved domain MCP servers to the ACP stdio wire shape. */
export function toAcpMcpServers(servers: McpServerConfig[]): McpServer[] {
  return servers.map((server) => ({
    name: server.name,
    command: server.command,
    args: server.args,
    env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
  }))
}

/**
 * Translate one ACP `SessionUpdate` into a domain event, or `null` for variants
 * Kitten does not surface in V1 (thoughts, plan deltas, mode/session
 * notifications). Config and available-command updates are surfaced as their
 * protocol-free domain slices.
 * Returning `null` keeps the caller's dispatch loop trivial.
 */
export function translateSessionUpdate(update: SessionUpdate): DomainSessionEvent | null {
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const text = extractText(update.content)
      if (text === null) return null
      return { kind: "user_message", messageId: messageIdOf(update.messageId), text }
    }
    case "agent_message_chunk": {
      const text = extractText(update.content)
      if (text === null) return null
      return { kind: "agent_message", messageId: messageIdOf(update.messageId), textDelta: text }
    }
    case "tool_call":
    case "tool_call_update":
      return { kind: "tool_call", call: translateToolCall(update) }
    case "plan":
      return { kind: "plan", entries: update.entries.map(translatePlanEntry) }
    case "config_option_update":
      // The agent advertises the full option set; translate the select options
      // and drop booleans (V1 renders select categories only, ADR-003/ADR-004).
      return { kind: "config_options", options: translateConfigOptions(update.configOptions) }
    case "available_commands_update":
      return { kind: "commands", commands: update.availableCommands.map(translateCommand) }
    case "usage_update":
      return translateUsage(update)
    // Deliberately not surfaced in V1 (documented in the module header).
    case "agent_thought_chunk":
    case "plan_update":
    case "plan_removed":
    case "current_mode_update":
    case "session_info_update":
      return null
    default:
      // A new ACP update variant appeared; ignore it rather than leak it upward.
      return null
  }
}

/**
 * Translate an ACP `ToolCall` (new) or `ToolCallUpdate` (delta) into the domain
 * {@link ToolCallUpdate} partial the reducer upserts by `toolCallId`.
 *
 * Field semantics mirror the reducer's merge rules: an absent field is omitted so
 * the reducer preserves the prior value; a provided `content` array without a diff
 * block clears the stored diff via an explicit `null`.
 */
export function translateToolCall(tc: ToolCall | AcpToolCallUpdate): ToolCallUpdate {
  const call: ToolCallUpdate = { toolCallId: tc.toolCallId }
  if (tc.kind != null) call.kind = mapKind(tc.kind)
  if (tc.title != null) call.title = tc.title
  if (tc.status != null) call.status = tc.status
  if (tc.locations != null) call.locations = tc.locations.map((l) => l.path)
  if (tc.rawInput !== undefined) call.inputSummary = summarizeToolCallInput(tc.rawInput)
  const diff = translateDiff(tc.content)
  if (diff !== undefined) call.diff = diff
  return call
}

/** The longest input shape the transcript will show before collapsing the remaining fields. */
const TOOL_CALL_INPUT_FIELD_LIMIT = 4

/** Parameter identifiers that are safe to show without retaining caller-provided values. */
const SAFE_TOOL_CALL_INPUT_FIELD = /^[A-Za-z][A-Za-z0-9_]{0,31}$/

/**
 * Produce a compact, value-free description of ACP's opaque `rawInput`.
 *
 * ACP gives clients the full raw value, but retaining it in the transcript could
 * expose prompts, paths, or credentials. Keep only a bounded top-level object
 * shape so the UI can explain an MCP invocation without moving raw ACP data past
 * this adapter boundary.
 */
function summarizeToolCallInput(rawInput: unknown): string {
  if (Array.isArray(rawInput)) return `[${rawInput.length} item${rawInput.length === 1 ? "" : "s"}]`
  if (!isRecord(rawInput)) return `<${rawInput === null ? "null" : typeof rawInput}>`

  const fields = Object.keys(rawInput)
  if (fields.length === 0) return "{}"

  const visible = fields.slice(0, TOOL_CALL_INPUT_FIELD_LIMIT).map((field) =>
    SAFE_TOOL_CALL_INPUT_FIELD.test(field) ? field : "field",
  )
  if (fields.length > TOOL_CALL_INPUT_FIELD_LIMIT) visible.push("…")
  return `{ ${visible.join(", ")} }`
}

/** Map an ACP `ToolKind` onto the narrower domain {@link ToolCallKind}. */
function mapKind(kind: ToolKind): ToolCallKind {
  // ACP adds `switch_mode`, which has no domain analogue; everything else is 1:1.
  return kind === "switch_mode" ? "other" : kind
}

function translatePlanEntry(entry: AcpPlanEntry): PlanEntry {
  return { content: entry.content, priority: entry.priority, status: entry.status }
}

/** Copy only the content-free context counters; ACP cost and metadata stay at the boundary. */
function translateUsage(update: UsageUpdate): Extract<DomainSessionEvent, { kind: "usage" }> {
  return { kind: "usage", used: update.used, size: update.size }
}

/**
 * Translate an ACP `SessionConfigOption[]` into the domain {@link ConfigOption[]}.
 *
 * V1 models select options only (ADR-003): a boolean option (e.g. Fast mode) is
 * skipped, never crashed on. `category` is passed through verbatim and kept opaque
 * (an absent category becomes `""`); the visible-category allowlist lives above the
 * adapter (ADR-004), so no filtering happens here.
 */
export function translateConfigOptions(options: SessionConfigOption[]): ConfigOption[] {
  const translated: ConfigOption[] = []
  for (const option of options) {
    if (option.type !== "select") continue // skip boolean (and any future non-select) options
    translated.push({
      id: option.id,
      category: option.category ?? "",
      label: option.name,
      currentValue: option.currentValue,
      options: flattenSelectOptions(option.options),
    })
  }
  return translated
}

/**
 * Flatten ACP's extensible slash-command shape into the domain's small command
 * record. In particular, `_meta` never crosses the adapter boundary.
 */
export function translateCommand(command: AcpAvailableCommand): AvailableCommand {
  return {
    name: command.name,
    description: command.description,
    hint: command.input?.hint,
  }
}

/**
 * Flatten an ACP select's `options` into `{ value, name }` pairs. ACP allows either
 * a flat list of options or a list of named groups; V1 has no group UI, so grouped
 * options are flattened into a single list, preserving order.
 */
function flattenSelectOptions(options: SessionConfigSelectOption[] | SessionConfigSelectGroup[]): ConfigSelectOption[] {
  const flat: ConfigSelectOption[] = []
  for (const entry of options) {
    if ("value" in entry) {
      flat.push({ value: entry.value, name: entry.name })
    } else {
      for (const opt of entry.options) flat.push({ value: opt.value, name: opt.name })
    }
  }
  return flat
}

/**
 * Extract a domain diff from an ACP tool-call `content` collection.
 *
 * - `undefined` when `content` is absent: the update does not touch the diff.
 * - `null` when `content` is present but carries no diff block: clear the diff.
 * - a {@link ToolCallDiff} for the first diff block present.
 *
 * V1 collapses a multi-file edit to its first diff; the tool call's `locations`
 * still capture every touched path.
 */
function translateDiff(content: Array<ToolCallContent> | null | undefined): ToolCallDiff | null | undefined {
  if (content == null) return undefined
  const diff = content.find((c): c is Diff & { type: "diff" } => c.type === "diff")
  if (diff === undefined) return null
  return { path: diff.path, unified: toUnifiedDiff(diff.path, diff.oldText ?? null, diff.newText) }
}

/** Read the text out of a content block, or `null` for non-text content. */
function extractText(content: ContentBlock): string | null {
  return content.type === "text" ? content.text : null
}

/** ACP messages carry an optional `messageId`; fall back to a stable empty key. */
function messageIdOf(messageId: string | null | undefined): string {
  return messageId ?? ""
}

/**
 * Render a line-based unified diff from an ACP structured diff. ACP ships
 * `oldText`/`newText`, but the domain (and the hand-off bundle) store a single
 * `unified` string, so the adapter synthesizes one with a minimal LCS diff.
 */
export function toUnifiedDiff(path: string, oldText: string | null, newText: string): string {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const ops = diffLines(oldLines, newLines)

  const removed = ops.reduce((n, op) => (op.tag === "+" ? n : n + 1), 0)
  const added = ops.reduce((n, op) => (op.tag === "-" ? n : n + 1), 0)
  const oldStart = removed === 0 ? 0 : 1
  const newStart = added === 0 ? 0 : 1

  const header = [`--- a/${path}`, `+++ b/${path}`, `@@ -${oldStart},${removed} +${newStart},${added} @@`]
  const body = ops.map((op) => `${op.tag}${op.text}`)
  return [...header, ...body].join("\n")
}

/** `""` is zero lines; otherwise split on newlines (a trailing "\n" yields a final "" line). */
function splitLines(text: string | null): string[] {
  if (text === null || text === "") return []
  return text.split("\n")
}

interface DiffOp {
  tag: " " | "-" | "+"
  text: string
}

/**
 * Classify each line as context (` `), removal (`-`), or addition (`+`) using a
 * longest-common-subsequence backtrace, so unchanged lines are shared rather than
 * shown as a delete-then-add of the whole file.
 */
function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length
  const m = newLines.length
  const width = m + 1
  const lcs = new Int32Array((n + 1) * width)

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * width + j
      if (oldLines[i] === newLines[j]) {
        lcs[idx] = lcs[(i + 1) * width + (j + 1)]! + 1
      } else {
        lcs[idx] = Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + (j + 1)]!)
      }
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ tag: " ", text: oldLines[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * width + j]! >= lcs[i * width + (j + 1)]!) {
      ops.push({ tag: "-", text: oldLines[i]! })
      i++
    } else {
      ops.push({ tag: "+", text: newLines[j]! })
      j++
    }
  }
  while (i < n) ops.push({ tag: "-", text: oldLines[i++]! })
  while (j < m) ops.push({ tag: "+", text: newLines[j++]! })
  return ops
}
