import { describe, expect, it } from "bun:test"

import { applyBuilderMutation, createDraft } from "../core/contextPack.ts"
import type {
  ClarificationOutcome,
  ContextPackMutationResult,
  DraftContextPack,
} from "../core/types.ts"
import {
  CONTEXT_PACK_MCP_CAPABILITY_ENV,
  CONTEXT_PACK_MCP_ENDPOINT_ENV,
  CONTEXT_PACK_MCP_MODE_FLAG,
  CONTEXT_PACK_MCP_SERVER_NAME,
  type ContextPackReadWorkspaceResult,
  type ContextPackMcpRequest,
} from "../agent/contextPackMcp.ts"
import {
  createContextPackBridge,
  type ContextPackBridgeAuthorization,
  type ContextPackBridgeDisposalReason,
  type ContextPackBridgeFacade,
  type ContextPackBridgeListenerHandlers,
  type ContextPackBridgeRoute,
  type ContextPackBridgeSocket,
} from "./contextPackBridge.ts"

const BASE_ROUTE: ContextPackBridgeRoute = {
  parentId: "parent",
  childId: "child",
  parentGeneration: 7,
  childGeneration: 3,
  draftRevision: 0,
  workspaceRoot: "/repo",
}

interface Harness {
  readonly bridge: ReturnType<typeof createContextPackBridge>
  readonly facade: ContextPackBridgeFacade
  readonly route: ContextPackBridgeRoute
  readonly authorizations: ContextPackBridgeAuthorization[]
  readonly disposals: ContextPackBridgeDisposalReason[]
  readonly config: ReturnType<ReturnType<typeof createContextPackBridge>["register"]>
  readonly call: (request: unknown, options?: { capability?: string; outer?: Record<string, unknown> }) => Promise<Record<string, unknown>>
  readonly setActiveRoute: (route: ContextPackBridgeRoute) => void
  readonly draft: () => DraftContextPack
  readonly mutationCount: () => number
  readonly workspaceReadCount: () => number
}

function createHarness(options: {
  readonly listenFails?: boolean
  readonly workspaceResult?: ContextPackReadWorkspaceResult
  readonly askOutcome?: ClarificationOutcome
} = {}): Harness {
  const created = createDraft("Curate this task")
  if (created.kind !== "created") throw new Error("draft fixture failed")
  let draft = created.draft
  let activeRoute = BASE_ROUTE
  let mutations = 0
  let workspaceReads = 0
  const authorizations: ContextPackBridgeAuthorization[] = []
  const disposals: ContextPackBridgeDisposalReason[] = []
  const listeners = new Map<string, ContextPackBridgeListenerHandlers>()
  let endpointSequence = 0
  let capabilitySequence = 0

  const facade: ContextPackBridgeFacade = {
    authorize(input) {
      authorizations.push(input)
      return JSON.stringify(input.route) === JSON.stringify(activeRoute)
        && input.workspaceRoot === activeRoute.workspaceRoot
    },
    readDraft() {
      return draft
    },
    async readWorkspace(_route, _root, request) {
      workspaceReads += 1
      return options.workspaceResult ?? {
        kind: "ready",
        artifact: {
          source: { identity: "file:1:2", digest: "a".repeat(64), bytes: 5 },
          content: request.path === "src/index.ts" ? "hello" : "other",
        },
      }
    },
    mutateDraft(_route, input): ContextPackMutationResult {
      mutations += 1
      const result = applyBuilderMutation(draft, input)
      if (result.kind === "applied") draft = result.draft
      return result
    },
    async askUser() {
      return options.askOutcome ?? { kind: "skipped" }
    },
    dispose(_route, reason) {
      disposals.push(reason)
    },
  }

  const bridge = createContextPackBridge({
    executablePath: "/bin/kitten",
    executableArgs: ["run", "src/index.ts"],
    createEndpoint: () => ({ endpoint: `/tmp/context-pack-${++endpointSequence}.sock` }),
    newCapability: () => `${String(++capabilitySequence).padStart(32, "c")}`,
    listen: (endpoint, handlers) => {
      if (options.listenFails) throw new Error("listen failed")
      listeners.set(endpoint, handlers)
      return { stop() {} }
    },
  })
  const config = bridge.register({ route: BASE_ROUTE, facade })

  return {
    bridge,
    facade,
    route: BASE_ROUTE,
    authorizations,
    disposals,
    config,
    setActiveRoute(route) { activeRoute = route },
    draft: () => draft,
    mutationCount: () => mutations,
    workspaceReadCount: () => workspaceReads,
    async call(request, callOptions = {}) {
      const endpoint = config.env[CONTEXT_PACK_MCP_ENDPOINT_ENV]!
      const capability = callOptions.capability ?? config.env[CONTEXT_PACK_MCP_CAPABILITY_ENV]!
      const handlers = listeners.get(endpoint)
      if (!handlers) throw new Error("listener missing")
      let resolveFrame!: (frame: Record<string, unknown>) => void
      const output = new Promise<Record<string, unknown>>((resolve) => { resolveFrame = resolve })
      const socket: ContextPackBridgeSocket = {
        write(data) {
          resolveFrame(JSON.parse(data.trim()) as Record<string, unknown>)
          return data.length
        },
        end() {},
      }
      handlers.open(socket)
      const frame = {
        kind: "context_pack",
        callId: `call-${Math.random()}`,
        capability,
        request,
        ...callOptions.outer,
      }
      handlers.data(socket, new TextEncoder().encode(`${JSON.stringify(frame)}\n`))
      return await output
    },
  }
}

function readDraftRequest(): ContextPackMcpRequest {
  return { operation: "read_draft", input: {} }
}

function mutateRequest(expectedRevision: number): ContextPackMcpRequest {
  return {
    operation: "mutate_draft",
    input: {
      expected_revision: expectedRevision,
      mutation: { kind: "set_brief_section", section: "architecture", text: "Layered" },
    },
  }
}

describe("generation-bound Context Pack bridge", () => {
  it("registers a distinct same-binary route with no mixed MCP environment", async () => {
    const harness = createHarness()
    expect(harness.config).toEqual({
      name: CONTEXT_PACK_MCP_SERVER_NAME,
      command: "/bin/kitten",
      args: ["run", "src/index.ts", CONTEXT_PACK_MCP_MODE_FLAG],
      env: {
        [CONTEXT_PACK_MCP_ENDPOINT_ENV]: "/tmp/context-pack-1.sock",
        [CONTEXT_PACK_MCP_CAPABILITY_ENV]: "1".padStart(32, "c"),
      },
    })
    expect(JSON.stringify(harness.config)).not.toContain("ASK_USER")
    expect(JSON.stringify(harness.config)).not.toContain("agent_run")
    await harness.bridge.dispose()
  })

  it("re-authorizes bounded draft/workspace/ask calls with the bound route and root", async () => {
    const harness = createHarness({ askOutcome: { kind: "cancelled" } })
    const draft = await harness.call(readDraftRequest())
    expect(draft).toMatchObject({
      kind: "context_pack_result",
      operation: "read_draft",
      result: { draft: { revision: 0 } },
    })

    const workspace = await harness.call({
      operation: "read_workspace",
      input: { kind: "full_file", path: "src/index.ts", max_bytes: 128 },
    })
    expect(workspace).toMatchObject({
      kind: "context_pack_result",
      operation: "read_workspace",
      result: { result: { kind: "ready", artifact: { content: "hello" } } },
    })

    const ask = await harness.call({
      operation: "ask_user",
      input: {
        prompt: "Choose",
        fields: [{ id: "choice", label: "Choose", required: true, mode: "text" }],
      },
    })
    expect(ask).toMatchObject({ operation: "ask_user", result: { kind: "cancelled" } })
    expect(harness.authorizations).toContainEqual({
      route: BASE_ROUTE,
      operation: "read_workspace",
      workspaceRoot: "/repo",
      path: "src/index.ts",
      maxBytes: 128,
    })
    expect(harness.workspaceReadCount()).toBe(1)
    await harness.bridge.dispose()
  })

  it("accepts an expected revision once and preserves the newer draft on stale replay", async () => {
    const harness = createHarness()
    const initialRevision = harness.draft().revision
    expect(await harness.call(mutateRequest(initialRevision))).toMatchObject({
      operation: "mutate_draft",
      result: { result: { kind: "applied", revision: initialRevision + 1 } },
    })
    const newer = harness.draft()
    expect(await harness.call(mutateRequest(initialRevision))).toMatchObject({
      operation: "mutate_draft",
      result: {
        result: {
          kind: "stale",
          expected_revision: initialRevision,
          current_revision: initialRevision + 1,
        },
      },
    })
    expect(harness.mutationCount()).toBe(1)
    expect(harness.draft()).toBe(newer)
    await harness.bridge.dispose()
  })

  it("denies every parent, child, generation, draft-binding, and workspace mismatch without mutation", async () => {
    const variants: ContextPackBridgeRoute[] = [
      { ...BASE_ROUTE, parentId: "other-parent" },
      { ...BASE_ROUTE, childId: "other-child" },
      { ...BASE_ROUTE, parentGeneration: 8 },
      { ...BASE_ROUTE, childGeneration: 4 },
      { ...BASE_ROUTE, draftRevision: 1 },
      { ...BASE_ROUTE, workspaceRoot: "/other" },
    ]
    for (const active of variants) {
      const harness = createHarness()
      harness.setActiveRoute(active)
      expect(await harness.call(mutateRequest(0))).toMatchObject({
        kind: "error",
        error: "unavailable",
      })
      expect(harness.mutationCount()).toBe(0)
      expect(harness.disposals).toEqual(["authorization_denied"])
    }
  })

  it("rejects path escapes, byte-limit bypasses, cross-session fields, and forbidden operations generically", async () => {
    const forbidden = [
      "agent_run",
      "shell",
      "git",
      "external_mcp",
      "seal",
      "send",
      "export",
      "approval",
    ]
    for (const operation of forbidden) {
      const harness = createHarness()
      expect(await harness.call({ operation, input: {} })).toMatchObject({
        kind: "error",
        error: "invalid_request",
      })
      expect(harness.mutationCount()).toBe(0)
      await harness.bridge.dispose()
    }

    for (const input of [
      { kind: "full_file", path: "../secret", max_bytes: 128 },
      { kind: "full_file", path: "src/index.ts", max_bytes: 1024 * 1024 + 1 },
      { kind: "full_file", path: "src/index.ts", max_bytes: 128, parent_id: "other" },
    ]) {
      const harness = createHarness()
      expect(await harness.call({ operation: "read_workspace", input })).toMatchObject({
        kind: "error",
        error: "invalid_request",
      })
      expect(harness.workspaceReadCount()).toBe(0)
      await harness.bridge.dispose()
    }

    const oversizedReturn = createHarness({
      workspaceResult: {
        kind: "ready",
        artifact: {
          source: { identity: "file:1:2", digest: "a".repeat(64), bytes: 5 },
          content: "hello",
        },
      },
    })
    expect(await oversizedReturn.call({
      operation: "read_workspace",
      input: { kind: "full_file", path: "src/index.ts", max_bytes: 4 },
    })).toMatchObject({ kind: "error", error: "unavailable" })
    expect(oversizedReturn.workspaceReadCount()).toBe(1)
    await oversizedReturn.bridge.dispose()

    const unscopedAsk = createHarness()
    expect(await unscopedAsk.call({
      operation: "ask_user",
      input: {
        prompt: "Choose",
        fields: [{
          id: "choice",
          label: "Choose",
          required: true,
          mode: "text",
          session_id: "other",
        }],
      },
    })).toMatchObject({ kind: "error", error: "invalid_request" })
    await unscopedAsk.bridge.dispose()

    const harness = createHarness()
    expect(await harness.call(readDraftRequest(), { outer: { parentId: "other" } })).toMatchObject({
      kind: "error",
      error: "invalid_request",
    })
    await harness.bridge.dispose()
  })

  it("revokes all late reads and writes after child settlement or parent generation change", async () => {
    for (const reason of ["child_settled", "parent_generation_changed"] as const) {
      const harness = createHarness()
      harness.bridge.revoke(harness.route, reason)
      expect(harness.disposals).toEqual([reason])
      expect(await harness.call(readDraftRequest())).toMatchObject({ error: "unavailable" })
      expect(await harness.call(mutateRequest(0))).toMatchObject({ error: "unavailable" })
      expect(harness.mutationCount()).toBe(0)
    }
  })

  it("clears already-established authority when launch registration is denied", () => {
    const created = createDraft("Curate")
    if (created.kind !== "created") throw new Error("draft fixture failed")
    const disposals: ContextPackBridgeDisposalReason[] = []
    const facade: ContextPackBridgeFacade = {
      authorize: () => true,
      readDraft: () => created.draft,
      readWorkspace: async () => ({ kind: "blocked", reason: "invalid_path", path: "x" }),
      mutateDraft: () => null,
      askUser: async () => ({ kind: "skipped" }),
      dispose: (_route, reason) => disposals.push(reason),
    }
    const bridge = createContextPackBridge({
      executablePath: "/bin/kitten",
      createEndpoint: () => ({ endpoint: "/tmp/denied.sock" }),
      newCapability: () => "c".repeat(32),
      listen: () => { throw new Error("denied") },
    })
    expect(() => bridge.register({ route: BASE_ROUTE, facade })).toThrow()
    expect(disposals).toEqual(["launch_denied"])
  })

  it("disposal rejects later reads and writes and releases the live facade once", async () => {
    const harness = createHarness()
    await harness.bridge.dispose()
    await harness.bridge.dispose()
    expect(harness.disposals).toEqual(["bridge_disposed"])
    expect(await harness.call(readDraftRequest())).toMatchObject({ error: "unavailable" })
    expect(await harness.call(mutateRequest(0))).toMatchObject({ error: "unavailable" })
    expect(harness.mutationCount()).toBe(0)
  })
})
