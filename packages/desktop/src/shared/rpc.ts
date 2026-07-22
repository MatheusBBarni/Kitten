import type { RPCSchema } from "electrobun/bun";
import type { ActivitySequence, AttemptGeneration, AttemptId } from "@kitten/engine";
import type {
  AttemptInspectorProjection,
  CardInspectorProjection,
} from "../attempts/inspectorProjection.ts";
import type { BoardId, CardId } from "../workflow/workflowTypes.ts";

export type JsonPrimitive = boolean | number | string | null;
export type ProjectionValue =
  | JsonPrimitive
  | { readonly [key: string]: ProjectionValue }
  | readonly ProjectionValue[];

export interface DesktopSnapshot {
  readonly kind: "desktop_snapshot";
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly workspace: {
    readonly status: "unbound";
    readonly boardCount: 0;
  };
  readonly settings: {
    readonly theme: "system";
    readonly executionLimit: 1;
  };
}

export interface RpcSuccess<TProjection> {
  readonly status: "ok";
  readonly projection: TProjection;
}

export interface RpcConflict {
  readonly status: "conflict";
  readonly conflict: {
    readonly kind: "stale_projection";
    readonly expectedRevision: number;
    readonly actualRevision: number;
  };
}

export interface RpcUnavailable {
  readonly status: "unavailable";
  readonly unavailable: {
    readonly resource: "desktop_host" | "desktop_snapshot" | "card_inspector";
    readonly reason: "host_stopped" | "projection_rejected" | "not_ready";
  };
}

export type DesktopQueryResult<TProjection> =
  | RpcSuccess<TProjection>
  | RpcUnavailable;

export type DesktopCommandResult<TProjection> =
  | RpcSuccess<TProjection>
  | RpcConflict
  | RpcUnavailable;

export interface DesktopCommandEnvelope<TCommand extends ProjectionValue = ProjectionValue> {
  readonly kind: "command";
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly command: TCommand;
}

export interface DesktopCommandResultEnvelope<TProjection> {
  readonly kind: "command_result";
  readonly commandId: string;
  readonly result: DesktopCommandResult<TProjection>;
}

export interface BootstrapEnvelope {
  readonly kind: "bootstrap";
  readonly result: DesktopQueryResult<DesktopSnapshot>;
}

export interface CardInspectorEnvelope {
  readonly kind: "card_inspector";
  readonly result: DesktopQueryResult<CardInspectorProjection>;
}

export type HostMessageEnvelope =
  | {
      readonly kind: "projection_committed";
      readonly messageId: string;
      readonly revision: number;
    }
  | {
      readonly kind: "host_unavailable";
      readonly messageId: string;
      readonly reason: RpcUnavailable["unavailable"]["reason"];
    }
  | {
      readonly kind: "attempt_activity";
      readonly messageId: string;
      readonly revision: number;
      readonly boardId: BoardId;
      readonly cardId: CardId;
      readonly attemptId: AttemptId;
      readonly generation: AttemptGeneration;
      readonly sequence: ActivitySequence;
      readonly projection: AttemptInspectorProjection;
    };

export type DesktopRpcSchema = {
  bun: RPCSchema<{
    requests: {
      getDesktopSnapshot: {
        params: { readonly knownRevision?: number };
        response: BootstrapEnvelope;
      };
      getCardInspector: {
        params: { readonly cardId: string };
        response: CardInspectorEnvelope;
      };
    };
    messages: Record<never, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<never, never>;
    messages: {
      hostMessage: HostMessageEnvelope;
    };
  }>;
};

const forbiddenProjectionKeys = [
  "acpconnection",
  "filesystemhandle",
  "sqlite",
  "sqlitehandle",
  "skillcontent",
  "skillcontents",
  "worktree",
  "worktreeobject",
  "secret",
  "secrets",
  "password",
  "credential",
  "credentials",
  "token",
  "privatekey",
  "apikey",
] as const;

function normalizedKey(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function assertProjectionNode(value: unknown, path: string, seen: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }

  if (typeof value !== "object") {
    throw new ProjectionBoundaryError(path, "projection values must be JSON data");
  }

  if (seen.has(value)) {
    throw new ProjectionBoundaryError(path, "cyclic projection values are forbidden");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertProjectionNode(entry, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProjectionBoundaryError(path, "resource handles and class instances are forbidden");
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (forbiddenProjectionKeys.some((forbidden) => normalized.includes(forbidden))) {
      throw new ProjectionBoundaryError(`${path}.${key}`, "privileged resources and secrets are forbidden");
    }
    assertProjectionNode(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export class ProjectionBoundaryError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Unsafe RPC projection at ${path}: ${reason}`);
    this.name = "ProjectionBoundaryError";
  }
}

export function assertProjectionPayload<T>(value: T): T {
  assertProjectionNode(value, "$", new WeakSet());
  return value;
}

export function createEmptyDesktopSnapshot(): DesktopSnapshot {
  return {
    kind: "desktop_snapshot",
    schemaVersion: 1,
    revision: 0,
    workspace: { status: "unbound", boardCount: 0 },
    settings: { theme: "system", executionLimit: 1 },
  };
}

export function createBootstrapEnvelope(
  result: DesktopQueryResult<DesktopSnapshot>,
): BootstrapEnvelope {
  return assertProjectionPayload({ kind: "bootstrap", result });
}

export function createCardInspectorEnvelope(
  result: DesktopQueryResult<CardInspectorProjection>,
): CardInspectorEnvelope {
  return assertProjectionPayload({ kind: "card_inspector", result });
}

export function createCommandResultEnvelope<TProjection>(
  commandId: string,
  result: DesktopCommandResult<TProjection>,
): DesktopCommandResultEnvelope<TProjection> {
  return assertProjectionPayload({ kind: "command_result", commandId, result });
}

export function assertHostMessage(message: HostMessageEnvelope): HostMessageEnvelope {
  return assertProjectionPayload(message);
}

export function createAttemptActivityMessage(input: Omit<
  Extract<HostMessageEnvelope, { kind: "attempt_activity" }>,
  "kind"
>): HostMessageEnvelope {
  return assertHostMessage({ kind: "attempt_activity", ...input });
}
