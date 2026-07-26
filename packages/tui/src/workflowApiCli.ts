import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_API_MANIFEST_RELATIVE_PATH = ".kitten/workflow-api.json";
const MAX_WORKFLOW_API_FRAME_BYTES = 128 * 1024;

interface WorkflowApiManifest {
  readonly schemaVersion: 1;
  readonly endpoint: string;
  readonly capability: string;
}

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

export interface WorkflowApiCliOptions {
  readonly homePath?: string;
  readonly readManifest?: (path: string) => string;
  readonly connect?: ConnectIpc;
  readonly requestId?: () => string;
  readonly write?: (value: string) => void;
  readonly writeError?: (value: string) => void;
  readonly exit?: (code: number) => void;
}

export function formatWorkflowApiHelp(): string {
  return [
    "Usage: kitten api <action> '<json-input>'",
    "",
    "Queries: get_workspace, get_board, get_catalog",
    "Commands: bind_repository, create_stage, update_stage, delete_stage, assign_stage_skill, connect_stages, reorder_stages, create_card, update_card, set_card_execution_status, move_card, record_agent_success",
    "",
    "Example: kitten api move_card '{\"boardId\":\"board:main\",\"taskId\":\"card:review-ui\",\"targetStageId\":\"stage:ready\"}'",
    "The Kitten desktop app must be running on this machine.",
  ].join("\n");
}

/** Dispatch the local desktop API without booting the interactive terminal UI. */
export async function dispatchWorkflowApiCli(
  argv: readonly string[],
  options: WorkflowApiCliOptions = {},
): Promise<boolean> {
  const apiIndex = argv.indexOf("api");
  if (apiIndex < 0) return false;
  const write = options.write ?? ((value: string) => process.stdout.write(value));
  const writeError = options.writeError ?? ((value: string) => process.stderr.write(value));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const action = argv[apiIndex + 1];
  if (action === undefined || action === "--help" || action === "help") {
    write(`${formatWorkflowApiHelp()}\n`);
    exit(0);
    return true;
  }
  const rawInput = argv[apiIndex + 2] ?? "{}";
  let input: Record<string, unknown>;
  try {
    const value = JSON.parse(rawInput) as unknown;
    if (!isRecord(value)) throw new Error();
    input = value;
  } catch {
    writeError("kitten api: input must be a JSON object\n");
    exit(2);
    return true;
  }

  let manifest: WorkflowApiManifest;
  try {
    const homePath = options.homePath ?? process.env.HOME;
    if (homePath === undefined || homePath.length === 0) throw new Error("home unavailable");
    manifest = parseManifest((options.readManifest ?? ((path) => readFileSync(path, "utf8")))(join(homePath, WORKFLOW_API_MANIFEST_RELATIVE_PATH)));
  } catch {
    writeError("kitten api: the Kitten desktop workflow API is not running\n");
    exit(1);
    return true;
  }

  try {
    const result = await requestWorkflowApi(manifest, action, input, {
      connect: options.connect,
      requestId: options.requestId,
    });
    write(`${JSON.stringify(result)}\n`);
    exit(isSuccessfulResult(result) ? 0 : 1);
  } catch (error) {
    writeError(`kitten api: ${error instanceof Error ? error.message : "request failed"}\n`);
    exit(1);
  }
  return true;
}

export async function requestWorkflowApi(
  manifest: WorkflowApiManifest,
  action: string,
  input: Record<string, unknown>,
  options: Pick<WorkflowApiCliOptions, "connect" | "requestId"> = {},
): Promise<unknown> {
  const requestId = options.requestId?.() ?? `workflow-api-cli:${crypto.randomUUID()}`;
  const serialized = `${JSON.stringify({ requestId, capability: manifest.capability, action, input })}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_WORKFLOW_API_FRAME_BYTES) throw new Error("request too large");
  const connect = options.connect ?? (Bun.connect as unknown as ConnectIpc);

  return new Promise<unknown>((resolve, reject) => {
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let settled = false;
    const finish = (socket: IpcSocket, result: { readonly value: unknown } | { readonly error: string }) => {
      if (settled) return;
      settled = true;
      socket.end();
      if ("value" in result) resolve(result.value);
      else reject(new Error(result.error));
    };
    void connect({
      unix: manifest.endpoint,
      socket: {
        open(socket) {
          socket.write(serialized);
        },
        data(socket, data) {
          if (settled) return;
          const newline = data.indexOf(10);
          const segment = newline < 0 ? data : data.subarray(0, newline);
          buffer = concatBytes(buffer, segment);
          if (buffer.byteLength > MAX_WORKFLOW_API_FRAME_BYTES) {
            finish(socket, { error: "response too large" });
            return;
          }
          if (newline < 0) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
          } catch {
            finish(socket, { error: "invalid host response" });
            return;
          }
          if (!isRecord(parsed) || parsed.requestId !== requestId) {
            finish(socket, { error: "invalid host response" });
            return;
          }
          if (parsed.kind === "error" && typeof parsed.error === "string") {
            finish(socket, { error: parsed.error });
            return;
          }
          if (parsed.kind !== "result" || !("result" in parsed)) {
            finish(socket, { error: "invalid host response" });
            return;
          }
          finish(socket, { value: parsed.result });
        },
        close(socket) {
          finish(socket, { error: "desktop workflow API disconnected" });
        },
        error(socket) {
          finish(socket, { error: "desktop workflow API unavailable" });
        },
        connectError(socket) {
          finish(socket, { error: "desktop workflow API unavailable" });
        },
      },
    }).catch(() => {
      if (settled) return;
      settled = true;
      reject(new Error("desktop workflow API unavailable"));
    });
  });
}

function parseManifest(value: string): WorkflowApiManifest {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.endpoint !== "string" || parsed.endpoint.length === 0) {
    throw new Error("invalid manifest");
  }
  if (typeof parsed.capability !== "string" || parsed.capability.length < 32) throw new Error("invalid manifest");
  return { schemaVersion: 1, endpoint: parsed.endpoint, capability: parsed.capability };
}

function isSuccessfulResult(value: unknown): boolean {
  if (!isRecord(value)) return true;
  if (value.kind !== "workflow_command_result" || !isRecord(value.result)) return true;
  return value.result.status === "ok";
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right.slice();
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
