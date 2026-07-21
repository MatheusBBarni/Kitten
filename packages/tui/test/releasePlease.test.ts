import { describe, expect, it } from "bun:test"

import manifest from "../../../.release-please-manifest.json" with { type: "json" }
import pkg from "../../../package.json" with { type: "json" }
import config from "../../../release-please-config.json" with { type: "json" }

const PLATFORM_PACKAGES = [
  "@matheusbbarni/kitten-darwin-arm64",
  "@matheusbbarni/kitten-darwin-x64",
  "@matheusbbarni/kitten-linux-arm64",
  "@matheusbbarni/kitten-linux-x64",
] as const

describe("release-please configuration", () => {
  const rootPackage = config.packages["."]

  it("declares one Node package at the repository root", () => {
    expect(Object.keys(config.packages)).toEqual(["."])
    expect(rootPackage["release-type"]).toBe("node")
  })

  it("seeds the root package above the placeholder version", () => {
    expect(manifest["."]).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
    expect(manifest["."]).not.toBe("0.0.0")
  })

  it("groups breaking changes, features, and fixes", () => {
    expect(rootPackage["changelog-sections"]).toEqual([
      { type: "!", section: "Breaking Changes" },
      { type: "feat", section: "Features" },
      { type: "fix", section: "Fixes" },
    ])
  })

  it("uses the Node strategy's package.json updater and syncs platform pins", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
    expect(rootPackage["extra-files"]).toEqual(
      PLATFORM_PACKAGES.map((name) => ({
        type: "json",
        path: "package.json",
        jsonpath: `$.optionalDependencies['${name}']`,
      })),
    )
  })
})
