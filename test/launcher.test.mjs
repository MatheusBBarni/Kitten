import { describe, expect, it } from "bun:test"

import {
  NPM_PACKAGE_NAME,
  NPM_RECOVERY_COMMAND,
  NPM_UPDATE_SPECIFIER,
  RELEASE_URL,
  STANDALONE_RECOVERY_COMMAND,
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
    expect(platformBinarySpecifier("linux-x64")).toBe("@matheusbbarni/kitten-linux-x64/kitten-linux-x64")
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
      ["resolve", "@matheusbbarni/kitten-linux-x64/kitten-linux-x64"],
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

  for (const metadata of ["--version", "--help"]) {
    it(`forwards ${metadata} with --update without inspecting or invoking npm`, () => {
      const calls = []
      const exitCode = runLauncher({
        platform: "linux",
        arch: "x64",
        argv: ["--update", metadata],
        resolve: (specifier) => {
          calls.push(["resolve", specifier])
          return "/packages/kitten-linux-x64"
        },
        spawn: (command, argv, options) => {
          calls.push(["spawn", command, argv, options])
          return { status: 0 }
        },
        reportError: () => {
          throw new Error("unexpected launcher failure")
        },
      })

      expect(exitCode).toBe(0)
      expect(calls).toEqual([
        ["resolve", "@matheusbbarni/kitten-linux-x64/kitten-linux-x64"],
        ["spawn", "/packages/kitten-linux-x64", ["--update", metadata], { stdio: "inherit" }],
      ])
    })
  }

  it("updates only after proving both packages under the canonical global npm root", () => {
    const fixture = npmUpdateFixture({ resultVersion: "1.3.0" })

    expect(runLauncher(fixture.options)).toBe(0)
    expect(fixture.commandCalls).toEqual([
      ["npm", ["root", "--global"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }],
      ["npm", ["install", "--global", NPM_UPDATE_SPECIFIER], { stdio: "inherit" }],
    ])
    expect(fixture.manifestReads).toEqual([
      fixture.mainRoot,
      fixture.platformRoot,
      fixture.mainRoot,
      fixture.platformRoot,
    ])
    expect(fixture.outputs).toEqual(["Kitten updated via npm: 1.2.3 -> 1.3.0."])
    expect(fixture.errors).toEqual([])
  })

  it("reports an unchanged verified main package as already current", () => {
    const fixture = npmUpdateFixture({ resultVersion: "1.2.3" })

    expect(runLauncher(fixture.options)).toBe(0)
    expect(fixture.outputs).toEqual([
      "Kitten is already current via npm at version 1.2.3.\nNo change occurred.",
    ])
  })

  for (const scenario of [
    {
      name: "main package outside the root",
      paths: { mainRoot: "/workspace/node_modules/@matheusbbarni/kitten" },
    },
    {
      name: "platform package outside the root",
      paths: { platformRoot: "/workspace/node_modules/@matheusbbarni/kitten-linux-x64" },
    },
    {
      name: "global-root prefix collision",
      paths: { mainRoot: "/npm/global/lib/node_modules-lookalike/@matheusbbarni/kitten" },
    },
    {
      name: "local dependency layout",
      paths: {
        mainRoot: "/repo/node_modules/@matheusbbarni/kitten",
        platformRoot: "/repo/node_modules/@matheusbbarni/kitten-linux-x64",
      },
    },
    {
      name: "npx-shaped cache layout",
      paths: {
        mainRoot: "/tmp/.npm/_npx/hash/node_modules/@matheusbbarni/kitten",
        platformRoot: "/tmp/.npm/_npx/hash/node_modules/@matheusbbarni/kitten-linux-x64",
      },
    },
    {
      name: "split main and platform roots",
      paths: { platformRoot: "/other/global/node_modules/@matheusbbarni/kitten-linux-x64" },
    },
  ]) {
    it(`refuses a ${scenario.name} without install or binary spawn`, () => {
      const fixture = npmUpdateFixture({ ...scenario.paths })

      expect(runLauncher(fixture.options)).toBe(1)
      expect(fixture.commandCalls).toHaveLength(1)
      expect(fixture.commandCalls[0]?.slice(0, 2)).toEqual(["npm", ["root", "--global"]])
      expectSafeRefusal(fixture.errors)
    })
  }

  for (const rootOutput of ["", "relative/root\n", "/one\n/two\n", " /npm/global/lib/node_modules\n", "/root\0suffix\n"]) {
    it(`refuses malformed npm root output ${JSON.stringify(rootOutput)}`, () => {
      const fixture = npmUpdateFixture({ rootOutput })

      expect(runLauncher(fixture.options)).toBe(1)
      expect(fixture.commandCalls).toHaveLength(1)
      expectSafeRefusal(fixture.errors)
    })
  }

  it("refuses a missing or failed npm root command", () => {
    for (const rootResult of [{ status: null, error: new Error("ENOENT") }, { status: 2, stdout: "" }]) {
      const fixture = npmUpdateFixture({ rootResult })

      expect(runLauncher(fixture.options)).toBe(1)
      expect(fixture.commandCalls).toHaveLength(1)
      expectSafeRefusal(fixture.errors)
    }
  })

  it("refuses failed canonicalization before installation", () => {
    for (const failedPath of ["main", "binary", "platform", "global"]) {
      const fixture = npmUpdateFixture({ canonicalizeFailure: failedPath })

      expect(runLauncher(fixture.options)).toBe(1)
      expect(fixture.commandCalls.filter(([, argv]) => argv[0] === "install")).toEqual([])
      expectSafeRefusal(fixture.errors)
    }
  })

  it("refuses missing or mismatched package manifests before installation", () => {
    for (const manifestFailure of ["main-missing", "platform-missing", "main-name", "platform-name", "version-mismatch"]) {
      const fixture = npmUpdateFixture({ manifestFailure })

      expect(runLauncher(fixture.options)).toBe(1)
      expect(fixture.commandCalls.filter(([, argv]) => argv[0] === "install")).toEqual([])
      expectSafeRefusal(fixture.errors)
    }
  })

  it("reports npm install failure without spawning the platform binary or falling back", () => {
    const fixture = npmUpdateFixture({ installResult: { status: 17 } })

    expect(runLauncher(fixture.options)).toBe(1)
    expect(fixture.commandCalls).toHaveLength(2)
    expect(fixture.commandCalls[1]).toEqual([
      "npm",
      ["install", "--global", "@matheusbbarni/kitten@latest"],
      { stdio: "inherit" },
    ])
    expectSafeFailure(fixture.errors)
  })

  it("reports an unreadable or invalid post-install manifest without fallback", () => {
    for (const postManifestFailure of ["missing", "invalid-name"]) {
      const fixture = npmUpdateFixture({ postManifestFailure })

      expect(runLauncher(fixture.options)).toBe(1)
      expect(fixture.commandCalls).toHaveLength(2)
      expect(fixture.outputs).toEqual([])
      expectSafeFailure(fixture.errors)
    }
  })

  it("fails safely when the post-install platform package is absent or no longer matches", () => {
    for (const postInstallPlatformFailure of ["resolve", "missing", "invalid-name", "version-mismatch"]) {
      const fixture = npmUpdateFixture({ postInstallPlatformFailure })

      expect(runLauncher(fixture.options), postInstallPlatformFailure).toBe(1)
      expect(fixture.commandCalls, postInstallPlatformFailure).toEqual([
        ["npm", ["root", "--global"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }],
        ["npm", ["install", "--global", NPM_UPDATE_SPECIFIER], { stdio: "inherit" }],
      ])
      expect(fixture.outputs, postInstallPlatformFailure).toEqual([])
      expectSafeFailure(fixture.errors)
    }
  })

  it("uses update recovery output for unsupported or unresolved update hosts", () => {
    const errors = []
    const base = {
      argv: ["--update"],
      resolve: () => {
        throw new Error("missing")
      },
      spawn: () => {
        throw new Error("must not spawn")
      },
      reportError: (message) => errors.push(message),
    }

    expect(runLauncher({ ...base, platform: "win32", arch: "x64" })).toBe(1)
    expect(runLauncher({ ...base, platform: "linux", arch: "x64" })).toBe(1)
    expect(errors).toHaveLength(2)
    for (const error of errors) expectSafeRefusal([error])
  })
})

function npmUpdateFixture(overrides = {}) {
  const globalRoot = overrides.globalRoot ?? "/npm/global/lib/node_modules"
  const mainRoot = overrides.mainRoot ?? `${globalRoot}/${NPM_PACKAGE_NAME}`
  const platformRoot = overrides.platformRoot ?? `${globalRoot}/${NPM_PACKAGE_NAME}-linux-x64`
  const binary = `${platformRoot}/kitten-linux-x64`
  const commandCalls = []
  const manifestReads = []
  const outputs = []
  const errors = []
  let mainReads = 0
  let platformReads = 0
  let installed = false

  const options = {
    platform: "linux",
    arch: "x64",
    argv: ["--update"],
    packageRoot: mainRoot,
    resolve: () => {
      if (installed && overrides.postInstallPlatformFailure === "resolve") throw new Error("missing after install")
      return binary
    },
    canonicalize: (path) => {
      const call = path === mainRoot
        ? "main"
        : path === binary
          ? "binary"
          : path === platformRoot
            ? "platform"
            : path === globalRoot
              ? "global"
              : "other"
      if (call === overrides.canonicalizeFailure) throw new Error(`failed ${call}`)
      return path
    },
    readManifest: (root) => {
      manifestReads.push(root)
      if (root === mainRoot) {
        mainReads += 1
        if (mainReads === 1 && overrides.manifestFailure === "main-missing") throw new Error("missing")
        if (mainReads > 1 && overrides.postManifestFailure === "missing") throw new Error("missing")
        return {
          name:
            mainReads > 1 && overrides.postManifestFailure === "invalid-name"
              ? "not-kitten"
              : overrides.manifestFailure === "main-name"
                ? "not-kitten"
                : NPM_PACKAGE_NAME,
          version: mainReads === 1 ? "1.2.3" : (overrides.resultVersion ?? "1.3.0"),
        }
      }
      if (root === platformRoot) {
        platformReads += 1
        if (overrides.manifestFailure === "platform-missing") throw new Error("missing")
        if (platformReads > 1 && overrides.postInstallPlatformFailure === "missing") throw new Error("missing")
        return {
          name:
            overrides.manifestFailure === "platform-name" ||
              (platformReads > 1 && overrides.postInstallPlatformFailure === "invalid-name")
              ? "not-platform"
              : `${NPM_PACKAGE_NAME}-linux-x64`,
          version:
            overrides.manifestFailure === "version-mismatch" ||
              (platformReads > 1 && overrides.postInstallPlatformFailure === "version-mismatch")
              ? "9.9.9"
              : platformReads === 1
                ? "1.2.3"
                : (overrides.resultVersion ?? "1.3.0"),
        }
      }
      throw new Error(`unexpected manifest root ${root}`)
    },
    spawn: (command, argv, options) => {
      commandCalls.push([command, argv, options])
      if (argv[0] === "root") {
        return overrides.rootResult ?? { status: 0, stdout: overrides.rootOutput ?? `${globalRoot}\n` }
      }
      if (argv[0] === "install") {
        const result = overrides.installResult ?? { status: 0 }
        if (result.status === 0) installed = true
        return result
      }
      throw new Error(`unexpected command ${command} ${argv.join(" ")}`)
    },
    reportOutput: (message) => outputs.push(message),
    reportError: (message) => errors.push(message),
  }

  return { options, globalRoot, mainRoot, platformRoot, binary, commandCalls, manifestReads, outputs, errors }
}

function expectSafeRefusal(errors) {
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain("Kitten update refused:")
  expect(errors[0]).toContain("No change occurred.")
  expect(errors[0]).toContain(NPM_RECOVERY_COMMAND)
  expect(errors[0]).toContain(STANDALONE_RECOVERY_COMMAND)
}

function expectSafeFailure(errors) {
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain("Kitten update failed:")
  expect(errors[0]).toContain("No change occurred.")
  expect(errors[0]).toContain(NPM_RECOVERY_COMMAND)
  expect(errors[0]).toContain(STANDALONE_RECOVERY_COMMAND)
}
