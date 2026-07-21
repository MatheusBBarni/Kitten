import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"

import { KITTEN_VERSION } from "../version.ts"

export const KITTEN_MCP_MODE_FLAG = "--ask-user-mcp"
export const KITTEN_MCP_SERVER_NAME = "kitten-ask-user"

export type KittenMcpToolRegistrar = (server: McpServer) => void

export interface KittenMcpServerOptions {
  readonly instructions?: string
  readonly registrars: readonly KittenMcpToolRegistrar[]
}

export interface RunKittenMcpOptions extends KittenMcpServerOptions {
  readonly createTransport?: () => Transport
}

/** Compose the Kitten-owned MCP tools without connecting a transport. */
export function createKittenMcpServer(options: KittenMcpServerOptions): McpServer {
  const server = new McpServer(
    { name: KITTEN_MCP_SERVER_NAME, version: KITTEN_VERSION },
    options.instructions === undefined ? {} : { instructions: options.instructions },
  )
  for (const register of options.registrars) register(server)
  return server
}

/** Run bundled child mode until its provider-facing transport closes. */
export async function runKittenMcp(options: RunKittenMcpOptions): Promise<void> {
  const server = createKittenMcpServer(options)
  const transport = options.createTransport?.() ?? new StdioServerTransport()
  const closed = new Promise<void>((resolve) => {
    transport.onclose = resolve
  })
  await server.connect(transport)
  await closed
}
