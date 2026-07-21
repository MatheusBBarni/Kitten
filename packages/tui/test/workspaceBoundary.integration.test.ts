import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"

const TUI_ROOT = resolve(import.meta.dir, "..")
const WORKSPACE_ROOT = resolve(TUI_ROOT, "../..")

function runTypecheck(cwd: string): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(["bun", "run", "typecheck"], {
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
  it("runs the package-local TUI typecheck through its temporary boundary", () => {
    const result = runTypecheck(TUI_ROOT)
    if (result.exitCode !== 0) throw new Error(failureOutput(result))

    expect(result.exitCode).toBe(0)
  }, 60_000)

  it("forwards the root typecheck to the same TUI lifecycle", () => {
    const result = runTypecheck(WORKSPACE_ROOT)
    if (result.exitCode !== 0) throw new Error(failureOutput(result))

    expect(result.exitCode).toBe(0)
  }, 60_000)
})
