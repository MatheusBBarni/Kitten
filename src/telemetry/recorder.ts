/**
 * The telemetry recorder: opt-in, content-free, local JSONL only.
 *
 * This is the honest instrumentation behind the PRD kill-or-scale gate (ADR-002). It
 * records the metric events from the TechSpec "Monitoring and Observability" section
 * and nothing else, under three hard constraints the PRD's privacy stance demands:
 *
 * - **Opt-in.** With telemetry disabled the recorder is a no-op that never even
 *   constructs a sink, so a run records nothing and touches no file. The gate is
 *   {@link createTelemetryRecorder}'s `enabled` flag, sourced from `AppConfig`.
 * - **Content-free.** A {@link TelemetryRecord} carries only an event type, a
 *   timestamp, an anonymous session reference, an agent id, and coarse numbers
 *   (buckets, durations). There is no text field, so no prompt or code can be stored
 *   even by accident - the guarantee is structural, not a matter of discipline.
 * - **Local only.** The default sink appends JSONL to a file on disk with the Node
 *   fs API. There is no network path anywhere in this module.
 *
 * First-response timing and the re-explanation heuristic are derived by
 * {@link TelemetryRecorder.watch}, which subscribes to store transitions (task_05)
 * and diffs the per-agent turn stream; the hand-off events come from the hand-off
 * flow (task_12) calling this recorder directly. The heuristic itself is the pure
 * core predicate (`../core/telemetryHeuristics.ts`); this module only feeds it and
 * records its verdict.
 */

import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

import type { SessionId } from "../core/types.ts"
import { bucketChars, detectReexplanation, REEXPLANATION_CHAR_THRESHOLD } from "../core/telemetryHeuristics.ts"
import type { AppStore, Unsubscribe } from "../store/appStore.ts"

/** Every telemetry event Kitten records. Names match the TechSpec metric set. */
export type TelemetryEventType =
  | "handoff_invoked"
  | "handoff_sent"
  | "handoff_repeat"
  | "reexplanation_detected"
  | "bundle_edit_chars"
  | "agent_ready"
  | "agent_unready"
  | "first_response_ms"

/**
 * One recorded event. Deliberately holds no text: an anonymous `sessionRef`, an
 * optional agent id (a fixed enum, not user content), and coarse numbers only. This
 * is what makes the recorder content-free by construction rather than by review.
 */
export interface TelemetryRecord {
  type: TelemetryEventType
  /** Epoch milliseconds the event was recorded, from the injected clock. */
  at: number
  /** An anonymous reference to this app run - never an ACP session id or path. */
  sessionRef: string
  /** Which session the event concerns, when relevant. A Kitten session id, not user content. */
  agent?: SessionId
  /** A coarse character bucket (see `bucketChars`), never an exact count. */
  charBucket?: number
  /** A measured duration in milliseconds, for `first_response_ms`. */
  durationMs?: number
}

/** Where recorded events go. The default is a local JSONL file; tests inject memory. */
export interface TelemetrySink {
  write(record: TelemetryRecord): void
}

/** What the hand-off flow reports when it sends a curated bundle to the target. */
export interface HandoffSentInput {
  /** The session that received the bundle - the one to watch for re-explanation. */
  targetSessionId: SessionId
  /** How many characters the developer changed in the summary (see `editedCharCount`). */
  editChars: number
}

/** The recorder surface its callers drive. Every method is a no-op when disabled. */
export interface TelemetryRecorder {
  /** Whether telemetry is on. `false` means every method here does nothing. */
  readonly enabled: boolean
  /** A hand-off preview was opened over a source session. */
  handoffInvoked(): void
  /** A curated bundle was sent to the target; also records edit volume and repeats. */
  handoffSent(input: HandoffSentInput): void
  /** A session completed its handshake and holds a live ACP session. */
  agentReady(sessionId: SessionId): void
  /** A session failed to come up. */
  agentUnready(sessionId: SessionId): void
  /**
   * Subscribe to store transitions to derive `first_response_ms` and
   * `reexplanation_detected`. Returns an unsubscribe; a no-op when disabled.
   */
  watch(store: AppStore): Unsubscribe
}

/** Construction seams. Only `enabled` is required; the rest have real defaults. */
export interface TelemetryRecorderOptions {
  /** The opt-in gate, sourced from `AppConfig.telemetryEnabled`. */
  enabled: boolean
  /** Where events go. Defaults to a JSONL file sink at {@link resolveTelemetryPath}. */
  sink?: TelemetrySink
  /** The clock for `at`/durations. Defaults to `Date.now`. */
  now?: () => number
  /** The anonymous run reference. Defaults to a fresh random id. */
  sessionRef?: string
  /** Re-explanation length threshold. Defaults to the core heuristic's value. */
  reexplanationThreshold?: number
}

/** The single disabled instance: records nothing, opens no file, watches nothing. */
const NOOP_RECORDER: TelemetryRecorder = {
  enabled: false,
  handoffInvoked() {},
  handoffSent() {},
  agentReady() {},
  agentUnready() {},
  watch() {
    return () => {}
  },
}

/**
 * Build a telemetry recorder.
 *
 * Returns the shared no-op recorder when `enabled` is false - so a disabled run never
 * constructs a sink and never writes a byte - and a live recorder otherwise.
 */
export function createTelemetryRecorder(options: TelemetryRecorderOptions): TelemetryRecorder {
  if (!options.enabled) return NOOP_RECORDER
  return new ActiveRecorder(options)
}

/** Per-session bookkeeping for the store-derived metrics. */
interface AgentWatch {
  /** How many turns of this session's transcript `watch` has already processed. */
  seenTurns: number
  /** When the pending prompt was sent, or `null` when no first response is awaited. */
  awaitingResponseAt: number | null
  /** True while the next developer message could count as re-explanation. */
  reexplanationArmed: boolean
}

class ActiveRecorder implements TelemetryRecorder {
  readonly enabled = true
  private readonly sink: TelemetrySink
  private readonly now: () => number
  private readonly sessionRef: string
  private readonly threshold: number
  private handoffCount = 0
  private readonly watches = new Map<SessionId, AgentWatch>()

  constructor(options: TelemetryRecorderOptions) {
    this.sink = options.sink ?? createJsonlFileSink(resolveTelemetryPath())
    this.now = options.now ?? (() => Date.now())
    this.sessionRef = options.sessionRef ?? crypto.randomUUID()
    this.threshold = options.reexplanationThreshold ?? REEXPLANATION_CHAR_THRESHOLD
  }

  handoffInvoked(): void {
    this.record({ type: "handoff_invoked" })
  }

  handoffSent(input: HandoffSentInput): void {
    this.handoffCount += 1
    this.record({ type: "handoff_sent", agent: input.targetSessionId })
    // A repeat hand-off in one run is a distinct signal for the 7-day-repeat metric.
    if (this.handoffCount > 1) this.record({ type: "handoff_repeat", agent: input.targetSessionId })
    this.record({ type: "bundle_edit_chars", agent: input.targetSessionId, charBucket: bucketChars(input.editChars) })
    // Arm re-explanation detection on the target. This runs after the flow's own
    // `sendPrompt`, so the bundle's user turn is already consumed and only a
    // subsequent developer message can trip the heuristic.
    this.watchFor(input.targetSessionId).reexplanationArmed = true
  }

  agentReady(sessionId: SessionId): void {
    this.record({ type: "agent_ready", agent: sessionId })
  }

  agentUnready(sessionId: SessionId): void {
    this.record({ type: "agent_unready", agent: sessionId })
  }

  watch(store: AppStore): Unsubscribe {
    // Prime the seen-turn counts so pre-existing transcript is not replayed as new.
    const initial = store.getState()
    for (const sessionId of initial.order) {
      this.watchFor(sessionId).seenTurns = initial.sessions[sessionId]!.turns.length
    }
    return store.subscribe((state) => {
      for (const sessionId of state.order) this.processSession(sessionId, state.sessions[sessionId]!.turns)
    })
  }

  /** Apply the turns newly appended to one session's transcript since the last pass. */
  private processSession(sessionId: SessionId, turns: readonly { kind: string; text?: string }[]): void {
    const watch = this.watchFor(sessionId)
    // A new session resets the transcript; drop stale timers/arming and resync.
    if (turns.length < watch.seenTurns) {
      watch.seenTurns = turns.length
      watch.awaitingResponseAt = null
      watch.reexplanationArmed = false
      return
    }
    for (let i = watch.seenTurns; i < turns.length; i++) this.handleTurn(sessionId, watch, turns[i]!)
    watch.seenTurns = turns.length
  }

  private handleTurn(sessionId: SessionId, watch: AgentWatch, turn: { kind: string; text?: string }): void {
    if (turn.kind === "user") {
      // A prompt was sent: start the first-response clock for this session.
      watch.awaitingResponseAt = this.now()
      if (watch.reexplanationArmed) {
        // The developer's first message after the hand-off decides re-explanation.
        watch.reexplanationArmed = false
        const result = detectReexplanation([{ kind: "developer_message", charCount: turn.text?.length ?? 0 }], this.threshold)
        if (result.detected) this.record({ type: "reexplanation_detected", agent: sessionId, charBucket: result.charBucket })
      }
      return
    }
    // An agent message or tool call is the first response; a tool call also ends the
    // re-explanation window (the target started acting on the bundle).
    if (watch.awaitingResponseAt !== null) {
      this.record({ type: "first_response_ms", agent: sessionId, durationMs: this.now() - watch.awaitingResponseAt })
      watch.awaitingResponseAt = null
    }
    if (turn.kind === "tool_call") watch.reexplanationArmed = false
  }

  private watchFor(sessionId: SessionId): AgentWatch {
    let watch = this.watches.get(sessionId)
    if (!watch) {
      watch = { seenTurns: 0, awaitingResponseAt: null, reexplanationArmed: false }
      this.watches.set(sessionId, watch)
    }
    return watch
  }

  /** Stamp and write one event. The one place `at`/`sessionRef` are attached. */
  private record(event: Omit<TelemetryRecord, "at" | "sessionRef">): void {
    this.sink.write({ ...event, at: this.now(), sessionRef: this.sessionRef })
  }
}

/**
 * Record each agent's readiness once at startup. The other event source
 * ({@link TelemetryRecorder.agentReady}) exists for later transitions; this covers
 * the boot snapshot from the controller's runtimes.
 */
export function recordReadiness(
  recorder: TelemetryRecorder,
  runtimes: readonly { sessionId: SessionId; ready: boolean }[],
): void {
  for (const runtime of runtimes) {
    if (runtime.ready) recorder.agentReady(runtime.sessionId)
    else recorder.agentUnready(runtime.sessionId)
  }
}

/** The environment variable that overrides the telemetry file location outright. */
export const TELEMETRY_PATH_ENV_VAR = "KITTEN_TELEMETRY_PATH"

/**
 * Where the JSONL log lives: an explicit `KITTEN_TELEMETRY_PATH` wins, else the XDG
 * state directory, else `~/.local/state/kitten/telemetry.jsonl`. State, not config:
 * this is generated data, kept out of the user's hand-edited config tree.
 */
export function resolveTelemetryPath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env[TELEMETRY_PATH_ENV_VAR]
  if (explicit) return explicit
  const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateHome, "kitten", "telemetry.jsonl")
}

/**
 * A sink that appends one JSON object per line to a local file. Creates the parent
 * directory once, when the sink is built, rather than on every append. Synchronous:
 * telemetry events are infrequent, and a blocking append is simpler and safer than
 * juggling an async write queue on exit.
 */
export function createJsonlFileSink(path: string): TelemetrySink {
  mkdirSync(dirname(path), { recursive: true })
  return {
    write(record: TelemetryRecord): void {
      appendFileSync(path, `${JSON.stringify(record)}\n`)
    },
  }
}
