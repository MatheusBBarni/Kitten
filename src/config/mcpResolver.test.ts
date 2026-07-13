import { describe, expect, it } from "bun:test"

import type { McpServerConfig } from "../core/types.ts"
import { resolveMcpServers } from "./mcpResolver.ts"

// Suite: MCP provisioning resolution
// Invariant: every server resolves completely or is skipped without aborting the batch.
// Boundary IN: env-reference expansion, command lookup, and result partitioning.
// Boundary OUT: config parsing and ACP wire translation, owned by their respective suites.

const server = (overrides: Partial<McpServerConfig> = {}): McpServerConfig => ({
  name: "github",
  command: "github-mcp",
  args: ["--stdio"],
  env: {},
  ...overrides,
})

const commands = (paths: Record<string, string>) => (command: string): string | null => paths[command] ?? null

describe("resolveMcpServers", () => {
  it("Should expand an environment reference and resolve the server", () => {
    const result = resolveMcpServers([server({ env: { TOKEN: "${GH}" } })], {
      env: { GH: "abc" },
      resolveCommand: commands({ "github-mcp": "/opt/bin/github-mcp" }),
    })

    expect(result).toEqual({
      resolved: [server({ command: "/opt/bin/github-mcp", env: { TOKEN: "abc" } })],
      skipped: [],
    })
  })

  it("Should skip a server and name its missing environment variable without throwing", () => {
    const resolve = () =>
      resolveMcpServers([server({ env: { TOKEN: "${MISSING}" } })], {
        env: {},
        resolveCommand: commands({ "github-mcp": "/opt/bin/github-mcp" }),
      })

    expect(resolve).not.toThrow()
    expect(resolve()).toEqual({
      resolved: [],
      skipped: [{ name: "github", reason: 'environment variable "MISSING" is not set' }],
    })
  })

  it("Should expand multiple references inside one value", () => {
    const result = resolveMcpServers([server({ env: { ENDPOINT: "${A}/${B}" } })], {
      env: { A: "https://example.com", B: "tools" },
      resolveCommand: commands({ "github-mcp": "/opt/bin/github-mcp" }),
    })

    expect(result.resolved[0]?.env).toEqual({ ENDPOINT: "https://example.com/tools" })
  })

  it("Should carry the injected absolute command into the resolved server", () => {
    const result = resolveMcpServers([server()], {
      env: {},
      resolveCommand: commands({ "github-mcp": "/usr/local/bin/github-mcp" }),
    })

    expect(result.resolved[0]?.command).toBe("/usr/local/bin/github-mcp")
  })

  it("Should skip a server when its command cannot be resolved", () => {
    const resolve = () => resolveMcpServers([server()], { env: {}, resolveCommand: () => null })

    expect(resolve).not.toThrow()
    expect(resolve()).toEqual({
      resolved: [],
      skipped: [{ name: "github", reason: 'command not found: "github-mcp"' }],
    })
  })

  it("Should keep resolving the batch when one server has an unresolved variable", () => {
    const result = resolveMcpServers(
      [server({ name: "ready" }), server({ name: "missing-env", env: { TOKEN: "${MISSING}" } })],
      {
        env: {},
        resolveCommand: commands({ "github-mcp": "/opt/bin/github-mcp" }),
      },
    )

    expect(result.resolved.map(({ name }) => name)).toEqual(["ready"])
    expect(result.skipped.map(({ name }) => name)).toEqual(["missing-env"])
  })

  it("Should partition a two-server list through env and command resolution end to end", () => {
    const input = [
      server({ name: "github", env: { TOKEN: "${GH}", URL: "${HOST}/${PATH}" } }),
      server({ name: "linear", command: "linear-mcp", env: { TOKEN: "${LINEAR}" } }),
    ]

    const result = resolveMcpServers(input, {
      env: { GH: "secret", HOST: "https://example.com", PATH: "mcp" },
      resolveCommand: commands({ "github-mcp": "/opt/bin/github-mcp", "linear-mcp": "/opt/bin/linear-mcp" }),
    })

    expect(result).toEqual({
      resolved: [
        server({
          name: "github",
          command: "/opt/bin/github-mcp",
          env: { TOKEN: "secret", URL: "https://example.com/mcp" },
        }),
      ],
      skipped: [{ name: "linear", reason: 'environment variable "LINEAR" is not set' }],
    })
    expect(input[0]?.command).toBe("github-mcp")
    expect(input[0]?.env).toEqual({ TOKEN: "${GH}", URL: "${HOST}/${PATH}" })
  })

  it("Should turn a throwing or non-absolute command resolver into a skip", () => {
    const throwing = resolveMcpServers([server({ name: "throwing" })], {
      env: {},
      resolveCommand: () => {
        throw new Error("lookup failed")
      },
    })
    const relative = resolveMcpServers([server({ name: "relative" })], {
      env: {},
      resolveCommand: () => "bin/github-mcp",
    })

    expect(throwing.skipped).toEqual([{ name: "throwing", reason: 'command not found: "github-mcp"' }])
    expect(relative.skipped).toEqual([{ name: "relative", reason: 'command not found: "github-mcp"' }])
  })
})
