import { describe, expect, it } from "bun:test"

import manifest from "../.release-please-manifest.json" with { type: "json" }
import pkg from "../package.json" with { type: "json" }
import config from "../release-please-config.json" with { type: "json" }

describe("release-please configuration", () => {
  const rootPackage = config.packages["."]

  it("declares one Node package at the repository root", () => {
    expect(Object.keys(config.packages)).toEqual(["."])
    expect(rootPackage["release-type"]).toBe("node")
  })

  it("seeds the root package above the placeholder version", () => {
    expect(manifest).toEqual({ ".": "0.1.0" })
    expect(manifest["."]).not.toBe("0.0.0")
  })

  it("groups breaking changes, features, and fixes", () => {
    expect(rootPackage["changelog-sections"]).toEqual([
      { type: "!", section: "Breaking Changes" },
      { type: "feat", section: "Features" },
      { type: "fix", section: "Fixes" },
    ])
  })

  it("uses the Node strategy's package.json updater without extra files", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)
    expect(rootPackage).not.toHaveProperty("extra-files")
  })
})
