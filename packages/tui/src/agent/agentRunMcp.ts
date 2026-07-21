import { randomUUID } from "node:crypto"

import { z } from "zod"

import {
  ASK_USER_MCP_CAPABILITY_ENV,
  ASK_USER_MCP_ENDPOINT_ENV,
  MAX_ASK_USER_FRAME_BYTES,
} from "./askUserMcp.ts"
import type { KittenMcpToolRegistrar } from "./kittenMcp.ts"

export const AGENT_RUN_MCP_TOOL_NAME = "agent_run"
export const AGENT_RUN_MCP_ENDPOINT_ENV = ASK_USER_MCP_ENDPOINT_ENV
export const AGENT_RUN_MCP_CAPABILITY_ENV = ASK_USER_MCP_CAPABILITY_ENV
export const MAX_AGENT_RUN_CHILDREN = 4
export const MAX_AGENT_RUN_TEXT_BYTES = 4 * 1024
export const MAX_AGENT_RUN_CHILD_ID_BYTES = 128
export const MAX_AGENT_RUN_FRAME_BYTES = MAX_ASK_USER_FRAME_BYTES

const GENERIC_INVALID_REQUEST = "invalid_request"
const GENERIC_UNAVAILABLE = "unavailable"
const GENERIC_BUSY = "busy"
const textDecoder = new TextDecoder("utf-8", { fatal: true })

const requiredBoundedText = z.string().refine(
  (value) => value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= MAX_AGENT_RUN_TEXT_BYTES,
  GENERIC_INVALID_REQUEST,
)

const childIdSchema = z.string().refine(
  (value) => value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= MAX_AGENT_RUN_CHILD_ID_BYTES,
  GENERIC_INVALID_REQUEST,
)

export const agentRunTaskSchema = z.object({
  task: requiredBoundedText,
  desired_outcome: requiredBoundedText,
}).strict()

const startSchema = z.object({
  operation: z.literal("start"),
  tasks: z.array(agentRunTaskSchema)
    .min(1, GENERIC_INVALID_REQUEST)
    .max(MAX_AGENT_RUN_CHILDREN, GENERIC_INVALID_REQUEST),
}).strict().superRefine((request, context) => {
  const entries = new Set<string>()
  for (const task of request.tasks) {
    const identity = JSON.stringify([task.task, task.desired_outcome])
    if (entries.has(identity)) {
      context.addIssue({ code: "custom", message: GENERIC_INVALID_REQUEST })
      return
    }
    entries.add(identity)
  }
})

const pollSchema = z.object({
  operation: z.literal("poll"),
  child_ids: z.array(childIdSchema).min(1, GENERIC_INVALID_REQUEST),
}).strict().superRefine((request, context) => {
  const childIds = new Set<string>()
  for (const childId of request.child_ids) {
    if (childIds.has(childId)) {
      context.addIssue({ code: "custom", message: GENERIC_INVALID_REQUEST })
      return
    }
    childIds.add(childId)
  }
})

/** Public MCP input. The strict operation arms reject every caller-owned identity field. */
export const agentRunInputSchema = z.discriminatedUnion("operation", [startSchema, pollSchema])

const preserveUnknown = z.never().catch(null as never)
const publishedTaskSchema = z.object({
  task: requiredBoundedText.catch(""),
  desired_outcome: requiredBoundedText.catch(""),
}).catchall(preserveUnknown)

// McpServer 1.29 publishes object-shaped Zod schemas correctly but reduces a
// top-level discriminated union to an empty object. This envelope retains the
// published fields and bounds. Field-level fallbacks preserve rejected input
// for the authoritative strict parser, avoiding SDK-owned verbose errors.
export const agentRunToolInputSchema = z.object({
  operation: z.enum(["start", "poll"]).catch("poll"),
  tasks: z.array(publishedTaskSchema.catch({ task: "", desired_outcome: "" } as never))
    .min(1, GENERIC_INVALID_REQUEST)
    .max(MAX_AGENT_RUN_CHILDREN, GENERIC_INVALID_REQUEST)
    .catch([])
    .optional(),
  child_ids: z.array(childIdSchema.catch(""))
    .min(1, GENERIC_INVALID_REQUEST)
    .catch([])
    .optional(),
}).catchall(preserveUnknown)

export type AgentRunRequest = z.infer<typeof agentRunInputSchema>
export type AgentRunTask = z.infer<typeof agentRunTaskSchema>
export type AgentRunStatus =
  | "starting"
  | "running"
  | "needs_input"
  | "finished"
  | "failed"
  | "cancelled"

export interface AgentRunSnapshot {
  readonly child_id: string
  readonly status: AgentRunStatus
  readonly terminal_at?: number
}

export interface AgentRunResult {
  readonly operation: AgentRunRequest["operation"]
  readonly children: readonly AgentRunSnapshot[]
}

export interface AgentRunFrame {
  readonly kind: "agent_run"
  readonly callId: string
  readonly capability: string
  readonly request: AgentRunRequest
}

export interface AgentRunResultFrame {
  readonly kind: "agent_run_result"
  readonly callId: string
  readonly result: AgentRunResult
}

interface ErrorFrame {
  readonly kind: "error"
  readonly callId?: string
  readonly error: "invalid_request" | "unavailable" | "busy"
}

interface IpcSocket {
  write(data: string): number
  end(): void
}

interface IpcSocketHandlers {
  open(socket: IpcSocket): void
  data(socket: IpcSocket, data: Uint8Array): void
  close(socket: IpcSocket): void
  error(socket: IpcSocket): void
  connectError(socket: IpcSocket): void
}

type ConnectIpc = (options: {
  unix: string
  socket: IpcSocketHandlers
}) => Promise<IpcSocket>

export interface AgentRunIpcOptions {
  readonly connect?: ConnectIpc
  readonly newCallId?: () => string
}

export interface AgentRunMcpServerOptions {
  readonly forward?: (request: AgentRunRequest) => Promise<unknown>
}

/** Send one strict operation through the existing authenticated, bounded JSONL route. */
export async function forwardAgentRunToBridge(
  request: AgentRunRequest,
  env: NodeJS.ProcessEnv,
  options: AgentRunIpcOptions = {},
): Promise<AgentRunResult> {
  const endpoint = env[AGENT_RUN_MCP_ENDPOINT_ENV]
  const capability = env[AGENT_RUN_MCP_CAPABILITY_ENV]
  if (!endpoint || !isCapability(capability)) throw new Error(GENERIC_UNAVAILABLE)

  const parsedRequest = agentRunInputSchema.safeParse(request)
  if (!parsedRequest.success) throw new Error(GENERIC_INVALID_REQUEST)

  const callId = (options.newCallId ?? randomUUID)()
  if (!isCallId(callId)) throw new Error(GENERIC_UNAVAILABLE)
  const frame: AgentRunFrame = {
    kind: "agent_run",
    callId,
    capability,
    request: parsedRequest.data,
  }
  const serialized = `${JSON.stringify(frame)}\n`
  if (Buffer.byteLength(serialized, "utf8") > MAX_AGENT_RUN_FRAME_BYTES) {
    throw new Error(GENERIC_INVALID_REQUEST)
  }

  const connect = options.connect ?? (Bun.connect as unknown as ConnectIpc)
  return new Promise<AgentRunResult>((resolve, reject) => {
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
    let settled = false

    const finish = (socket: IpcSocket, result: { value: AgentRunResult } | { error: string }): void => {
      if (settled) return
      settled = true
      socket.end()
      if ("value" in result) resolve(result.value)
      else reject(new Error(result.error))
    }

    void connect({
      unix: endpoint,
      socket: {
        open(socket) {
          socket.write(serialized)
        },
        data(socket, chunk) {
          if (settled) return
          const newline = chunk.indexOf(10)
          const segment = newline < 0 ? chunk : chunk.subarray(0, newline)
          if (buffer.byteLength + segment.byteLength > MAX_AGENT_RUN_FRAME_BYTES) {
            finish(socket, { error: GENERIC_UNAVAILABLE })
            return
          }
          buffer = concatBytes(buffer, segment)
          if (newline < 0) return

          let parsed: unknown
          try {
            parsed = JSON.parse(textDecoder.decode(buffer))
          } catch {
            finish(socket, { error: GENERIC_UNAVAILABLE })
            return
          }

          if (isAgentRunResultFrame(parsed, callId, parsedRequest.data)) {
            finish(socket, { value: parsed.result })
          } else if (isErrorFrame(parsed, callId)) {
            finish(socket, { error: parsed.error })
          } else {
            finish(socket, { error: GENERIC_UNAVAILABLE })
          }
        },
        close(socket) {
          finish(socket, { error: GENERIC_UNAVAILABLE })
        },
        error(socket) {
          finish(socket, { error: GENERIC_UNAVAILABLE })
        },
        connectError(socket) {
          finish(socket, { error: GENERIC_UNAVAILABLE })
        },
      },
    }).catch(() => {
      if (settled) return
      settled = true
      reject(new Error(GENERIC_UNAVAILABLE))
    })
  })
}

/** Register the strict agent_run contract with the bundled Kitten MCP server. */
export function createAgentRunMcpRegistrar(
  env: NodeJS.ProcessEnv,
  options: AgentRunMcpServerOptions = {},
): KittenMcpToolRegistrar {
  const forward = options.forward ?? ((request) => forwardAgentRunToBridge(request, env))
  return (server) => {
    server.registerTool(AGENT_RUN_MCP_TOOL_NAME, {
      title: "Run supervised child tasks",
      description: "Start up to four independent Kitten child tasks or poll explicit owned child IDs. Children remain visible normal conversations and may require supervising-user attention.",
      inputSchema: agentRunToolInputSchema,
    }, async (input) => {
      const parsed = agentRunInputSchema.safeParse(input)
      if (!parsed.success) return toolError(GENERIC_INVALID_REQUEST)
      try {
        const result = serializeAgentRunResult(parsed.data, await forward(parsed.data))
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: {
            operation: result.operation,
            children: result.children.map((snapshot) => ({ ...snapshot })),
          },
        }
      } catch (error) {
        return toolError(isGenericBridgeError(error) ? error.message : GENERIC_UNAVAILABLE)
      }
    })
  }
}

/** Validate and copy a bridge result so only the public snapshot allowlist can escape. */
export function serializeAgentRunResult(request: AgentRunRequest, value: unknown): AgentRunResult {
  if (!isAgentRunResult(value, request)) throw new Error(GENERIC_UNAVAILABLE)
  return {
    operation: value.operation,
    children: value.children.map((snapshot) => ({
      child_id: snapshot.child_id,
      status: snapshot.status,
      ...(snapshot.terminal_at === undefined ? {} : { terminal_at: snapshot.terminal_at }),
    })),
  }
}

function toolError(error: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return {
    content: [{ type: "text", text: JSON.stringify({ error }) }],
    isError: true,
  }
}

function isGenericBridgeError(error: unknown): error is Error {
  return error instanceof Error
    && (error.message === GENERIC_INVALID_REQUEST
      || error.message === GENERIC_UNAVAILABLE
      || error.message === GENERIC_BUSY)
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

function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return value === "starting"
    || value === "running"
    || value === "needs_input"
    || value === "finished"
    || value === "failed"
    || value === "cancelled"
}

function isTerminalStatus(status: AgentRunStatus): boolean {
  return status === "finished" || status === "failed" || status === "cancelled"
}

function isAgentRunSnapshot(value: unknown): value is AgentRunSnapshot {
  if (!isRecord(value) || !hasOnlyKeys(value, ["child_id", "status", "terminal_at"])) return false
  if (!childIdSchema.safeParse(value.child_id).success || !isAgentRunStatus(value.status)) return false
  if (value.terminal_at !== undefined
    && (typeof value.terminal_at !== "number"
      || !Number.isSafeInteger(value.terminal_at)
      || value.terminal_at < 0)) return false
  return isTerminalStatus(value.status) || value.terminal_at === undefined
}

function isAgentRunResult(value: unknown, request: AgentRunRequest): value is AgentRunResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ["operation", "children"])) return false
  if (value.operation !== request.operation || !Array.isArray(value.children)) return false
  if (value.children.length !== (request.operation === "start" ? request.tasks.length : request.child_ids.length)) {
    return false
  }
  if (!value.children.every(isAgentRunSnapshot)) return false

  const childIds = value.children.map((snapshot) => snapshot.child_id)
  if (new Set(childIds).size !== childIds.length) return false
  return request.operation === "start"
    || request.child_ids.every((childId, index) => childIds[index] === childId)
}

function isAgentRunResultFrame(
  value: unknown,
  callId: string,
  request: AgentRunRequest,
): value is AgentRunResultFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "callId", "result"])
    && value.kind === "agent_run_result"
    && value.callId === callId
    && isAgentRunResult(value.result, request)
}

function isErrorFrame(value: unknown, callId: string): value is ErrorFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "callId", "error"])
    && value.kind === "error"
    && value.callId === callId
    && (value.error === GENERIC_INVALID_REQUEST
      || value.error === GENERIC_UNAVAILABLE
      || value.error === GENERIC_BUSY)
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right.slice()
  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left)
  combined.set(right, left.byteLength)
  return combined
}
