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
