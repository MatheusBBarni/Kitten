import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

import rootTsconfig from "../../../tsconfig.json" with { type: "json" }
import tuiPackage from "../package.json" with { type: "json" }
import tuiTsconfig from "../tsconfig.json" with { type: "json" }

const TUI_ROOT = resolve(import.meta.dir, "..")
const WORKSPACE_ROOT = resolve(TUI_ROOT, "../..")

function runLifecycle(cwd: string, lifecycle: string): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(["bun", "run", lifecycle], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
}

function failureOutput(result: ReturnType<typeof Bun.spawnSync>): string {
  return `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`
}

describe("workspace forwarding", () => {
  it("runs the package-local TUI typecheck through its authoritative boundary", () => {
    const result = runLifecycle(TUI_ROOT, "typecheck")
    if (result.exitCode !== 0) throw new Error(failureOutput(result))

    expect(result.exitCode).toBe(0)
  }, 60_000)

  it("forwards the root typecheck to the same TUI lifecycle", () => {
    const result = runLifecycle(WORKSPACE_ROOT, "typecheck")
    if (result.exitCode !== 0) throw new Error(failureOutput(result))

    expect(result.exitCode).toBe(0)
  }, 60_000)

  it("boots the package-local Cockpit through its self-check", () => {
    const result = runLifecycle(TUI_ROOT, "selfcheck")
    if (result.exitCode !== 0) throw new Error(failureOutput(result))

    expect(result.stdout?.toString() ?? "").toContain("SELF-CHECK OK")
  }, 120_000)
})

describe("packages-only Cockpit ownership", () => {
  it("rejects root Cockpit source and test ownership", () => {
    expect(existsSync(resolve(WORKSPACE_ROOT, "src"))).toBe(false)
    expect(existsSync(resolve(WORKSPACE_ROOT, "test"))).toBe(false)
  })

  it("keeps the TUI test lifecycle package-local", () => {
    expect(tuiPackage.scripts.test).toBe(
      "bun test --cwd ../.. packages/tui/src packages/tui/test",
    )
    expect(tuiPackage.scripts["test:coverage"]).toBe(
      "bun test --cwd ../.. packages/tui/src packages/tui/test --coverage --isolate",
    )
    expect(tuiTsconfig.include).toEqual(["src", "test"])
    expect(rootTsconfig.include).toEqual(["packages/tui/src", "packages/tui/test"])
  })
})
