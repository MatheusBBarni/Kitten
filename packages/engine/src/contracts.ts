/**
 * Small protocol-free contracts shared by Kitten applications.
 *
 * This module owns values at adapter boundaries, never application lifecycle,
 * persistence, rendering, worktrees, board state, or ACP wire translation.
 */

declare const opaqueId: unique symbol

type OpaqueId<Kind extends string> = string & { readonly [opaqueId]: Kind }

export type ProfileId = OpaqueId<"ProfileId">
export type AttemptId = OpaqueId<"AttemptId">
export type ActivityEventId = OpaqueId<"ActivityEventId">
export type QuestionId = OpaqueId<"QuestionId">

declare const generationBrand: unique symbol
declare const sequenceBrand: unique symbol

export type AttemptGeneration = number & { readonly [generationBrand]: "AttemptGeneration" }
export type ActivitySequence = number & { readonly [sequenceBrand]: "ActivitySequence" }

/** Brand a non-empty application-owned identifier without assigning lifecycle ownership. */
export function toOpaqueId<Id extends ProfileId | AttemptId | ActivityEventId | QuestionId>(value: string): Id | null {
  return value.length > 0 ? value as Id : null
}

/** Accept only finite, non-negative integer attempt generations. */
export function toAttemptGeneration(value: number): AttemptGeneration | null {
  return Number.isSafeInteger(value) && value >= 0 ? value as AttemptGeneration : null
}

/** Accept only finite, non-negative integer activity sequence numbers. */
export function toActivitySequence(value: number): ActivitySequence | null {
  return Number.isSafeInteger(value) && value >= 0 ? value as ActivitySequence : null
}

/** A protocol-free result from a Direct ACP adapter handshake. */
export type DirectAcpReadyState =
  | { readonly ready: true; readonly protocolVersion: number; readonly canLoadSession: boolean }
  | { readonly ready: false; readonly reason?: "authentication_required"; readonly error: string }

/** A certified profile's application-neutral readiness taxonomy. */
export type ProfileNotReadyReason =
  | "binary_not_found"
  | "handshake_failed"
  | "handshake_timeout"
  | "capability_mismatch"
  | "uncertified_recipe"
  | "version_mismatch"
  | "authentication_required"

export type ProfileReadiness =
  | { readonly ready: true; readonly protocolVersion: number }
  | {
      readonly ready: false
      readonly reason: ProfileNotReadyReason
      readonly message: string
    }

export type CertifiedProfileReadiness = ProfileReadiness & { readonly profileId: ProfileId }

export function profileReadinessClass(readiness: ProfileReadiness): "ready" | "not_ready" {
  return readiness.ready ? "ready" : "not_ready"
}

/** Why a Direct ACP prompt turn stopped, normalized before leaving an adapter. */
export type DirectAcpStopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"

export interface DirectAcpPromptResult {
  readonly stopReason: DirectAcpStopReason
}

/** Attempt lifecycle only; applications retain all transition and side-effect ownership. */
export type DirectAcpAttemptState =
  | "created"
  | "starting"
  | "running"
  | "needs_attention"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"

export type DirectAcpTerminalState = Extract<
  DirectAcpAttemptState,
  "succeeded" | "failed" | "cancelled" | "interrupted"
>

export function isDirectAcpTerminalState(state: DirectAcpAttemptState): state is DirectAcpTerminalState {
  return state === "succeeded" || state === "failed" || state === "cancelled" || state === "interrupted"
}

export type NormalizedToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "other"

export type NormalizedToolStatus = "pending" | "in_progress" | "completed" | "failed"
export type NormalizedToolFailure = "temporary_capacity" | "unavailable"

export interface NormalizedToolDiff {
  readonly path: string
  readonly unified: string
}

export interface NormalizedToolUpdate {
  readonly toolCallId: string
  readonly kind?: NormalizedToolKind
  readonly title?: string
  readonly status?: NormalizedToolStatus
  readonly locations?: readonly string[]
  readonly inputSummary?: string
  readonly failureKind?: NormalizedToolFailure | null
  readonly diff?: NormalizedToolDiff | null
}

export interface NormalizedPlanEntry {
  readonly content: string
  readonly priority?: "low" | "medium" | "high"
  readonly status?: "pending" | "in_progress" | "completed"
}

/** Adapter-normalized attempt activity. No ACP discriminant or wire object appears here. */
export type NormalizedAttemptActivity =
  | { readonly kind: "agent_message"; readonly messageId: string; readonly textDelta: string }
  | { readonly kind: "user_message"; readonly messageId: string; readonly text: string }
  | { readonly kind: "tool_call"; readonly call: NormalizedToolUpdate }
  | { readonly kind: "plan"; readonly entries: readonly NormalizedPlanEntry[] }
  | { readonly kind: "usage"; readonly used: number; readonly size: number }
  | { readonly kind: "attempt_state"; readonly state: DirectAcpAttemptState }

/** Ordering metadata survives adapter normalization as part of the event contract. */
export interface NormalizedAttemptEvent {
  readonly eventId: ActivityEventId
  readonly attemptId: AttemptId
  readonly generation: AttemptGeneration
  readonly sequence: ActivitySequence
  readonly occurredAt: number
  readonly activity: NormalizedAttemptActivity
}

export class NormalizedActivityValidationError extends Error {
  constructor(message: string) {
    super(`Invalid normalized attempt activity: ${message}`)
    this.name = "NormalizedActivityValidationError"
  }
}

function activityRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new NormalizedActivityValidationError(`${label} must be a plain object`)
  }
  return value as Record<string, unknown>
}

function activityKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new NormalizedActivityValidationError(`${key} is required`)
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new NormalizedActivityValidationError(`${key} is unsupported`)
  }
}

function activityString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new NormalizedActivityValidationError(`${label} is invalid`)
  }
  return value
}

function activityInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new NormalizedActivityValidationError(`${label} is invalid`)
  }
  return value as number
}

function optionalActivityString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : activityString(value, label)
}

const TOOL_KINDS: readonly NormalizedToolKind[] = [
  "read", "edit", "delete", "move", "search", "execute", "think", "fetch", "other",
]
const TOOL_STATUSES: readonly NormalizedToolStatus[] = ["pending", "in_progress", "completed", "failed"]
const ATTEMPT_STATES: readonly DirectAcpAttemptState[] = [
  "created", "starting", "running", "needs_attention", "succeeded", "failed", "cancelled", "interrupted",
]

/** Runtime validation for the protocol-free adapter boundary. Unknown fields fail closed. */
export function validateNormalizedAttemptEvent(input: unknown): NormalizedAttemptEvent {
  const event = activityRecord(input, "event")
  activityKeys(event, ["eventId", "attemptId", "generation", "sequence", "occurredAt", "activity"])
  const eventId = toOpaqueId<ActivityEventId>(activityString(event.eventId, "eventId"))
  const attemptId = toOpaqueId<AttemptId>(activityString(event.attemptId, "attemptId"))
  const generation = toAttemptGeneration(activityInteger(event.generation, "generation"))
  const sequence = toActivitySequence(activityInteger(event.sequence, "sequence"))
  if (eventId === null || attemptId === null || generation === null || sequence === null) {
    throw new NormalizedActivityValidationError("event identity is invalid")
  }
  return {
    eventId,
    attemptId,
    generation,
    sequence,
    occurredAt: activityInteger(event.occurredAt, "occurredAt"),
    activity: validateNormalizedAttemptActivity(event.activity),
  }
}

export function validateNormalizedAttemptActivity(input: unknown): NormalizedAttemptActivity {
  const activity = activityRecord(input, "activity")
  const kind = activityString(activity.kind, "activity.kind")
  switch (kind) {
    case "agent_message":
      activityKeys(activity, ["kind", "messageId", "textDelta"])
      return {
        kind,
        messageId: activityString(activity.messageId, "activity.messageId"),
        textDelta: activityString(activity.textDelta, "activity.textDelta"),
      }
    case "user_message":
      activityKeys(activity, ["kind", "messageId", "text"])
      return {
        kind,
        messageId: activityString(activity.messageId, "activity.messageId"),
        text: activityString(activity.text, "activity.text"),
      }
    case "tool_call": {
      activityKeys(activity, ["kind", "call"])
      const call = activityRecord(activity.call, "activity.call")
      activityKeys(call, ["toolCallId"], ["kind", "title", "status", "locations", "inputSummary", "failureKind", "diff"])
      const toolKind = optionalActivityString(call.kind, "activity.call.kind")
      if (toolKind !== undefined && !TOOL_KINDS.includes(toolKind as NormalizedToolKind)) {
        throw new NormalizedActivityValidationError("activity.call.kind is unsupported")
      }
      const status = optionalActivityString(call.status, "activity.call.status")
      if (status !== undefined && !TOOL_STATUSES.includes(status as NormalizedToolStatus)) {
        throw new NormalizedActivityValidationError("activity.call.status is unsupported")
      }
      let locations: readonly string[] | undefined
      if (call.locations !== undefined) {
        if (!Array.isArray(call.locations)) throw new NormalizedActivityValidationError("activity.call.locations must be an array")
        locations = call.locations.map((value) => activityString(value, "activity.call.locations[]"))
      }
      let failureKind: NormalizedToolFailure | null | undefined
      if (call.failureKind !== undefined) {
        if (call.failureKind !== null && call.failureKind !== "temporary_capacity" && call.failureKind !== "unavailable") {
          throw new NormalizedActivityValidationError("activity.call.failureKind is unsupported")
        }
        failureKind = call.failureKind
      }
      let diff: NormalizedToolDiff | null | undefined
      if (call.diff !== undefined) {
        if (call.diff === null) {
          diff = null
        } else {
          const value = activityRecord(call.diff, "activity.call.diff")
          activityKeys(value, ["path", "unified"])
          diff = {
            path: activityString(value.path, "activity.call.diff.path"),
            unified: activityString(value.unified, "activity.call.diff.unified", true),
          }
        }
      }
      return {
        kind,
        call: {
          toolCallId: activityString(call.toolCallId, "activity.call.toolCallId"),
          ...(toolKind === undefined ? {} : { kind: toolKind as NormalizedToolKind }),
          ...(call.title === undefined ? {} : { title: activityString(call.title, "activity.call.title") }),
          ...(status === undefined ? {} : { status: status as NormalizedToolStatus }),
          ...(locations === undefined ? {} : { locations }),
          ...(call.inputSummary === undefined ? {} : { inputSummary: activityString(call.inputSummary, "activity.call.inputSummary", true) }),
          ...(failureKind === undefined ? {} : { failureKind }),
          ...(diff === undefined ? {} : { diff }),
        },
      }
    }
    case "plan": {
      activityKeys(activity, ["kind", "entries"])
      if (!Array.isArray(activity.entries)) throw new NormalizedActivityValidationError("activity.entries must be an array")
      return {
        kind,
        entries: activity.entries.map((entry) => {
          const value = activityRecord(entry, "activity.entries[]")
          activityKeys(value, ["content"], ["priority", "status"])
          const priority = optionalActivityString(value.priority, "activity.entries[].priority")
          if (priority !== undefined && priority !== "low" && priority !== "medium" && priority !== "high") {
            throw new NormalizedActivityValidationError("activity.entries[].priority is unsupported")
          }
          const status = optionalActivityString(value.status, "activity.entries[].status")
          if (status !== undefined && status !== "pending" && status !== "in_progress" && status !== "completed") {
            throw new NormalizedActivityValidationError("activity.entries[].status is unsupported")
          }
          return {
            content: activityString(value.content, "activity.entries[].content"),
            ...(priority === undefined ? {} : { priority: priority as NormalizedPlanEntry["priority"] }),
            ...(status === undefined ? {} : { status: status as NormalizedPlanEntry["status"] }),
          }
        }),
      }
    }
    case "usage": {
      activityKeys(activity, ["kind", "used", "size"])
      const used = activityInteger(activity.used, "activity.used")
      const size = activityInteger(activity.size, "activity.size")
      if (used > size) throw new NormalizedActivityValidationError("activity.used exceeds activity.size")
      return { kind, used, size }
    }
    case "attempt_state": {
      activityKeys(activity, ["kind", "state"])
      const state = activityString(activity.state, "activity.state") as DirectAcpAttemptState
      if (!ATTEMPT_STATES.includes(state)) throw new NormalizedActivityValidationError("activity.state is unsupported")
      return { kind, state }
    }
    default:
      throw new NormalizedActivityValidationError("activity.kind is unsupported")
  }
}

export interface ActivityOrderCursor {
  readonly attemptId: AttemptId
  readonly generation: AttemptGeneration
  readonly nextSequence: ActivitySequence
}

export type ActivityOrderDecision =
  | { readonly accepted: true }
  | {
      readonly accepted: false
      readonly reason: "unknown_attempt" | "stale_generation" | "non_monotonic" | "sequence_gap"
    }

/** Pure ordering fence; journal/projection mutation stays with the consuming application. */
export function classifyActivityOrder(
  cursor: ActivityOrderCursor,
  event: NormalizedAttemptEvent,
): ActivityOrderDecision {
  if (event.attemptId !== cursor.attemptId) return { accepted: false, reason: "unknown_attempt" }
  if (event.generation !== cursor.generation) return { accepted: false, reason: "stale_generation" }
  if (event.sequence < cursor.nextSequence) return { accepted: false, reason: "non_monotonic" }
  if (event.sequence > cursor.nextSequence) return { accepted: false, reason: "sequence_gap" }
  return { accepted: true }
}

export type TerminalQuestionOutcome<Answers = unknown> =
  | { readonly kind: "submitted"; readonly answers: Answers }
  | { readonly kind: "skipped" }
  | { readonly kind: "timed_out" }
  | { readonly kind: "cancelled" }

export type QuestionOutcome<Answers = unknown> = { readonly kind: "pending" } | TerminalQuestionOutcome<Answers>

export interface ScopedQuestionOutcome<Answers = unknown> {
  readonly attemptId: AttemptId
  readonly questionId: QuestionId
  readonly generation: AttemptGeneration
  readonly outcome: QuestionOutcome<Answers>
}

export type QuestionOutcomeDecision<Answers = unknown> =
  | { readonly accepted: true; readonly outcome: TerminalQuestionOutcome<Answers> }
  | { readonly accepted: false; readonly reason: "stale_generation" | "non_terminal" }

export function isTerminalQuestionOutcome<Answers>(
  outcome: QuestionOutcome<Answers>,
): outcome is TerminalQuestionOutcome<Answers> {
  return outcome.kind === "submitted" ||
    outcome.kind === "skipped" ||
    outcome.kind === "timed_out" ||
    outcome.kind === "cancelled"
}

/** Reject stale routes and active/non-terminal values before an application resumes an attempt. */
export function classifyScopedQuestionOutcome<Answers>(
  currentGeneration: AttemptGeneration,
  scoped: ScopedQuestionOutcome<Answers>,
): QuestionOutcomeDecision<Answers> {
  if (scoped.generation !== currentGeneration) return { accepted: false, reason: "stale_generation" }
  if (!isTerminalQuestionOutcome(scoped.outcome)) return { accepted: false, reason: "non_terminal" }
  return { accepted: true, outcome: scoped.outcome }
}
