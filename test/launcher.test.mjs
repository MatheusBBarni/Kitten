import { describe, expect, it } from "bun:test"

import {
  RELEASE_URL,
  platformBinarySpecifier,
  platformSlug,
  runLauncher,
} from "../bin/launcher.mjs"

describe("Node launcher", () => {
  it("maps every supported Node platform and architecture to its package slug", () => {
    expect(platformSlug("darwin", "arm64")).toBe("darwin-arm64")
    expect(platformSlug("darwin", "x64")).toBe("darwin-x64")
    expect(platformSlug("linux", "arm64")).toBe("linux-arm64")
    expect(platformSlug("linux", "x64")).toBe("linux-x64")
  })

  it("builds the platform package binary subpath", () => {
    expect(platformBinarySpecifier("linux-x64")).toBe("@kitten/linux-x64/kitten-linux-x64")
  })

  it("resolves the host package and forwards argv, stdio, and exit status", () => {
    const calls = []
    const exitCode = runLauncher({
      platform: "linux",
      arch: "x64",
      argv: ["--version"],
      resolve: (specifier) => {
        calls.push(["resolve", specifier])
        return "/packages/kitten-linux-x64"
      },
      spawn: (binary, argv, options) => {
        calls.push(["spawn", binary, argv, options])
        return { status: 7 }
      },
      reportError: () => {
        throw new Error("unexpected launcher failure")
      },
    })

    expect(exitCode).toBe(7)
    expect(calls).toEqual([
      ["resolve", "@kitten/linux-x64/kitten-linux-x64"],
      ["spawn", "/packages/kitten-linux-x64", ["--version"], { stdio: "inherit" }],
    ])
  })

  it("fails unsupported hosts loudly with the Release URL", () => {
    const errors = []
    const exitCode = runLauncher({
      platform: "win32",
      arch: "x64",
      argv: [],
      resolve: () => "unused",
      spawn: () => ({ status: 0 }),
      reportError: (message) => errors.push(message),
    })

    expect(exitCode).toBe(1)
    expect(errors).toEqual([expect.stringContaining("unsupported platform win32-x64")])
    expect(errors[0]).toContain(RELEASE_URL)
  })

  it("fails a missing optional platform package loudly with the Release URL", () => {
    const errors = []
    const exitCode = runLauncher({
      platform: "darwin",
      arch: "arm64",
      argv: [],
      resolve: () => {
        throw new Error("module not found")
      },
      spawn: () => ({ status: 0 }),
      reportError: (message) => errors.push(message),
    })

    expect(exitCode).toBe(1)
    expect(errors[0]).toContain("no prebuilt binary for darwin-arm64")
    expect(errors[0]).toContain(RELEASE_URL)
  })

  it("reports spawn failures and treats signal-only exits as failures", () => {
    const errors = []
    const base = {
      platform: "linux",
      arch: "arm64",
      argv: [],
      resolve: () => "/packages/kitten-linux-arm64",
      reportError: (message) => errors.push(message),
    }

    expect(runLauncher({ ...base, spawn: () => ({ status: null, error: new Error("EACCES") }) })).toBe(1)
    expect(errors[0]).toContain("failed to launch linux-arm64: EACCES")
    expect(runLauncher({ ...base, spawn: () => ({ status: null, signal: "SIGTERM" }) })).toBe(1)
  })
})
