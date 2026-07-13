import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

import pkg from "../package.json" with { type: "json" }

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8")

const PLATFORM_PACKAGES = [
  "@kitten/darwin-arm64",
  "@kitten/darwin-x64",
  "@kitten/linux-arm64",
  "@kitten/linux-x64",
] as const

describe("main npm package shim contract", () => {
  it("ships the Node launcher instead of the Bun source tree", () => {
    expect(pkg.bin).toEqual({ kitten: "bin/kitten.mjs" })
    expect(pkg.files).toEqual(["bin"])
    expect(pkg).not.toHaveProperty("module")
    expect(pkg).not.toHaveProperty("engines.bun")
  })

  it("exact-pins every platform package to the main package version", () => {
    expect(Object.keys(pkg.optionalDependencies)).toEqual([...PLATFORM_PACKAGES])
    for (const name of PLATFORM_PACKAGES) {
      expect(pkg.optionalDependencies[name]).toBe(pkg.version)
    }
  })

  it("declares no lifecycle install scripts", () => {
    expect(pkg.scripts).not.toHaveProperty("preinstall")
    expect(pkg.scripts).not.toHaveProperty("install")
    expect(pkg.scripts).not.toHaveProperty("postinstall")
  })

  it("leads the README install story with npx, then the global channel and version check", () => {
    const firstShellCommand = README.match(/```bash\n([^\n]+)/)?.[1]
    expect(firstShellCommand).toBe("npx kitten")
    expect(README.indexOf("npm i -g kitten")).toBeGreaterThan(README.indexOf("npx kitten"))
    expect(README).toContain("npx kitten --version")
  })
})
