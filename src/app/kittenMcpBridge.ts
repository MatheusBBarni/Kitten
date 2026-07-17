import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomBytes, randomUUID } from "node:crypto"

import {
  ASK_USER_MCP_CAPABILITY_ENV,
  ASK_USER_MCP_ENDPOINT_ENV,
  ASK_USER_MCP_MODE_FLAG,
  ASK_USER_MCP_SERVER_NAME,
  MAX_ASK_USER_FIELDS,
  MAX_ASK_USER_FRAME_BYTES,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_TEXT_BYTES,
} from "../agent/askUserMcp.ts"
import {
  agentRunInputSchema,
  MAX_AGENT_RUN_CHILD_ID_BYTES,
  type AgentRunRequest,
} from "../agent/agentRunMcp.ts"
import type {
  ClarificationField,
  ClarificationOutcome,
  ClarificationPayload,
  DelegatedChildStatus,
  McpServerConfig,
  SessionId,
} from "../core/types.ts"
import type {
  ClarificationRequestHandle,
} from "./controller.ts"
import type { ClarificationSessionLossReason } from "../telemetry/recorder.ts"

export const MAX_KITTEN_MCP_CALL_ID_BYTES = 128
export const MAX_KITTEN_MCP_CONCURRENT_CALLS = 4
export const MAX_KITTEN_MCP_CALLS_PER_ROUTE = 256

export {
  ASK_USER_MCP_CAPABILITY_ENV,
  ASK_USER_MCP_ENDPOINT_ENV,
  ASK_USER_MCP_MODE_FLAG,
  ASK_USER_MCP_SERVER_NAME,
  MAX_ASK_USER_FIELDS,
  MAX_ASK_USER_FRAME_BYTES,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_TEXT_BYTES,
} from "../agent/askUserMcp.ts"

const textDecoder = new TextDecoder("utf-8", { fatal: true })

export type KittenMcpBridgeFailureReason =
  | "registration_endpoint_failed"
  | "registration_capability_failed"
  | "registration_listen_failed"
  | "connection_frame_too_large"
  | "connection_malformed_frame"
  | "connection_invalid_request"
  | "connection_unauthorized"
  | "connection_duplicate_call_id"
  | "connection_concurrency_limit"
  | "connection_call_limit"
  | "connection_io_error"
  | "connection_request_failed"

export interface BridgeRegistration {
  readonly sessionId: SessionId
  readonly generation: number
}

export type GeneratedMcpServer = McpServerConfig

export interface AgentRunRoute {
  readonly parentId: SessionId
  readonly parentGeneration: number
}

export interface AgentRunTask {
  readonly task: string
  readonly desiredOutcome: string
}

export interface AgentRunSnapshot {
  readonly childId: SessionId
  readonly status: DelegatedChildStatus
  readonly terminalAt?: number
}

export interface AgentRunControl {
  start(route: AgentRunRoute, tasks: readonly AgentRunTask[]): Promise<readonly AgentRunSnapshot[]>
  poll(route: AgentRunRoute, childIds: readonly SessionId[]): readonly AgentRunSnapshot[]
}

export interface KittenMcpBridge {
  register(input: BridgeRegistration): GeneratedMcpServer
  ask(capability: string, form: ClarificationPayload): Promise<ClarificationOutcome>
  cancelSession(
    sessionId: SessionId,
    generation: number,
    reason: ClarificationSessionLossReason,
  ): void
  dispose(): Promise<void>
}

export interface KittenMcpEndpoint {
  readonly endpoint: string
  readonly directory?: string
}

export interface KittenMcpBridgeSocket {
  write(data: string): number
  end(): void
}

export interface KittenMcpBridgeListener {
  stop(closeActiveConnections?: boolean): void
  unref?(): void
}

export interface KittenMcpBridgeListenerHandlers {
  open(socket: KittenMcpBridgeSocket): void
  data(socket: KittenMcpBridgeSocket, data: Uint8Array): void
  close(socket: KittenMcpBridgeSocket): void
  error(socket: KittenMcpBridgeSocket): void
}

export interface KittenMcpBridgeOptions {
  readonly executablePath: string
  /** Arguments needed to launch the Kitten entrypoint before the child-mode flag. */
  readonly executableArgs?: readonly string[]
  readonly requestClarification: (
    sessionId: SessionId,
    generation: number,
    form: ClarificationPayload,
  ) => ClarificationRequestHandle
  readonly cancelClarifications: (
    sessionId: SessionId,
    generation: number,
    reason: ClarificationSessionLossReason,
  ) => void
  readonly agentRunControl?: AgentRunControl
  readonly onFailure?: (reason: KittenMcpBridgeFailureReason) => void
  readonly platform?: NodeJS.Platform
  readonly createEndpoint?: (platform: NodeJS.Platform) => KittenMcpEndpoint
  readonly listen?: (
    endpoint: string,
    handlers: KittenMcpBridgeListenerHandlers,
  ) => KittenMcpBridgeListener
  readonly newCapability?: () => string
  readonly newCallId?: () => string
}

interface ConnectionState {
  buffer: Uint8Array
  route: Route | null
  closed: boolean
}

interface PendingCall {
  readonly socket: KittenMcpBridgeSocket | null
  readonly handle?: ClarificationRequestHandle
}

interface Route {
  readonly sessionId: SessionId
  readonly generation: number
  readonly capability: string
  readonly endpoint: KittenMcpEndpoint
  readonly listener: KittenMcpBridgeListener
  readonly callIds: Set<string>
  readonly pending: Map<string, PendingCall>
  readonly sockets: Set<KittenMcpBridgeSocket>
  totalCalls: number
  closing: boolean
}

interface AskFrame {
  readonly kind: "ask"
  readonly callId: string
  readonly capability: string
  readonly form: ClarificationPayload
}

interface AgentRunFrame {
  readonly kind: "agent_run"
  readonly callId: string
  readonly capability: string
  readonly request: AgentRunRequest
}

type KittenMcpFrame = AskFrame | AgentRunFrame

export class KittenMcpBridgeError extends Error {
  constructor(readonly code: "registration_failed" | "unavailable" | "invalid_request" | "busy") {
    super(`kitten MCP bridge ${code}`)
    this.name = "KittenMcpBridgeError"
  }
}

export function createKittenMcpBridge(options: KittenMcpBridgeOptions): KittenMcpBridge {
  const platform = options.platform ?? process.platform
  const createEndpoint = options.createEndpoint ?? createPrivateEndpoint
  const listen = options.listen ?? listenOnLocalEndpoint
  const newCapability = options.newCapability ?? (() => randomBytes(32).toString("base64url"))
  const newCallId = options.newCallId ?? randomUUID
  const onFailure = options.onFailure ?? (() => {})
  const routesByCapability = new Map<string, Route>()
  const routesBySession = new Map<SessionId, Route>()
  const connections = new Map<KittenMcpBridgeSocket, ConnectionState>()
  const agentRunControl = options.agentRunControl ?? unavailableAgentRunControl
  let disposed = false

  function report(reason: KittenMcpBridgeFailureReason): void {
    onFailure(reason)
  }

  function removeEndpoint(endpoint: KittenMcpEndpoint): void {
    if (!endpoint.directory) return
    try {
      rmSync(endpoint.directory, { recursive: true, force: true })
    } catch {
      report("connection_io_error")
    }
  }

  function closeRoute(route: Route, reason: ClarificationSessionLossReason): void {
    if (route.closing) return
    route.closing = true
    routesByCapability.delete(route.capability)
    if (routesBySession.get(route.sessionId) === route) routesBySession.delete(route.sessionId)
    try {
      options.cancelClarifications(route.sessionId, route.generation, reason)
    } catch {
      report("connection_request_failed")
    }
    try {
      route.listener.stop(true)
    } catch {
      report("connection_io_error")
    } finally {
      removeEndpoint(route.endpoint)
    }
    route.sockets.clear()
  }

  function closeConnection(
    socket: KittenMcpBridgeSocket,
    state: ConnectionState,
    reason?: KittenMcpBridgeFailureReason,
  ): void {
    if (state.closed) return
    state.closed = true
    if (reason) report(reason)
    const route = state.route
    state.route = null
    connections.delete(socket)
    if (route) {
      route.sockets.delete(socket)
      if (!route.closing) {
        for (const [callId, pending] of route.pending) {
          if (pending.socket !== socket) continue
          route.pending.delete(callId)
          if (!pending.handle) continue
          try {
            pending.handle.cancel("connection_error")
          } catch {
            report("connection_request_failed")
          }
        }
      }
    }
    socket.end()
  }

  function send(
    socket: KittenMcpBridgeSocket,
    frame: Record<string, unknown>,
  ): void {
    socket.write(`${JSON.stringify(frame)}\n`)
  }

  function rejectConnection(
    socket: KittenMcpBridgeSocket,
    state: ConnectionState,
    reason: KittenMcpBridgeFailureReason,
    error: "invalid_request" | "unavailable" | "busy",
    callId?: string,
  ): void {
    send(socket, callId ? { kind: "error", callId, error } : { kind: "error", error })
    closeConnection(socket, state, reason)
  }

  function reserveCall(route: Route, callId: string): "ok" | "duplicate" | "busy" | "limit" {
    if (route.callIds.has(callId)) return "duplicate"
    if (route.pending.size >= MAX_KITTEN_MCP_CONCURRENT_CALLS) return "busy"
    if (route.totalCalls >= MAX_KITTEN_MCP_CALLS_PER_ROUTE) return "limit"
    route.callIds.add(callId)
    route.totalCalls += 1
    return "ok"
  }

  function beginCall(
    route: Route,
    callId: string,
    form: ClarificationPayload,
    socket: KittenMcpBridgeSocket | null,
  ): Promise<ClarificationOutcome> {
    let handle: ClarificationRequestHandle
    try {
      handle = options.requestClarification(route.sessionId, route.generation, form)
    } catch {
      report("connection_request_failed")
      return Promise.reject(new KittenMcpBridgeError("unavailable"))
    }
    route.pending.set(callId, { socket, handle })
    return handle.outcome
  }

  function acceptFrame(socket: KittenMcpBridgeSocket, state: ConnectionState, raw: Uint8Array): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(textDecoder.decode(raw))
    } catch {
      rejectConnection(socket, state, "connection_malformed_frame", "invalid_request")
      return
    }
    const frame = parseFrame(parsed)
    if (!frame) {
      rejectConnection(socket, state, "connection_invalid_request", "invalid_request", safeCallId(parsed))
      return
    }

    const route = routesByCapability.get(frame.capability)
    if (!route || route.closing) {
      rejectConnection(socket, state, "connection_unauthorized", "unavailable", frame.callId)
      return
    }
    if (state.route && state.route !== route) {
      rejectConnection(socket, state, "connection_unauthorized", "unavailable", frame.callId)
      return
    }
    state.route = route
    route.sockets.add(socket)

    const reservation = reserveCall(route, frame.callId)
    if (reservation !== "ok") {
      const reason = reservation === "duplicate"
        ? "connection_duplicate_call_id"
        : reservation === "busy"
          ? "connection_concurrency_limit"
          : "connection_call_limit"
      const error = reservation === "duplicate" ? "invalid_request" : "busy"
      send(socket, { kind: "error", callId: frame.callId, error })
      report(reason)
      return
    }

    if (frame.kind === "ask") {
      void beginCall(route, frame.callId, frame.form, socket).then(
        (outcome) => {
          route.pending.delete(frame.callId)
          if (canSend(route, socket)) send(socket, { kind: "result", callId: frame.callId, outcome })
        },
        (error) => failCall(route, socket, frame.callId, error),
      )
      return
    }

    route.pending.set(frame.callId, { socket })
    void dispatchAgentRun(agentRunControl, route, frame.request).then(
      (result) => {
        route.pending.delete(frame.callId)
        if (canSend(route, socket)) send(socket, { kind: "agent_run_result", callId: frame.callId, result })
      },
      (error) => failCall(route, socket, frame.callId, error),
    )
  }

  function canSend(route: Route, socket: KittenMcpBridgeSocket): boolean {
    const state = connections.get(socket)
    return !route.closing && state !== undefined && !state.closed
  }

  function failCall(route: Route, socket: KittenMcpBridgeSocket, callId: string, cause: unknown): void {
    const error = cause instanceof KittenMcpBridgeError && cause.code === "busy" ? "busy" : "unavailable"
    report(error === "busy" ? "connection_concurrency_limit" : "connection_request_failed")
    route.pending.delete(callId)
    if (canSend(route, socket)) send(socket, { kind: "error", callId, error })
  }

  function onData(socket: KittenMcpBridgeSocket, chunk: Uint8Array): void {
    const state = connections.get(socket)
    if (!state || state.closed) return
    let offset = 0
    while (!state.closed) {
      const newline = chunk.indexOf(10, offset)
      if (newline < 0) break
      const segment = chunk.subarray(offset, newline)
      if (state.buffer.byteLength + segment.byteLength > MAX_ASK_USER_FRAME_BYTES) {
        rejectConnection(socket, state, "connection_frame_too_large", "invalid_request")
        return
      }
      const frame = concatBytes(state.buffer, segment)
      state.buffer = new Uint8Array()
      acceptFrame(socket, state, frame)
      offset = newline + 1
    }
    if (state.closed) return
    const remaining = chunk.subarray(offset)
    if (state.buffer.byteLength + remaining.byteLength > MAX_ASK_USER_FRAME_BYTES) {
      rejectConnection(socket, state, "connection_frame_too_large", "invalid_request")
      return
    }
    state.buffer = concatBytes(state.buffer, remaining)
  }

  const handlers: KittenMcpBridgeListenerHandlers = {
    open(socket) {
      connections.set(socket, { buffer: new Uint8Array(), route: null, closed: false })
    },
    data: onData,
    close(socket) {
      const state = connections.get(socket)
      if (state) closeConnection(socket, state)
    },
    error(socket) {
      const state = connections.get(socket)
      if (state) closeConnection(socket, state, "connection_io_error")
      else report("connection_io_error")
    },
  }

  return {
    register(input) {
      if (disposed) throw new KittenMcpBridgeError("registration_failed")
      const previous = routesBySession.get(input.sessionId)
      if (previous) closeRoute(previous, "session_replaced")

      let endpoint: KittenMcpEndpoint
      try {
        endpoint = createEndpoint(platform)
      } catch {
        report("registration_endpoint_failed")
        throw new KittenMcpBridgeError("registration_failed")
      }

      const capability = newCapability()
      if (!isCapability(capability) || routesByCapability.has(capability)) {
        removeEndpoint(endpoint)
        report("registration_capability_failed")
        throw new KittenMcpBridgeError("registration_failed")
      }

      let listener: KittenMcpBridgeListener
      try {
        listener = listen(endpoint.endpoint, handlers)
        listener.unref?.()
      } catch {
        removeEndpoint(endpoint)
        report("registration_listen_failed")
        throw new KittenMcpBridgeError("registration_failed")
      }

      const route: Route = {
        sessionId: input.sessionId,
        generation: input.generation,
        capability,
        endpoint,
        listener,
        callIds: new Set(),
        pending: new Map(),
        sockets: new Set(),
        totalCalls: 0,
        closing: false,
      }
      routesByCapability.set(capability, route)
      routesBySession.set(input.sessionId, route)
      return {
        name: ASK_USER_MCP_SERVER_NAME,
        command: options.executablePath,
        args: [...(options.executableArgs ?? []), ASK_USER_MCP_MODE_FLAG],
        env: {
          [ASK_USER_MCP_ENDPOINT_ENV]: endpoint.endpoint,
          [ASK_USER_MCP_CAPABILITY_ENV]: capability,
        },
      }
    },

    async ask(capability, form) {
      const route = routesByCapability.get(capability)
      if (!route || route.closing) throw new KittenMcpBridgeError("unavailable")
      if (!isClarificationPayload(form)) throw new KittenMcpBridgeError("invalid_request")
      const callId = newCallId()
      const reservation = reserveCall(route, callId)
      if (reservation !== "ok") throw new KittenMcpBridgeError(reservation === "duplicate" ? "invalid_request" : "busy")
      try {
        return await beginCall(route, callId, form, null)
      } finally {
        route.pending.delete(callId)
      }
    },

    cancelSession(sessionId, generation, reason) {
      const route = routesBySession.get(sessionId)
      if (!route || route.generation !== generation) return
      closeRoute(route, reason)
    },

    async dispose() {
      if (disposed) return
      disposed = true
      for (const route of [...routesByCapability.values()]) {
        closeRoute(route, "controller_disposed")
      }
      connections.clear()
    },
  }
}

function createPrivateEndpoint(platform: NodeJS.Platform): KittenMcpEndpoint {
  if (platform === "win32") {
    return { endpoint: `\\\\.\\pipe\\kitten-mcp-${randomUUID()}` }
  }
  const directory = mkdtempSync(join(tmpdir(), "kitten-mcp-"))
  try {
    chmodSync(directory, 0o700)
    return { endpoint: join(directory, "bridge.sock"), directory }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
}

function listenOnLocalEndpoint(
  endpoint: string,
  handlers: KittenMcpBridgeListenerHandlers,
): KittenMcpBridgeListener {
  return Bun.listen<undefined>({
    unix: endpoint,
    socket: {
      open(socket) {
        handlers.open(socket)
      },
      data(socket, data) {
        handlers.data(socket, data)
      },
      close(socket) {
        handlers.close(socket)
      },
      error(socket) {
        handlers.error(socket)
      },
    },
  })
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right.slice()
  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left)
  combined.set(right, left.byteLength)
  return combined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isBoundedText(value: unknown, options: { optional?: boolean; nonEmpty?: boolean } = {}): boolean {
  if (value === undefined) return options.optional === true
  if (typeof value !== "string") return false
  if (options.nonEmpty && value.length === 0) return false
  return Buffer.byteLength(value, "utf8") <= MAX_ASK_USER_TEXT_BYTES
}

function isCapability(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && Buffer.byteLength(value, "utf8") <= 128
}

function isCallId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= MAX_KITTEN_MCP_CALL_ID_BYTES
}

function isClarificationOption(value: unknown): value is { id: string; label: string; description?: string } {
  return isRecord(value)
    && hasOnlyKeys(value, ["id", "label", "description"])
    && isBoundedText(value.id, { nonEmpty: true })
    && isBoundedText(value.label, { nonEmpty: true })
    && isBoundedText(value.description, { optional: true })
}

function isClarificationField(value: unknown): value is ClarificationField {
  if (!isRecord(value)) return false
  const baseKeys = ["id", "label", "description", "required", "mode"]
  if (!isBoundedText(value.id, { nonEmpty: true })
    || !isBoundedText(value.label, { nonEmpty: true })
    || !isBoundedText(value.description, { optional: true })
    || typeof value.required !== "boolean") return false
  if (value.mode === "text") return hasOnlyKeys(value, baseKeys)
  if (value.mode !== "single" && value.mode !== "multi") return false
  if (!hasOnlyKeys(value, [...baseKeys, "options", "allowsCustom"])
    || !Array.isArray(value.options)
    || value.options.length > MAX_ASK_USER_OPTIONS
    || typeof value.allowsCustom !== "boolean"
    || (value.options.length === 0 && !value.allowsCustom)) return false
  const optionIds = new Set<string>()
  for (const option of value.options) {
    if (!isClarificationOption(option) || optionIds.has(option.id)) return false
    optionIds.add(option.id)
  }
  return true
}

export function isClarificationPayload(value: unknown): value is ClarificationPayload {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["title", "context", "prompt", "fields"])
    || !isBoundedText(value.title, { optional: true })
    || !isBoundedText(value.context, { optional: true })
    || !isBoundedText(value.prompt, { nonEmpty: true })
    || !Array.isArray(value.fields)
    || value.fields.length < 1
    || value.fields.length > MAX_ASK_USER_FIELDS) return false
  const fieldIds = new Set<string>()
  for (const field of value.fields) {
    if (!isClarificationField(field) || fieldIds.has(field.id)) return false
    fieldIds.add(field.id)
  }
  return true
}

function isAskFrame(value: unknown): value is AskFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "callId", "capability", "form"])
    && value.kind === "ask"
    && isCallId(value.callId)
    && isCapability(value.capability)
    && isClarificationPayload(value.form)
}

function parseFrame(value: unknown): KittenMcpFrame | null {
  if (isAskFrame(value)) return value
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["kind", "callId", "capability", "request"])
    || value.kind !== "agent_run"
    || !isCallId(value.callId)
    || !isCapability(value.capability)) return null
  const request = agentRunInputSchema.safeParse(value.request)
  return request.success
    ? { kind: "agent_run", callId: value.callId, capability: value.capability, request: request.data }
    : null
}

const unavailableAgentRunControl: AgentRunControl = {
  async start() {
    throw new KittenMcpBridgeError("unavailable")
  },
  poll() {
    throw new KittenMcpBridgeError("unavailable")
  },
}

async function dispatchAgentRun(
  control: AgentRunControl,
  route: Route,
  request: AgentRunRequest,
): Promise<{ operation: AgentRunRequest["operation"]; children: readonly Record<string, unknown>[] }> {
  const authority: AgentRunRoute = {
    parentId: route.sessionId,
    parentGeneration: route.generation,
  }
  const snapshots = request.operation === "start"
    ? await control.start(authority, request.tasks.map((task) => ({
        task: task.task,
        desiredOutcome: task.desired_outcome,
      })))
    : control.poll(authority, request.child_ids as readonly SessionId[])
  return {
    operation: request.operation,
    children: serializeAgentRunSnapshots(request, snapshots),
  }
}

function serializeAgentRunSnapshots(
  request: AgentRunRequest,
  snapshots: readonly AgentRunSnapshot[],
): readonly Record<string, unknown>[] {
  const expectedLength = request.operation === "start" ? request.tasks.length : request.child_ids.length
  if (!Array.isArray(snapshots) || snapshots.length !== expectedLength) {
    throw new KittenMcpBridgeError("unavailable")
  }
  const childIds = new Set<SessionId>()
  return snapshots.map((snapshot, index) => {
    if (!isAgentRunSnapshot(snapshot) || childIds.has(snapshot.childId)) {
      throw new KittenMcpBridgeError("unavailable")
    }
    if (request.operation === "poll" && snapshot.childId !== request.child_ids[index]) {
      throw new KittenMcpBridgeError("unavailable")
    }
    childIds.add(snapshot.childId)
    return {
      child_id: snapshot.childId,
      status: snapshot.status,
      ...(snapshot.terminalAt === undefined ? {} : { terminal_at: snapshot.terminalAt }),
    }
  })
}

function isAgentRunSnapshot(value: unknown): value is AgentRunSnapshot {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["childId", "status", "terminalAt"])
    || typeof value.childId !== "string"
    || value.childId.trim().length === 0
    || Buffer.byteLength(value.childId, "utf8") > MAX_AGENT_RUN_CHILD_ID_BYTES
    || !isAgentRunStatus(value.status)) return false
  if (value.terminalAt !== undefined
    && (typeof value.terminalAt !== "number"
      || !Number.isSafeInteger(value.terminalAt)
      || value.terminalAt < 0)) return false
  return isTerminalAgentRunStatus(value.status) || value.terminalAt === undefined
}

function isAgentRunStatus(value: unknown): value is DelegatedChildStatus {
  return value === "starting"
    || value === "running"
    || value === "needs_input"
    || value === "finished"
    || value === "failed"
    || value === "cancelled"
}

function isTerminalAgentRunStatus(status: DelegatedChildStatus): boolean {
  return status === "finished" || status === "failed" || status === "cancelled"
}

function safeCallId(value: unknown): string | undefined {
  return isRecord(value) && isCallId(value.callId) ? value.callId : undefined
}
