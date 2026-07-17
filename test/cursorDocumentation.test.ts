import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8")
const CURSOR_SECTION = README.slice(README.indexOf("### Local Cursor session"), README.indexOf("## Showcase Site"))
const HANDOFF_SECTION = README.slice(README.indexOf("## How handoffs work"), README.indexOf("## Everyday controls"))

describe("Cursor README contract", () => {
  it("documents a certified third local agent acp session, not cloud or background products", () => {
    expect(README).toContain("**Claude Code**, **Codex**, and **Cursor**")
    expect(CURSOR_SECTION).toContain("third local coding-agent session")
    expect(CURSOR_SECTION).toContain("`agent acp`")
    expect(CURSOR_SECTION).toContain("certified local profile")
    expect(CURSOR_SECTION).toContain("does not connect to Cursor cloud agents, background agents")
    expect(CURSOR_SECTION).toContain("other remote Cursor products")
  })

  it("keeps ready siblings usable across every documented Cursor recovery boundary", () => {
    for (const state of ["missing", "unauthenticated", "incompatible", "outside Kitten's certified profile"]) {
      expect(CURSOR_SECTION).toContain(state)
    }
    expect(CURSOR_SECTION).toContain("ready Claude Code and Codex sessions remain usable")
    expect(CURSOR_SECTION).toContain("does not claim an exact certified Cursor version")
    expect(CURSOR_SECTION).not.toMatch(/certified Cursor (?:CLI )?version\s+v?\d+\.\d+\.\d+/i)
  })

  it("keeps credentials native and active-session controls ACP-authoritative", () => {
    expect(CURSOR_SECTION).toContain("Authentication stays in Cursor's native flow")
    expect(CURSOR_SECTION).toContain("does not collect or manage Cursor credentials")
    expect(CURSOR_SECTION).toContain("does not use direct CLI model lists or flags")
    expect(CURSOR_SECTION).toContain("active ACP session")
  })

  it("does not publish a literal certified semantic version before native review", () => {
    expect(CURSOR_SECTION).not.toMatch(/certified(?: local)? profile[^\n]*\bv?\d+\.\d+\.\d+\b/i)
    expect(CURSOR_SECTION).not.toMatch(/\bv?\d+\.\d+\.\d+\b[^\n]*certified(?: local)? profile/i)
  })

  it("requires target choice, a curatable preview, and explicit confirmation without promising perfect redaction", () => {
    expect(HANDOFF_SECTION).toContain("choose the destination")
    expect(HANDOFF_SECTION).toContain("Review the preview")
    expect(HANDOFF_SECTION).toContain("keep or drop an item")
    expect(HANDOFF_SECTION).toContain("edit the summary")
    expect(HANDOFF_SECTION).toContain("Press `Enter` to send the curated bundle")
    expect(HANDOFF_SECTION).toContain("cancel without sending anything")
    expect(HANDOFF_SECTION).toContain("Nothing is sent when you start the handoff, choose a target")
    expect(HANDOFF_SECTION).toContain("Only explicit confirmation from the preview sends the bundle")
    expect(HANDOFF_SECTION).toContain("not a promise that every secret has been found")
    expect(HANDOFF_SECTION).toContain("there is no Cursor-only shortcut")
  })
})
