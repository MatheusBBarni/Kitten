import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

import manifest from "../../../.release-please-manifest.json" with { type: "json" }
import pkg from "../package.json" with { type: "json" }
import config from "../../../release-please-config.json" with { type: "json" }

const PLATFORM_PACKAGES = [
  "@matheusbbarni/kitten-darwin-arm64",
  "@matheusbbarni/kitten-darwin-x64",
  "@matheusbbarni/kitten-linux-arm64",
  "@matheusbbarni/kitten-linux-x64",
] as const

describe("release-please configuration", () => {
  const tuiPackage = config.packages["packages/tui"]
  const workspaceRoot = resolve(import.meta.dir, "../../..")

  it("declares one Node package at packages/tui", () => {
    expect(Object.keys(config.packages)).toEqual(["packages/tui"])
    expect(tuiPackage["release-type"]).toBe("node")
  })

  it("seeds the TUI package above the placeholder version", () => {
    expect(manifest["packages/tui"]).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
    expect(manifest["packages/tui"]).not.toBe("0.0.0")
  })

  it("groups breaking changes, features, and fixes", () => {
    expect(tuiPackage["changelog-sections"]).toEqual([
      { type: "!", section: "Breaking Changes" },
      { type: "feat", section: "Features" },
      { type: "fix", section: "Fixes" },
    ])
  })

  it("uses the Node strategy's package.json updater and syncs platform pins", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
    expect(tuiPackage["extra-files"]).toEqual(
      PLATFORM_PACKAGES.map((name) => ({
        type: "json",
        path: "package.json",
        jsonpath: `$.optionalDependencies['${name}']`,
      })),
    )
  })

  it("keeps the release changelog with the TUI package", () => {
    expect(existsSync(resolve(workspaceRoot, "packages/tui/CHANGELOG.md"))).toBe(true)
    expect(existsSync(resolve(workspaceRoot, "CHANGELOG.md"))).toBe(false)
  })
})
