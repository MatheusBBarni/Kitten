import { describe, expect, it } from "bun:test"

import { syntaxParserManifest } from "../src/ui/syntaxParsers.ts"

const readme = await Bun.file(new URL("../../../README.md", import.meta.url)).text()

function section(heading: string, nextHeading: string): string {
  const start = readme.indexOf(heading)
  const end = readme.indexOf(nextHeading, start + heading.length)
  if (start < 0 || end < 0) return ""
  return readme.slice(start, end)
}

function codeLabels(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`]+)`/g)].map((match) => match[1]!)
}

function releasedRows(): Map<string, string[]> {
  const rows = section("### Released fence labels", "### Fallback contract")
    .split("\n")
    .filter((line) => line.startsWith("| ") && line.includes("`") && !line.startsWith("| ---"))
    .map((line) => codeLabels(line))

  return new Map(rows.map(([canonical, ...aliases]) => [canonical!, aliases]))
}

describe("README syntax-highlighting contract", () => {
  it("publishes exactly the released manifest labels", () => {
    const rows = releasedRows()
    const documented = [...rows].flatMap(([canonical, aliases]) => [canonical, ...aliases]).sort()
    const released = syntaxParserManifest.capabilities
      .flatMap(({ fixtures }) => fixtures.filter(({ source }) => source === "markdown").map(({ label }) => label))
      .sort()

    expect(documented).toEqual(released)
    expect(new Set(documented).size).toBe(documented.length)

    for (const capability of syntaxParserManifest.capabilities) {
      expect(rows.get(capability.filetype)).toEqual([...capability.aliases])
    }
    expect(rows.get("javascript")).toEqual(["js", "jsx", "javascriptreact"])
    expect(rows.get("typescript")).toEqual(["ts", "tsx", "typescriptreact"])
  })

  it("documents bounded, labelled, copy-safe plaintext without language guessing", () => {
    const fallback = section("### Fallback contract", "## How handoffs work")

    expect(fallback).toContain("Only the documented, release-gated labels above receive syntax highlighting.")
    expect(fallback).toContain("bounded, copy-safe plaintext")
    expect(fallback).toContain("retains that label")
    expect(fallback).toContain(
      "Kitten never guesses a language from unlabelled code, extensionless diffs, or dotfile diffs.",
    )
  })

  it("keeps ReScript out of released labels while its gate is unmet", () => {
    const released = section("### Released fence labels", "### Fallback contract")
    const fallbacks = syntaxParserManifest.plaintextFallbacks
    const rescript = fallbacks.find(({ filetype }) => filetype === "rescript")

    expect(rescript?.reason).toBe("release_gate_unmet")
    expect(codeLabels(released)).not.toContain("rescript")
    expect(readme).toContain(
      `ReScript (\`${rescript!.filetype}\`, aliases ${rescript!.aliases.map((alias) => `\`${alias}\``).join(" and ")}) has not met the release gate`,
    )
    expect(readme).toContain("ReScript fences and diffs remain labelled, bounded, copy-safe plaintext")
  })

  it("documents diff as a release-gated format with extension-only language enhancement", () => {
    expect(readme).toContain("The canonical `diff` format is Kitten's built-in unified-diff surface")
    expect(readme).toContain("recognized file extension")
  })
})
