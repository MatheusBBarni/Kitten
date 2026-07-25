import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import { isDirectAcpTerminalState } from "@kitten/engine";
import type { EventJournal } from "../persistence/eventJournal.ts";
import type { AttentionCoordinator } from "./attentionCoordinator.ts";
import { AttentionCoordinatorError } from "./attentionCoordinator.ts";
import type { AttentionForm, AttentionOutcome } from "./contracts.ts";
import { validateAttentionForm } from "./contracts.ts";

export const MAX_ATTEMPT_ASK_USER_CALL_ID_BYTES = 128;
export const MAX_ATTEMPT_ASK_USER_CALLS_PER_ROUTE = 64;
export const MAX_ATTEMPT_ASK_USER_FRAME_BYTES = 64 * 1024;

export interface AttemptAskUserRoute {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly capability: string;
  readonly endpoint: string;
}

export type AttemptAskUserBridgeErrorCode = "registration_failed" | "unavailable" | "invalid_request" | "busy";

export class AttemptAskUserBridgeError extends Error {
  constructor(readonly code: AttemptAskUserBridgeErrorCode, readonly reason: string) {
    super(`attempt ask_user bridge ${code}: ${reason}`);
    this.name = "AttemptAskUserBridgeError";
  }
}

export interface AttemptAskUserBridge {
  register(input: { readonly attemptId: AttemptId; readonly generation: AttemptGeneration }): AttemptAskUserRoute;
  forward(input: {
    readonly capability: string;
    readonly callId: string;
    readonly form: AttentionForm;
  }): Promise<AttentionOutcome>;
  revoke(input: { readonly attemptId: AttemptId; readonly generation: AttemptGeneration }): void;
  dispose(): void;
}

interface RouteState extends AttemptAskUserRoute {
  readonly callIds: Set<string>;
  readonly directory: string | null;
  readonly listener: LocalListener;
  pending: boolean;
  revoked: boolean;
}

interface LocalSocket {
  write(data: string): number;
  end(): void;
}

interface LocalListener {
  stop(closeActiveConnections?: boolean): void;
  unref?(): void;
}

export function createAttemptAskUserBridge(options: {
  readonly journal: EventJournal;
  readonly attention: AttentionCoordinator;
  readonly createCapability?: () => string;
}): AttemptAskUserBridge {
  const createCapability = options.createCapability ?? (() => randomBytes(32).toString("base64url"));
  const byCapability = new Map<string, RouteState>();
  const byAttempt = new Map<AttemptId, RouteState>();
  const buffers = new Map<LocalSocket, Uint8Array>();
  let disposed = false;

  const revokeRoute = (route: RouteState): void => {
    if (route.revoked) return;
    route.revoked = true;
    byCapability.delete(route.capability);
    if (byAttempt.get(route.attemptId) === route) byAttempt.delete(route.attemptId);
    try {
      route.listener.stop(true);
    } finally {
      try {
        if (route.directory !== null) rmSync(route.directory, { recursive: true, force: true });
      } finally {
        options.attention.cancelActive(route);
      }
    }
  };

  const bridge: AttemptAskUserBridge = {
    register(input) {
      if (disposed) throw new AttemptAskUserBridgeError("registration_failed", "bridge_disposed");
      const attempt = options.journal.snapshot().attempts.find((candidate) => candidate.attemptId === input.attemptId);
      if (attempt === undefined || attempt.generation !== input.generation || isDirectAcpTerminalState(attempt.state)) {
        throw new AttemptAskUserBridgeError("registration_failed", "attempt_route_invalid");
      }
      const prior = byAttempt.get(input.attemptId);
      if (prior !== undefined) revokeRoute(prior);
      const capability = createCapability();
      if (!isCapability(capability) || byCapability.has(capability)) {
        throw new AttemptAskUserBridgeError("registration_failed", "capability_invalid");
      }
      const local = createPrivateEndpoint();
      let listener: LocalListener;
      let route!: RouteState;
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
              const next = concatBytes(current, segment);
              if (next.byteLength > MAX_ATTEMPT_ASK_USER_FRAME_BYTES) {
                writeIpcError(socket, undefined, "invalid_request");
                buffers.delete(socket);
                return;
              }
              buffers.set(socket, next);
              if (newline < 0) return;
              buffers.delete(socket);
              void handleIpcFrame(bridge, route, socket, next);
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
      } catch {
        if (local.directory !== null) rmSync(local.directory, { recursive: true, force: true });
        throw new AttemptAskUserBridgeError("registration_failed", "endpoint_unavailable");
      }
      route = {
        ...input,
        capability,
        endpoint: local.endpoint,
        directory: local.directory,
        listener,
        callIds: new Set(),
        pending: false,
        revoked: false,
      };
      byCapability.set(capability, route);
      byAttempt.set(input.attemptId, route);
      return route;
    },

    async forward(input) {
      const route = byCapability.get(input.capability);
      if (disposed || route === undefined || route.revoked) {
        throw new AttemptAskUserBridgeError("unavailable", "capability_invalid_or_revoked");
      }
      if (!isCallId(input.callId)) throw new AttemptAskUserBridgeError("invalid_request", "call_id_invalid");
      if (route.callIds.has(input.callId)) throw new AttemptAskUserBridgeError("invalid_request", "duplicate_call_id");
      if (route.callIds.size >= MAX_ATTEMPT_ASK_USER_CALLS_PER_ROUTE) {
        throw new AttemptAskUserBridgeError("busy", "route_call_limit");
      }
      const attempt = options.journal.snapshot().attempts.find((candidate) => candidate.attemptId === route.attemptId);
      if (attempt === undefined || attempt.generation !== route.generation || isDirectAcpTerminalState(attempt.state)) {
        revokeRoute(route);
        throw new AttemptAskUserBridgeError("unavailable", "attempt_stale_or_terminal");
      }
      if (route.pending || options.attention.hasActive(route.attemptId)) {
        throw new AttemptAskUserBridgeError("busy", "blocker_active");
      }
      let form: AttentionForm;
      try {
        form = validateAttentionForm(input.form);
      } catch {
        throw new AttemptAskUserBridgeError("invalid_request", "form_invalid");
      }
      route.callIds.add(input.callId);
      route.pending = true;
      try {
        const request = await options.attention.raise({
          attemptId: route.attemptId,
          generation: route.generation,
          callId: input.callId,
          form,
        });
        return await request.outcome;
      } catch (error) {
        if (error instanceof AttentionCoordinatorError) {
          if (error.code === "blocker_active") throw new AttemptAskUserBridgeError("busy", error.code);
          if (error.code === "duplicate_call_id") throw new AttemptAskUserBridgeError("invalid_request", error.code);
          throw new AttemptAskUserBridgeError("unavailable", error.code);
        }
        throw error;
      } finally {
        route.pending = false;
      }
    },

    revoke(input) {
      const route = byAttempt.get(input.attemptId);
      if (route === undefined || route.generation !== input.generation) return;
      revokeRoute(route);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const route of [...byCapability.values()]) revokeRoute(route);
    },
  };
  return bridge;
}

async function handleIpcFrame(
  bridge: AttemptAskUserBridge,
  route: RouteState,
  socket: LocalSocket,
  bytes: Uint8Array,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    writeIpcError(socket, undefined, "invalid_request");
    return;
  }
  if (!isRecord(parsed) || parsed.kind !== "ask" || !isCallId(parsed.callId) || parsed.capability !== route.capability) {
    writeIpcError(socket, isRecord(parsed) && isCallId(parsed.callId) ? parsed.callId : undefined, "invalid_request");
    return;
  }
  try {
    const form = validateAttentionForm(parsed.form);
    const outcome = await bridge.forward({ capability: parsed.capability, callId: parsed.callId, form });
    socket.write(`${JSON.stringify({ kind: "result", callId: parsed.callId, outcome })}\n`);
    socket.end();
  } catch (error) {
    writeIpcError(
      socket,
      parsed.callId,
      error instanceof AttemptAskUserBridgeError ? error.code : "unavailable",
    );
  }
}

function writeIpcError(
  socket: LocalSocket,
  callId: string | undefined,
  error: AttemptAskUserBridgeErrorCode,
): void {
  socket.write(`${JSON.stringify({ kind: "error", ...(callId === undefined ? {} : { callId }), error })}\n`);
  socket.end();
}

function createPrivateEndpoint(): { readonly endpoint: string; readonly directory: string | null } {
  if (process.platform === "win32") return { endpoint: `\\\\.\\pipe\\kitten-desktop-ask-user-${crypto.randomUUID()}`, directory: null };
  const directory = mkdtempSync(join(tmpdir(), "kitten-desktop-ask-user-"));
  try {
    chmodSync(directory, 0o700);
    return { endpoint: join(directory, "bridge.sock"), directory };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
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

function isCapability(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && Buffer.byteLength(value, "utf8") <= 128;
}

function isCallId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= MAX_ATTEMPT_ASK_USER_CALL_ID_BYTES;
}
