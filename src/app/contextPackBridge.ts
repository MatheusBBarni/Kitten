import { randomBytes, randomUUID } from "node:crypto"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

import {
  CONTEXT_PACK_MCP_CAPABILITY_ENV,
  CONTEXT_PACK_MCP_ENDPOINT_ENV,
  CONTEXT_PACK_MCP_MODE_FLAG,
  CONTEXT_PACK_MCP_SERVER_NAME,
  contextPackMutateDraftInputSchema,
  contextPackReadWorkspaceInputSchema,
  contextPackReadWorkspaceOutputSchema,
  isContextPackMcpFrame,
  MAX_CONTEXT_PACK_MCP_REQUEST_FRAME_BYTES,
  normalizeContextPackMutation,
  normalizeContextPackWorkspaceRead,
  serializeContextPackDraft,
  serializeContextPackMutationResult,
  type ContextPackMcpFrame,
  type ContextPackMcpOperation,
  type ContextPackReadWorkspaceResult,
  type ContextPackWorkspaceRead,
  type ContextPackWorkspaceReadLimits,
} from "../agent/contextPackMcp.ts"
import type {
  ClarificationAnswer,
  ClarificationOutcome,
  ClarificationPayload,
  ContextPackMutationResult,
  DraftContextPack,
  McpServerConfig,
  RevisionFencedContextPackMutation,
  SessionId,
} from "../core/types.ts"

export const MAX_CONTEXT_PACK_BRIDGE_CALLS_PER_ROUTE = 256
export const MAX_CONTEXT_PACK_BRIDGE_CONCURRENT_CALLS = 4

const textDecoder = new TextDecoder("utf-8", { fatal: true })

export interface ContextPackBridgeRoute {
  readonly parentId: SessionId
  readonly childId: SessionId
  readonly parentGeneration: number
  readonly childGeneration: number
  readonly draftRevision: number
  readonly workspaceRoot: string
}

export type ContextPackBridgeDisposalReason =
  | "child_settled"
  | "parent_generation_changed"
  | "launch_denied"
  | "authorization_denied"
  | "route_replaced"
  | "bridge_disposed"

export interface ContextPackBridgeAuthorization {
  readonly route: ContextPackBridgeRoute
  readonly operation: ContextPackMcpOperation
  readonly workspaceRoot: string
  readonly path?: string
  readonly maxBytes?: number
  readonly expectedRevision?: number
}

/** Controller-owned authority. The bridge still validates and re-authorizes every call. */
export interface ContextPackBridgeFacade {
  authorize(input: ContextPackBridgeAuthorization): boolean
  readDraft(route: ContextPackBridgeRoute): DraftContextPack | null
  readWorkspace(
    route: ContextPackBridgeRoute,
    workspaceRoot: string,
    request: ContextPackWorkspaceRead,
    limits: ContextPackWorkspaceReadLimits,
  ): Promise<ContextPackReadWorkspaceResult>
  mutateDraft(
    route: ContextPackBridgeRoute,
    input: RevisionFencedContextPackMutation,
  ): ContextPackMutationResult | null
  askUser(route: ContextPackBridgeRoute, form: ClarificationPayload): Promise<ClarificationOutcome>
  dispose?(route: ContextPackBridgeRoute, reason: ContextPackBridgeDisposalReason): void
}

export interface ContextPackBridgeRegistration {
  readonly route: ContextPackBridgeRoute
  readonly facade: ContextPackBridgeFacade
}

export interface ContextPackBridge {
  register(input: ContextPackBridgeRegistration): McpServerConfig
  revoke(route: ContextPackBridgeRoute, reason: Extract<
    ContextPackBridgeDisposalReason,
    "child_settled" | "parent_generation_changed" | "launch_denied"
  >): void
  dispose(): Promise<void>
}

export interface ContextPackBridgeEndpoint {
  readonly endpoint: string
  readonly directory?: string
}

export interface ContextPackBridgeSocket {
  write(data: string): number
  end(): void
}

export interface ContextPackBridgeListener {
  stop(closeActiveConnections?: boolean): void
  unref?(): void
}

export interface ContextPackBridgeListenerHandlers {
  open(socket: ContextPackBridgeSocket): void
  data(socket: ContextPackBridgeSocket, data: Uint8Array): void
  close(socket: ContextPackBridgeSocket): void
  error(socket: ContextPackBridgeSocket): void
}

export type ContextPackBridgeFailureReason =
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

export interface CreateContextPackBridgeOptions {
  readonly executablePath: string
  readonly executableArgs?: readonly string[]
  readonly platform?: NodeJS.Platform
  readonly createEndpoint?: (platform: NodeJS.Platform) => ContextPackBridgeEndpoint
  readonly listen?: (
    endpoint: string,
    handlers: ContextPackBridgeListenerHandlers,
  ) => ContextPackBridgeListener
  readonly newCapability?: () => string
  readonly onFailure?: (reason: ContextPackBridgeFailureReason) => void
}

interface ConnectionState {
  buffer: Uint8Array
  route: RouteState | null
  closed: boolean
}

interface RouteState {
  readonly binding: ContextPackBridgeRoute
  readonly facade: ContextPackBridgeFacade
  readonly capability: string
  readonly endpoint: ContextPackBridgeEndpoint
  readonly listener: ContextPackBridgeListener
  readonly callIds: Set<string>
  readonly pending: Set<string>
  readonly sockets: Set<ContextPackBridgeSocket>
  totalCalls: number
  closing: boolean
}

export class ContextPackBridgeError extends Error {
  constructor(readonly code: "registration_failed" | "unavailable" | "invalid_request" | "busy" | "authorization_denied") {
    super(`context pack bridge ${code}`)
    this.name = "ContextPackBridgeError"
  }
}

export function createContextPackBridge(options: CreateContextPackBridgeOptions): ContextPackBridge {
  const platform = options.platform ?? process.platform
  const createEndpoint = options.createEndpoint ?? createPrivateEndpoint
  const listen = options.listen ?? listenOnLocalEndpoint
  const newCapability = options.newCapability ?? (() => randomBytes(32).toString("base64url"))
  const onFailure = options.onFailure ?? (() => {})
  const routesByCapability = new Map<string, RouteState>()
  const routesByIdentity = new Map<string, RouteState>()
  const connections = new Map<ContextPackBridgeSocket, ConnectionState>()
  let disposed = false

  const report = (reason: ContextPackBridgeFailureReason): void => onFailure(reason)

  function removeEndpoint(endpoint: ContextPackBridgeEndpoint): void {
    if (!endpoint.directory) return
    try {
      rmSync(endpoint.directory, { recursive: true, force: true })
    } catch {
      report("connection_io_error")
    }
  }

  function closeRoute(route: RouteState, reason: ContextPackBridgeDisposalReason): void {
    if (route.closing) return
    route.closing = true
    routesByCapability.delete(route.capability)
    const identity = routeIdentity(route.binding)
    if (routesByIdentity.get(identity) === route) routesByIdentity.delete(identity)
    try {
      route.facade.dispose?.(route.binding, reason)
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
    for (const socket of route.sockets) {
      const state = connections.get(socket)
      if (state) closeConnection(socket, state)
      else socket.end()
    }
    route.sockets.clear()
    route.pending.clear()
  }

  function closeConnection(
    socket: ContextPackBridgeSocket,
    state: ConnectionState,
    reason?: ContextPackBridgeFailureReason,
  ): void {
    if (state.closed) return
    state.closed = true
    if (reason) report(reason)
    if (state.route) state.route.sockets.delete(socket)
    state.route = null
    connections.delete(socket)
    socket.end()
  }

  function send(socket: ContextPackBridgeSocket, frame: Record<string, unknown>): void {
    socket.write(`${JSON.stringify(frame)}\n`)
  }

  function rejectConnection(
    socket: ContextPackBridgeSocket,
    state: ConnectionState,
    reason: ContextPackBridgeFailureReason,
    error: "invalid_request" | "unavailable" | "busy",
    callId?: string,
  ): void {
    send(socket, callId ? { kind: "error", callId, error } : { kind: "error", error })
    closeConnection(socket, state, reason)
  }

  function reserveCall(route: RouteState, callId: string): "ok" | "duplicate" | "busy" | "limit" {
    if (route.callIds.has(callId)) return "duplicate"
    if (route.pending.size >= MAX_CONTEXT_PACK_BRIDGE_CONCURRENT_CALLS) return "busy"
    if (route.totalCalls >= MAX_CONTEXT_PACK_BRIDGE_CALLS_PER_ROUTE) return "limit"
    route.callIds.add(callId)
    route.pending.add(callId)
    route.totalCalls += 1
    return "ok"
  }

  function authorize(
    route: RouteState,
    input: Omit<ContextPackBridgeAuthorization, "route" | "workspaceRoot">,
  ): boolean {
    if (route.closing) return false
    try {
      const authorized = route.facade.authorize({
        route: route.binding,
        workspaceRoot: route.binding.workspaceRoot,
        ...input,
      })
      return authorized
    } catch {
      report("connection_request_failed")
      return false
    }
  }

  async function dispatch(route: RouteState, frame: ContextPackMcpFrame): Promise<unknown> {
    switch (frame.request.operation) {
      case "read_draft": {
        if (!authorize(route, { operation: "read_draft" })) throw new ContextPackBridgeError("authorization_denied")
        const draft = route.facade.readDraft(route.binding)
        if (!draft || !authorize(route, { operation: "read_draft" })) {
          throw new ContextPackBridgeError("authorization_denied")
        }
        return serializeContextPackDraft(draft)
      }
      case "read_workspace": {
        const parsed = contextPackReadWorkspaceInputSchema.safeParse(frame.request.input)
        if (!parsed.success) throw new ContextPackBridgeError("invalid_request")
        const { request, maxBytes } = normalizeContextPackWorkspaceRead(parsed.data)
        const authorization = {
          operation: "read_workspace" as const,
          path: request.path,
          maxBytes,
        }
        if (!authorize(route, authorization)) throw new ContextPackBridgeError("authorization_denied")
        const result = await route.facade.readWorkspace(
          route.binding,
          route.binding.workspaceRoot,
          request,
          { maxArtifactBytes: maxBytes, maxTotalBytes: maxBytes },
        )
        if (!authorize(route, authorization)) throw new ContextPackBridgeError("authorization_denied")
        if (!validWorkspaceResult(request, maxBytes, result)) {
          throw new ContextPackBridgeError("unavailable")
        }
        return contextPackReadWorkspaceOutputSchema.parse({ result })
      }
      case "mutate_draft": {
        const parsed = contextPackMutateDraftInputSchema.safeParse(frame.request.input)
        if (!parsed.success) throw new ContextPackBridgeError("invalid_request")
        const input = normalizeContextPackMutation(parsed.data)
        const authorization = {
          operation: "mutate_draft" as const,
          expectedRevision: input.readRevision,
        }
        if (!authorize(route, authorization)) throw new ContextPackBridgeError("authorization_denied")
        const current = route.facade.readDraft(route.binding)
        if (!current) throw new ContextPackBridgeError("unavailable")
        if (current.revision !== input.readRevision) {
          return serializeContextPackMutationResult({
            kind: "stale",
            readRevision: input.readRevision,
            currentRevision: current.revision,
          })
        }
        const result = route.facade.mutateDraft(route.binding, input)
        if (!result) throw new ContextPackBridgeError("unavailable")
        return serializeContextPackMutationResult(result)
      }
      case "ask_user": {
        if (!authorize(route, { operation: "ask_user" })) throw new ContextPackBridgeError("authorization_denied")
        const outcome = await route.facade.askUser(route.binding, frame.request.input)
        if (!isClarificationOutcome(outcome) || !authorize(route, { operation: "ask_user" })) {
          throw new ContextPackBridgeError("authorization_denied")
        }
        return outcome
      }
    }
  }

  function acceptFrame(socket: ContextPackBridgeSocket, state: ConnectionState, raw: Uint8Array): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(textDecoder.decode(raw))
    } catch {
      rejectConnection(socket, state, "connection_malformed_frame", "invalid_request")
      return
    }
    if (!isContextPackMcpFrame(parsed)) {
      rejectConnection(socket, state, "connection_invalid_request", "invalid_request", safeCallId(parsed))
      return
    }
    const route = routesByCapability.get(parsed.capability)
    if (!route || route.closing || (state.route && state.route !== route)) {
      rejectConnection(socket, state, "connection_unauthorized", "unavailable", parsed.callId)
      return
    }
    state.route = route
    route.sockets.add(socket)
    const reservation = reserveCall(route, parsed.callId)
    if (reservation !== "ok") {
      const reason = reservation === "duplicate"
        ? "connection_duplicate_call_id"
        : reservation === "busy"
          ? "connection_concurrency_limit"
          : "connection_call_limit"
      send(socket, {
        kind: "error",
        callId: parsed.callId,
        error: reservation === "duplicate" ? "invalid_request" : "busy",
      })
      report(reason)
      return
    }

    void dispatch(route, parsed).then(
      (result) => {
        route.pending.delete(parsed.callId)
        if (canSend(route, socket)) {
          send(socket, {
            kind: "context_pack_result",
            callId: parsed.callId,
            operation: parsed.request.operation,
            result,
          })
        }
      },
      (cause) => {
        route.pending.delete(parsed.callId)
        const error = cause instanceof ContextPackBridgeError && cause.code === "busy" ? "busy" : "unavailable"
        const authorizationDenied = cause instanceof ContextPackBridgeError && cause.code === "authorization_denied"
        report(error === "busy" ? "connection_concurrency_limit" : "connection_request_failed")
        if (canSend(route, socket)) send(socket, { kind: "error", callId: parsed.callId, error })
        if (authorizationDenied) closeRoute(route, "authorization_denied")
      },
    )
  }

  function canSend(route: RouteState, socket: ContextPackBridgeSocket): boolean {
    const state = connections.get(socket)
    return !route.closing && state !== undefined && !state.closed
  }

  function onData(socket: ContextPackBridgeSocket, chunk: Uint8Array): void {
    const state = connections.get(socket)
    if (!state || state.closed) return
    let offset = 0
    while (!state.closed) {
      const newline = chunk.indexOf(10, offset)
      if (newline < 0) break
      const segment = chunk.subarray(offset, newline)
      if (state.buffer.byteLength + segment.byteLength > MAX_CONTEXT_PACK_MCP_REQUEST_FRAME_BYTES) {
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
    if (state.buffer.byteLength + remaining.byteLength > MAX_CONTEXT_PACK_MCP_REQUEST_FRAME_BYTES) {
      rejectConnection(socket, state, "connection_frame_too_large", "invalid_request")
      return
    }
    state.buffer = concatBytes(state.buffer, remaining)
  }

  const handlers: ContextPackBridgeListenerHandlers = {
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
      if (disposed || !validRoute(input.route)) {
        safeDispose(input.facade, input.route, "launch_denied", report)
        throw new ContextPackBridgeError("registration_failed")
      }
      const identity = routeIdentity(input.route)
      const previous = routesByIdentity.get(identity)
      if (previous) closeRoute(previous, "route_replaced")

      let endpoint: ContextPackBridgeEndpoint
      try {
        endpoint = createEndpoint(platform)
      } catch {
        report("registration_endpoint_failed")
        safeDispose(input.facade, input.route, "launch_denied", report)
        throw new ContextPackBridgeError("registration_failed")
      }
      const capability = newCapability()
      if (!isCapability(capability) || routesByCapability.has(capability)) {
        removeEndpoint(endpoint)
        report("registration_capability_failed")
        safeDispose(input.facade, input.route, "launch_denied", report)
        throw new ContextPackBridgeError("registration_failed")
      }

      let listener: ContextPackBridgeListener
      try {
        listener = listen(endpoint.endpoint, handlers)
        listener.unref?.()
      } catch {
        removeEndpoint(endpoint)
        report("registration_listen_failed")
        safeDispose(input.facade, input.route, "launch_denied", report)
        throw new ContextPackBridgeError("registration_failed")
      }
      const route: RouteState = {
        binding: { ...input.route },
        facade: input.facade,
        capability,
        endpoint,
        listener,
        callIds: new Set(),
        pending: new Set(),
        sockets: new Set(),
        totalCalls: 0,
        closing: false,
      }
      routesByCapability.set(capability, route)
      routesByIdentity.set(identity, route)
      return {
        name: CONTEXT_PACK_MCP_SERVER_NAME,
        command: options.executablePath,
        args: [...(options.executableArgs ?? []), CONTEXT_PACK_MCP_MODE_FLAG],
        env: {
          [CONTEXT_PACK_MCP_ENDPOINT_ENV]: endpoint.endpoint,
          [CONTEXT_PACK_MCP_CAPABILITY_ENV]: capability,
        },
      }
    },

    revoke(binding, reason) {
      const route = routesByIdentity.get(routeIdentity(binding))
      if (!route || !sameRoute(route.binding, binding)) return
      closeRoute(route, reason)
    },

    async dispose() {
      if (disposed) return
      disposed = true
      for (const route of [...routesByCapability.values()]) closeRoute(route, "bridge_disposed")
      connections.clear()
    },
  }
}

function createPrivateEndpoint(platform: NodeJS.Platform): ContextPackBridgeEndpoint {
  if (platform === "win32") return { endpoint: `\\\\.\\pipe\\kitten-context-pack-${randomUUID()}` }
  const directory = mkdtempSync(join(tmpdir(), "kitten-context-pack-"))
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
  handlers: ContextPackBridgeListenerHandlers,
): ContextPackBridgeListener {
  return Bun.listen<undefined>({
    unix: endpoint,
    socket: {
      open(socket) { handlers.open(socket) },
      data(socket, data) { handlers.data(socket, data) },
      close(socket) { handlers.close(socket) },
      error(socket) { handlers.error(socket) },
    },
  })
}

function validRoute(route: ContextPackBridgeRoute): boolean {
  return isBoundedId(route.parentId)
    && isBoundedId(route.childId)
    && Number.isSafeInteger(route.parentGeneration)
    && route.parentGeneration >= 0
    && Number.isSafeInteger(route.childGeneration)
    && route.childGeneration >= 0
    && Number.isSafeInteger(route.draftRevision)
    && route.draftRevision >= 0
    && isAbsolute(route.workspaceRoot)
}

function validWorkspaceResult(
  request: ContextPackWorkspaceRead,
  maxBytes: number,
  result: ContextPackReadWorkspaceResult,
): boolean {
  if (result.kind !== "ready") return result.path === request.path
  const actualBytes = Buffer.byteLength(result.artifact.content, "utf8")
  return actualBytes <= maxBytes && result.artifact.source.bytes === actualBytes
}

function isBoundedId(value: string): boolean {
  return value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= 128
}

function routeIdentity(route: ContextPackBridgeRoute): string {
  return JSON.stringify([
    route.parentId,
    route.childId,
    route.parentGeneration,
    route.childGeneration,
    route.draftRevision,
    route.workspaceRoot,
  ])
}

function sameRoute(left: ContextPackBridgeRoute, right: ContextPackBridgeRoute): boolean {
  return routeIdentity(left) === routeIdentity(right)
}

function safeDispose(
  facade: ContextPackBridgeFacade,
  route: ContextPackBridgeRoute,
  reason: ContextPackBridgeDisposalReason,
  report: (reason: ContextPackBridgeFailureReason) => void,
): void {
  try {
    facade.dispose?.(route, reason)
  } catch {
    report("connection_request_failed")
  }
}

function isClarificationOutcome(value: unknown): value is ClarificationOutcome {
  if (!isRecord(value)) return false
  if (value.kind === "skipped" || value.kind === "timed_out" || value.kind === "cancelled") {
    return hasOnlyKeys(value, ["kind"])
  }
  if (value.kind !== "submitted" || !hasOnlyKeys(value, ["kind", "answers"]) || !isRecord(value.answers)) {
    return false
  }
  return Object.values(value.answers).every(isClarificationAnswer)
}

function isClarificationAnswer(value: unknown): value is ClarificationAnswer {
  return isRecord(value)
    && hasOnlyKeys(value, ["selectedOptionIds", "customText"])
    && Array.isArray(value.selectedOptionIds)
    && value.selectedOptionIds.every((entry) => typeof entry === "string")
    && (value.customText === undefined || typeof value.customText === "string")
}

function safeCallId(value: unknown): string | undefined {
  return isRecord(value) && isCallId(value.callId) ? value.callId : undefined
}

function isCapability(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && Buffer.byteLength(value, "utf8") <= 128
}

function isCallId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 128
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right.slice()
  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left)
  combined.set(right, left.byteLength)
  return combined
}
