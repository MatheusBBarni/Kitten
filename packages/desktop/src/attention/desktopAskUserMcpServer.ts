import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v3";
import type { AttentionAnswer, AttentionField, AttentionForm, AttentionOutcome } from "./contracts.ts";
import { validateAttentionOutcome } from "./contracts.ts";
import { MAX_ATTEMPT_ASK_USER_FRAME_BYTES } from "./attemptAskUserBridge.ts";

export const DESKTOP_ASK_USER_MCP_SERVER_NAME = "kitten-ask-user";
export const DESKTOP_ASK_USER_MCP_TOOL_NAME = "ask_user";
export const DESKTOP_ASK_USER_MCP_MODE_FLAG = "--kitten-desktop-ask-user-mcp";
export const DESKTOP_ASK_USER_ENDPOINT_ENV = "KITTEN_DESKTOP_ASK_USER_ENDPOINT";
export const DESKTOP_ASK_USER_CAPABILITY_ENV = "KITTEN_DESKTOP_ASK_USER_CAPABILITY";

const optionSchema = z.object({
  id: z.string().min(1).max(4_096),
  label: z.string().min(1).max(4_096),
  description: z.string().max(4_096).optional(),
}).strict();

const fieldSchema = z.object({
  id: z.string().min(1).max(4_096),
  header: z.string().max(4_096).optional(),
  question: z.string().min(1).max(4_096),
  context: z.string().max(4_096).optional(),
  options: z.array(optionSchema).max(20).optional(),
  allows_multiple: z.boolean().optional(),
  allows_custom: z.boolean().optional(),
}).strict();

const askUserInputSchema = z.object({
  title: z.string().max(4_096).optional(),
  context: z.string().max(4_096).optional(),
  fields: z.array(fieldSchema).min(1).max(10),
}).strict();
type AskUserInput = z.infer<typeof askUserInputSchema>;

interface IpcSocket {
  write(data: string): number;
  end(): void;
}

interface IpcSocketHandlers {
  open(socket: IpcSocket): void;
  data(socket: IpcSocket, data: Uint8Array): void;
  close(socket: IpcSocket): void;
  error(socket: IpcSocket): void;
  connectError(socket: IpcSocket): void;
}

type ConnectIpc = (options: { readonly unix: string; readonly socket: IpcSocketHandlers }) => Promise<IpcSocket>;

export async function runDesktopAskUserMcp(
  env: NodeJS.ProcessEnv = process.env,
  options: { readonly createTransport?: () => Transport } = {},
): Promise<void> {
  const server = createMcpServer((form) => forwardAskUserToHost(form, env));
  const transport = options.createTransport?.() ?? new StdioServerTransport();
  const closed = new Promise<void>((resolve) => { transport.onclose = resolve; });
  await server.connect(transport);
  await closed;
}

export async function forwardAskUserToHost(
  form: AttentionForm,
  env: NodeJS.ProcessEnv,
  options: { readonly connect?: ConnectIpc; readonly callId?: string } = {},
): Promise<AttentionOutcome> {
  const endpoint = env[DESKTOP_ASK_USER_ENDPOINT_ENV];
  const capability = env[DESKTOP_ASK_USER_CAPABILITY_ENV];
  const callId = options.callId ?? crypto.randomUUID();
  if (endpoint === undefined || capability === undefined || capability.length < 32 || callId.length === 0) {
    throw new Error("unavailable");
  }
  const serialized = `${JSON.stringify({ kind: "ask", callId, capability, form })}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_ATTEMPT_ASK_USER_FRAME_BYTES) throw new Error("invalid_request");
  const connect = options.connect ?? (Bun.connect as unknown as ConnectIpc);

  return new Promise<AttentionOutcome>((resolve, reject) => {
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let settled = false;
    const finish = (socket: IpcSocket, result: { readonly outcome: AttentionOutcome } | { readonly error: string }) => {
      if (settled) return;
      settled = true;
      socket.end();
      if ("outcome" in result) resolve(result.outcome);
      else reject(new Error(result.error));
    };
    void connect({
      unix: endpoint,
      socket: {
        open(socket) { socket.write(serialized); },
        data(socket, data) {
          if (settled) return;
          const newline = data.indexOf(10);
          const segment = newline < 0 ? data : data.subarray(0, newline);
          buffer = concatBytes(buffer, segment);
          if (buffer.byteLength > MAX_ATTEMPT_ASK_USER_FRAME_BYTES) {
            finish(socket, { error: "unavailable" });
            return;
          }
          if (newline < 0) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
          } catch {
            finish(socket, { error: "unavailable" });
            return;
          }
          if (!isRecord(parsed) || parsed.callId !== callId) {
            finish(socket, { error: "unavailable" });
            return;
          }
          if (parsed.kind === "error" && typeof parsed.error === "string") {
            finish(socket, { error: parsed.error });
            return;
          }
          if (parsed.kind !== "result") {
            finish(socket, { error: "unavailable" });
            return;
          }
          try {
            finish(socket, { outcome: validateAttentionOutcome(parsed.outcome) });
          } catch {
            finish(socket, { error: "unavailable" });
          }
        },
        close(socket) { finish(socket, { error: "unavailable" }); },
        error(socket) { finish(socket, { error: "unavailable" }); },
        connectError(socket) { finish(socket, { error: "unavailable" }); },
      },
    }).catch(() => {
      if (settled) return;
      settled = true;
      reject(new Error("unavailable"));
    });
  });
}

function createMcpServer(forward: (form: AttentionForm) => Promise<AttentionOutcome>): Server {
  const server = new Server(
    { name: DESKTOP_ASK_USER_MCP_SERVER_NAME, version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: "Use ask_user whenever operator input is required. Wait for its structured outcome before continuing.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{
      name: DESKTOP_ASK_USER_MCP_TOOL_NAME,
      title: "Ask the supervising user",
      description: "Pause this run and request structured input from the supervising user.",
      inputSchema: {
        type: "object" as const,
        additionalProperties: false,
        required: ["fields"],
        properties: {
          title: { type: "string" as const },
          context: { type: "string" as const },
          fields: { type: "array" as const, minItems: 1, maxItems: 10, items: { type: "object" as const } },
        },
      },
    }],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== DESKTOP_ASK_USER_MCP_TOOL_NAME) throw new Error("Unknown tool");
    const input: AskUserInput = askUserInputSchema.parse(request.params.arguments);
    const outcome = await forward(toAttentionForm(input));
    return { content: [{ type: "text" as const, text: JSON.stringify(serializeOutcome(outcome)) }] };
  });
  return server;
}

function toAttentionForm(input: AskUserInput): AttentionForm {
  return {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.context === undefined ? {} : { context: input.context }),
    prompt: input.title ?? input.context ?? "Agent needs your input",
    fields: input.fields.map(toAttentionField),
  };
}

function toAttentionField(field: AskUserInput["fields"][number]): AttentionField {
  const options = field.options ?? [];
  const label = field.header ?? field.question;
  const description = field.context ?? (field.header === undefined ? undefined : field.question);
  if (options.length === 0) {
    return { id: field.id, label, ...(description === undefined ? {} : { description }), required: true, mode: "text" };
  }
  return {
    id: field.id,
    label,
    ...(description === undefined ? {} : { description }),
    required: true,
    mode: field.allows_multiple === true ? "multi" : "single",
    options,
    allowsCustom: field.allows_custom === true,
  };
}

function serializeOutcome(outcome: AttentionOutcome): unknown {
  if (outcome.kind !== "submitted") return { outcome: outcome.kind };
  return {
    outcome: "submitted",
    answers: Object.fromEntries(Object.entries(outcome.answers).map(([fieldId, answer]) => [fieldId, serializeAnswer(answer)])),
  };
}

function serializeAnswer(answer: AttentionAnswer): unknown {
  return {
    selected_option_ids: answer.selectedOptionIds,
    custom_text: answer.customText ?? null,
    values: [...answer.selectedOptionIds, ...(answer.customText === undefined ? [] : [answer.customText])],
  };
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right.slice();
  const combined = new Uint8Array(left.byteLength + right.byteLength);
  combined.set(left);
  combined.set(right, left.byteLength);
  return combined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
