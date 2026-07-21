import { describe, expect, it } from "bun:test"

import type { AnyMessage } from "@agentclientprotocol/sdk"

import type { AgentConfig } from "../core/types.ts"
import { createAgentStderrFilter, spawnAgentTransport } from "./transport.ts"

/**
 * Transport tests for the real `Bun.spawn` stdio wiring. These use trivial system
 * processes (`cat`, `true`) rather than a full ACP agent: `cat` echoes to verify
 * the stdin→stdout message round-trip and framing, and `true` verifies `onClose`
 * fires with the child's exit code. The `createInMemoryTransportPair` path is
 * covered by the adapter integration tests.
 */

const config = (command: string, args: string[] = []): AgentConfig => ({
  id: "claude-code",
  displayName: command,
  command,
  args,
  env: {},
})

describe("spawnAgentTransport", () => {
  it("round-trips an ndjson message through the child's stdio", async () => {
    const transport = spawnAgentTransport(config("cat"))
    const writer = transport.stream.writable.getWriter()
    const reader = transport.stream.readable.getReader()

    const message = { jsonrpc: "2.0", id: 1, method: "ping", params: { hello: "world" } } as unknown as AnyMessage
    await writer.write(message)
    const { value } = await reader.read()
    expect(value).toEqual(message)

    await reader.cancel()
    await writer.close()
    await transport.dispose()
  })

  it("fires onClose with the child's exit code", async () => {
    const transport = spawnAgentTransport(config("true"))
    const code = await new Promise<number | null>((resolve) => transport.onClose((info) => resolve(info.code)))
    expect(code).toBe(0)
    await transport.dispose()
  })

  it("forwards a child stderr diagnostic through the line filter", async () => {
    const transport = spawnAgentTransport(config("sh", ["-c", "printf 'adapter diagnostic\\n' >&2"]))
    const code = await new Promise<number | null>((resolve) => transport.onClose((info) => resolve(info.code)))

    expect(code).toBe(0)
    await Bun.sleep(0)
    await transport.dispose()
  })

  it("removes only Claude's known bypass warning, even when its line is chunked", async () => {
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("(node:42) [CLAUDE_SDK_CAN_USE_")
        controller.enqueue("TOOL_SHADOWED] Warning: canUseTool will not be invoked\n")
        controller.enqueue("(Use `node --trace-warnings ...` to show where the warning was created)\n")
        controller.enqueue("adapter startup failed\n")
        controller.close()
      },
    })
    const reader = source.pipeThrough(createAgentStderrFilter()).getReader()
    let output = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      output += value
    }

    expect(output).toBe("adapter startup failed\n")
  })

  it("preserves unrelated agent diagnostics", async () => {
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("adapter warning\n")
        controller.enqueue("adapter failure\n")
        controller.close()
      },
    })
    const reader = source.pipeThrough(createAgentStderrFilter()).getReader()
    let output = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      output += value
    }

    expect(output).toBe("adapter warning\nadapter failure\n")
  })

  it("preserves an unterminated diagnostic when the stderr stream closes", async () => {
    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue("adapter warning without a final newline")
        controller.close()
      },
    })
    const reader = source.pipeThrough(createAgentStderrFilter()).getReader()
    const { done, value } = await reader.read()

    expect(done).toBe(false)
    expect(value).toBe("adapter warning without a final newline")
    expect((await reader.read()).done).toBe(true)
  })
})
