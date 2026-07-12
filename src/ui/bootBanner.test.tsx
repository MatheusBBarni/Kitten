// Suite: transient boot-banner root
// Invariant: boot renders the configured welcome variant and fully releases the renderer before handoff.
// Boundary IN: banner variant selection plus OpenTUI React root mount/unmount.
// Boundary OUT: main() controller/readiness sequencing (owned by test/index.integration.test.tsx).

import { describe, expect, it } from "bun:test"

import { createTestRenderer } from "@opentui/core/testing"

import { actAsync } from "../../test/reactTui.ts"
import { WELCOME_GREETING, WELCOME_WORDMARK } from "./WelcomeBanner.tsx"
import { renderBootBanner } from "./bootBanner.tsx"

const CONNECTING_AGENTS = [
  { displayName: "Claude Code", state: "connecting" as const },
  { displayName: "Codex", state: "connecting" as const },
]

describe("renderBootBanner", () => {
  it.each([
    { name: "full on first run", firstRunSeen: false, expectedState: true, expectedWordmark: true },
    { name: "compact after first run", firstRunSeen: true, expectedState: false, expectedWordmark: true },
  ])("renders $name", async ({ firstRunSeen, expectedState, expectedWordmark }) => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    let dispose = () => {}

    await actAsync(() => {
      dispose = renderBootBanner(setup.renderer, {
        preference: "auto",
        theme: "auto",
        firstRunSeen,
        agents: CONNECTING_AGENTS,
        cwd: "/workspace/kitten",
      })
    })
    await setup.renderOnce()

    const frame = setup.captureCharFrame()
    expect(frame).toContain(WELCOME_GREETING)
    expect(frame.includes("Agents: connecting · connecting")).toBe(expectedState)
    expect(frame.includes(WELCOME_WORDMARK[0])).toBe(expectedWordmark)

    await actAsync(dispose)
    await setup.renderOnce()
    expect(setup.captureCharFrame()).not.toContain(WELCOME_GREETING)
    setup.renderer.destroy()
  })

  it("paints nothing when the preference is off and its disposer stays safe", async () => {
    const setup = await createTestRenderer({ width: 80, height: 24 })
    const dispose = renderBootBanner(setup.renderer, {
      preference: "off",
      theme: "auto",
      firstRunSeen: false,
      agents: CONNECTING_AGENTS,
      cwd: "/workspace/kitten",
    })

    await setup.renderOnce()
    expect(setup.captureCharFrame().trim()).toBe("")
    expect(() => {
      dispose()
      dispose()
    }).not.toThrow()
    setup.renderer.destroy()
  })
})
