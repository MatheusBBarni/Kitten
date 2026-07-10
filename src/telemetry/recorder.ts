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
 * First-response timing, the re-explanation heuristic, and the attention metrics
 * (attention latency and idle-fleet, task_09) are derived by
 * {@link TelemetryRecorder.watch}, which subscribes to store transitions and diffs the
 * per-agent turn stream and status/focus edges; the hand-off events, the focus-switch
 * counters, and the max-concurrent snapshot come from callers driving this recorder
 * directly. The re-explanation heuristic itself is the pure core predicate
 * (`../core/telemetryHeuristics.ts`); this module only feeds it and records its verdict.
 */

import { appendFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

import { EFFORT_CATEGORY, needsAttention, type ConfigOption, type SessionId, type SessionStatus } from "../core/types.ts"
import {
  bucketChars,
  detectReexplanation,
  effortChangeKept,
  REEXPLANATION_CHAR_THRESHOLD,
  type EffortRetentionEvent,
} from "../core/telemetryHeuristics.ts"
import type { AppStore, Unsubscribe } from "../store/appStore.ts"

/** Every telemetry event Kitten records. Names match the TechSpec metric set. */
export type TelemetryEventType =
  | "handoff_invoked"
  | "handoff_sent"
  | "handoff_repeat"
  | "effort_linked_handoff"
  | "reexplanation_detected"
  | "bundle_edit_chars"
  | "model_switched"
  | "effort_switched"
  | "switch_confirmed"
  | "switch_unverified"
  | "effort_change_kept"
  | "agent_ready"
  | "agent_unready"
  | "first_response_ms"
  // The multi-session attention metrics (task_09). Each measures whether the fleet
  // stays productive; all are content-free (durations, counts, and session ids only).
  | "attention_latency_ms"
  | "idle_fleet_ms"
  | "focus_switch"
  | "overview_switch"
  | "max_concurrent_sessions"

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
  /** A count of sessions, for `max_concurrent_sessions`. A small integer, never content. */
  count?: number
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
  /** A hand-off carried one or more target model/effort changes. */
  effortLinkedHandoff(sessionId: SessionId): void
  /**
   * Record a model or effort switch from the adapter-reported outcome. `effortChanged`
   * arms the content-free kept-change watch only for a confirmed value change.
   */
  recordSwitch(sessionId: SessionId, kind: "model" | "effort", confirmed: boolean, effortChanged: boolean): void
  /** A session completed its handshake and holds a live ACP session. */
  agentReady(sessionId: SessionId): void
  /** A session failed to come up. */
  agentUnready(sessionId: SessionId): void
  /**
   * A developer moved keyboard focus to `sessionId`. `viaOverview` marks a switch made
   * through the Ctrl+S overview (jump-into or jump-to-next) rather than a blind Ctrl+O
   * cycle - the numerator and denominator behind the overview-reliance metric (task_09).
   */
  focusSwitch(sessionId: SessionId, viaOverview: boolean): void
  /**
   * The peak number of concurrently-live sessions in this run - the multi-session
   * adoption signal (task_09). Recorded once from the boot readiness snapshot.
   */
  maxConcurrentSessions(count: number): void
  /**
   * Subscribe to store transitions to derive `first_response_ms`,
   * `reexplanation_detected`, `attention_latency_ms`, and `idle_fleet_ms`. Returns an
   * unsubscribe; a no-op when disabled.
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
  effortLinkedHandoff() {},
  recordSwitch() {},
  agentReady() {},
  agentUnready() {},
  focusSwitch() {},
  maxConcurrentSessions() {},
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
  /**
   * The ACP session id last seen for this session. A change means the slice was reset
   * (a restart/reconnect), which resets every derived timer - a restart is not the
   * developer acting, so it must not emit a latency or count as a first response.
   */
  seenAcpSessionId: string
  /** How many turns of this session's transcript `watch` has already processed. */
  seenTurns: number
  /** Last observed confirmed effort value; transient only, never written to telemetry. */
  seenEffortValue: string | undefined
  /** A pending confirmed effort change, reduced to content-free event kinds. */
  effortRetention: EffortRetentionEvent[] | null
  /** When the pending prompt was sent, or `null` when no first response is awaited. */
  awaitingResponseAt: number | null
  /** True while the next developer message could count as re-explanation. */
  reexplanationArmed: boolean
  /**
   * When this session entered its current needs-you state, or `null` when it does not
   * need the developer. Attention latency is the gap from here to the state resolving.
   */
  neededSince: number | null
  /**
   * When this session started needing the developer while unfocused, or `null` when it
   * is not both needy and unfocused. Idle-fleet time accrues over this window.
   */
  idleFleetSince: number | null
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

  effortLinkedHandoff(sessionId: SessionId): void {
    this.record({ type: "effort_linked_handoff", agent: sessionId })
  }

  recordSwitch(sessionId: SessionId, kind: "model" | "effort", confirmed: boolean, effortChanged: boolean): void {
    this.record({ type: kind === "model" ? "model_switched" : "effort_switched", agent: sessionId })
    this.record({ type: confirmed ? "switch_confirmed" : "switch_unverified", agent: sessionId })
    // Only a confirmed, actual effort change can contribute to the kept-change metric.
    // The transient stream carries event kinds only, never the option's value.
    if (kind === "effort" && confirmed && effortChanged) {
      this.watchFor(sessionId).effortRetention = [{ kind: "effort_change" }]
    }
  }

  agentReady(sessionId: SessionId): void {
    this.record({ type: "agent_ready", agent: sessionId })
  }

  agentUnready(sessionId: SessionId): void {
    this.record({ type: "agent_unready", agent: sessionId })
  }

  focusSwitch(sessionId: SessionId, viaOverview: boolean): void {
    // Every switch is the overview-reliance denominator; the ones made through the
    // overview are also the numerator, so their share measures how much the developer
    // leans on the overview instead of blind-cycling with Ctrl+O.
    this.record({ type: "focus_switch", agent: sessionId })
    if (viaOverview) this.record({ type: "overview_switch", agent: sessionId })
  }

  maxConcurrentSessions(count: number): void {
    this.record({ type: "max_concurrent_sessions", count })
  }

  watch(store: AppStore): Unsubscribe {
    // Prime the per-session state so pre-existing transcript is not replayed as new and
    // a session already needing the developer at subscribe time is still measured.
    const initial = store.getState()
    for (const sessionId of initial.order) {
      const session = initial.sessions[sessionId]!
      const watch = this.watchFor(sessionId)
      watch.seenAcpSessionId = session.acpSessionId
      watch.seenTurns = session.turns.length
      watch.seenEffortValue = effortValue(session.configOptions)
      const needy = needsAttention(session.status)
      watch.neededSince = needy ? this.now() : null
      watch.idleFleetSince = needy && initial.focusedSessionId !== sessionId ? this.now() : null
    }
    return store.subscribe((state) => {
      for (const sessionId of state.order) {
        const session = state.sessions[sessionId]!
        const watch = this.watchFor(sessionId)
        // A rebound ACP session id means the slice was reset. Drop every stale timer and
        // arming silently and skip this commit: a restart is not the developer acting.
        if (session.acpSessionId !== watch.seenAcpSessionId) {
          watch.seenAcpSessionId = session.acpSessionId
          watch.seenTurns = session.turns.length
          watch.seenEffortValue = effortValue(session.configOptions)
          watch.awaitingResponseAt = null
          watch.reexplanationArmed = false
          watch.effortRetention = null
          watch.neededSince = null
          watch.idleFleetSince = null
          continue
        }
        this.processEffortChange(sessionId, session.configOptions)
        this.processSession(sessionId, session.turns)
        this.processAttention(sessionId, session.status, state.focusedSessionId === sessionId)
      }
    })
  }

  /** Apply the turns newly appended to one session's transcript since the last pass. */
  private processSession(sessionId: SessionId, turns: readonly { kind: string; text?: string }[]): void {
    const watch = this.watchFor(sessionId)
    // A new session resets the transcript; drop stale timers/arming and resync. The
    // attention timers reset silently too: a restart is not the developer answering.
    if (turns.length < watch.seenTurns) {
      watch.seenTurns = turns.length
      watch.awaitingResponseAt = null
      watch.reexplanationArmed = false
      watch.effortRetention = null
      watch.neededSince = null
      watch.idleFleetSince = null
      return
    }
    for (let i = watch.seenTurns; i < turns.length; i++) this.handleTurn(sessionId, watch, turns[i]!)
    watch.seenTurns = turns.length
  }

  /**
   * Fold one session's current attention state into two durations (ADR-006):
   *
   * - **Attention latency** runs from the rising edge into a needs-you state to the
   *   falling edge out of it - the state resolves only when the developer acts, so the
   *   gap is how long they took to respond after the session started needing them.
   * - **Idle-fleet** runs only while the session is both needy and unfocused - the
   *   waiting time a session spends wanting the developer who is busy elsewhere.
   *
   * Both are emitted on the falling edge, carrying a duration and the session id only.
   */
  private processAttention(sessionId: SessionId, status: SessionStatus, isFocused: boolean): void {
    const watch = this.watchFor(sessionId)
    const needy = needsAttention(status)

    if (needy && watch.neededSince === null) watch.neededSince = this.now()
    else if (!needy && watch.neededSince !== null) {
      this.record({ type: "attention_latency_ms", agent: sessionId, durationMs: this.now() - watch.neededSince })
      watch.neededSince = null
    }

    const waiting = needy && !isFocused
    if (waiting && watch.idleFleetSince === null) watch.idleFleetSince = this.now()
    else if (!waiting && watch.idleFleetSince !== null) {
      this.record({ type: "idle_fleet_ms", agent: sessionId, durationMs: this.now() - watch.idleFleetSince })
      watch.idleFleetSince = null
    }
  }

  private handleTurn(sessionId: SessionId, watch: AgentWatch, turn: { kind: string; text?: string }): void {
    if (turn.kind === "user") {
      this.resolveEffortRetention(sessionId, watch)
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
      watch = {
        seenAcpSessionId: "",
        seenTurns: 0,
        seenEffortValue: undefined,
        effortRetention: null,
        awaitingResponseAt: null,
        reexplanationArmed: false,
        neededSince: null,
        idleFleetSince: null,
      }
      this.watches.set(sessionId, watch)
    }
    return watch
  }

  /** Stamp and write one event. The one place `at`/`sessionRef` are attached. */
  private record(event: Omit<TelemetryRecord, "at" | "sessionRef">): void {
    this.sink.write({ ...event, at: this.now(), sessionRef: this.sessionRef })
  }

  /** Compare one store snapshot's confirmed effort to the prior snapshot. */
  private processEffortChange(sessionId: SessionId, options: readonly ConfigOption[]): void {
    const watch = this.watchFor(sessionId)
    const current = effortValue(options)
    if (current === watch.seenEffortValue) return

    // A pending metric sees any subsequent effort change as the original choice not
    // surviving. Whether that new value is an exact revert is immaterial to retention.
    watch.effortRetention?.push({ kind: "effort_change" })
    watch.seenEffortValue = current
  }

  /** Close a pending effort-change window at the pane's next developer turn. */
  private resolveEffortRetention(sessionId: SessionId, watch: AgentWatch): void {
    const events = watch.effortRetention
    if (!events) return
    events.push({ kind: "next_turn" })
    if (effortChangeKept(events)) this.record({ type: "effort_change_kept", agent: sessionId })
    watch.effortRetention = null
  }
}

/** Read an effort's current value from the generic, adapter-owned option surface. */
function effortValue(options: readonly ConfigOption[]): string | undefined {
  return options.find((option) => option.category === EFFORT_CATEGORY)?.currentValue
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
  let live = 0
  for (const runtime of runtimes) {
    if (runtime.ready) {
      recorder.agentReady(runtime.sessionId)
      live += 1
    } else recorder.agentUnready(runtime.sessionId)
  }
  // The peak concurrently-live count for the run: how many sessions actually came up,
  // the multi-session adoption signal (task_09). One event per run from the boot snapshot.
  recorder.maxConcurrentSessions(live)
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
