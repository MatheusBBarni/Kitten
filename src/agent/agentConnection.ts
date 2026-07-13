/**
 * The Agent Adapter Layer (`AgentConnection`) - the imperative shell and the ACP
 * anti-corruption boundary (ADR-003).
 *
 * One instance drives one agent: it spawns the agent as an ACP subprocess (via an
 * injectable {@link TransportFactory}, defaulting to `Bun.spawn`), speaks ACP over
 * a `ClientSideConnection`, implements the ACP `Client` callbacks (permission +
 * filesystem), and translates the incoming `SessionUpdate` stream into Kitten's
 * protocol-free {@link DomainSessionEvent}s. Streamed `agent_message` deltas are
 * coalesced to at most one flush per frame so downstream rendering stays
 * flicker-free (ADR-004). No ACP wire type escapes this layer.
 */

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Client,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type StopReason,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk"

import type {
  AgentConfig,
  ClarificationOutcome,
  ClarificationPayload,
  ConfigOption,
  DomainSessionEvent,
  ProviderKind,
  ResolvedAgentConfig,
  SessionStatus,
  ToolCallUpdate,
} from "../core/types.ts"
import { KITTEN_VERSION } from "../version.ts"
import {
  toAcpElicitationOutcome,
  translateConfigOptions,
  translateElicitationForm,
  translateSessionUpdate,
  translateToolCall,
} from "./acpTranslate.ts"
import { spawnAgentTransport, type AgentTransport, type TransportFactory } from "./transport.ts"

/** A block of prompt content sent to an agent. V1 sends plain text. */
export interface PromptBlock {
  type: "text"
  text: string
}

/** Why a prompt turn stopped, normalized from the ACP stop reason. */
export type PromptStopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"

/** The result of a completed prompt turn. */
export interface PromptResult {
  stopReason: PromptStopReason
}

/** Outcome of `connect`: a completed handshake, or a legible not-ready reason. */
export type ReadyState =
  | { ready: true; protocolVersion: number; canLoadSession: boolean }
  | { ready: false; error: string }

/**
 * The ACP protocol version Kitten negotiates during `initialize`.
 *
 * Re-exported as a plain number so layers above this adapter (the readiness
 * checker in `src/config`) can detect a capability mismatch without importing
 * the ACP SDK, keeping the anti-corruption boundary intact (ADR-003).
 */
export const SUPPORTED_PROTOCOL_VERSION: number = PROTOCOL_VERSION

/** A permission option surfaced to the user, translated from ACP. */
export interface PermissionOptionView {
  optionId: string
  name: string
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"
}

/** A permission request routed to the UI; carries a domain tool-call view. */
export interface PermissionRequest {
  sessionId: string
  toolCall: ToolCallUpdate
  options: PermissionOptionView[]
}

/** The user's decision on a permission request, returned to the agent. */
export type PermissionOutcome = { outcome: "selected"; optionId: string } | { outcome: "cancelled" }

/** Protocol-free clarification callback consumed by the controller coordinator. */
export type ClarificationHandler = (payload: ClarificationPayload) => Promise<ClarificationOutcome>

type Unsubscribe = () => void

/** The adapter boundary the rest of the app depends on (TechSpec "Core Interfaces"). */
export interface AgentConnection {
  readonly id: ProviderKind
  connect(): Promise<ReadyState>
  newSession(cwd: string): Promise<string>
  loadSession(sessionId: string, cwd: string): Promise<void>
  prompt(sessionId: string, blocks: PromptBlock[]): Promise<PromptResult>
  cancel(sessionId: string): Promise<void>
  /**
   * Change one config option (model, reasoning effort, ...) on the live session and
   * return the agent-confirmed full option set - the source of confirmed state
   * (ADR-004). The session is never torn down or re-spawned. On a transport failure
   * this propagates like {@link cancel} so the controller action routes it to
   * `onError` rather than letting it reject into the UI; no config event is emitted.
   */
  setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<ConfigOption[]>
  onUpdate(cb: (event: DomainSessionEvent) => void): Unsubscribe
  onPermission(handler: (req: PermissionRequest) => Promise<PermissionOutcome>): void
  onClarification(handler: ClarificationHandler): Unsubscribe
  dispose(): Promise<void>
}

/**
 * Batches work to at most once per frame. `schedule` is idempotent within a frame:
 * repeated calls before the frame boundary collapse to a single `flush`.
 */
export interface FrameScheduler {
  schedule(flush: () => void): void
  dispose(): void
}

/** Default scheduler: one flush per ~60fps frame via a coalescing timer. */
export function createFrameScheduler(frameMs = 16): FrameScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    schedule(flush) {
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        flush()
      }, frameMs)
    },
    dispose() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}

/** Construction options for an {@link AgentConnection}. Seams are injectable for tests. */
export interface AgentConnectionOptions {
  /** A resolved config carries the verified capability; a bare config fails closed. */
  config: AgentConfig | ResolvedAgentConfig
  /** Transport factory; defaults to a real `Bun.spawn` stdio transport. */
  transport?: TransportFactory
  /** Frame scheduler for coalescing; defaults to a real timer-based scheduler. */
  scheduler?: FrameScheduler
}

/** Create an {@link AgentConnection} for one configured agent. */
export function createAgentConnection(options: AgentConnectionOptions): AgentConnection {
  return new AgentConnectionImpl(options)
}

/** A single buffered, still-streaming agent message within the current frame. */
interface BufferedMessage {
  messageId: string
  text: string
}

class AgentConnectionImpl implements AgentConnection {
  readonly id: ProviderKind

  private readonly config: AgentConfig
  private readonly clarificationSupported: boolean
  private readonly transportFactory: TransportFactory
  private readonly scheduler: FrameScheduler

  private transport: AgentTransport | null = null
  private connection: ClientSideConnection | null = null

  /** Set the instant `dispose` begins, so an intentional teardown's transport close
   * does not masquerade as a crash. */
  private closing = false

  private readonly subscribers = new Set<(event: DomainSessionEvent) => void>()
  private permissionHandler: ((req: PermissionRequest) => Promise<PermissionOutcome>) | null = null
  private clarificationHandler: ClarificationHandler | null = null
  private activeSessionId: string | null = null

  /** Contiguous, not-yet-flushed agent-message deltas for the current frame. */
  private readonly messageBuffer: BufferedMessage[] = []

  constructor(options: AgentConnectionOptions) {
    this.id = options.config.id
    this.config = options.config
    this.clarificationSupported =
      "clarificationCapability" in options.config && options.config.clarificationCapability.status === "supported"
    this.transportFactory = options.transport ?? spawnAgentTransport
    this.scheduler = options.scheduler ?? createFrameScheduler()
  }

  async connect(): Promise<ReadyState> {
    try {
      this.transport = this.transportFactory(this.config)
      // A transport close we did not ask for is a lost subprocess: surface `error`
      // (ADR-006). The `closing` guard suppresses the close that `dispose` itself
      // triggers, so only an unexpected exit reaches the overview. The transport's
      // `onClose` is backed by the subprocess `exited` promise (`transport.ts`), so
      // this is a real signal - no fallback to holding the last state is needed.
      this.transport.onClose(() => {
        if (this.closing) return
        this.emit({ kind: "status", status: "error" })
      })
      this.connection = new ClientSideConnection(() => this.buildClient(), this.transport.stream)
      const result = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          // Select config options are part of Kitten's confirmed session state. Advertise
          // that surface so ACP agents can safely return model and reasoning controls.
          // Boolean options remain intentionally unsupported by the V1 UI.
          session: { configOptions: {} },
          ...(this.clarificationSupported ? { elicitation: { form: {} } } : {}),
        },
        clientInfo: { name: "kitten", version: KITTEN_VERSION },
      })
      return {
        ready: true,
        protocolVersion: result.protocolVersion,
        canLoadSession: result.agentCapabilities?.loadSession === true,
      }
    } catch (error) {
      return { ready: false, error: handshakeErrorMessage(error) }
    }
  }

  async newSession(cwd: string): Promise<string> {
    const connection = this.requireConnection()
    const result = await connection.newSession({ cwd, mcpServers: [] })
    // Seed the pane's confirmed config state from what the session already advertises
    // instead of discarding it. Emit only when the agent actually returned the field:
    // an absent `configOptions` means the agent has no config surface (the reducer's
    // `[]` default already covers it), while an explicit empty list is emitted as an
    // empty set - never fabricate options the agent did not advertise (ADR-003/ADR-004).
    if (result.configOptions != null) {
      this.emit({ kind: "config_options", options: translateConfigOptions(result.configOptions) })
    }
    this.activeSessionId = result.sessionId
    return result.sessionId
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    const connection = this.requireConnection()
    const result = await connection.loadSession({ sessionId, cwd, mcpServers: [] })
    // A resumed session returns the same initial config snapshot as a fresh one.
    // Preserve it so model and reasoning selectors retain their confirmed state.
    if (result.configOptions != null) {
      this.emit({ kind: "config_options", options: translateConfigOptions(result.configOptions) })
    }
    this.activeSessionId = sessionId
  }

  async prompt(sessionId: string, blocks: PromptBlock[]): Promise<PromptResult> {
    const connection = this.requireConnection()
    this.emit({ kind: "status", status: "working" })
    try {
      const result = await connection.prompt({
        sessionId,
        prompt: blocks.map((block) => ({ type: "text", text: block.text })),
      })
      const stopReason = result.stopReason satisfies StopReason
      // Map the terminal stop reason to a status instead of always emitting `idle`
      // (ADR-006): a turn that ran to its end is `finished` (your move), a turn the
      // developer cancelled is `idle`. Deriving only from this terminal signal keeps
      // `finished` from flickering off a mid-turn streaming update.
      this.emit({ kind: "status", status: statusForStopReason(stopReason) })
      return { stopReason }
    } catch (error) {
      // A thrown prompt is a lost turn, not a completed one: surface `error` so the
      // overview can route the developer to the broken session (ADR-006), then let
      // the failure propagate to the controller's `onError`.
      this.emit({ kind: "status", status: "error" })
      throw error
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const connection = this.requireConnection()
    await connection.cancel({ sessionId })
  }

  async setSessionConfigOption(sessionId: string, configId: string, value: string): Promise<ConfigOption[]> {
    const connection = this.requireConnection()
    // The agent echoes back the full refreshed option set (not a delta), so map the
    // response verbatim - it is the confirmed state the overlay renders. A thrown call
    // propagates to the controller action (the existing error path), which reports it
    // through `onError`; it is deliberately not caught here, so the caller can keep
    // showing its last confirmed value and mark the option `unverified` (ADR-004).
    const result = await connection.setSessionConfigOption({ sessionId, configId, value })
    return translateConfigOptions(result.configOptions)
  }

  onUpdate(cb: (event: DomainSessionEvent) => void): Unsubscribe {
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  onPermission(handler: (req: PermissionRequest) => Promise<PermissionOutcome>): void {
    this.permissionHandler = handler
  }

  onClarification(handler: ClarificationHandler): Unsubscribe {
    this.clarificationHandler = handler
    return () => {
      if (this.clarificationHandler === handler) this.clarificationHandler = null
    }
  }

  async dispose(): Promise<void> {
    this.closing = true
    this.scheduler.dispose()
    this.subscribers.clear()
    this.permissionHandler = null
    this.clarificationHandler = null
    this.activeSessionId = null
    this.connection = null
    const transport = this.transport
    this.transport = null
    if (transport) await transport.dispose()
  }

  /** Build the ACP `Client` handler wired back into this adapter's routing. */
  private buildClient(): Client {
    const client: Client = {
      sessionUpdate: (params: SessionNotification) => this.onSessionUpdate(params),
      requestPermission: (params: RequestPermissionRequest) => this.onRequestPermission(params),
      readTextFile: (params: ReadTextFileRequest) => readTextFile(params),
      writeTextFile: (params: WriteTextFileRequest) => writeTextFile(params),
    }
    if (this.clarificationSupported) {
      client.unstable_createElicitation = (params: CreateElicitationRequest) => this.onCreateElicitation(params)
    }
    return client
  }

  /** Translate an incoming `session/update` and route it through coalescing. */
  private onSessionUpdate(params: SessionNotification): void {
    const event = translateSessionUpdate(params.update)
    if (event === null) return
    if (event.kind === "agent_message") {
      this.bufferAgentMessage(event.messageId, event.textDelta)
    } else {
      // Preserve transcript order: any non-message event flushes buffered text first.
      this.emit(event)
    }
  }

  /** Translate a permission request, surface `awaiting_approval`, and route it. */
  private async onRequestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const handler = this.permissionHandler
    if (!handler) {
      // Nothing is listening to curate the decision; cancel rather than auto-approve.
      return { outcome: { outcome: "cancelled" } }
    }
    this.emit({ kind: "status", status: "awaiting_approval" })
    try {
      const outcome = await handler({
        sessionId: params.sessionId,
        toolCall: translateToolCall(params.toolCall),
        options: params.options.map((option) => ({
          optionId: option.optionId,
          name: option.name,
          kind: option.kind,
        })),
      })
      return { outcome: toAcpOutcome(outcome) }
    } finally {
      this.emit({ kind: "status", status: "working" })
    }
  }

  /** Normalize one verified, active-session form request and settle it exactly once. */
  private async onCreateElicitation(params: CreateElicitationRequest): Promise<CreateElicitationResponse> {
    if (
      params.mode !== "form" ||
      !("sessionId" in params) ||
      this.activeSessionId === null ||
      params.sessionId !== this.activeSessionId
    ) {
      return { action: "cancel" }
    }

    const payload = translateElicitationForm(params.message, params.requestedSchema)
    const handler = this.clarificationHandler
    if (payload === null || handler === null) return { action: "cancel" }

    try {
      return toAcpElicitationOutcome(payload, await handler(payload))
    } catch {
      // A failed consumer cannot leave the agent's original callback unresolved.
      return { action: "cancel" }
    }
  }

  /** Append a streamed delta to the frame buffer and schedule a flush. */
  private bufferAgentMessage(messageId: string, textDelta: string): void {
    const last = this.messageBuffer[this.messageBuffer.length - 1]
    if (last && last.messageId === messageId) {
      last.text += textDelta
    } else {
      this.messageBuffer.push({ messageId, text: textDelta })
    }
    this.scheduler.schedule(() => this.flushMessageBuffer())
  }

  /** Emit one coalesced `agent_message` per buffered message, in arrival order. */
  private flushMessageBuffer(): void {
    if (this.messageBuffer.length === 0) return
    const pending = this.messageBuffer.splice(0)
    for (const message of pending) {
      this.dispatch({ kind: "agent_message", messageId: message.messageId, textDelta: message.text })
    }
  }

  /** Emit a non-message event, flushing any buffered text first to keep order. */
  private emit(event: DomainSessionEvent): void {
    this.flushMessageBuffer()
    this.dispatch(event)
  }

  /** Fan an event out to every subscriber. */
  private dispatch(event: DomainSessionEvent): void {
    for (const subscriber of this.subscribers) subscriber(event)
  }

  private requireConnection(): ClientSideConnection {
    if (!this.connection) throw new Error(`Agent "${this.id}" is not connected; call connect() first`)
    return this.connection
  }
}

/** Read a file for the agent, honoring an optional 1-based line window. */
async function readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
  const text = await Bun.file(params.path).text()
  if (params.line == null && params.limit == null) return { content: text }
  const lines = text.split("\n")
  const start = Math.max((params.line ?? 1) - 1, 0)
  const end = params.limit == null ? undefined : start + params.limit
  return { content: lines.slice(start, end).join("\n") }
}

/** Write a file on the agent's behalf. */
async function writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
  await Bun.write(params.path, params.content)
  return {}
}

/**
 * The status a completed prompt turn leaves the session in (ADR-006).
 *
 * Every reason the turn ran to its own end - `end_turn`, a token or turn-request
 * limit, or a `refusal` - is `finished`: the turn is over and the developer's input
 * is expected. Only `cancelled` (the developer interrupted) returns the session to
 * `idle`. A thrown prompt never reaches here; it maps to `error` at the call site.
 */
function statusForStopReason(reason: PromptStopReason): SessionStatus {
  return reason === "cancelled" ? "idle" : "finished"
}

function toAcpOutcome(outcome: PermissionOutcome): RequestPermissionResponse["outcome"] {
  return outcome.outcome === "selected" ? { outcome: "selected", optionId: outcome.optionId } : { outcome: "cancelled" }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Describe a failed handshake as legibly as the wire allows.
 *
 * An agent that rejects `initialize` with a plain (non-JSON-RPC) error reaches us as
 * a generic "Internal error", with the agent's actual complaint - "not logged in",
 * "unsupported flag" - tucked into the error's `data.details`. The readiness checker
 * shows this string to the user verbatim, so unwrap that detail here rather than
 * letting a real, actionable cause be flattened into a useless word.
 */
function handshakeErrorMessage(error: unknown): string {
  const message = errorMessage(error)
  const details = errorDetails(error)
  return details && !message.includes(details) ? `${message}: ${details}` : message
}

/** Pull the nested `data.details` string the SDK stores when wrapping a plain error. */
function errorDetails(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("data" in error)) return null
  const data = (error as { data: unknown }).data
  if (typeof data !== "object" || data === null || !("details" in data)) return null
  const details = (data as { details: unknown }).details
  return typeof details === "string" && details.length > 0 ? details : null
}
