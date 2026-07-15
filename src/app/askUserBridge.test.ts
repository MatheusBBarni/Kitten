import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { forwardAskUserToBridge } from "../agent/askUserMcp.ts"
import type { ClarificationOutcome, ClarificationPayload, SessionId } from "../core/types.ts"
import type { ClarificationRequestHandle } from "./controller.ts"
import {
  ASK_USER_MCP_CAPABILITY_ENV,
  ASK_USER_MCP_ENDPOINT_ENV,
  ASK_USER_MCP_MODE_FLAG,
  ASK_USER_MCP_SERVER_NAME,
  createAskUserBridge,
  MAX_ASK_USER_CONCURRENT_CALLS,
  MAX_ASK_USER_FRAME_BYTES,
  MAX_ASK_USER_TEXT_BYTES,
  type AskUserBridge,
  type AskUserBridgeFailureReason,
  type AskUserBridgeListenerHandlers,
} from "./askUserBridge.ts"

const FORM: ClarificationPayload = {
  title: "Migration choice",
  context: "Choose the safe path",
  prompt: "How should the migration proceed?",
  fields: [{
    id: "strategy",
    label: "Strategy",
    description: "Select one",
    required: true,
    mode: "single",
    allowsCustom: true,
    options: [{ id: "safe", label: "Safe" }],
  }],
}

interface PendingClarification {
  readonly sessionId: SessionId
  readonly generation: number
  readonly form: ClarificationPayload
  readonly requestId: string
  settle(outcome: ClarificationOutcome): void
}

function createCoordinatorFake() {
  const pending: PendingClarification[] = []
  const cancellations: Array<{ sessionId: SessionId; generation: number; reason: string }> = []
  let sequence = 0
  return {
    pending,
    cancellations,
    requestClarification(sessionId: SessionId, generation: number, form: ClarificationPayload): ClarificationRequestHandle {
      const requestId = `request-${++sequence}`
      let settle!: (outcome: ClarificationOutcome) => void
      const outcome = new Promise<ClarificationOutcome>((resolve) => {
        settle = resolve
      })
      pending.push({ sessionId, generation, form, requestId, settle })
      return { requestId, outcome, timeout: () => false }
    },
    cancelClarifications(sessionId: SessionId, generation: number, reason: string): void {
      cancellations.push({ sessionId, generation, reason })
      for (const request of pending) {
        if (request.sessionId === sessionId && request.generation === generation) {
          request.settle({ kind: "cancelled" })
        }
      }
    },
  }
}

function createBridge(
  overrides: Partial<Parameters<typeof createAskUserBridge>[0]> = {},
): { bridge: AskUserBridge; fake: ReturnType<typeof createCoordinatorFake>; failures: AskUserBridgeFailureReason[] } {
  const fake = createCoordinatorFake()
  const failures: AskUserBridgeFailureReason[] = []
  return {
    fake,
    failures,
    bridge: createAskUserBridge({
      executablePath: "/kitten/bin/kitten",
      requestClarification: fake.requestClarification,
      cancelClarifications: fake.cancelClarifications,
      onFailure: (reason) => failures.push(reason),
      ...overrides,
    }),
  }
}

interface ClientState {
  bytes: Uint8Array
  messages: unknown[]
  waiters: Array<(value: unknown) => void>
  closed: boolean
}

interface LocalClient {
  send(value: unknown): void
  sendRaw(value: string | Uint8Array): void
  next(timeoutMs?: number): Promise<unknown>
  close(): void
}

async function connectClient(endpoint: string): Promise<LocalClient> {
  const state: ClientState = { bytes: new Uint8Array(), messages: [], waiters: [], closed: false }
  const socket = await Bun.connect<ClientState>({
    unix: endpoint,
    data: state,
    socket: {
      data(current, chunk) {
        current.data.bytes = concat(current.data.bytes, chunk)
        while (true) {
          const newline = current.data.bytes.indexOf(10)
          if (newline < 0) break
          const raw = current.data.bytes.subarray(0, newline)
          current.data.bytes = current.data.bytes.subarray(newline + 1)
          const message = JSON.parse(new TextDecoder().decode(raw)) as unknown
          const waiter = current.data.waiters.shift()
          if (waiter) waiter(message)
          else current.data.messages.push(message)
        }
      },
      close(current) {
        current.data.closed = true
      },
      error() {},
    },
  })
  return {
    send(value) {
      socket.write(`${JSON.stringify(value)}\n`)
    },
    sendRaw(value) {
      socket.write(value)
    },
    next(timeoutMs = 1_000) {
      const message = state.messages.shift()
      if (message !== undefined) return Promise.resolve(message)
      return new Promise((resolve, reject) => {
        const receive = (value: unknown) => {
          clearTimeout(timer)
          resolve(value)
        }
        const timer = setTimeout(() => {
          const index = state.waiters.indexOf(receive)
          if (index >= 0) state.waiters.splice(index, 1)
          reject(new Error("Timed out waiting for bridge response"))
        }, timeoutMs)
        state.waiters.push(receive)
      })
    },
    close() {
      socket.end()
    },
  }
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength)
  result.set(left)
  result.set(right, left.byteLength)
  return result
}

function routeFrame(server: ReturnType<AskUserBridge["register"]>, callId: string, form = FORM) {
  return {
    kind: "ask",
    callId,
    capability: server.env[ASK_USER_MCP_CAPABILITY_ENV],
    form,
  }
}

function endpointOf(server: ReturnType<AskUserBridge["register"]>): string {
  return server.env[ASK_USER_MCP_ENDPOINT_ENV]!
}

async function waitForPending(
  fake: ReturnType<typeof createCoordinatorFake>,
  count: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (fake.pending.length >= count) return
    await Bun.sleep(5)
  }
  throw new Error(`Timed out waiting for ${count} bridge clarification request(s)`)
}

describe("AskUserBridge registration", () => {
  it("creates an isolated POSIX route and a declaration containing no caller-selectable identity", async () => {
    const { bridge } = createBridge()
    try {
      const first = bridge.register({ sessionId: "alpha", generation: 7 })
      const second = bridge.register({ sessionId: "beta", generation: 2 })
      expect(first).toEqual({
        name: ASK_USER_MCP_SERVER_NAME,
        command: "/kitten/bin/kitten",
        args: [ASK_USER_MCP_MODE_FLAG],
        env: {
          [ASK_USER_MCP_ENDPOINT_ENV]: expect.any(String),
          [ASK_USER_MCP_CAPABILITY_ENV]: expect.any(String),
        },
      })
      expect(first.env[ASK_USER_MCP_CAPABILITY_ENV]).not.toBe(second.env[ASK_USER_MCP_CAPABILITY_ENV])
      expect(first.env[ASK_USER_MCP_ENDPOINT_ENV]).not.toBe(second.env[ASK_USER_MCP_ENDPOINT_ENV])
      expect(first.env).not.toHaveProperty("sessionId")
      expect(first.env).not.toHaveProperty("generation")
      const directory = join(endpointOf(first), "..")
      expect(statSync(directory).mode & 0o777).toBe(0o700)
    } finally {
      await bridge.dispose()
    }
  })

  it("uses unique Windows named pipes and never asks a listener factory for TCP options", async () => {
    const endpoints: string[] = []
    const { bridge } = createBridge({
      platform: "win32",
      listen(endpoint) {
        endpoints.push(endpoint)
        return { stop() {} }
      },
    })
    try {
      bridge.register({ sessionId: "alpha", generation: 1 })
      bridge.register({ sessionId: "beta", generation: 1 })
      expect(endpoints).toHaveLength(2)
      expect(endpoints[0]).toStartWith("\\\\.\\pipe\\kitten-ask-user-")
      expect(endpoints[1]).toStartWith("\\\\.\\pipe\\kitten-ask-user-")
      expect(endpoints[0]).not.toBe(endpoints[1])
    } finally {
      await bridge.dispose()
    }
  })
})

describe("AskUserBridge authenticated local IPC", () => {
  it("keeps a route available for a second child-mode call after the first child closes", async () => {
    const { bridge, fake } = createBridge()
    const server = bridge.register({ sessionId: "alpha", generation: 3 })
    try {
      const first = forwardAskUserToBridge(FORM, server.env, { newCallId: () => "completed-1" })
      await waitForPending(fake, 1)
      fake.pending[0]!.settle({ kind: "skipped" })
      expect(await first).toEqual({ kind: "skipped" })
      await Bun.sleep(10)

      expect(fake.cancellations).toEqual([])
      expect(existsSync(endpointOf(server))).toBe(true)

      const second = forwardAskUserToBridge(FORM, server.env, { newCallId: () => "completed-2" })
      await waitForPending(fake, 2)
      fake.pending[1]!.settle({ kind: "timed_out" })
      expect(await second).toEqual({ kind: "timed_out" })
    } finally {
      await bridge.dispose()
    }
  })

  it("returns the fake coordinator's submitted structured outcome to a valid local client", async () => {
    const { bridge, fake } = createBridge()
    const server = bridge.register({ sessionId: "alpha", generation: 3 })
    const client = await connectClient(endpointOf(server))
    try {
      client.send(routeFrame(server, "call-1"))
      await waitForPending(fake, 1)
      expect(fake.pending).toHaveLength(1)
      expect(fake.pending[0]).toMatchObject({ sessionId: "alpha", generation: 3, form: FORM })
      const outcome: ClarificationOutcome = {
        kind: "submitted",
        answers: { strategy: { selectedOptionIds: ["safe"], customText: "with backup" } },
      }
      fake.pending[0]!.settle(outcome)
      expect(await client.next()).toEqual({ kind: "result", callId: "call-1", outcome })
    } finally {
      client.close()
      await bridge.dispose()
    }
  })

  it("fails unknown, malformed, invalid-capability, and caller-owned identity frames without disclosure", async () => {
    const { bridge, fake } = createBridge()
    const server = bridge.register({ sessionId: "private-session", generation: 91 })
    const endpoint = endpointOf(server)
    const capability = server.env[ASK_USER_MCP_CAPABILITY_ENV]!
    const attempts: Array<string | object> = [
      "{not-json}\n",
      { kind: "unknown", callId: "unknown", capability, form: FORM },
      { kind: "ask", callId: "invalid-cap", capability: "x".repeat(40), form: FORM },
      { ...routeFrame(server, "identity"), sessionId: "other", generation: 500 },
    ]
    try {
      for (const attempt of attempts) {
        const client = await connectClient(endpoint)
        if (typeof attempt === "string") client.sendRaw(attempt)
        else client.send(attempt)
        const response = await client.next()
        const serialized = JSON.stringify(response)
        expect(response).toMatchObject({ kind: "error" })
        expect(serialized).not.toContain("private-session")
        expect(serialized).not.toContain(capability)
        expect(serialized).not.toContain(endpoint)
        expect(serialized).not.toContain("Migration choice")
        client.close()
      }
      expect(fake.pending).toHaveLength(0)
    } finally {
      await bridge.dispose()
    }
  })

  it("rejects duplicate call IDs and oversized frames before another clarification is queued", async () => {
    const { bridge, fake, failures } = createBridge()
    const server = bridge.register({ sessionId: "alpha", generation: 1 })
    const client = await connectClient(endpointOf(server))
    try {
      client.send(routeFrame(server, "duplicate"))
      client.send(routeFrame(server, "duplicate"))
      expect(await client.next()).toEqual({
        kind: "error",
        callId: "duplicate",
        error: "invalid_request",
      })
      expect(fake.pending).toHaveLength(1)
      expect(failures).toContain("connection_duplicate_call_id")

      let handlers: AskUserBridgeListenerHandlers | undefined
      const oversizedWrites: string[] = []
      const oversized = createBridge({
        platform: "win32",
        listen(_endpoint, received) {
          handlers = received
          return { stop() {} }
        },
      })
      oversized.bridge.register({ sessionId: "oversized", generation: 1 })
      const socket = {
        write(data: string) {
          oversizedWrites.push(data)
          return data.length
        },
        end() {},
      }
      handlers!.open(socket)
      handlers!.data(socket, new Uint8Array(MAX_ASK_USER_FRAME_BYTES + 1))
      expect(JSON.parse(oversizedWrites[0]!)).toEqual({ kind: "error", error: "invalid_request" })
      expect(oversized.fake.pending).toHaveLength(0)
      expect(oversized.failures).toContain("connection_frame_too_large")
      await oversized.bridge.dispose()
    } finally {
      client.close()
      await bridge.dispose()
    }
  })

  it("bounds concurrent calls without queueing the excess form", async () => {
    const { bridge, fake, failures } = createBridge()
    const server = bridge.register({ sessionId: "alpha", generation: 1 })
    const client = await connectClient(endpointOf(server))
    try {
      for (let index = 0; index <= MAX_ASK_USER_CONCURRENT_CALLS; index += 1) {
        client.send(routeFrame(server, `call-${index}`))
      }
      expect(await client.next()).toEqual({
        kind: "error",
        callId: `call-${MAX_ASK_USER_CONCURRENT_CALLS}`,
        error: "busy",
      })
      expect(fake.pending).toHaveLength(MAX_ASK_USER_CONCURRENT_CALLS)
      expect(failures).toContain("connection_concurrency_limit")
    } finally {
      client.close()
      await bridge.dispose()
    }
  })

  it("rejects oversized and duplicate-field forms before coordinator entry", async () => {
    const { bridge, fake } = createBridge()
    const server = bridge.register({ sessionId: "alpha", generation: 1 })
    const capability = server.env[ASK_USER_MCP_CAPABILITY_ENV]!
    try {
      await expect(bridge.ask(capability, {
        ...FORM,
        prompt: "x".repeat(MAX_ASK_USER_TEXT_BYTES + 1),
      })).rejects.toMatchObject({ code: "invalid_request" })
      await expect(bridge.ask(capability, {
        ...FORM,
        fields: [FORM.fields[0]!, FORM.fields[0]!],
      })).rejects.toMatchObject({ code: "invalid_request" })
      expect(fake.pending).toHaveLength(0)
    } finally {
      await bridge.dispose()
    }
  })

  it("keeps each route's terminal result isolated from every other route", async () => {
    const { bridge, fake } = createBridge()
    const alphaServer = bridge.register({ sessionId: "alpha", generation: 1 })
    const betaServer = bridge.register({ sessionId: "beta", generation: 1 })
    const alpha = await connectClient(endpointOf(alphaServer))
    const beta = await connectClient(endpointOf(betaServer))
    try {
      alpha.send(routeFrame(alphaServer, "same-call"))
      beta.send(routeFrame(betaServer, "same-call"))
      await Bun.sleep(0)
      expect(fake.pending.map(({ sessionId }) => sessionId)).toEqual(["alpha", "beta"])
      fake.pending[0]!.settle({ kind: "skipped" })
      expect(await alpha.next()).toEqual({
        kind: "result",
        callId: "same-call",
        outcome: { kind: "skipped" },
      })
      await expect(beta.next(30)).rejects.toThrow("Timed out")
      fake.pending[1]!.settle({ kind: "timed_out" })
      expect(await beta.next()).toEqual({
        kind: "result",
        callId: "same-call",
        outcome: { kind: "timed_out" },
      })
    } finally {
      alpha.close()
      beta.close()
      await bridge.dispose()
    }
  })
})

describe("AskUserBridge lifecycle and diagnostics", () => {
  it("fences a stale generation after replacement, cancels its pending call, and removes its endpoint", async () => {
    const { bridge, fake } = createBridge()
    const stale = bridge.register({ sessionId: "alpha", generation: 1 })
    const staleEndpoint = endpointOf(stale)
    const client = await connectClient(staleEndpoint)
    try {
      client.send(routeFrame(stale, "pending"))
      await Bun.sleep(0)
      const live = bridge.register({ sessionId: "alpha", generation: 2 })
      expect(fake.cancellations).toContainEqual({
        sessionId: "alpha",
        generation: 1,
        reason: "session_replaced",
      })
      expect(existsSync(staleEndpoint)).toBe(false)
      await expect(bridge.ask(stale.env[ASK_USER_MCP_CAPABILITY_ENV]!, FORM)).rejects.toMatchObject({
        code: "unavailable",
      })
      const ask = bridge.ask(live.env[ASK_USER_MCP_CAPABILITY_ENV]!, FORM)
      await Bun.sleep(0)
      fake.pending.at(-1)!.settle({ kind: "cancelled" })
      expect(await ask).toEqual({ kind: "cancelled" })
    } finally {
      client.close()
      await bridge.dispose()
    }
  })

  it.each([
    ["session close", "conversation_closed"],
    ["provider failure", "connection_error"],
  ] as const)("%s cancels the pending call and releases the endpoint", async (_label, reason) => {
    const { bridge, fake } = createBridge()
    const server = bridge.register({ sessionId: "alpha", generation: 4 })
    const endpoint = endpointOf(server)
    const client = await connectClient(endpoint)
    try {
      client.send(routeFrame(server, "pending"))
      await Bun.sleep(0)
      bridge.cancelSession("alpha", 4, reason)
      expect(fake.cancellations).toContainEqual({ sessionId: "alpha", generation: 4, reason })
      expect(existsSync(endpoint)).toBe(false)
    } finally {
      client.close()
      await bridge.dispose()
    }
  })

  it("disposal cancels every route and removes every endpoint", async () => {
    const { bridge, fake } = createBridge()
    const first = bridge.register({ sessionId: "alpha", generation: 1 })
    const second = bridge.register({ sessionId: "beta", generation: 8 })
    const endpoints = [endpointOf(first), endpointOf(second)]
    const clients = await Promise.all(endpoints.map(connectClient))
    clients[0]!.send(routeFrame(first, "alpha-call"))
    clients[1]!.send(routeFrame(second, "beta-call"))
    await Bun.sleep(0)
    await bridge.dispose()
    expect(fake.cancellations).toEqual([
      { sessionId: "alpha", generation: 1, reason: "controller_disposed" },
      { sessionId: "beta", generation: 8, reason: "controller_disposed" },
    ])
    expect(endpoints.every((endpoint) => !existsSync(endpoint))).toBe(true)
    for (const client of clients) client.close()
  })

  it("treats an authenticated child disconnect as provider failure", async () => {
    const { bridge, fake } = createBridge()
    const server = bridge.register({ sessionId: "alpha", generation: 6 })
    const endpoint = endpointOf(server)
    const client = await connectClient(endpoint)
    client.send(routeFrame(server, "pending"))
    await Bun.sleep(0)
    client.close()
    await Bun.sleep(10)
    expect(fake.cancellations).toContainEqual({
      sessionId: "alpha",
      generation: 6,
      reason: "connection_error",
    })
    expect(existsSync(endpoint)).toBe(false)
    await bridge.dispose()
  })

  it("emits only bounded reason enums for registration and connection failures", async () => {
    const leaked = {
      endpoint: "/private/endpoint",
      capability: "capability-secret-value-that-must-never-escape",
      request: "request-secret",
      session: "session-secret",
      form: "form-secret",
    }
    const registrationFailures: AskUserBridgeFailureReason[] = []
    const registration = createBridge({
      createEndpoint() {
        throw new Error(JSON.stringify(leaked))
      },
      onFailure: (reason) => registrationFailures.push(reason),
    }).bridge
    expect(() => registration.register({ sessionId: leaked.session, generation: 1 })).toThrow("registration_failed")
    expect(registrationFailures).toEqual(["registration_endpoint_failed"])
    expect(JSON.stringify(registrationFailures)).not.toContain("secret")

    const failures: AskUserBridgeFailureReason[] = []
    const { bridge } = createBridge({ onFailure: (reason) => failures.push(reason) })
    const server = bridge.register({ sessionId: leaked.session, generation: 1 })
    const client = await connectClient(endpointOf(server))
    try {
      client.sendRaw(`${JSON.stringify(leaked)}\n`)
      await client.next()
      expect(failures).toEqual(["connection_invalid_request"])
      expect(Object.keys({ reason: failures[0] })).toEqual(["reason"])
      expect(JSON.stringify(failures)).not.toContain("secret")
      expect(JSON.stringify(failures)).not.toContain(endpointOf(server))
    } finally {
      client.close()
      await bridge.dispose()
      await registration.dispose()
    }
  })

  it("cleans an allocated endpoint when listener registration fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "kitten-ask-user-listen-failure-"))
    const endpoint = join(directory, "private.sock")
    const failures: AskUserBridgeFailureReason[] = []
    const { bridge } = createBridge({
      createEndpoint: () => ({ endpoint, directory }),
      listen() {
        throw new Error("private-listener-details")
      },
      onFailure: (reason) => failures.push(reason),
    })
    expect(() => bridge.register({ sessionId: "alpha", generation: 1 })).toThrow("registration_failed")
    expect(failures).toEqual(["registration_listen_failed"])
    expect(existsSync(directory)).toBe(false)
    await bridge.dispose()
  })

  it("passes only the endpoint string and fixed callbacks through the injected listener seam", async () => {
    let handlers: AskUserBridgeListenerHandlers | undefined
    const { bridge } = createBridge({
      platform: "win32",
      listen(_endpoint, received) {
        handlers = received
        return { stop() {} }
      },
    })
    bridge.register({ sessionId: "alpha", generation: 1 })
    expect(handlers).toEqual({
      open: expect.any(Function),
      data: expect.any(Function),
      close: expect.any(Function),
      error: expect.any(Function),
    })
    await bridge.dispose()
  })
})
