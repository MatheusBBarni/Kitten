import { describe, expect, it } from "bun:test"

import rootPackage from "../../../package.json" with { type: "json" }
import tuiPackage from "../package.json" with { type: "json" }

const lockfile = Bun.JSONC.parse(
  await Bun.file(new URL("../../../bun.lock", import.meta.url)).text(),
) as { workspaces: Record<string, { name?: string }> }

const TUI_PACKAGE_NAME = "@matheusbbarni/kitten"
const FORWARDED_LIFECYCLE = [
  "start",
  "dev",
  "typecheck",
  "test",
  "test:coverage",
  "selfcheck",
  "selfcheck:reload",
  "build",
  "build:local",
] as const

const EXPECTED_DEPENDENCIES = {
  "@agentclientprotocol/sdk": "1.2.1",
  "@modelcontextprotocol/sdk": "1.29.0",
  "@opentui/core": "0.4.3",
  "@opentui/react": "0.4.3",
  "@xterm/headless": "6.0.0",
  react: "19.2.7",
  "react-devtools-core": "7.0.1",
  ws: "8.21.0",
  zod: "4.4.3",
} as const

const EXPECTED_DEV_DEPENDENCIES = {
  "@agentclientprotocol/claude-agent-acp": "0.57.0",
  "@agentclientprotocol/codex-acp": "1.1.2",
  "@types/bun": "1.3.14",
  "@types/react": "19.2.17",
  "@types/ws": "8.18.1",
  typescript: "6.0.3",
} as const

const EXPECTED_OPTIONAL_DEPENDENCIES = {
  "@matheusbbarni/kitten-darwin-arm64": "0.6.1",
  "@matheusbbarni/kitten-darwin-x64": "0.6.1",
  "@matheusbbarni/kitten-linux-arm64": "0.6.1",
  "@matheusbbarni/kitten-linux-x64": "0.6.1",
} as const

describe("workspace ownership boundary", () => {
  it("makes the root a private packages-only workspace", () => {
    expect(rootPackage.name).toBe("kitten-workspace")
    expect(rootPackage.private).toBe(true)
    expect(rootPackage.workspaces).toEqual(["packages/*"])
    expect(rootPackage).not.toHaveProperty("version")
    expect(rootPackage).not.toHaveProperty("description")
    expect(rootPackage).not.toHaveProperty("repository")
    expect(rootPackage).not.toHaveProperty("bin")
    expect(rootPackage).not.toHaveProperty("files")
    expect(rootPackage).not.toHaveProperty("publishConfig")
    expect(rootPackage).not.toHaveProperty("optionalDependencies")
    expect(lockfile.workspaces[""]?.name).toBe("kitten-workspace")
    expect(lockfile.workspaces["packages/tui"]?.name).toBe(TUI_PACKAGE_NAME)
  })

  it("keeps every root lifecycle script forwarding-only", () => {
    for (const lifecycle of FORWARDED_LIFECYCLE) {
      expect(rootPackage.scripts[lifecycle]).toBe(`bun run --filter ${TUI_PACKAGE_NAME} ${lifecycle}`)
    }

    const rootCommands = Object.values(rootPackage.scripts).join("\n")
    expect(rootCommands).not.toMatch(/(?:^|\s)(?:\.\/)?src\/index\.ts(?:\s|$)/)
    expect(rootCommands).not.toMatch(/(?:^|\s)(?:\.\/)?scripts\/build\.ts(?:\s|$)/)
  })

  it("gives the TUI package the preserved public and runtime contract", () => {
    expect(tuiPackage.name).toBe(TUI_PACKAGE_NAME)
    expect(tuiPackage.version).toBe("0.6.1")
    expect(tuiPackage.bin).toEqual({ kitten: "bin/kitten.mjs" })
    expect(tuiPackage.files).toEqual(["bin", "CHANGELOG.md", "README.md"])
    expect(tuiPackage.publishConfig).toEqual({ access: "public" })
    expect(tuiPackage.optionalDependencies).toEqual(EXPECTED_OPTIONAL_DEPENDENCIES)
    expect(tuiPackage.dependencies).toEqual(EXPECTED_DEPENDENCIES)
    expect(tuiPackage.devDependencies).toEqual(EXPECTED_DEV_DEPENDENCIES)
  })

  it("keeps dependency ownership exclusively in the TUI package", () => {
    expect(rootPackage).not.toHaveProperty("dependencies")
    expect(rootPackage).not.toHaveProperty("devDependencies")
    expect(tuiPackage.dependencies).toEqual(EXPECTED_DEPENDENCIES)
    expect(tuiPackage.devDependencies).toEqual(EXPECTED_DEV_DEPENDENCIES)
  })

  it("keeps lifecycle authority in the TUI package", () => {
    expect(tuiPackage.scripts.start).toBe("bun run --cwd ../.. packages/tui/src/index.ts")
    expect(tuiPackage.scripts.typecheck).toBe("tsc --noEmit -p tsconfig.json")
    expect(tuiPackage.scripts.test).toBe("bun test --cwd ../.. packages/tui/src packages/tui/test")
    expect(tuiPackage.scripts.selfcheck).toBe(
      "bun run --cwd ../.. packages/tui/src/index.ts --self-check",
    )
    expect(tuiPackage.scripts.build).toBe(
      "bun run --cwd ../.. packages/tui/scripts/build.ts",
    )
  })
})
