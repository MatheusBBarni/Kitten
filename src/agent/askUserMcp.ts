import { randomUUID } from "node:crypto"

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { z } from "zod"

import type {
  ClarificationAnswer,
  ClarificationField,
  ClarificationOutcome,
  ClarificationPayload,
} from "../core/types.ts"
import {
  createKittenMcpServer,
  KITTEN_MCP_MODE_FLAG,
  KITTEN_MCP_SERVER_NAME,
  runKittenMcp,
  type KittenMcpToolRegistrar,
} from "./kittenMcp.ts"

export const ASK_USER_MCP_ENDPOINT_ENV = "KITTEN_ASK_USER_ENDPOINT"
export const ASK_USER_MCP_CAPABILITY_ENV = "KITTEN_ASK_USER_CAPABILITY"
export const ASK_USER_MCP_MODE_FLAG = KITTEN_MCP_MODE_FLAG
export const ASK_USER_MCP_SERVER_NAME = KITTEN_MCP_SERVER_NAME
export const ASK_USER_MCP_TOOL_NAME = "ask_user"

/** MCP server metadata describing the structured interaction contract. */
export const ASK_USER_MCP_INSTRUCTIONS =
  "Use the ask_user tool whenever you need input from the supervising user to continue. Do not present questions or answer choices as plain assistant text; call ask_user with the structured question, then wait for its outcome before continuing. Kitten always gives the supervising user a free-form input on the final field. This includes workflows and skills that require an interactive question tool."

/**
 * Adapter-only guidance prepended to a prompt when this server is attached. It never
 * enters Kitten's transcript, history, persistence, telemetry, or diagnostics.
 */
export const ASK_USER_MCP_HOST_GUIDANCE =
  "<kitten-runtime-instruction>When you need input from the supervising user to continue, you MUST call the ask_user MCP tool. Do not write a question or answer choices in assistant text. Call ask_user with one structured question and wait for its submitted, skipped, timed-out, or cancelled outcome before continuing. Kitten always provides a free-form input on the final field. This applies when a workflow or skill requires an interactive question tool too.</kitten-runtime-instruction>"

export const MAX_ASK_USER_FRAME_BYTES = 64 * 1024
export const MAX_ASK_USER_TEXT_BYTES = 4 * 1024
export const MAX_ASK_USER_FIELDS = 10
export const MAX_ASK_USER_OPTIONS = 20

const GENERIC_INVALID_REQUEST = "invalid_request"
const GENERIC_UNAVAILABLE = "unavailable"
const textDecoder = new TextDecoder("utf-8", { fatal: true })

const boundedText = z.string().refine(
  (value) => Buffer.byteLength(value, "utf8") <= MAX_ASK_USER_TEXT_BYTES,
  GENERIC_INVALID_REQUEST,
)
const requiredText = boundedText.min(1, GENERIC_INVALID_REQUEST)

const optionSchema = z.object({
  id: requiredText,
  label: requiredText,
  description: boundedText.optional(),
}).strict()

const fieldSchema = z.object({
  id: requiredText,
  header: boundedText.optional(),
  question: requiredText,
  context: boundedText.optional(),
  options: z.array(optionSchema).max(MAX_ASK_USER_OPTIONS, GENERIC_INVALID_REQUEST).optional(),
  allows_multiple: z.boolean().optional(),
  allows_custom: z.boolean().optional(),
}).strict().superRefine((field, context) => {
  const optionIds = new Set<string>()
  for (const option of field.options ?? []) {
    if (optionIds.has(option.id)) {
      context.addIssue({ code: "custom", message: GENERIC_INVALID_REQUEST })
      return
    }
    optionIds.add(option.id)
  }
})

/** Published MCP input contract. Unknown keys include caller timeout and session identity. */
export const askUserInputSchema = z.object({
  title: boundedText.optional(),
  context: boundedText.optional(),
  fields: z.array(fieldSchema).min(1, GENERIC_INVALID_REQUEST).max(MAX_ASK_USER_FIELDS, GENERIC_INVALID_REQUEST),
}).strict().superRefine((form, context) => {
  const fieldIds = new Set<string>()
  for (const [index, field] of form.fields.entries()) {
    if (fieldIds.has(field.id)) {
      context.addIssue({ code: "custom", message: GENERIC_INVALID_REQUEST })
      return
    }
    fieldIds.add(field.id)
    // The only free-form field is the final one. Earlier fields must provide
    // choices so callers cannot create an interior text input.
    if (index < form.fields.length - 1 && (field.options ?? []).length === 0) {
      context.addIssue({ code: "custom", message: GENERIC_INVALID_REQUEST })
      return
    }
  }
})

export type AskUserMcpInput = z.infer<typeof askUserInputSchema>

export interface AskUserMcpSerializedAnswer {
  readonly selected_option_ids: string[]
  readonly custom_text: string | null
  readonly values: string[]
}

export type AskUserMcpSerializedOutcome =
  | { readonly outcome: "submitted"; readonly answers: Record<string, AskUserMcpSerializedAnswer> }
  | { readonly outcome: "skipped" | "timed_out" | "cancelled" }

interface AskFrame {
  readonly kind: "ask"
  readonly callId: string
  readonly capability: string
  readonly form: ClarificationPayload
}

interface ResultFrame {
  readonly kind: "result"
  readonly callId: string
  readonly outcome: ClarificationOutcome
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

export interface AskUserIpcOptions {
  readonly connect?: ConnectIpc
  readonly newCallId?: () => string
}

export interface AskUserMcpServerOptions {
  readonly forward?: (form: ClarificationPayload) => Promise<ClarificationOutcome>
}

export interface RunAskUserMcpOptions extends AskUserMcpServerOptions {
  readonly createTransport?: () => Transport
}

/** Convert the narrow external form into Kitten's protocol-free clarification model. */
export function normalizeAskUserInput(input: AskUserMcpInput): ClarificationPayload {
  const lastFieldIndex = input.fields.length - 1
  const fields = input.fields.map((field, index) => normalizeField(field, index === lastFieldIndex))
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.context === undefined ? {} : { context: input.context }),
    prompt: input.title ?? "Agent input required",
    fields,
  }
}

/** Serialize the closed core vocabulary without exposing bridge or session identity. */
export function serializeAskUserOutcome(outcome: ClarificationOutcome): AskUserMcpSerializedOutcome {
  if (outcome.kind !== "submitted") return { outcome: outcome.kind }
  return {
    outcome: "submitted",
    answers: Object.fromEntries(
      Object.entries(outcome.answers).map(([fieldId, answer]) => [fieldId, serializeAnswer(answer)]),
    ),
  }
}

/** Send one authenticated, bounded JSONL request to the owning controller bridge. */
export async function forwardAskUserToBridge(
  form: ClarificationPayload,
  env: NodeJS.ProcessEnv,
  options: AskUserIpcOptions = {},
): Promise<ClarificationOutcome> {
  const endpoint = env[ASK_USER_MCP_ENDPOINT_ENV]
  const capability = env[ASK_USER_MCP_CAPABILITY_ENV]
  if (!endpoint || !isCapability(capability)) throw new Error(GENERIC_UNAVAILABLE)

  const callId = (options.newCallId ?? randomUUID)()
  if (!isCallId(callId)) throw new Error(GENERIC_UNAVAILABLE)
  const frame: AskFrame = { kind: "ask", callId, capability, form }
  const serialized = `${JSON.stringify(frame)}\n`
  if (Buffer.byteLength(serialized, "utf8") > MAX_ASK_USER_FRAME_BYTES) {
    throw new Error(GENERIC_INVALID_REQUEST)
  }

  const connect = options.connect ?? (Bun.connect as unknown as ConnectIpc)
  return new Promise<ClarificationOutcome>((resolve, reject) => {
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
    let settled = false

    const finish = (socket: IpcSocket, result: { outcome: ClarificationOutcome } | { error: string }): void => {
      if (settled) return
      settled = true
      socket.end()
      if ("outcome" in result) resolve(result.outcome)
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
          if (buffer.byteLength + segment.byteLength > MAX_ASK_USER_FRAME_BYTES) {
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
          if (isResultFrame(parsed, callId)) finish(socket, { outcome: parsed.outcome })
          else if (isErrorFrame(parsed, callId)) finish(socket, { error: parsed.error })
          else finish(socket, { error: GENERIC_UNAVAILABLE })
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

/** Create the one-tool server without connecting it, so its contract is testable in memory. */
export function createAskUserMcpServer(
  env: NodeJS.ProcessEnv,
  options: AskUserMcpServerOptions = {},
): ReturnType<typeof createKittenMcpServer> {
  return createKittenMcpServer({
    instructions: ASK_USER_MCP_INSTRUCTIONS,
    registrars: [createAskUserMcpRegistrar(env, options)],
  })
}

/** Create the standalone ask_user registrar used by the bundled child server. */
export function createAskUserMcpRegistrar(
  env: NodeJS.ProcessEnv,
  options: AskUserMcpServerOptions = {},
): KittenMcpToolRegistrar {
  const forward = options.forward ?? ((form) => forwardAskUserToBridge(form, env))
  return (server) => {
    server.registerTool(ASK_USER_MCP_TOOL_NAME, {
      title: "Ask the supervising user",
      description: "Ask the supervising user a structured consequential-decision question in Kitten. The final field includes a free-form input alongside any choices. Use this instead of writing a plain-text question when the user's answer determines the safe next step; wait for its submitted, skipped, timed-out, or cancelled outcome before continuing.",
      inputSchema: askUserInputSchema,
    }, async (input) => {
      const parsed = askUserInputSchema.safeParse(input)
      if (!parsed.success) return toolError(GENERIC_INVALID_REQUEST)
      try {
        const result = serializeAskUserOutcome(await forward(normalizeAskUserInput(parsed.data)))
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        }
      } catch (error) {
        return toolError(isGenericBridgeError(error) ? error.message : GENERIC_UNAVAILABLE)
      }
    })
  }
}

/** Run child mode until its provider-facing stdio transport closes. */
export async function runAskUserMcp(
  env: NodeJS.ProcessEnv = process.env,
  options: RunAskUserMcpOptions = {},
): Promise<void> {
  await runKittenMcp({
    instructions: ASK_USER_MCP_INSTRUCTIONS,
    registrars: [createAskUserMcpRegistrar(env, options)],
    ...(options.createTransport === undefined ? {} : { createTransport: options.createTransport }),
  })
}

function normalizeField(
  field: AskUserMcpInput["fields"][number],
  isFinalField: boolean,
): ClarificationField {
  const label = field.header ?? field.question
  const description = field.header
    ? [field.question, field.context].filter((part): part is string => part !== undefined).join("\n")
    : field.context
  const base = {
    id: field.id,
    label,
    ...(description === undefined ? {} : { description }),
    required: true,
  }
  const options = field.options ?? []
  if (options.length === 0) return { ...base, mode: "text" }
  return {
    ...base,
    mode: field.allows_multiple === true ? "multi" : "single",
    options,
    // Ask User is host-owned: reserve one free-form response at the end of the form
    // so choices in earlier fields stay structured without limiting the final answer.
    allowsCustom: isFinalField,
  }
}

function serializeAnswer(answer: ClarificationAnswer): AskUserMcpSerializedAnswer {
  return {
    selected_option_ids: [...answer.selectedOptionIds],
    custom_text: answer.customText ?? null,
    values: answer.customText === undefined
      ? [...answer.selectedOptionIds]
      : [...answer.selectedOptionIds, answer.customText],
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
      || error.message === "busy")
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

function isAnswer(value: unknown): value is ClarificationAnswer {
  return isRecord(value)
    && hasOnlyKeys(value, ["selectedOptionIds", "customText"])
    && Array.isArray(value.selectedOptionIds)
    && value.selectedOptionIds.every((id) => typeof id === "string")
    && (value.customText === undefined || typeof value.customText === "string")
}

function isOutcome(value: unknown): value is ClarificationOutcome {
  if (!isRecord(value)) return false
  if (value.kind === "skipped" || value.kind === "timed_out" || value.kind === "cancelled") {
    return hasOnlyKeys(value, ["kind"])
  }
  if (value.kind !== "submitted" || !hasOnlyKeys(value, ["kind", "answers"]) || !isRecord(value.answers)) {
    return false
  }
  return Object.values(value.answers).every(isAnswer)
}

function isResultFrame(value: unknown, callId: string): value is ResultFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "callId", "outcome"])
    && value.kind === "result"
    && value.callId === callId
    && isOutcome(value.outcome)
}

function isErrorFrame(value: unknown, callId: string): value is ErrorFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "callId", "error"])
    && value.kind === "error"
    && value.callId === callId
    && (value.error === GENERIC_INVALID_REQUEST || value.error === GENERIC_UNAVAILABLE || value.error === "busy")
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right.slice()
  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left)
  combined.set(right, left.byteLength)
  return combined
}
