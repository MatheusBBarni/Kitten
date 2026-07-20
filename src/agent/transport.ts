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
 * over the child's `stdin` `FileSink` carries outgoing messages. Diagnostics are
 * forwarded to stderr, apart from one known Claude SDK warning that Kitten
 * neutralizes before the session becomes available.
 */
export function spawnAgentTransport(config: AgentConfig): AgentTransport {
  const proc = Bun.spawn({
    cmd: [config.command, ...config.args],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...config.env },
  })

  forwardAgentStderr(proc.stderr)

  // Only `write` is wired: `ndJsonStream` builds its own `WritableStream` over this
  // sink and never forwards `close`/`abort` to it, so sink-level teardown hooks would
  // be dead code. Ending stdin and reaping the child is `dispose`'s job.
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      proc.stdin.write(chunk)
      proc.stdin.flush()
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

/** The Node warning emitted when Claude's inherited bypass mode shadows canUseTool. */
const CLAUDE_BYPASS_WARNING_CODE = "[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED]"
const NODE_WARNING_HINT = "(Use `node --trace-warnings"

/**
 * Remove only the noisy Node warning that accompanies Claude's inherited bypass
 * mode. All other agent diagnostics still reach the operator exactly as before.
 * The transform is line-buffered because process pipes can split one warning line
 * across arbitrary chunks.
 */
export function createAgentStderrFilter(): TransformStream<string, string> {
  let buffered = ""
  let suppressNodeWarningHint = false

  const forwardLine = (line: string, controller: TransformStreamDefaultController<string>) => {
    const normalized = line.replace(/\r?\n$/, "")
    if (normalized.includes(CLAUDE_BYPASS_WARNING_CODE)) {
      suppressNodeWarningHint = true
      return
    }
    if (suppressNodeWarningHint && normalized.startsWith(NODE_WARNING_HINT)) {
      suppressNodeWarningHint = false
      return
    }
    suppressNodeWarningHint = false
    controller.enqueue(line)
  }

  return new TransformStream({
    transform(chunk, controller) {
      buffered += chunk
      let newline = buffered.indexOf("\n")
      while (newline !== -1) {
        forwardLine(buffered.slice(0, newline + 1), controller)
        buffered = buffered.slice(newline + 1)
        newline = buffered.indexOf("\n")
      }
    },
    flush(controller) {
      if (buffered.length > 0) forwardLine(buffered, controller)
    },
  })
}

/** Preserve subprocess diagnostics without letting the known warning corrupt the TUI. */
function forwardAgentStderr(stderr: ReadableStream<Uint8Array>): void {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const decode = new TransformStream<Uint8Array, string>({
    transform(chunk, controller) {
      controller.enqueue(decoder.decode(chunk, { stream: true }))
    },
    flush(controller) {
      const finalChunk = decoder.decode()
      if (finalChunk.length > 0) controller.enqueue(finalChunk)
    },
  })
  const encode = new TransformStream<string, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(encoder.encode(chunk))
    },
  })

  void stderr
    .pipeThrough(decode)
    .pipeThrough(createAgentStderrFilter())
    .pipeThrough(encode)
    .pipeTo(new WritableStream<Uint8Array>({ write: (chunk) => { process.stderr.write(chunk) } }))
    // The subprocess exit and ACP connection report actual failures; a diagnostic
    // forwarding failure must never create an unhandled rejection in the UI tree.
    .catch(() => {})
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
