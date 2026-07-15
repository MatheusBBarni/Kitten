import { describe, expect, it, spyOn } from "bun:test"

import { createTestRenderer } from "@opentui/core/testing"

import {
  createOfflineConnection,
  formatMcpSelfCheckLine,
  runSelfCheck,
  SELF_CHECK_DEFAULT_TOKEN,
} from "../src/app/selfCheck.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import { formatFirstRunReport, REPO_REQUIREMENT_MESSAGE, type FirstRunReport, type FirstRunGuidanceOptions } from "../src/config/firstRun.ts"
import {
  dispatchCliFlags,
  exitBlocked,
  main,
  runtimeSetup,
  wantsAskUserMcp,
  wantsHelp,
  wantsReloadProbe,
  wantsSelfCheck,
  wantsVersion,
} from "../src/index.ts"
import type { AgentRuntimeState } from "../src/app/controller.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { KITTEN_VERSION } from "../src/version.ts"
import { createFakeController } from "./fakeController.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

describe("main() repo gate", () => {
  it("refuses to boot outside a repository and never creates a renderer", async () => {
    let rendererCreated = false
    let reported: FirstRunReport | undefined
    let blocked: FirstRunReport | undefined

    const result = await main({
      cwd: "/tmp/not-a-repo",
      checkRepo: () => false,
      createRenderer: async () => {
        rendererCreated = true
        throw new Error("renderer must not be created when outside a repo")
      },
      reportFirstRun: (report) => {
        reported = report
      },
      onBlocked: (report) => {
        blocked = report
      },
    })

    expect(result).toBeNull()
    expect(rendererCreated).toBe(false)
    expect(reported?.insideRepo).toBe(false)
    expect(reported?.blocked).toBe(true)
    expect(blocked).toBe(reported)
  })

  it("prints the repo requirement to stderr by default", async () => {
    const writes: string[] = []
    const stderr = spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      writes.push(String(chunk))
      return true
    }) as never)

    try {
      const result = await main({ checkRepo: () => false, onBlocked: () => {} })
      expect(result).toBeNull()
    } finally {
      stderr.mockRestore()
    }

    expect(writes.join("")).toContain(REPO_REQUIREMENT_MESSAGE)
  })
})

describe("main() readiness gate", () => {
  it("keeps the cockpit mounted and reports only Cursor's safe recovery gap when siblings are ready", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const cwd = process.cwd()
    const cursorGap =
      "Cursor: authentication is required: sign in to Cursor. Sign in to Cursor, then restart Kitten."
    const runtimes: AgentRuntimeState[] = [
      { sessionId: "claude-code", providerKind: "claude-code", displayName: "Claude Code", title: "Claude Code", cwd, ready: true, acpSessionId: "session-claude" },
      { sessionId: "codex", providerKind: "codex", displayName: "Codex", title: "Codex", cwd, ready: true, acpSessionId: "session-codex" },
      { sessionId: "cursor", providerKind: "cursor", displayName: "Cursor", title: "Cursor", cwd, ready: false, error: cursorGap },
    ]
    const store = createAppStore({
      seeds: runtimes.map((runtime) => ({
        id: runtime.sessionId,
        providerKind: runtime.providerKind,
        title: runtime.title,
        cwd: runtime.cwd,
      })),
      selectedVisibleId: "codex",
    })
    const controller = createFakeController({ store, runtimes })
    let reported: FirstRunReport | undefined
    let blocked = 0

    let result: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      result = await main({
        checkRepo: () => true,
        createRenderer: async () => renderer,
        createController: async () => controller,
        loadConfig: async () => defaultAppConfig(),
        readFirstRunSeen: () => false,
        markFirstRunSeen: () => {},
        renderBootBanner: () => () => {},
        reportFirstRun: (report) => {
          reported = report
        },
        onBlocked: () => blocked++,
        onExit: () => {},
        wireNotifier: () => {},
      })
    })

    expect(result).not.toBeNull()
    expect(renderer.isDestroyed).toBe(false)
    expect(blocked).toBe(0)
    expect(reported?.blocked).toBe(false)
    expect(reported?.gaps).toEqual([cursorGap])
    expect(reported?.agents.filter((agent) => agent.ready).map((agent) => agent.agentId)).toEqual([
      "claude-code",
      "codex",
    ])

    await destroyMounted(renderer)
    await result?.closed
  })

  it("restores the terminal and reports gaps when no agent is ready", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const notReady: AgentRuntimeState[] = [
      { sessionId: "claude-code", providerKind: "claude-code", displayName: "Claude Code", title: "Claude Code", cwd: "/workspace/kitten", ready: false, error: "Claude Code: command not found." },
      { sessionId: "codex", providerKind: "codex", displayName: "Codex", title: "Codex", cwd: "/workspace/kitten", ready: false, error: "Codex: not authenticated." },
    ]
    const controller = createFakeController({ runtimes: notReady })
    let reported: FirstRunReport | undefined
    let markCalls = 0

    let result: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      result = await main({
        checkRepo: () => true,
        createRenderer: async () => renderer,
        createController: async () => controller,
        loadConfig: async () => defaultAppConfig(),
        readFirstRunSeen: () => false,
        markFirstRunSeen: () => {
          markCalls++
        },
        reportFirstRun: (report) => {
          reported = report
        },
        onBlocked: () => {},
      })
    })

    expect(result).toBeNull()
    expect(renderer.isDestroyed).toBe(true)
    expect(controller.calls.dispose).toBe(1)
    expect(reported?.blocked).toBe(true)
    expect(reported?.gaps).toEqual(["Claude Code: command not found.", "Codex: not authenticated."])
    expect(markCalls).toBe(0)
  })

  it("mounts a valid empty workspace without treating it as a failed fixed fleet", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController({
      store: createAppStore({ seeds: [] }),
      runtimes: [],
    })
    let blocked = 0

    let result: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      result = await main({
        checkRepo: () => true,
        createRenderer: async () => renderer,
        createController: async () => controller,
        loadConfig: async () => defaultAppConfig(),
        readFirstRunSeen: () => true,
        onBlocked: () => blocked++,
        onExit: () => {},
        wireNotifier: () => {},
      })
    })

    expect(result).not.toBeNull()
    expect(blocked).toBe(0)
    expect(renderer.isDestroyed).toBe(false)

    await destroyMounted(renderer)
    await result?.closed
    expect(controller.calls.dispose).toBe(1)
  })

  it("mounts one restore-unavailable conversation so recovery remains reachable", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const store = createAppStore({
      seeds: [{ id: "restored", providerKind: "codex", title: "Restored", cwd: process.cwd() }],
      selectedVisibleId: "restored",
    })
    store.setConversationAvailability("restored", {
      kind: "unavailable",
      reasonCode: "restore-unavailable",
      retryable: true,
    })
    const controller = createFakeController({
      store,
      runtimes: [{
        sessionId: "restored",
        providerKind: "codex",
        displayName: "Codex",
        title: "Restored",
        cwd: process.cwd(),
        ready: false,
        error: "history unavailable",
      }],
    })
    let blocked = 0

    let result: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      result = await main({
        checkRepo: () => true,
        createRenderer: async () => renderer,
        createController: async () => controller,
        loadConfig: async () => defaultAppConfig(),
        readFirstRunSeen: () => true,
        onBlocked: () => blocked++,
        onExit: () => {},
        wireNotifier: () => {},
      })
    })

    expect(result).not.toBeNull()
    expect(blocked).toBe(0)
    expect(store.getState().workspace.selectedVisibleId).toBe("restored")

    await destroyMounted(renderer)
    await result?.closed
  })
})

describe("main() persistence disclosure", () => {
  it("surfaces the disclosure once on a first successful boot and does not stop startup", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    const config = defaultAppConfig()
    config.persistenceEnabled = true
    const guidance: string[] = []
    let markCalls = 0

    let result: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      result = await main({
        checkRepo: () => true,
        createRenderer: async () => renderer,
        createController: async () => controller,
        loadConfig: async () => config,
        readFirstRunSeen: () => false,
        markFirstRunSeen: () => {
          markCalls++
        },
        renderBootBanner: () => () => {},
        reportFirstRun: (report: FirstRunReport, options?: FirstRunGuidanceOptions) => {
          guidance.push(...formatFirstRunReport(report, options))
        },
        wireNotifier: () => {},
        onExit: () => {},
      })
    })

    expect(result).not.toBeNull()
    expect(result).not.toBeUndefined()
    expect(guidance.filter((line) => line.includes("remembers sessions for this project"))).toHaveLength(1)
    expect(guidance[0]).toContain("sessions")
    expect(guidance[0]).toContain("Ctrl+D")
    expect(markCalls).toBe(1)

    await destroyMounted(renderer)
    await result?.closed
  })

  it("does not repeat the disclosure after the first successful boot", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const controller = createFakeController()
    const guidance: string[] = []

    let result: Awaited<ReturnType<typeof main>> | undefined
    await actAsync(async () => {
      result = await main({
        checkRepo: () => true,
        createRenderer: async () => renderer,
        createController: async () => controller,
        loadConfig: async () => defaultAppConfig(),
        readFirstRunSeen: () => true,
        renderBootBanner: () => () => {},
        reportFirstRun: (report: FirstRunReport, options?: FirstRunGuidanceOptions) => {
          guidance.push(...formatFirstRunReport(report, options))
        },
        wireNotifier: () => {},
        onExit: () => {},
      })
    })

    expect(result).not.toBeNull()
    expect(guidance).toEqual([])

    await destroyMounted(renderer)
    await result?.closed
  })
})

describe("runtimeSetup", () => {
  it("maps a ready runtime in a repository to a ready setup state", () => {
    expect(
      runtimeSetup(
        { sessionId: "codex", providerKind: "codex", displayName: "Codex", title: "Codex", cwd: "/repo", ready: true, acpSessionId: "s" },
        () => true,
      ),
    ).toEqual({ agentId: "codex", displayName: "Codex", ready: true })
  })

  it("reports a ready runtime whose directory is not a repository as not ready", () => {
    const setup = runtimeSetup(
      { sessionId: "codex", providerKind: "codex", displayName: "Codex", title: "Codex", cwd: "/tmp/loose", ready: true, acpSessionId: "s" },
      () => false,
    )
    expect(setup.ready).toBe(false)
    expect(setup.gap).toContain("/tmp/loose")
    expect(setup.gap).toContain("not inside a git repository")
  })

  it("carries a not-ready runtime's error as the gap", () => {
    expect(
      runtimeSetup(
        { sessionId: "codex", providerKind: "codex", displayName: "Codex", title: "Codex", cwd: "/repo", ready: false, error: "boom" },
        () => true,
      ),
    ).toEqual({ agentId: "codex", displayName: "Codex", ready: false, gap: "boom" })
  })
})

describe("wantsSelfCheck", () => {
  it("detects the --self-check flag", () => {
    expect(wantsSelfCheck(["bun", "index.ts", "--self-check"])).toBe(true)
    expect(wantsSelfCheck(["bun", "index.ts"])).toBe(false)
  })

  it("enters MCP child mode only for the explicit reserved flag", () => {
    expect(wantsAskUserMcp(["bun", "index.ts", "--ask-user-mcp"])).toBe(true)
    expect(wantsAskUserMcp(["bun", "index.ts", "--self-check"])).toBe(false)
    expect(wantsAskUserMcp(["bun", "index.ts"])).toBe(false)
  })

  it("detects the opt-in real-adapter reload probe flag independently", () => {
    expect(wantsReloadProbe(["bun", "index.ts", "--self-check", "--reload-probe"])).toBe(true)
    expect(wantsReloadProbe(["bun", "index.ts", "--self-check"])).toBe(false)
  })
})

describe("CLI metadata flags", () => {
  it("detects --version independently from --self-check", () => {
    expect(wantsVersion(["--version"])).toBe(true)
    expect(wantsVersion(["--self-check"])).toBe(false)
  })

  it("prints exactly the package version and exits successfully", () => {
    const writes: string[] = []
    const exits: number[] = []

    expect(
      dispatchCliFlags(["--version"], {
        write: (output) => writes.push(output),
        exit: (code) => exits.push(code),
      }),
    ).toBe(true)
    expect(writes).toEqual([`${KITTEN_VERSION}\n`])
    expect(exits).toEqual([0])
  })

  it("prints examples-first help with install and self-check guidance, then exits successfully", () => {
    const writes: string[] = []
    const exits: number[] = []

    expect(
      dispatchCliFlags(["--help"], {
        write: (output) => writes.push(output),
        exit: (code) => exits.push(code),
      }),
    ).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toStartWith("Examples:\n")
    expect(writes[0]).toContain("npx @matheusbbarni/kitten")
    expect(writes[0]).toContain("--self-check")
    expect(writes[0]).toContain("npm i -g @matheusbbarni/kitten@latest")
    expect(writes[0]).toContain("raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh")
    expect(exits).toEqual([0])
  })

  it("leaves unknown flags for cockpit boot without writing or exiting", () => {
    const writes: string[] = []
    const exits: number[] = []
    const argv = ["--nope"]

    expect(wantsVersion(argv)).toBe(false)
    expect(wantsHelp(argv)).toBe(false)
    expect(wantsSelfCheck(argv)).toBe(false)
    expect(
      dispatchCliFlags(argv, {
        write: (output) => writes.push(output),
        exit: (code) => exits.push(code),
      }),
    ).toBe(false)
    expect(writes).toEqual([])
    expect(exits).toEqual([])
  })
})

describe("exitBlocked", () => {
  it("exits with a non-zero status", () => {
    const exit = spyOn(process, "exit").mockImplementation((() => undefined) as never)
    try {
      exitBlocked()
      expect(exit).toHaveBeenCalledWith(1)
    } finally {
      exit.mockRestore()
    }
  })
})

describe("createOfflineConnection", () => {
  const connection = createOfflineConnection({
    id: "codex",
    displayName: "Codex",
    command: "codex",
    args: [],
    env: {},
  })

  it("reports not ready without spawning a process", async () => {
    expect(connection.id).toBe("codex")
    expect(await connection.connect()).toEqual({ ready: false, error: expect.stringContaining("not started") })
  })

  it("has no session or prompt surface", async () => {
    await expect(connection.newSession("/tmp")).rejects.toThrow()
    await expect(connection.prompt("s", [])).rejects.toThrow()
  })

  it("is a no-op for cancel, updates, permission, and dispose", async () => {
    await connection.cancel("s")
    expect(typeof connection.onUpdate(() => {})).toBe("function")
    expect(connection.onPermission(async () => ({ outcome: "cancelled" }))).toBeUndefined()
    await connection.dispose()
  })
})

describe("runSelfCheck", () => {
  it("loads config, mounts the cockpit headlessly, and paints the transcript fixture", async () => {
    const { frame, highlights } = await runSelfCheck({
      loadConfig: async () => defaultAppConfig(),
      configureWorker: async () => null,
    })
    expect(frame).toContain(SELF_CHECK_DEFAULT_TOKEN)
    expect(highlights.fixtures.length).toBeGreaterThan(0)
    expect(highlights.fixtures.every(({ foreground }) => foreground !== highlights.defaultForeground)).toBeTrue()
    expect(highlights.unknownForeground).toBe(highlights.defaultForeground)
  })

  it("reports each skipped MCP declaration without leaking environment values", async () => {
    const config = defaultAppConfig()
    config.mcpServers = [{
      name: "unavailable",
      command: "/definitely/not/a/kitten-mcp-server",
      args: [],
      env: { TOKEN: "literal-secret-is-never-reported" },
    }]
    const { mcp } = await runSelfCheck({ loadConfig: async () => config, configureWorker: async () => null })

    const line = formatMcpSelfCheckLine(mcp[0]!)
    expect(line).toContain("unavailable")
    expect(line).toContain('command not found: "/definitely/not/a/kitten-mcp-server"')
    expect(line).not.toContain("literal-secret-is-never-reported")
  })
})
