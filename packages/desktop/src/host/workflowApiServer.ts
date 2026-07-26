import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PersistenceSnapshot } from "../persistence/eventJournal.ts";
import type { WorkflowBoardProjection } from "../shared/rpc.ts";
import type { DesktopBoardRpc } from "./boardRpc.ts";
import {
  workflowIds,
  type ExecutionStatus,
  type WorkflowCommand,
  type WorkflowCommandKind,
} from "../workflow/workflowTypes.ts";

export const WORKFLOW_API_MANIFEST_RELATIVE_PATH = ".kitten/workflow-api.json";
export const MAX_WORKFLOW_API_FRAME_BYTES = 128 * 1024;

type WorkflowApiAction = "get_workspace" | "get_board" | "get_catalog" | WorkflowCommandKind;

interface WorkflowApiManifest {
  readonly schemaVersion: 1;
  readonly endpoint: string;
  readonly capability: string;
}

interface WorkflowApiRequest {
  readonly requestId: string;
  readonly capability: string;
  readonly action: WorkflowApiAction;
  readonly input: Record<string, unknown>;
}

interface LocalSocket {
  write(data: string): number;
  end(): void;
}

interface LocalListener {
  stop(closeActiveConnections?: boolean): void;
  unref?(): void;
}

export interface WorkflowApiServer {
  readonly endpoint: string;
  stop(): void;
}

export function workflowApiManifestPath(homePath: string): string {
  return join(homePath, WORKFLOW_API_MANIFEST_RELATIVE_PATH);
}

/**
 * A local, capability-protected command boundary for Workflow Skills. Keeping
 * mutation ownership in the desktop host means an agent never writes SQLite or
 * races the rendered projection directly.
 */
export function createWorkflowApiServer(options: {
  readonly boardRpc: DesktopBoardRpc;
  readonly getSnapshot: () => PersistenceSnapshot;
  readonly homePath: string;
  readonly onProjectionCommitted?: (projection: WorkflowBoardProjection) => void;
  readonly createCapability?: () => string;
}): WorkflowApiServer {
  const capability = (options.createCapability ?? (() => randomBytes(32).toString("base64url")))();
  const local = createPrivateEndpoint();
  const manifest = workflowApiManifestPath(options.homePath);
  const buffers = new Map<LocalSocket, Uint8Array>();
  let stopped = false;
  let listener: LocalListener | null = null;
  try {
    listener = Bun.listen<undefined>({
      unix: local.endpoint,
      socket: {
        open(socket) {
          buffers.set(socket, new Uint8Array());
        },
        data(socket, data) {
          const current = buffers.get(socket) ?? new Uint8Array();
          const newline = data.indexOf(10);
          const segment = newline < 0 ? data : data.subarray(0, newline);
          const frame = concatBytes(current, segment);
          if (frame.byteLength > MAX_WORKFLOW_API_FRAME_BYTES) {
            writeError(socket, undefined, "request_too_large");
            buffers.delete(socket);
            return;
          }
          buffers.set(socket, frame);
          if (newline < 0) return;
          buffers.delete(socket);
          void handleFrame(frame, socket, capability, options);
        },
        close(socket) {
          buffers.delete(socket);
        },
        error(socket) {
          buffers.delete(socket);
        },
      },
    });
    listener.unref?.();
    writeManifest(manifest, { schemaVersion: 1, endpoint: local.endpoint, capability });
  } catch (error) {
    try {
      listener?.stop(true);
    } finally {
      if (local.directory !== null) rmSync(local.directory, { recursive: true, force: true });
    }
    throw error;
  }

  return {
    endpoint: local.endpoint,
    stop() {
      if (stopped) return;
      stopped = true;
      buffers.clear();
      listener?.stop(true);
      removeManifestIfOwned(manifest, capability);
      if (local.directory !== null) rmSync(local.directory, { recursive: true, force: true });
    },
  };
}

async function handleFrame(
  bytes: Uint8Array,
  socket: LocalSocket,
  capability: string,
  options: Parameters<typeof createWorkflowApiServer>[0],
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    writeError(socket, undefined, "invalid_json");
    return;
  }
  const request = parseRequest(value);
  if (request === null) {
    writeError(socket, requestIdFrom(value), "invalid_request");
    return;
  }
  if (request.capability !== capability) {
    writeError(socket, request.requestId, "unauthorized");
    return;
  }
  try {
    const result = await executeWorkflowApiRequest(request, options);
    socket.write(`${JSON.stringify({ kind: "result", requestId: request.requestId, result })}\n`);
  } catch (error) {
    writeError(socket, request.requestId, error instanceof Error ? error.message : "request_failed");
  } finally {
    socket.end();
  }
}

async function executeWorkflowApiRequest(
  request: WorkflowApiRequest,
  options: Parameters<typeof createWorkflowApiServer>[0],
): Promise<unknown> {
  switch (request.action) {
    case "get_workspace":
      if (options.boardRpc.getWorkspace === undefined) throw new Error("workspace_unavailable");
      return options.boardRpc.getWorkspace({});
    case "get_board":
      return options.boardRpc.getBoard({
        ...(stringOrUndefined(request.input.boardId) === undefined ? {} : { boardId: stringOrUndefined(request.input.boardId) }),
        ...(request.input.mode === "new" ? { mode: "new" as const } : {}),
      });
    case "get_catalog":
      return options.boardRpc.getCatalog({
        ...(stringOrUndefined(request.input.catalogId) === undefined ? {} : { catalogId: stringOrUndefined(request.input.catalogId) }),
      });
    default: {
      const command = workflowCommandForApi(options.getSnapshot(), request.action, request.input);
      const envelope = await options.boardRpc.executeWorkflowCommand({ commandId: request.requestId, command });
      if (envelope.result.status === "ok" && envelope.result.outcome === "committed") {
        options.onProjectionCommitted?.(envelope.result.projection);
      }
      return envelope;
    }
  }
}

/** Build a current-version workflow command from the concise public API input. */
export function workflowCommandForApi(
  snapshot: PersistenceSnapshot,
  action: WorkflowCommandKind,
  input: Record<string, unknown>,
): WorkflowCommand {
  const mutationId = workflowIds.mutation(stringOrUndefined(input.mutationId) ?? `workflow-api:${crypto.randomUUID()}`);
  const boardId = workflowIds.board(requireString(input, "boardId"));
  const board = snapshot.boards.find((candidate) => candidate.boardId === boardId);
  const expectedWorkflowVersion = board?.workflowVersion ?? 0;

  switch (action) {
    case "bind_repository":
      return { kind: action, mutationId, boardId, repositoryPath: requireString(input, "repositoryPath") };
    case "create_stage":
      return {
        kind: action,
        mutationId,
        boardId,
        expectedWorkflowVersion,
        stageId: workflowIds.stage(stringOrUndefined(input.stageId) ?? `stage:${crypto.randomUUID()}`),
        label: requireString(input, "label"),
      };
    case "update_stage":
      return {
        kind: action,
        mutationId,
        boardId,
        expectedWorkflowVersion,
        stageId: workflowIds.stage(requireString(input, "stageId")),
        label: requireString(input, "label"),
      };
    case "delete_stage":
      return {
        kind: action,
        mutationId,
        boardId,
        expectedWorkflowVersion,
        stageId: workflowIds.stage(requireString(input, "stageId")),
      };
    case "assign_stage_skill":
      return {
        kind: action,
        mutationId,
        boardId,
        expectedWorkflowVersion,
        stageId: workflowIds.stage(requireString(input, "stageId")),
        defaultSkillId: skillIdOrNull(input.defaultSkillId),
      };
    case "connect_stages":
      return {
        kind: action,
        mutationId,
        boardId,
        expectedWorkflowVersion,
        edges: requireEdges(input.edges),
      };
    case "reorder_stages":
      return {
        kind: action,
        mutationId,
        boardId,
        expectedWorkflowVersion,
        orderedStageIds: requireStringArray(input.orderedStageIds, "orderedStageIds").map(workflowIds.stage),
      };
    case "create_card":
      return {
        kind: action,
        mutationId,
        boardId,
        expectedWorkflowVersion,
        cardId: cardIdFor(input, true),
        stageId: workflowIds.stage(requireString(input, "stageId")),
        ...cardFields(input),
      };
    case "update_card":
      return {
        kind: action,
        mutationId,
        boardId,
        cardId: cardIdFor(input),
        expectedCardVersion: cardVersionFor(snapshot, boardId, input),
        ...cardFields(input),
      };
    case "set_card_execution_status":
      return {
        kind: action,
        mutationId,
        boardId,
        cardId: cardIdFor(input),
        expectedCardVersion: cardVersionFor(snapshot, boardId, input),
        executionStatus: requireExecutionStatus(input.executionStatus),
      };
    case "move_card":
      return {
        kind: action,
        mutationId,
        boardId,
        cardId: cardIdFor(input),
        expectedWorkflowVersion,
        expectedCardVersion: cardVersionFor(snapshot, boardId, input),
        targetStageId: workflowIds.stage(requireString(input, "targetStageId")),
      };
    case "record_agent_success":
      return {
        kind: action,
        mutationId,
        boardId,
        cardId: cardIdFor(input),
        expectedWorkflowVersion,
        expectedCardVersion: cardVersionFor(snapshot, boardId, input),
      };
  }
}

function cardIdFor(input: Record<string, unknown>, create = false) {
  const value = stringOrUndefined(input.cardId) ?? stringOrUndefined(input.taskId);
  return workflowIds.card(value ?? (create ? `card:${crypto.randomUUID()}` : requireString(input, "taskId")));
}

function cardVersionFor(snapshot: PersistenceSnapshot, boardId: ReturnType<typeof workflowIds.board>, input: Record<string, unknown>): number {
  const cardId = cardIdFor(input);
  return snapshot.cards.find((candidate) => candidate.cardId === cardId && candidate.boardId === boardId)?.version ?? 0;
}

function cardFields(input: Record<string, unknown>) {
  return {
    title: requireString(input, "title"),
    description: requireString(input, "description"),
    provider: requireString(input, "provider"),
    model: requireString(input, "model"),
    effort: requireString(input, "effort"),
    skillOverrideId: skillIdOrNull(input.skillOverrideId),
    runnable: requireBoolean(input, "runnable"),
  };
}

function requireExecutionStatus(value: unknown): Exclude<ExecutionStatus, "ready_for_review" | "completed"> {
  if (value === "idle" || value === "running" || value === "needs_attention" || value === "failed" || value === "cancelled") return value;
  throw new Error("executionStatus must be an allowed card status");
}

function skillIdOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  return workflowIds.skill(requireString({ value }, "value"));
}

function requireEdges(value: unknown): readonly { readonly sourceStageId: ReturnType<typeof workflowIds.stage>; readonly targetStageId: ReturnType<typeof workflowIds.stage> }[] {
  if (!Array.isArray(value)) throw new Error("edges must be an array");
  return value.map((edge) => {
    if (!isRecord(edge)) throw new Error("each edge must be an object");
    return {
      sourceStageId: workflowIds.stage(requireString(edge, "sourceStageId")),
      targetStageId: workflowIds.stage(requireString(edge, "targetStageId")),
    };
  });
}

function requireStringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  return value;
}

function requireBoolean(input: Record<string, unknown>, name: string): boolean {
  if (typeof input[name] !== "boolean") throw new Error(`${name} must be a boolean`);
  return input[name];
}

function requireString(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseRequest(value: unknown): WorkflowApiRequest | null {
  if (!isRecord(value) || !isWorkflowApiAction(value.action) || !isRecord(value.input)) return null;
  if (typeof value.requestId !== "string" || value.requestId.length === 0 || value.requestId.length > 128) return null;
  if (typeof value.capability !== "string" || value.capability.length < 32 || value.capability.length > 128) return null;
  return { requestId: value.requestId, capability: value.capability, action: value.action, input: value.input };
}

function isWorkflowApiAction(value: unknown): value is WorkflowApiAction {
  return value === "get_workspace" || value === "get_board" || value === "get_catalog"
    || value === "bind_repository" || value === "create_stage" || value === "update_stage" || value === "delete_stage"
    || value === "assign_stage_skill" || value === "connect_stages" || value === "reorder_stages"
    || value === "create_card" || value === "update_card" || value === "set_card_execution_status"
    || value === "move_card" || value === "record_agent_success";
}

function requestIdFrom(value: unknown): string | undefined {
  return isRecord(value) && typeof value.requestId === "string" ? value.requestId : undefined;
}

function writeError(socket: LocalSocket, requestId: string | undefined, error: string): void {
  socket.write(`${JSON.stringify({ kind: "error", ...(requestId === undefined ? {} : { requestId }), error })}\n`);
  socket.end();
}

function writeManifest(path: string, manifest: WorkflowApiManifest): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(path), 0o700);
  } catch {
    // Windows does not expose POSIX modes; the capability remains unguessable.
  }
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function removeManifestIfOwned(path: string, capability: string): void {
  if (!existsSync(path)) return;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (isRecord(value) && value.capability === capability) unlinkSync(path);
  } catch {
    // The stale file is harmless; never remove another host's endpoint blindly.
  }
}

function createPrivateEndpoint(): { readonly endpoint: string; readonly directory: string | null } {
  if (process.platform === "win32") return { endpoint: `\\\\.\\pipe\\kitten-workflow-api-${crypto.randomUUID()}`, directory: null };
  const directory = mkdtempSync(join(tmpdir(), "kitten-workflow-api-"));
  try {
    chmodSync(directory, 0o700);
    return { endpoint: join(directory, "workflow.sock"), directory };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
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
