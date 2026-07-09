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
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type StopReason,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk"

import type { AgentConfig, ProviderKind, AgentStatus, DomainSessionEvent, ToolCallUpdate } from "../core/types.ts"
import { translateSessionUpdate, translateToolCall } from "./acpTranslate.ts"
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
export type ReadyState = { ready: true; protocolVersion: number } | { ready: false; error: string }

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

type Unsubscribe = () => void

/** The adapter boundary the rest of the app depends on (TechSpec "Core Interfaces"). */
export interface AgentConnection {
  readonly id: ProviderKind
  connect(): Promise<ReadyState>
  newSession(cwd: string): Promise<string>
  prompt(sessionId: string, blocks: PromptBlock[]): Promise<PromptResult>
  cancel(sessionId: string): Promise<void>
  onUpdate(cb: (event: DomainSessionEvent) => void): Unsubscribe
  onPermission(handler: (req: PermissionRequest) => Promise<PermissionOutcome>): void
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
  config: AgentConfig
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
  private readonly transportFactory: TransportFactory
  private readonly scheduler: FrameScheduler

  private transport: AgentTransport | null = null
  private connection: ClientSideConnection | null = null

  private readonly subscribers = new Set<(event: DomainSessionEvent) => void>()
  private permissionHandler: ((req: PermissionRequest) => Promise<PermissionOutcome>) | null = null

  /** Contiguous, not-yet-flushed agent-message deltas for the current frame. */
  private readonly messageBuffer: BufferedMessage[] = []

  constructor(options: AgentConnectionOptions) {
    this.id = options.config.id
    this.config = options.config
    this.transportFactory = options.transport ?? spawnAgentTransport
    this.scheduler = options.scheduler ?? createFrameScheduler()
  }

  async connect(): Promise<ReadyState> {
    try {
      this.transport = this.transportFactory(this.config)
      this.connection = new ClientSideConnection(() => this.buildClient(), this.transport.stream)
      const result = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        clientInfo: { name: "kitten", version: "0.0.0" },
      })
      return { ready: true, protocolVersion: result.protocolVersion }
    } catch (error) {
      return { ready: false, error: handshakeErrorMessage(error) }
    }
  }

  async newSession(cwd: string): Promise<string> {
    const connection = this.requireConnection()
    const result = await connection.newSession({ cwd, mcpServers: [] })
    return result.sessionId
  }

  async prompt(sessionId: string, blocks: PromptBlock[]): Promise<PromptResult> {
    const connection = this.requireConnection()
    this.emit({ kind: "status", status: "working" })
    try {
      const result = await connection.prompt({
        sessionId,
        prompt: blocks.map((block) => ({ type: "text", text: block.text })),
      })
      return { stopReason: result.stopReason satisfies StopReason }
    } finally {
      this.emit({ kind: "status", status: "idle" })
    }
  }

  async cancel(sessionId: string): Promise<void> {
    const connection = this.requireConnection()
    await connection.cancel({ sessionId })
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

  async dispose(): Promise<void> {
    this.scheduler.dispose()
    this.subscribers.clear()
    this.permissionHandler = null
    this.connection = null
    const transport = this.transport
    this.transport = null
    if (transport) await transport.dispose()
  }

  /** Build the ACP `Client` handler wired back into this adapter's routing. */
  private buildClient(): Client {
    return {
      sessionUpdate: (params: SessionNotification) => this.onSessionUpdate(params),
      requestPermission: (params: RequestPermissionRequest) => this.onRequestPermission(params),
      readTextFile: (params: ReadTextFileRequest) => readTextFile(params),
      writeTextFile: (params: WriteTextFileRequest) => writeTextFile(params),
    }
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
