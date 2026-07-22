import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client,
  type ContentBlock,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SessionUpdate,
  type Stream,
  type ToolCall,
  type ToolCallUpdate,
  type ToolKind,
} from "@agentclientprotocol/sdk";
import type {
  ActivityEventId,
  ActivitySequence,
  DirectAcpPromptResult,
  NormalizedAttemptActivity,
} from "@kitten/engine";
import { toActivitySequence, toOpaqueId } from "@kitten/engine";
import type { CertifiedDirectAcpProfile } from "./contracts.ts";
import type {
  DirectAcpConnection,
  DirectAcpConnectionFactory,
  FreshDirectAcpSessionInput,
} from "./directAcpAttempt.ts";

export interface DesktopAcpRuntimeProfile {
  readonly profile: CertifiedDirectAcpProfile;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface DesktopAcpTransport {
  readonly stream: Stream;
  close(): Promise<void>;
}

export type DesktopAcpTransportFactory = (profile: DesktopAcpRuntimeProfile) => DesktopAcpTransport;

export function createDesktopAcpConnectionFactory(
  profiles: readonly DesktopAcpRuntimeProfile[],
  createTransport: DesktopAcpTransportFactory = spawnAcpTransport,
): DirectAcpConnectionFactory {
  const byProfileId = new Map(profiles.map((profile) => [profile.profile.profileId, profile]));
  return {
    async connect(input) {
      const runtime = byProfileId.get(input.profileId);
      if (
        runtime === undefined
        || runtime.profile.certification.recipeId !== input.recipeId
        || runtime.profile.certification.adapterVersion !== input.adapterVersion
      ) {
        throw new Error("The selected ACP profile is not available in this desktop host.");
      }
      const connection = new DesktopAcpConnection(runtime, createTransport(runtime));
      try {
        await connection.connect();
        return connection;
      } catch (error) {
        await connection.close();
        throw error;
      }
    },
  };
}

class DesktopAcpConnection implements DirectAcpConnection {
  private readonly connection: ClientSideConnection;
  private readonly subscribers = new Set<(input: unknown) => void | Promise<void>>();
  private session: FreshDirectAcpSessionInput | null = null;
  private sessionId: string | null = null;
  private nextSequence = 3;
  private skillContent = "";
  private suppressInitialUserMessage = false;

  constructor(
    private readonly runtime: DesktopAcpRuntimeProfile,
    private readonly transport: DesktopAcpTransport,
  ) {
    this.connection = new ClientSideConnection(
      () => this.client(),
      transport.stream,
    );
  }

  async connect(): Promise<void> {
    const initialized = await withTimeout(this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { session: { configOptions: {} } },
      clientInfo: { name: "kitten-desktop", version: "0.1.0" },
    }), "ACP handshake");
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`ACP protocol mismatch: expected ${PROTOCOL_VERSION}, received ${initialized.protocolVersion}`);
    }
  }

  async newSession(input: FreshDirectAcpSessionInput): Promise<{ readonly sessionId: string }> {
    this.session = input;
    this.skillContent = input.skillContent;
    this.nextSequence = 3;
    const created = await withTimeout(
      this.connection.newSession({ cwd: input.cwd, mcpServers: [] }),
      "ACP session startup",
    );
    this.sessionId = created.sessionId;
    await this.applySelection(created.configOptions ?? [], "model", input.model);
    await this.applySelection(created.configOptions ?? [], "effort", input.effort);
    return { sessionId: created.sessionId };
  }

  async prompt(input: { readonly sessionId: string; readonly prompt: string }): Promise<DirectAcpPromptResult> {
    if (this.sessionId === null || input.sessionId !== this.sessionId) {
      throw new Error("The ACP prompt does not belong to this fresh session.");
    }
    const firstPrompt = this.nextSequence === 3;
    if (firstPrompt) this.suppressInitialUserMessage = true;
    let result;
    try {
      result = await this.connection.prompt({
        sessionId: input.sessionId,
        prompt: [{
          type: "text",
          text: [
            "Follow this Workflow Skill for the run:",
            this.skillContent,
            "Operator request:",
            input.prompt,
          ].join("\n\n"),
        }],
      });
    } finally {
      this.suppressInitialUserMessage = false;
    }
    return { stopReason: normalizeStopReason(result.stopReason) };
  }

  subscribeActivity(listener: (input: unknown) => void | Promise<void>): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async close(): Promise<void> {
    this.subscribers.clear();
    await this.transport.close();
  }

  private client(): Client {
    return {
      sessionUpdate: (notification) => this.onSessionUpdate(notification),
      requestPermission: (request) => this.cancelPermission(request),
    };
  }

  private async cancelPermission(_request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    return { outcome: { outcome: "cancelled" } };
  }

  private async onSessionUpdate(notification: SessionNotification): Promise<void> {
    if (this.sessionId === null || notification.sessionId !== this.sessionId) return;
    if (this.suppressInitialUserMessage && notification.update.sessionUpdate === "user_message_chunk") return;
    const activity = normalizeActivity(notification.update);
    if (activity === null || this.session === null) return;
    const event = {
      eventId: toOpaqueId<ActivityEventId>(`acp:${crypto.randomUUID()}`)!,
      attemptId: this.session.attemptId,
      generation: this.session.generation,
      sequence: toActivitySequence(this.nextSequence++)!,
      occurredAt: Date.now(),
      activity,
    };
    for (const subscriber of this.subscribers) await subscriber(event);
  }

  private async applySelection(
    options: readonly SessionConfigOption[],
    kind: "model" | "effort",
    value: string,
  ): Promise<void> {
    if (this.sessionId === null || value === "default") return;
    const option = options.find((candidate): candidate is Extract<SessionConfigOption, { type: "select" }> => {
      if (candidate.type !== "select") return false;
      const identity = `${candidate.id} ${candidate.category ?? ""}`.toLocaleLowerCase();
      return kind === "model" ? identity.includes("model") : identity.includes("effort") || identity.includes("reasoning");
    });
    if (option === undefined || !selectValues(option).includes(value)) {
      throw new Error(`The ACP session does not support ${kind} ${value}.`);
    }
    await withTimeout(this.connection.setSessionConfigOption({
      sessionId: this.sessionId,
      configId: option.id,
      value,
    }), `ACP ${kind} selection`);
  }
}

function spawnAcpTransport(runtime: DesktopAcpRuntimeProfile): DesktopAcpTransport {
  const subprocess = Bun.spawn({
    cmd: [runtime.command, ...runtime.args],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, ...runtime.env },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      subprocess.stdin.write(chunk);
      subprocess.stdin.flush();
    },
  });
  return {
    stream: ndJsonStream(writable, subprocess.stdout),
    async close() {
      subprocess.kill();
      await subprocess.exited;
    },
  };
}

function normalizeActivity(update: SessionUpdate): NormalizedAttemptActivity | null {
  switch (update.sessionUpdate) {
    case "user_message_chunk": {
      const text = contentText(update.content);
      return text === null ? null : { kind: "user_message", messageId: messageId(update.messageId), text };
    }
    case "agent_message_chunk": {
      const text = contentText(update.content);
      return text === null ? null : { kind: "agent_message", messageId: messageId(update.messageId), textDelta: text };
    }
    case "tool_call":
    case "tool_call_update":
      return { kind: "tool_call", call: normalizeToolCall(update) };
    case "plan":
      return { kind: "plan", entries: update.entries.map(({ content, priority, status }) => ({ content, priority, status })) };
    case "usage_update":
      return { kind: "usage", used: update.used, size: update.size };
    default:
      return null;
  }
}

function normalizeToolCall(call: ToolCall | ToolCallUpdate): Extract<NormalizedAttemptActivity, { kind: "tool_call" }>["call"] {
  return {
    toolCallId: call.toolCallId,
    ...(call.kind === undefined || call.kind === null ? {} : { kind: normalizeToolKind(call.kind) }),
    ...(call.title === undefined || call.title === null ? {} : { title: call.title }),
    ...(call.status === undefined || call.status === null ? {} : { status: call.status }),
    ...(call.locations === undefined || call.locations === null ? {} : { locations: call.locations.map(({ path }) => path) }),
  };
}

function normalizeToolKind(kind: ToolKind): Extract<NormalizedAttemptActivity, { kind: "tool_call" }>["call"]["kind"] {
  return kind === "switch_mode" ? "other" : kind;
}

function contentText(content: ContentBlock): string | null {
  return content.type === "text" ? content.text : null;
}

function messageId(value: string | null | undefined): string {
  return value?.trim().length ? value : `message:${crypto.randomUUID()}`;
}

function selectValues(option: Extract<SessionConfigOption, { type: "select" }>): readonly string[] {
  return option.options.flatMap((entry) => "value" in entry ? [entry.value] : entry.options.map(({ value }) => value));
}

function normalizeStopReason(reason: string): DirectAcpPromptResult["stopReason"] {
  if (
    reason === "end_turn"
    || reason === "max_tokens"
    || reason === "max_turn_requests"
    || reason === "refusal"
    || reason === "cancelled"
  ) return reason;
  return "end_turn";
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 4_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
