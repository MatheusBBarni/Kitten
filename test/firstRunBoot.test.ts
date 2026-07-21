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
  dispatchPreBootCliFlags,
  dispatchReservedChildMode,
  dispatchStandaloneRecordMode,
  dispatchStandaloneUpdate,
  exitBlocked,
  main,
  runtimeSetup,
  STANDALONE_RECORD_MODE_FLAG,
  wantsAskUserMcp,
  wantsContextPackMcp,
  wantsHelp,
  wantsReloadProbe,
  wantsSelfCheck,
  wantsUpdate,
  wantsVersion,
} from "../src/index.ts"
import type { AgentRuntimeState } from "../src/app/controller.ts"
import { createAppStore } from "../src/store/appStore.ts"
import { NPM_RECOVERY_COMMAND, STANDALONE_RECOVERY_COMMAND, type UpdateOutcome } from "../src/update.ts"
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
    expect(guidance.filter((line) => line.includes("loaded its built-in ask_user MCP bridge"))).toHaveLength(1)
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
    expect(wantsAskUserMcp(["bun", "index.ts", "--context-pack-mcp"])).toBe(false)
    expect(wantsAskUserMcp(["bun", "index.ts", "--self-check"])).toBe(false)
    expect(wantsAskUserMcp(["bun", "index.ts"])).toBe(false)

    expect(wantsContextPackMcp(["bun", "index.ts", "--context-pack-mcp"])).toBe(true)
    expect(wantsContextPackMcp(["bun", "index.ts", "--ask-user-mcp"])).toBe(false)
    expect(wantsContextPackMcp(["bun", "index.ts", "--self-check"])).toBe(false)
  })

  it("detects the opt-in real-adapter reload probe flag independently", () => {
    expect(wantsReloadProbe(["bun", "index.ts", "--self-check", "--reload-probe"])).toBe(true)
    expect(wantsReloadProbe(["bun", "index.ts", "--self-check"])).toBe(false)
  })

  it("recognizes only an explicit public update flag", () => {
    expect(wantsUpdate(["--update"])).toBe(true)
    expect(wantsUpdate(["kitten", "--self-check"])).toBe(false)
    expect(wantsUpdate(["kitten", "--unknown"])).toBe(false)
  })
})

describe("private standalone record dispatch", () => {
  it("keeps the private installer handoff ahead of public update dispatch", async () => {
    const argv = [
      "kitten",
      "--update",
      STANDALONE_RECORD_MODE_FLAG,
      "/usr/local/bin/kitten",
      "linux-x64",
      "a".repeat(64),
    ]
    let records = 0
    let updates = 0

    const recordHandled = await dispatchStandaloneRecordMode(argv, {
      record: async (input) => {
        records += 1
        return {
          ok: true,
          value: {
            schemaVersion: 1,
            canonicalPath: input.targetPath,
            platform: input.platform,
            version: "1.2.3",
            sha256: input.sha256,
          },
        }
      },
      exit: () => {},
    })
    if (!recordHandled) {
      await dispatchPreBootCliFlags(argv, {
        runUpdate: async () => {
          updates += 1
          return { kind: "already-current", channel: "standalone", version: "1.2.3" }
        },
      })
    }

    expect(recordHandled).toBe(true)
    expect(records).toBe(1)
    expect(updates).toBe(0)
  })

  it("short-circuits before MCP, self-check, repository, renderer, agent, or network work", async () => {
    const calls = {
      record: 0,
      mcp: 0,
      selfCheck: 0,
      repository: 0,
      renderer: 0,
      agent: 0,
      network: 0,
    }
    const exits: number[] = []
    const handled = await dispatchStandaloneRecordMode(
      ["kitten", STANDALONE_RECORD_MODE_FLAG, "/usr/local/bin/kitten", "linux-x64", "a".repeat(64)],
      {
        record: async (input) => {
          calls.record += 1
          return {
            ok: true,
            value: {
              schemaVersion: 1,
              canonicalPath: input.targetPath,
              platform: input.platform,
              version: "1.2.3",
              sha256: input.sha256,
            },
          }
        },
        exit: (code) => exits.push(code),
      },
    )

    if (!handled) {
      calls.mcp += 1
      calls.selfCheck += 1
      calls.repository += 1
      calls.renderer += 1
      calls.agent += 1
      calls.network += 1
    }

    expect(calls).toEqual({
      record: 1,
      mcp: 0,
      selfCheck: 0,
      repository: 0,
      renderer: 0,
      agent: 0,
      network: 0,
    })
    expect(exits).toEqual([0])
  })

  it("exits nonzero on validation failure without continuing into boot", async () => {
    const errors: string[] = []
    const exits: number[] = []
    expect(await dispatchStandaloneRecordMode(
      ["kitten", STANDALONE_RECORD_MODE_FLAG, "/tmp/kitten", "linux-x64", "a".repeat(64)],
      {
        record: async () => ({
          ok: false,
          outcome: { kind: "refused", message: "target identity mismatch" },
        }),
        writeError: (output) => errors.push(output),
        exit: (code) => exits.push(code),
      },
    )).toBe(true)
    expect(errors).toEqual(["STANDALONE RECORD FAILED: target identity mismatch\n"])
    expect(exits).toEqual([1])
  })

  it("rejects malformed installer arguments without invoking the writer", async () => {
    let records = 0
    const exits: number[] = []
    expect(await dispatchStandaloneRecordMode(
      ["kitten", STANDALONE_RECORD_MODE_FLAG, "/tmp/kitten", "linux-x64"],
      {
        record: async () => {
          records += 1
          throw new Error("must not run")
        },
        writeError: () => {},
        exit: (code) => exits.push(code),
      },
    )).toBe(true)
    expect(records).toBe(0)
    expect(exits).toEqual([1])
  })
})

describe("reserved MCP child dispatch", () => {
  it("keeps reserved child modes ahead of public update dispatch", async () => {
    const argv = ["kitten", "--context-pack-mcp", "--update"]
    let childRuns = 0
    let updates = 0

    const childHandled = await dispatchReservedChildMode(argv, {}, {
      run: async () => { childRuns += 1 },
    })
    if (!childHandled) {
      await dispatchPreBootCliFlags(argv, {
        runUpdate: async () => {
          updates += 1
          return { kind: "already-current", channel: "standalone", version: KITTEN_VERSION }
        },
      })
    }

    expect(childHandled).toBe(true)
    expect(childRuns).toBe(1)
    expect(updates).toBe(0)
  })

  it("runs before normal repository and readiness boot paths", async () => {
    let childRuns = 0
    let normalBoots = 0

    const handled = await dispatchReservedChildMode(
      ["bun", "index.ts", "--ask-user-mcp"],
      {},
      { run: async () => { childRuns += 1 } },
    )
    if (!handled) normalBoots += 1

    expect(childRuns).toBe(1)
    expect(normalBoots).toBe(0)
  })

  it("preserves the generic child failure discipline", async () => {
    const errors: string[] = []
    const exits: number[] = []

    expect(await dispatchReservedChildMode(
      ["bun", "index.ts", "--ask-user-mcp"],
      {},
      {
        run: async () => { throw new Error("private transport detail") },
        writeError: (output) => errors.push(output),
        exit: (code) => exits.push(code),
      },
    )).toBe(true)

    expect(errors).toEqual(["ASK_USER MCP FAILED: unavailable\n"])
    expect(errors.join("")).not.toContain("private transport detail")
    expect(exits).toEqual([1])
  })

  it("dispatches the isolated Context Pack child before normal boot", async () => {
    let childRuns = 0
    expect(await dispatchReservedChildMode(
      ["bun", "index.ts", "--context-pack-mcp"],
      {},
      { run: async () => { childRuns += 1 } },
    )).toBe(true)
    expect(childRuns).toBe(1)
  })

  it("keeps Context Pack child failures generic and separate from the mixed bridge", async () => {
    const errors: string[] = []
    const exits: number[] = []
    expect(await dispatchReservedChildMode(
      ["bun", "index.ts", "--context-pack-mcp"],
      {},
      {
        run: async () => { throw new Error("private context route") },
        writeError: (output) => errors.push(output),
        exit: (code) => exits.push(code),
      },
    )).toBe(true)
    expect(errors).toEqual(["CONTEXT PACK MCP FAILED: unavailable\n"])
    expect(errors.join("")).not.toContain("private context route")
    expect(exits).toEqual([1])
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

  it("prints examples-first help with channel-preserving update guidance, then exits successfully", () => {
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
    expect(writes[0]).toContain("kitten --update")
    expect(writes[0]).toContain("latest stable")
    expect(writes[0]).toContain("--self-check")
    expect(writes[0]).toContain("Only verified global npm installs and installer-managed standalone binaries can update.")
    expect(writes[0]).toContain("Source, local, npx, copied, and unknown contexts remain unchanged")
    expect(writes[0]).toContain("there is no channel fallback")
    expect(writes[0]).toContain("does not launch the Cockpit, require a repository, start agents, prompt, or relaunch")
    expect(writes[0]).toContain("npm install --global @matheusbbarni/kitten@latest")
    expect(writes[0]).toContain(
      "curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash",
    )
    expect(writes[0]).not.toContain("npm i -g")
    expect(writes[0]).not.toContain(" | sh\n")
    expect(writes[0]).not.toContain(STANDALONE_RECORD_MODE_FLAG)
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

describe("public standalone update dispatch", () => {
  it("uses the production stdout and exit seams for a handled update", async () => {
    const write = spyOn(process.stdout, "write").mockImplementation((() => true) as never)
    const exit = spyOn(process, "exit").mockImplementation((() => undefined) as never)
    try {
      expect(await dispatchStandaloneUpdate(["kitten", "--update"], {
        run: async () => ({
          kind: "already-current",
          channel: "standalone",
          version: KITTEN_VERSION,
        }),
      })).toBe(true)
      expect(write).toHaveBeenCalledTimes(1)
      expect(write).toHaveBeenCalledWith(
        `Kitten is already current via standalone at version ${KITTEN_VERSION}.\nNo change occurred.\n`,
      )
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      write.mockRestore()
      exit.mockRestore()
    }
  })

  it.each([
    {
      outcome: { kind: "updated", channel: "standalone", from: "1.2.3", to: "1.3.0" } satisfies UpdateOutcome,
      expected: "Kitten updated via standalone: 1.2.3 -> 1.3.0.\n",
    },
    {
      outcome: { kind: "already-current", channel: "standalone", version: "1.3.0" } satisfies UpdateOutcome,
      expected: "Kitten is already current via standalone at version 1.3.0.\nNo change occurred.\n",
    },
  ])("writes one successful $outcome.kind outcome and exits zero", async ({ outcome, expected }) => {
    const writes: string[] = []
    const exits: number[] = []

    expect(await dispatchStandaloneUpdate(["kitten", "--update"], {
      run: async () => outcome,
      write: (output) => writes.push(output),
      exit: (code) => exits.push(code),
    })).toBe(true)

    expect(writes).toEqual([expected])
    expect(exits).toEqual([0])
  })

  it.each([
    { kind: "refused", message: "standalone ownership was not proven" },
    { kind: "failed", message: "the standalone transaction failed safely" },
  ] satisfies UpdateOutcome[])("writes one fail-closed $kind outcome and exits nonzero", async (outcome) => {
    const writes: string[] = []
    const exits: number[] = []

    expect(await dispatchStandaloneUpdate(["kitten", "--update"], {
      run: async () => outcome,
      write: (output) => writes.push(output),
      exit: (code) => exits.push(code),
    })).toBe(true)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain("No change occurred.")
    expect(writes[0]).toContain(NPM_RECOVERY_COMMAND)
    expect(writes[0]).toContain(STANDALONE_RECOVERY_COMMAND)
    expect(exits).toEqual([1])
  })

  it("sanitizes an unexpected runner rejection", async () => {
    const writes: string[] = []
    const exits: number[] = []

    expect(await dispatchStandaloneUpdate(["kitten", "--update"], {
      run: async () => { throw new Error("private update cause") },
      write: (output) => writes.push(output),
      exit: (code) => exits.push(code),
    })).toBe(true)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain("Kitten update failed")
    expect(writes[0]).toContain("No change occurred.")
    expect(writes[0]).toContain(NPM_RECOVERY_COMMAND)
    expect(writes[0]).toContain(STANDALONE_RECOVERY_COMMAND)
    expect(writes[0]).not.toContain("private update cause")
    expect(exits).toEqual([1])
  })

  it.each([
    { argv: ["kitten", "--version", "--update"], expected: `${KITTEN_VERSION}\n` },
    { argv: ["kitten", "--help", "--update"], expected: "Examples:\n" },
  ])("keeps metadata precedence for $argv", async ({ argv, expected }) => {
    const writes: string[] = []
    const exits: number[] = []
    let updates = 0

    expect(await dispatchPreBootCliFlags(argv, {
      runUpdate: async () => {
        updates += 1
        return { kind: "already-current", channel: "standalone", version: KITTEN_VERSION }
      },
      write: (output) => writes.push(output),
      exit: (code) => exits.push(code),
    })).toBe(true)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toStartWith(expected)
    expect(writes[0]).not.toContain("already current")
    if (expected === "Examples:\n") {
      expect(writes[0]).toContain("kitten --update")
      expect(writes[0]).toContain("npm install --global @matheusbbarni/kitten@latest")
      expect(writes[0]).toContain(
        "curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash",
      )
    }
    expect(updates).toBe(0)
    expect(exits).toEqual([0])
  })

  it("runs update before self-check and leaves unknown flags for normal boot", async () => {
    let updates = 0
    let selfChecks = 0
    let normalBoots = 0

    const updateArgv = ["kitten", "--update", "--self-check"]
    const updateHandled = await dispatchPreBootCliFlags(updateArgv, {
      runUpdate: async () => {
        updates += 1
        return { kind: "already-current", channel: "standalone", version: KITTEN_VERSION }
      },
      write: () => {},
      exit: () => {},
    })
    if (!updateHandled && wantsSelfCheck(updateArgv)) selfChecks += 1

    const unknownHandled = await dispatchPreBootCliFlags(["kitten", "--unknown"], {
      runUpdate: async () => {
        updates += 1
        throw new Error("unknown flags must not update")
      },
      write: () => {},
      exit: () => {},
    })
    if (!unknownHandled) normalBoots += 1

    expect(updateHandled).toBe(true)
    expect(unknownHandled).toBe(false)
    expect(updates).toBe(1)
    expect(selfChecks).toBe(0)
    expect(normalBoots).toBe(1)
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
    expect(line).toContain("ask_user=attached")
    expect(line).toContain('command not found: "/definitely/not/a/kitten-mcp-server"')
    expect(line).not.toContain("literal-secret-is-never-reported")
  })
})
