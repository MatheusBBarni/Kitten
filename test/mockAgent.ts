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
  type InitializeRequest,
  type InitializeResponse,
  type LoadSessionRequest,
  type PermissionOption,
  type PromptRequest,
  type RequestPermissionOutcome,
  type SessionConfigOption,
  type SetSessionConfigOptionRequest,
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

/** A scripted `initialize` handshake. Throw to make the agent reject the handshake. */
export type MockInitializeScript = (request: InitializeRequest) => Promise<InitializeResponse> | InitializeResponse

/** A scripted `session/load` request, optionally replaying history through updates. */
export type MockLoadSessionScript = (
  request: LoadSessionRequest,
  ctx: Pick<MockAgentContext, "update">,
) => Promise<void> | void

export interface MockAgentOptions {
  sessionId?: string
  /** The protocol version the default `initialize` negotiates back to the client. */
  protocolVersion?: number
  /** Override the whole handshake - to reject it, or to answer with odd capabilities. */
  onInitialize?: MockInitializeScript
  /** Whether the default handshake advertises `session/load` support. */
  canLoadSession?: boolean
  /** Handle `session/load`, usually by replaying history through `ctx.update`. */
  onLoadSession?: MockLoadSessionScript
  onPrompt?: MockPromptScript
  /**
   * The config options the agent advertises. When set, `newSession` returns them and
   * `setSessionConfigOption` mutates the matching option's `currentValue` in place and
   * echoes back the full refreshed set. When absent, the agent advertises no config
   * surface (`newSession` omits `configOptions`) and rejects `setSessionConfigOption`.
   */
  configOptions?: SessionConfigOption[]
  /** Reject a config-option change with this error, to exercise the adapter's error path. */
  onSetConfigOption?: (request: SetSessionConfigOptionRequest) => void
}

/** A running mock agent plus the interactions it observed, for test assertions. */
export interface MockAgentHandle {
  readonly connection: AgentSideConnection
  /** Every prompt request the agent received, in order. */
  readonly prompts: PromptRequest[]
  /** Every permission outcome the client returned to the agent, in order. */
  readonly permissionOutcomes: RequestPermissionOutcome[]
  /** The working directory of every `session/new` the agent received, in order. */
  readonly newSessionCwds: string[]
  /** Every `session/load` request the agent received, in order. */
  readonly loadSessionRequests: LoadSessionRequest[]
  /** Every `session/set_config_option` request the agent received, in order. */
  readonly configOptionRequests: SetSessionConfigOptionRequest[]
  /** The agent's current config options, as mutated by `setSessionConfigOption`. */
  readonly configOptions: SessionConfigOption[]
  /**
   * Push an agent-initiated `config_option_update` notification to the client, carrying
   * the current (or a supplied) full option set - the after-the-switch case.
   */
  emitConfigOptionUpdate(configOptions?: SessionConfigOption[]): Promise<void>
}

/** Start a scripted mock agent listening on the agent side of an in-memory stream. */
export function startMockAgent(stream: Stream, options: MockAgentOptions = {}): MockAgentHandle {
  const sessionId = options.sessionId ?? "mock-session-1"
  const protocolVersion = options.protocolVersion ?? PROTOCOL_VERSION
  const prompts: PromptRequest[] = []
  const permissionOutcomes: RequestPermissionOutcome[] = []
  const newSessionCwds: string[] = []
  const loadSessionRequests: LoadSessionRequest[] = []
  const configOptionRequests: SetSessionConfigOptionRequest[] = []
  // The live option set the agent advertises, mutated in place by set_config_option.
  const configOptions: SessionConfigOption[] = options.configOptions ? [...options.configOptions] : []
  const advertisesConfig = options.configOptions !== undefined

  let connection!: AgentSideConnection

  const agent: Agent = {
    initialize: (request: InitializeRequest) =>
      options.onInitialize?.(request) ?? {
        protocolVersion,
        agentCapabilities: options.canLoadSession === undefined ? {} : { loadSession: options.canLoadSession },
        agentInfo: { name: "mock-agent", version: "0.0.0" },
      },
    newSession: (request) => {
      newSessionCwds.push(request.cwd)
      return advertisesConfig ? { sessionId, configOptions } : { sessionId }
    },
    async loadSession(request: LoadSessionRequest) {
      loadSessionRequests.push(request)
      await options.onLoadSession?.(request, {
        update: (update) => connection.sessionUpdate({ sessionId: request.sessionId, update }),
      })
      return {}
    },
    setSessionConfigOption: (request: SetSessionConfigOptionRequest) => {
      configOptionRequests.push(request)
      options.onSetConfigOption?.(request)
      // Apply the requested value to the matching select option, then echo the full set.
      for (const option of configOptions) {
        if (option.id === request.configId && option.type === "select" && typeof request.value === "string") {
          option.currentValue = request.value
        }
      }
      return { configOptions }
    },
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
  return {
    connection,
    prompts,
    permissionOutcomes,
    newSessionCwds,
    loadSessionRequests,
    configOptionRequests,
    configOptions,
    emitConfigOptionUpdate: (next) =>
      connection.sessionUpdate({
        sessionId,
        update: { sessionUpdate: "config_option_update", configOptions: next ?? configOptions },
      }),
  }
}
