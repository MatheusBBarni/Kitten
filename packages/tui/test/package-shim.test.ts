import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

import pkg from "../package.json" with { type: "json" }
const README = readFileSync(new URL("../../../README.md", import.meta.url), "utf8")

const PLATFORM_PACKAGES = [
  "@matheusbbarni/kitten-darwin-arm64",
  "@matheusbbarni/kitten-darwin-x64",
  "@matheusbbarni/kitten-linux-arm64",
  "@matheusbbarni/kitten-linux-x64",
] as const

describe("main npm package shim contract", () => {
  it("ships the Node launcher instead of the Bun source tree", () => {
    expect(pkg.name).toBe("@matheusbbarni/kitten")
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

  it("leads with the published npm package and retains the standalone alternative", () => {
    const firstShellCommand = README.match(/```bash\n([^\n]+)/)?.[1]
    const visitorInstallDocs = README.slice(0, README.indexOf("## Contributing"))

    expect(firstShellCommand).toBe(
      "npm install --global @matheusbbarni/kitten",
    )
    expect(visitorInstallDocs).not.toContain("npm i -g kitten")
    expect(visitorInstallDocs).not.toContain("npx kitten --version")
    expect(visitorInstallDocs).not.toContain("npm i -g @matheusbbarni/kitten")
    expect(visitorInstallDocs).not.toContain("npx @matheusbbarni/kitten --version")
    expect(visitorInstallDocs).toContain(
      "curl -fsSL https://raw.githubusercontent.com/MatheusBBarni/Kitten/main/scripts/install.sh | bash",
    )
    expect(visitorInstallDocs).toContain("kitten --update")
    expect(visitorInstallDocs).toContain("npm install --global @matheusbbarni/kitten@latest")
    expect(visitorInstallDocs).toContain("verified global npm installation")
    expect(visitorInstallDocs).toContain("installer-managed standalone binary")
    expect(visitorInstallDocs).toContain("Source checkouts, local dependencies, `npx` invocations, copied binaries")
    expect(visitorInstallDocs).toContain("unknown or uncertain installation contexts remain unchanged")
    expect(visitorInstallDocs).toContain("There is no channel fallback.")
    expect(visitorInstallDocs).toContain("release-asset integrity")
    expect(visitorInstallDocs).toContain("does not protect against a compromised release publisher")
  })
})
