import { describe, expect, test } from "bun:test"

import {
  createExternalEditorLauncher,
  type EditorPreference,
  type ExternalEditorSpawn,
  type ExternalEditorSpawnOptions,
  type OpenableFile,
} from "./externalEditor.ts"

const FILE = {
  kind: "openable-file",
  absolutePath: "/workspace/src/file with spaces.ts",
} as const satisfies OpenableFile

function createSpawn(exitCodes: readonly number[]) {
  const calls: ExternalEditorSpawnOptions[] = []
  const spawn: ExternalEditorSpawn = (options) => {
    calls.push(options)
    const exitCode = exitCodes[calls.length - 1]
    if (exitCode === undefined) throw new Error("unexpected spawn")
    return { exited: Promise.resolve(exitCode) }
  }
  return { calls, spawn }
}

describe("external editor launcher", () => {
  test.each([
    ["darwin", ["open", FILE.absolutePath]],
    ["linux", ["xdg-open", FILE.absolutePath]],
  ] as const)("uses the exact %s system-default argv without a shell", async (platform, cmd) => {
    const fake = createSpawn([0])
    const launcher = createExternalEditorLauncher({ platform, spawn: fake.spawn })

    await expect(launcher.launch(FILE, { kind: "system-default" })).resolves.toEqual({
      kind: "system-default-dispatched",
    })
    expect(fake.calls).toEqual([
      {
        cmd: [...cmd],
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    ])
    expect("shell" in fake.calls[0]!).toBe(false)
  })

  test("substitutes one full file token into a direct custom argv", async () => {
    const fake = createSpawn([0])
    const launcher = createExternalEditorLauncher({ platform: "linux", spawn: fake.spawn })

    await expect(
      launcher.launch(FILE, {
        kind: "custom",
        executable: "code",
        args: ["--reuse-window", "{file}", "--wait"],
      }),
    ).resolves.toEqual({ kind: "custom-dispatched" })
    expect(fake.calls.map((call) => call.cmd)).toEqual([
      ["code", "--reuse-window", FILE.absolutePath, "--wait"],
    ])
  })

  test.each([
    { kind: "custom", executable: "code", args: [] },
    { kind: "custom", executable: "code", args: ["--goto={file}"] },
    { kind: "custom", executable: "code", args: ["{file}", "{file}"] },
    { kind: "custom", executable: "code", args: ["{file}{file}"] },
    { kind: "custom", executable: "", args: ["{file}"] },
    { kind: "custom", executable: "   ", args: ["{file}"] },
  ] as const)("rejects malformed custom preference %# without spawning", async (preference) => {
    const fake = createSpawn([])
    const launcher = createExternalEditorLauncher({ platform: "linux", spawn: fake.spawn })

    await expect(
      launcher.launch(FILE, preference as EditorPreference),
    ).resolves.toEqual({ kind: "failed" })
    expect(fake.calls).toHaveLength(0)
  })

  test("does not fall back after a successful custom dispatch", async () => {
    const fake = createSpawn([0])
    const launcher = createExternalEditorLauncher({ platform: "darwin", spawn: fake.spawn })

    await expect(
      launcher.launch(FILE, { kind: "custom", executable: "zed", args: ["{file}"] }),
    ).resolves.toEqual({ kind: "custom-dispatched" })
    expect(fake.calls).toHaveLength(1)
  })

  test("falls back exactly once after a failed custom dispatch", async () => {
    const fake = createSpawn([1, 0])
    const launcher = createExternalEditorLauncher({ platform: "linux", spawn: fake.spawn })

    await expect(
      launcher.launch(FILE, { kind: "custom", executable: "code", args: ["{file}"] }),
    ).resolves.toEqual({ kind: "fallback-dispatched" })
    expect(fake.calls.map((call) => call.cmd)).toEqual([
      ["code", FILE.absolutePath],
      ["xdg-open", FILE.absolutePath],
    ])
  })

  test("reports final failure after the one allowed fallback", async () => {
    const fake = createSpawn([1, 1])
    const launcher = createExternalEditorLauncher({ platform: "darwin", spawn: fake.spawn })

    await expect(
      launcher.launch(FILE, { kind: "custom", executable: "zed", args: ["{file}"] }),
    ).resolves.toEqual({ kind: "failed" })
    expect(fake.calls.map((call) => call.cmd)).toEqual([
      ["zed", FILE.absolutePath],
      ["open", FILE.absolutePath],
    ])
  })

  test("contains synchronous spawn and asynchronous process failures", async () => {
    const synchronous = createExternalEditorLauncher({
      platform: "linux",
      spawn() {
        throw new Error("missing binary")
      },
    })
    const asynchronous = createExternalEditorLauncher({
      platform: "linux",
      spawn() {
        return { exited: Promise.reject(new Error("process failed")) }
      },
    })

    await expect(synchronous.launch(FILE, { kind: "system-default" })).resolves.toEqual({
      kind: "failed",
    })
    await expect(asynchronous.launch(FILE, { kind: "system-default" })).resolves.toEqual({
      kind: "failed",
    })
  })

  test("distinguishes an unsupported platform without spawning", async () => {
    const fake = createSpawn([])
    const launcher = createExternalEditorLauncher({ platform: "win32", spawn: fake.spawn })

    await expect(launcher.launch(FILE, { kind: "system-default" })).resolves.toEqual({
      kind: "unsupported-platform",
    })
    expect(fake.calls).toHaveLength(0)
  })

  test("rejects an invalid openable-file token without spawning", async () => {
    const fake = createSpawn([])
    const launcher = createExternalEditorLauncher({ platform: "linux", spawn: fake.spawn })

    await expect(
      launcher.launch(
        { kind: "openable-file", absolutePath: "" },
        { kind: "system-default" },
      ),
    ).resolves.toEqual({ kind: "failed" })
    expect(fake.calls).toHaveLength(0)
  })
})
