import { randomBytes } from "node:crypto";
import type { AttemptGeneration, AttemptId } from "@kitten/engine";
import { isDirectAcpTerminalState } from "@kitten/engine";
import type { EventJournal } from "../persistence/eventJournal.ts";
import type { AttentionCoordinator } from "./attentionCoordinator.ts";
import { AttentionCoordinatorError } from "./attentionCoordinator.ts";
import type { AttentionForm, AttentionOutcome } from "./contracts.ts";
import { validateAttentionForm } from "./contracts.ts";

export const MAX_ATTEMPT_ASK_USER_CALL_ID_BYTES = 128;
export const MAX_ATTEMPT_ASK_USER_CALLS_PER_ROUTE = 64;

export interface AttemptAskUserRoute {
  readonly attemptId: AttemptId;
  readonly generation: AttemptGeneration;
  readonly capability: string;
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
  pending: boolean;
  revoked: boolean;
}

export function createAttemptAskUserBridge(options: {
  readonly journal: EventJournal;
  readonly attention: AttentionCoordinator;
  readonly createCapability?: () => string;
}): AttemptAskUserBridge {
  const createCapability = options.createCapability ?? (() => randomBytes(32).toString("base64url"));
  const byCapability = new Map<string, RouteState>();
  const byAttempt = new Map<AttemptId, RouteState>();
  let disposed = false;

  const revokeRoute = (route: RouteState): void => {
    if (route.revoked) return;
    route.revoked = true;
    byCapability.delete(route.capability);
    if (byAttempt.get(route.attemptId) === route) byAttempt.delete(route.attemptId);
    options.attention.cancelActive(route);
  };

  return {
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
      const route: RouteState = {
        ...input,
        capability,
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
}

function isCapability(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && Buffer.byteLength(value, "utf8") <= 128;
}

function isCallId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= MAX_ATTEMPT_ASK_USER_CALL_ID_BYTES;
}
