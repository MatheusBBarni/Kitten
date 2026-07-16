import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { primaryInstallCmd } from "../site/src/config/showcase-config.ts"

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
const showcaseStart = readme.indexOf("## Showcase Site")
const showcaseEnd = readme.indexOf("\n## Why this project exists", showcaseStart)
const showcaseSection = readme.slice(showcaseStart, showcaseEnd)

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe("showcase README launch contract", () => {
  test("links the canonical site and documents one verified package route", () => {
    expect(showcaseStart).toBeGreaterThanOrEqual(0)
    expect(showcaseEnd).toBeGreaterThan(showcaseStart)
    expect(showcaseSection).toContain("https://matheusbbarni.github.io/Kitten/")
    expect(showcaseSection).toContain("must have exactly one verified install CTA")
    expect(readme).toContain(primaryInstallCmd)
    expect(occurrences(readme, `\n${primaryInstallCmd}\n`)).toBe(1)
  })

  test("names every launch gate and the V1 measurement boundary", () => {
    expect(showcaseSection).toContain("### Launch gate")
    expect(showcaseSection).toContain("Repository visibility")
    expect(showcaseSection).toContain("License presence")
    expect(showcaseSection).toContain("Proof clarity")
    expect(showcaseSection).toContain("Command verification")
    expect(showcaseSection).toContain("### Maintenance and measurement")
    expect(showcaseSection).toContain("V1 emits no automatic showcase telemetry")
  })

  test("includes the build, section, copy, star, and preview smoke checks", () => {
    expect(showcaseSection).toContain("### Smoke validation")
    expect(showcaseSection).toContain("bun run check")
    expect(showcaseSection).toContain("bun run build")
    expect(showcaseSection).toContain("bun run test:coverage")
    expect(showcaseSection).toContain("dist/index.html")
    expect(showcaseSection).toContain("copy-command.test.ts")
    expect(showcaseSection).toContain("star-count.test.ts")
    expect(showcaseSection).toContain("bun run preview -- --host 127.0.0.1")
    expect(showcaseSection).toContain("curl --fail http://127.0.0.1:4321/Kitten/")
  })
})
