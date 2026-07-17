import { randomUUID } from "node:crypto"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { z } from "zod"

import type {
  ClarificationOutcome,
  ClarificationPayload,
  ContextPackMutationResult,
  DraftContextPack,
  RevisionFencedContextPackMutation,
} from "../core/types.ts"
import { KITTEN_VERSION } from "../version.ts"
import {
  createAskUserMcpRegistrar,
  MAX_ASK_USER_FIELDS,
  MAX_ASK_USER_OPTIONS,
  MAX_ASK_USER_TEXT_BYTES,
} from "./askUserMcp.ts"
import type { KittenMcpToolRegistrar } from "./kittenMcp.ts"

export const CONTEXT_PACK_MCP_MODE_FLAG = "--context-pack-mcp"
export const CONTEXT_PACK_MCP_SERVER_NAME = "kitten-context-pack"
export const CONTEXT_PACK_MCP_ENDPOINT_ENV = "KITTEN_CONTEXT_PACK_ENDPOINT"
export const CONTEXT_PACK_MCP_CAPABILITY_ENV = "KITTEN_CONTEXT_PACK_CAPABILITY"
export const CONTEXT_PACK_READ_DRAFT_TOOL_NAME = "context_pack.read_draft"
export const CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME = "context_pack.read_workspace"
export const CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME = "context_pack.mutate_draft"

export const CONTEXT_PACK_MCP_INSTRUCTIONS =
  "Curate only the bound Context Pack draft. Use bounded Context Pack reads and revision-fenced draft mutations; ask the supervising user when a consequential choice is required. Do not implement, seal, deliver, export, approve, control agents, use shell or general Git, or access external MCP services."

export const MAX_CONTEXT_PACK_MCP_REQUEST_FRAME_BYTES = 64 * 1024
export const MAX_CONTEXT_PACK_MCP_RESULT_FRAME_BYTES = 1024 * 1024 + 128 * 1024
export const MAX_CONTEXT_PACK_MCP_ARTIFACT_BYTES = 1024 * 1024
export const MAX_CONTEXT_PACK_MCP_DRAFT_BYTES = 256 * 1024
export const MAX_CONTEXT_PACK_MCP_SELECTIONS = 256
export const MAX_CONTEXT_PACK_MCP_TEXT_BYTES = 16 * 1024
export const MAX_CONTEXT_PACK_MCP_PATH_BYTES = 4 * 1024

const GENERIC_INVALID_REQUEST = "invalid_request"
const GENERIC_UNAVAILABLE = "unavailable"
const textDecoder = new TextDecoder("utf-8", { fatal: true })

const nonnegativeInteger = z.number().int().min(0)
const positiveInteger = z.number().int().min(1)
const boundedText = z.string().refine(
  (value) => Buffer.byteLength(value, "utf8") <= MAX_CONTEXT_PACK_MCP_TEXT_BYTES,
  GENERIC_INVALID_REQUEST,
)
const requiredBoundedText = boundedText.refine((value) => value.trim().length > 0, GENERIC_INVALID_REQUEST)
const boundedPath = z.string().refine(
  (value) => isSafeWorkspaceRelativePath(value)
    && Buffer.byteLength(value, "utf8") <= MAX_CONTEXT_PACK_MCP_PATH_BYTES,
  GENERIC_INVALID_REQUEST,
)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)

const sourceReferenceSchema = z.object({
  identity: requiredBoundedText,
  digest,
  bytes: nonnegativeInteger,
}).strict()

const selectionBase = {
  path: boundedPath,
  source: sourceReferenceSchema,
  rationale: boundedText,
  relationship: boundedText,
}

const fullFileSelectionSchema = z.object({
  kind: z.literal("full_file"),
  ...selectionBase,
}).strict()
const fileSliceSelectionSchema = z.object({
  kind: z.literal("file_slice"),
  ...selectionBase,
  range: z.object({
    startLine: positiveInteger,
    endLine: positiveInteger,
  }).strict().refine((range) => range.endLine >= range.startLine, GENERIC_INVALID_REQUEST),
}).strict()
const diffSelectionSchema = z.object({
  kind: z.literal("diff"),
  ...selectionBase,
  scope: z.enum(["staged", "unstaged", "pending"]),
}).strict()
export const contextPackSelectionSchema = z.discriminatedUnion("kind", [
  fullFileSelectionSchema,
  fileSliceSelectionSchema,
  diffSelectionSchema,
])

const contextBriefSchema = z.object({
  architecture: boundedText,
  selectedContext: boundedText,
  relationships: boundedText,
  ambiguities: boundedText,
  budgetOmissions: boundedText,
}).strict()

const draftSchema = z.object({
  revision: nonnegativeInteger,
  instructions: z.object({
    original: boundedText,
    mode: z.enum(["preserve", "augment", "rewrite"]),
    discovered: boundedText,
  }).strict(),
  budget: z.object({
    unit: z.literal("estimated_tokens"),
    limit: positiveInteger,
  }).strict(),
  brief: contextBriefSchema,
  selections: z.array(contextPackSelectionSchema).max(MAX_CONTEXT_PACK_MCP_SELECTIONS),
  stale: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("fresh") }).strict(),
    z.object({ kind: z.literal("needs_revalidation") }).strict(),
    z.object({
      kind: z.literal("stale"),
      reason: z.enum([
        "source_changed",
        "source_missing",
        "outside_workspace",
        "ineligible_source",
        "oversized_source",
      ]),
    }).strict(),
  ]),
}).strict()

export const contextPackReadDraftInputSchema = z.object({}).strict()

export const contextPackReadWorkspaceInputSchema = z.object({
  kind: z.enum(["full_file", "file_slice", "diff"]),
  path: boundedPath,
  max_bytes: positiveInteger.max(MAX_CONTEXT_PACK_MCP_ARTIFACT_BYTES),
  range: z.object({
    start_line: positiveInteger,
    end_line: positiveInteger,
  }).strict().optional(),
  scope: z.enum(["staged", "unstaged"]).optional(),
}).strict().superRefine((input, context) => {
  if (input.kind === "full_file" && (input.range !== undefined || input.scope !== undefined)) {
    context.addIssue({ code: "custom", message: GENERIC_INVALID_REQUEST })
  } else if (
    input.kind === "file_slice" &&
    (input.range === undefined || input.scope !== undefined || input.range.end_line < input.range.start_line)
  ) {
    context.addIssue({ code: "custom", message: GENERIC_INVALID_REQUEST })
  } else if (input.kind === "diff" && (input.scope === undefined || input.range !== undefined)) {
    context.addIssue({ code: "custom", message: GENERIC_INVALID_REQUEST })
  }
})

const mutationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set_discovered_instructions"),
    discovered: boundedText,
  }).strict(),
  z.object({
    kind: z.literal("set_brief_section"),
    section: z.enum([
      "architecture",
      "selectedContext",
      "relationships",
      "ambiguities",
      "budgetOmissions",
    ]),
    text: boundedText,
  }).strict(),
  z.object({
    kind: z.literal("upsert_selection"),
    selection: contextPackSelectionSchema,
  }).strict(),
  z.object({
    kind: z.literal("remove_selection"),
    selectionKey: requiredBoundedText,
  }).strict(),
])

export const contextPackMutateDraftInputSchema = z.object({
  expected_revision: nonnegativeInteger,
  mutation: mutationSchema,
}).strict()

const materializationBlockedReasonSchema = z.enum([
  "invalid_workspace",
  "invalid_limits",
  "invalid_path",
  "source_missing",
  "outside_workspace",
  "ineligible_source",
  "binary_source",
  "malformed_source",
  "invalid_range",
  "unsupported_diff_scope",
  "oversized_artifact",
  "total_bytes_exceeded",
  "diff_failed",
])
const materializationStaleReasonSchema = z.enum([
  "source_changed_during_read",
  "source_identity_changed",
  "source_digest_changed",
  "source_bytes_changed",
])

export const contextPackReadDraftOutputSchema = z.object({ draft: draftSchema }).strict()
export const contextPackReadWorkspaceOutputSchema = z.object({
  result: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("ready"),
      artifact: z.object({
        source: sourceReferenceSchema,
        content: z.string().refine(
          (value) => Buffer.byteLength(value, "utf8") <= MAX_CONTEXT_PACK_MCP_ARTIFACT_BYTES,
          GENERIC_INVALID_REQUEST,
        ),
      }).strict(),
    }).strict(),
    z.object({
      kind: z.literal("blocked"),
      reason: materializationBlockedReasonSchema,
      path: boundedPath,
    }).strict(),
    z.object({
      kind: z.literal("stale"),
      reason: materializationStaleReasonSchema,
      path: boundedPath,
    }).strict(),
  ]),
}).strict()

const validationIssueSchema = z.object({
  code: z.enum([
    "invalid_revision",
    "invalid_instructions",
    "invalid_instruction_mode",
    "invalid_discovered_instructions",
    "invalid_budget",
    "invalid_brief",
    "invalid_stale_state",
    "invalid_selection",
    "duplicate_selection",
    "invalid_path",
    "invalid_source_identity",
    "invalid_source_digest",
    "invalid_source_bytes",
    "invalid_rationale",
    "invalid_relationship",
    "invalid_slice_range",
    "invalid_diff_scope",
    "unauthorized_mutation",
    "unsupported_fields",
  ]),
  selection_index: nonnegativeInteger.optional(),
}).strict()

export const contextPackMutateDraftOutputSchema = z.object({
  result: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("applied"), revision: nonnegativeInteger }).strict(),
    z.object({
      kind: z.literal("stale"),
      expected_revision: nonnegativeInteger,
      current_revision: nonnegativeInteger,
    }).strict(),
    z.object({ kind: z.literal("invalid"), issues: z.array(validationIssueSchema) }).strict(),
  ]),
}).strict()

export type ContextPackReadDraftOutput = z.infer<typeof contextPackReadDraftOutputSchema>
export type ContextPackReadWorkspaceInput = z.infer<typeof contextPackReadWorkspaceInputSchema>
export type ContextPackReadWorkspaceOutput = z.infer<typeof contextPackReadWorkspaceOutputSchema>
export type ContextPackReadWorkspaceResult = ContextPackReadWorkspaceOutput["result"]
export type ContextPackMutateDraftInput = z.infer<typeof contextPackMutateDraftInputSchema>
export type ContextPackMutateDraftOutput = z.infer<typeof contextPackMutateDraftOutputSchema>

export type ContextPackWorkspaceRead =
  | { readonly kind: "full_file"; readonly path: string }
  | {
      readonly kind: "file_slice"
      readonly path: string
      readonly range: { readonly startLine: number; readonly endLine: number }
    }
  | {
      readonly kind: "diff"
      readonly path: string
      readonly scope: "staged" | "unstaged"
    }

export interface ContextPackWorkspaceReadLimits {
  readonly maxArtifactBytes: number
  readonly maxTotalBytes: number
}

export type ContextPackMcpOperation = "read_draft" | "read_workspace" | "mutate_draft" | "ask_user"

export type ContextPackMcpRequest =
  | { readonly operation: "read_draft"; readonly input: Record<string, never> }
  | { readonly operation: "read_workspace"; readonly input: ContextPackReadWorkspaceInput }
  | { readonly operation: "mutate_draft"; readonly input: ContextPackMutateDraftInput }
  | { readonly operation: "ask_user"; readonly input: ClarificationPayload }

export interface ContextPackMcpFrame {
  readonly kind: "context_pack"
  readonly callId: string
  readonly capability: string
  readonly request: ContextPackMcpRequest
}

export interface ContextPackMcpResultFrame {
  readonly kind: "context_pack_result"
  readonly callId: string
  readonly operation: ContextPackMcpOperation
  readonly result: unknown
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

type ConnectIpc = (options: { unix: string; socket: IpcSocketHandlers }) => Promise<IpcSocket>

export interface ContextPackMcpIpcOptions {
  readonly connect?: ConnectIpc
  readonly newCallId?: () => string
}

export interface ContextPackMcpRegistrarOptions {
  readonly forward?: (request: Exclude<ContextPackMcpRequest, { operation: "ask_user" }>) => Promise<unknown>
}

export interface ContextPackMcpServerOptions extends ContextPackMcpRegistrarOptions {
  readonly askUser?: (form: ClarificationPayload) => Promise<ClarificationOutcome>
}

export interface RunContextPackMcpOptions extends ContextPackMcpServerOptions {
  readonly createTransport?: () => Transport
}

export function normalizeContextPackWorkspaceRead(input: ContextPackReadWorkspaceInput): {
  readonly request: ContextPackWorkspaceRead
  readonly maxBytes: number
} {
  if (input.kind === "full_file") {
    return { request: { kind: input.kind, path: input.path }, maxBytes: input.max_bytes }
  }
  if (input.kind === "file_slice") {
    return {
      request: {
        kind: input.kind,
        path: input.path,
        range: { startLine: input.range!.start_line, endLine: input.range!.end_line },
      },
      maxBytes: input.max_bytes,
    }
  }
  return {
    request: { kind: input.kind, path: input.path, scope: input.scope! },
    maxBytes: input.max_bytes,
  }
}

export function normalizeContextPackMutation(input: ContextPackMutateDraftInput): RevisionFencedContextPackMutation {
  return { readRevision: input.expected_revision, mutation: input.mutation }
}

export function serializeContextPackDraft(draft: DraftContextPack): ContextPackReadDraftOutput {
  const serialized = contextPackReadDraftOutputSchema.parse({ draft })
  if (Buffer.byteLength(JSON.stringify(serialized), "utf8") > MAX_CONTEXT_PACK_MCP_DRAFT_BYTES) {
    throw new Error(GENERIC_UNAVAILABLE)
  }
  return serialized
}

export function serializeContextPackMutationResult(result: ContextPackMutationResult): ContextPackMutateDraftOutput {
  if (result.kind === "applied") {
    return { result: { kind: "applied", revision: result.draft.revision } }
  }
  if (result.kind === "stale") {
    return {
      result: {
        kind: "stale",
        expected_revision: result.readRevision,
        current_revision: result.currentRevision,
      },
    }
  }
  return {
    result: {
      kind: "invalid",
      issues: result.issues.map((issue) => ({
        code: issue.code,
        ...(issue.selectionIndex === undefined ? {} : { selection_index: issue.selectionIndex }),
      })),
    },
  }
}

export function createContextPackMcpRegistrar(
  env: NodeJS.ProcessEnv,
  options: ContextPackMcpRegistrarOptions = {},
): KittenMcpToolRegistrar {
  const forward = options.forward ?? ((request) => forwardContextPackMcpRequest(request, env))
  return (server) => {
    registerTool(server, CONTEXT_PACK_READ_DRAFT_TOOL_NAME, contextPackReadDraftInputSchema, contextPackReadDraftOutputSchema, async () => {
      const result = contextPackReadDraftOutputSchema.parse(await forward({ operation: "read_draft", input: {} }))
      return toolSuccess(result)
    })
    registerTool(server, CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME, contextPackReadWorkspaceInputSchema, contextPackReadWorkspaceOutputSchema, async (input) => {
      const parsed = contextPackReadWorkspaceInputSchema.safeParse(input)
      if (!parsed.success) return toolError(GENERIC_INVALID_REQUEST)
      const result = contextPackReadWorkspaceOutputSchema.parse(await forward({ operation: "read_workspace", input: parsed.data }))
      return toolSuccess(result)
    })
    registerTool(server, CONTEXT_PACK_MUTATE_DRAFT_TOOL_NAME, contextPackMutateDraftInputSchema, contextPackMutateDraftOutputSchema, async (input) => {
      const parsed = contextPackMutateDraftInputSchema.safeParse(input)
      if (!parsed.success) return toolError(GENERIC_INVALID_REQUEST)
      const result = contextPackMutateDraftOutputSchema.parse(await forward({ operation: "mutate_draft", input: parsed.data }))
      return toolSuccess(result)
    })
  }
}

/** Compose only scoped ask_user and the three closed Context Pack tools. */
export function createContextPackMcpServer(
  env: NodeJS.ProcessEnv,
  options: ContextPackMcpServerOptions = {},
): McpServer {
  const server = new McpServer(
    { name: CONTEXT_PACK_MCP_SERVER_NAME, version: KITTEN_VERSION },
    { instructions: CONTEXT_PACK_MCP_INSTRUCTIONS },
  )
  const askUser = options.askUser ?? ((form) => forwardContextPackAskUser(form, env))
  const registrars: readonly KittenMcpToolRegistrar[] = [
    createAskUserMcpRegistrar({}, { forward: askUser }),
    createContextPackMcpRegistrar(env, options),
  ]
  for (const registrar of registrars) registrar(server)
  return server
}

export async function runContextPackMcp(
  env: NodeJS.ProcessEnv = process.env,
  options: RunContextPackMcpOptions = {},
): Promise<void> {
  const server = createContextPackMcpServer(env, options)
  const transport = options.createTransport?.() ?? new StdioServerTransport()
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve
  })
  await server.connect(transport)
  await closed
}

export async function forwardContextPackAskUser(
  form: ClarificationPayload,
  env: NodeJS.ProcessEnv,
  options: ContextPackMcpIpcOptions = {},
): Promise<ClarificationOutcome> {
  return await forwardContextPackMcpRequest({ operation: "ask_user", input: form }, env, options) as ClarificationOutcome
}

export async function forwardContextPackMcpRequest(
  request: ContextPackMcpRequest,
  env: NodeJS.ProcessEnv,
  options: ContextPackMcpIpcOptions = {},
): Promise<unknown> {
  const endpoint = env[CONTEXT_PACK_MCP_ENDPOINT_ENV]
  const capability = env[CONTEXT_PACK_MCP_CAPABILITY_ENV]
  if (!endpoint || !isCapability(capability)) throw new Error(GENERIC_UNAVAILABLE)

  const callId = (options.newCallId ?? randomUUID)()
  if (!isCallId(callId) || !isContextPackMcpRequest(request)) throw new Error(GENERIC_INVALID_REQUEST)
  const frame: ContextPackMcpFrame = { kind: "context_pack", callId, capability, request }
  const serialized = `${JSON.stringify(frame)}\n`
  if (Buffer.byteLength(serialized, "utf8") > MAX_CONTEXT_PACK_MCP_REQUEST_FRAME_BYTES) {
    throw new Error(GENERIC_INVALID_REQUEST)
  }

  const connect = options.connect ?? (Bun.connect as unknown as ConnectIpc)
  return await new Promise<unknown>((resolve, reject) => {
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
    let settled = false
    const finish = (socket: IpcSocket, value: { result: unknown } | { error: string }): void => {
      if (settled) return
      settled = true
      socket.end()
      if ("result" in value) resolve(value.result)
      else reject(new Error(value.error))
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
          if (buffer.byteLength + segment.byteLength > MAX_CONTEXT_PACK_MCP_RESULT_FRAME_BYTES) {
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
          if (isContextPackMcpResultFrame(parsed, callId, request.operation)) {
            finish(socket, { result: parsed.result })
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

export function isContextPackMcpFrame(value: unknown): value is ContextPackMcpFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "callId", "capability", "request"])
    && value.kind === "context_pack"
    && isCallId(value.callId)
    && isCapability(value.capability)
    && isContextPackMcpRequest(value.request)
}

function isContextPackMcpRequest(value: unknown): value is ContextPackMcpRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ["operation", "input"])) return false
  switch (value.operation) {
    case "read_draft":
      return contextPackReadDraftInputSchema.safeParse(value.input).success
    case "read_workspace":
      return contextPackReadWorkspaceInputSchema.safeParse(value.input).success
    case "mutate_draft":
      return contextPackMutateDraftInputSchema.safeParse(value.input).success
    case "ask_user":
      return isClarificationPayload(value.input)
    default:
      return false
  }
}

function isContextPackMcpResultFrame(
  value: unknown,
  callId: string,
  operation: ContextPackMcpOperation,
): value is ContextPackMcpResultFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "callId", "operation", "result"])
    && value.kind === "context_pack_result"
    && value.callId === callId
    && value.operation === operation
}

function isClarificationPayload(value: unknown): value is ClarificationPayload {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["title", "context", "prompt", "fields"])
    || !boundedOptionalText(value.title)
    || !boundedOptionalText(value.context)
    || !boundedRequiredText(value.prompt)
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

function isClarificationField(value: unknown): value is ClarificationPayload["fields"][number] {
  if (!isRecord(value)) return false
  const baseKeys = ["id", "label", "description", "required", "mode"]
  if (!boundedRequiredText(value.id)
    || !boundedRequiredText(value.label)
    || !boundedOptionalText(value.description)
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

function isClarificationOption(value: unknown): value is { id: string; label: string; description?: string } {
  return isRecord(value)
    && hasOnlyKeys(value, ["id", "label", "description"])
    && boundedRequiredText(value.id)
    && boundedRequiredText(value.label)
    && boundedOptionalText(value.description)
}

function registerTool(
  server: McpServer,
  name: string,
  inputSchema: z.ZodType,
  outputSchema: z.ZodType,
  handler: (input: unknown) => Promise<ReturnType<typeof toolSuccess> | ReturnType<typeof toolError>>,
): void {
  server.registerTool(name, {
    title: name,
    description: name === CONTEXT_PACK_READ_DRAFT_TOOL_NAME
      ? "Read the bounded metadata-only summary of the bound draft."
      : name === CONTEXT_PACK_READ_WORKSPACE_TOOL_NAME
        ? "Read one bounded artifact from the bound Session Workspace."
        : "Apply one closed mutation to the bound draft at the revision you read.",
    inputSchema,
    outputSchema,
  }, async (input) => {
    try {
      return await handler(input)
    } catch (error) {
      return toolError(isGenericBridgeError(error) ? error.message : GENERIC_UNAVAILABLE)
    }
  })
}

function toolSuccess(result: Record<string, unknown>): {
  content: [{ type: "text"; text: string }]
  structuredContent: Record<string, unknown>
} {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  }
}

function toolError(error: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: JSON.stringify({ error }) }], isError: true }
}

function isGenericBridgeError(error: unknown): error is Error {
  return error instanceof Error
    && (error.message === GENERIC_INVALID_REQUEST || error.message === GENERIC_UNAVAILABLE || error.message === "busy")
}

function isErrorFrame(value: unknown, callId: string): value is ErrorFrame {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "callId", "error"])
    && value.kind === "error"
    && value.callId === callId
    && (value.error === "invalid_request" || value.error === "unavailable" || value.error === "busy")
}

function isCapability(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && Buffer.byteLength(value, "utf8") <= 128
}

function isCallId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= 128
}

function boundedOptionalText(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && Buffer.byteLength(value, "utf8") <= MAX_ASK_USER_TEXT_BYTES)
}

function boundedRequiredText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_ASK_USER_TEXT_BYTES
}

function isSafeWorkspaceRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes("\0") || value.includes("\\") || value.startsWith("/")) return false
  const segments = value.split("/")
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
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
