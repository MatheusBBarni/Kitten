import { describe, expect, it, spyOn } from "bun:test"

import { createTestRenderer } from "@opentui/core/testing"

import { createOfflineConnection, runSelfCheck } from "../src/app/selfCheck.ts"
import { defaultAppConfig } from "../src/config/configLoader.ts"
import { REPO_REQUIREMENT_MESSAGE, type FirstRunReport } from "../src/config/firstRun.ts"
import {
  exitBlocked,
  main,
  runtimeSetup,
  wantsSelfCheck,
} from "../src/index.ts"
import type { AgentRuntimeState } from "../src/app/controller.ts"
import { createFakeController } from "./fakeController.ts"

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
  it("restores the terminal and reports gaps when no agent is ready", async () => {
    const { renderer } = await createTestRenderer({ width: 80, height: 24 })
    const notReady: AgentRuntimeState[] = [
      { agentId: "claude-code", displayName: "Claude Code", ready: false, error: "Claude Code: command not found." },
      { agentId: "codex", displayName: "Codex", ready: false, error: "Codex: not authenticated." },
    ]
    const controller = createFakeController({ runtimes: notReady })
    let reported: FirstRunReport | undefined

    const result = await main({
      checkRepo: () => true,
      createRenderer: async () => renderer,
      createController: async () => controller,
      reportFirstRun: (report) => {
        reported = report
      },
      onBlocked: () => {},
    })

    expect(result).toBeNull()
    expect(renderer.isDestroyed).toBe(true)
    expect(controller.calls.dispose).toBe(1)
    expect(reported?.blocked).toBe(true)
    expect(reported?.gaps).toEqual(["Claude Code: command not found.", "Codex: not authenticated."])
  })
})

describe("runtimeSetup", () => {
  it("maps a ready runtime to a ready setup state", () => {
    expect(
      runtimeSetup({ agentId: "codex", displayName: "Codex", ready: true, sessionId: "s" }),
    ).toEqual({ agentId: "codex", displayName: "Codex", ready: true })
  })

  it("carries a not-ready runtime's error as the gap", () => {
    expect(
      runtimeSetup({ agentId: "codex", displayName: "Codex", ready: false, error: "boom" }),
    ).toEqual({ agentId: "codex", displayName: "Codex", ready: false, gap: "boom" })
  })
})

describe("wantsSelfCheck", () => {
  it("detects the --self-check flag", () => {
    expect(wantsSelfCheck(["bun", "index.ts", "--self-check"])).toBe(true)
    expect(wantsSelfCheck(["bun", "index.ts"])).toBe(false)
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
  it("loads config, mounts the cockpit headlessly, and paints an agent name", async () => {
    const { frame } = await runSelfCheck({ loadConfig: async () => defaultAppConfig() })
    expect(frame).toContain("Claude Code")
  })
})
