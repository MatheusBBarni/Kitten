/**
 * ACP stdio transport wiring (ADR-005).
 *
 * Turns an {@link AgentConfig} into an ACP {@link Stream} by spawning the agent as
 * a `Bun.spawn` subprocess and framing its stdin/stdout as newline-delimited JSON.
 * The `ClientSideConnection` in `agentConnection.ts` speaks over this stream.
 *
 * A transport is an injectable seam: `agentConnection.ts` takes a factory so tests
 * drive the adapter against an in-process agent via {@link createInMemoryTransportPair}
 * instead of a real subprocess. The ACP SDK is imported only under `src/agent`.
 */

import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk"

import type { AgentConfig } from "../core/types.ts"

/** A live ACP byte transport plus lifecycle controls owned by the adapter. */
export interface AgentTransport {
  /** The bidirectional ACP message stream to hand to `ClientSideConnection`. */
  readonly stream: Stream
  /** Register a callback fired when the underlying channel closes/exits. */
  onClose(cb: (info: { code: number | null }) => void): void
  /** Tear the transport down (kill the subprocess, close the streams). */
  dispose(): Promise<void>
}

/** How the adapter obtains a transport for a given agent config. Injectable for tests. */
export type TransportFactory = (config: AgentConfig) => AgentTransport

/**
 * Spawn the configured agent command and frame its stdio as an ACP stream.
 *
 * The child's `stdout` is the incoming message stream; a `WritableStream` adapter
 * over the child's `stdin` `FileSink` carries outgoing messages. `stderr` is left
 * inherited so agent diagnostics reach the operator during a failed handshake.
 */
export function spawnAgentTransport(config: AgentConfig): AgentTransport {
  const proc = Bun.spawn({
    cmd: [config.command, ...config.args],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env, ...config.env },
  })

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      proc.stdin.write(chunk)
      proc.stdin.flush()
    },
    close() {
      proc.stdin.end()
    },
    abort() {
      proc.stdin.end()
    },
  })

  const stream = ndJsonStream(writable, proc.stdout)

  return {
    stream,
    onClose(cb) {
      void proc.exited.then((code) => cb({ code }))
    },
    async dispose() {
      proc.kill()
      await proc.exited
    },
  }
}

/**
 * Create a pair of connected in-memory ACP streams for tests: whatever the client
 * writes the agent reads and vice-versa, with the same newline-delimited JSON
 * framing the real subprocess uses. Wire `client` to a `ClientSideConnection` and
 * `agent` to an `AgentSideConnection` to exercise the adapter with no subprocess.
 */
export function createInMemoryTransportPair(): { client: Stream; agent: Stream } {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>()
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>()
  return {
    client: ndJsonStream(clientToAgent.writable, agentToClient.readable),
    agent: ndJsonStream(agentToClient.writable, clientToAgent.readable),
  }
}
