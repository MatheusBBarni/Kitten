/**
 * In-process ACP agent test double.
 *
 * Wraps a real `AgentSideConnection` over an in-memory stream (see
 * {@link createInMemoryTransportPair}) with a scripted `Agent` implementation, so
 * the `AgentConnection` adapter can be driven end to end - `initialize`, prompt
 * turns, streamed `session/update` notifications, and `requestPermission`
 * round-trips - with no real subprocess, key, or network. It uses the actual ACP
 * SDK wire framing, so it exercises the adapter's translation faithfully.
 */

import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  type Agent,
  type PermissionOption,
  type PromptRequest,
  type RequestPermissionOutcome,
  type SessionUpdate,
  type Stream,
  type StopReason,
  type ToolCallUpdate,
} from "@agentclientprotocol/sdk"

/** The tools a prompt script uses to stream updates and ask for permission. */
export interface MockAgentContext {
  readonly sessionId: string
  /** Stream one `session/update` notification to the client. */
  update(update: SessionUpdate): Promise<void>
  /** Ask the client for permission and return the user's decision. */
  requestPermission(toolCall: ToolCallUpdate, options: PermissionOption[]): Promise<RequestPermissionOutcome>
  /** Read a file through the client's filesystem callback. */
  readTextFile(path: string, opts?: { line?: number; limit?: number }): Promise<string>
  /** Write a file through the client's filesystem callback. */
  writeTextFile(path: string, content: string): Promise<void>
}

/** A scripted prompt turn: emit updates/permissions, then resolve with a stop reason. */
export type MockPromptScript = (
  prompt: PromptRequest,
  ctx: MockAgentContext,
) => Promise<StopReason | void> | StopReason | void

export interface MockAgentOptions {
  sessionId?: string
  protocolVersion?: number
  onPrompt?: MockPromptScript
}

/** A running mock agent plus the interactions it observed, for test assertions. */
export interface MockAgentHandle {
  readonly connection: AgentSideConnection
  /** Every prompt request the agent received, in order. */
  readonly prompts: PromptRequest[]
  /** Every permission outcome the client returned to the agent, in order. */
  readonly permissionOutcomes: RequestPermissionOutcome[]
}

/** Start a scripted mock agent listening on the agent side of an in-memory stream. */
export function startMockAgent(stream: Stream, options: MockAgentOptions = {}): MockAgentHandle {
  const sessionId = options.sessionId ?? "mock-session-1"
  const protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION
  const prompts: PromptRequest[] = []
  const permissionOutcomes: RequestPermissionOutcome[] = []

  let connection!: AgentSideConnection

  const agent: Agent = {
    initialize: () => ({ protocolVersion, agentCapabilities: {}, agentInfo: { name: "mock-agent", version: "0.0.0" } }),
    newSession: () => ({ sessionId }),
    authenticate: () => ({}),
    cancel: () => {},
    async prompt(request: PromptRequest) {
      prompts.push(request)
      const ctx: MockAgentContext = {
        sessionId: request.sessionId,
        update: (update) => connection.sessionUpdate({ sessionId: request.sessionId, update }),
        async requestPermission(toolCall, permissionOptions) {
          const response = await connection.requestPermission({
            sessionId: request.sessionId,
            toolCall,
            options: permissionOptions,
          })
          permissionOutcomes.push(response.outcome)
          return response.outcome
        },
        async readTextFile(path, opts) {
          const response = await connection.readTextFile({
            sessionId: request.sessionId,
            path,
            line: opts?.line ?? null,
            limit: opts?.limit ?? null,
          })
          return response.content
        },
        async writeTextFile(path, content) {
          await connection.writeTextFile({ sessionId: request.sessionId, path, content })
        },
      }
      const stopReason = (await options.onPrompt?.(request, ctx)) ?? "end_turn"
      return { stopReason }
    },
  }

  connection = new AgentSideConnection(() => agent, stream)
  return { connection, prompts, permissionOutcomes }
}
