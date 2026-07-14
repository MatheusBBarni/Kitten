// Suite: MessageView role presentation
// Invariant: the shared Markdown body never erases the agent label or the user's glyph-free surface band.
// Boundary IN: MessageView wrappers, real shared Markdown rendering, palette inheritance, and OpenTUI layout.
// Boundary OUT: store-driven transcript ordering and streaming updates, owned by ConversationView.test.tsx.

import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { MessageView, ROLE_LABELS } from "./MessageView.tsx"
import { DARK_PALETTE } from "./theme.ts"

function paletteColor(hex: string): string {
  return RGBA.fromHex(hex).toString()
}

describe("MessageView", () => {
  it("capitalizes the agent role label and keeps the user's distinct surface band", async () => {
    const controller = createFakeController()
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <box style={{ flexDirection: "column" }}>
          <MessageView role="user" text="USER_SENTINEL" />
          <MessageView role="agent" text="AGENT_SENTINEL" />
        </box>
      </CockpitProvider>,
      { width: 52, height: 10 },
    )
    const frame = await setup.waitForFrame(
      (candidate) => candidate.includes("USER_SENTINEL") && candidate.includes("AGENT_SENTINEL"),
    )

    const rows = frame.split("\n")
    expect(ROLE_LABELS.agent).toBe("Agent")
    const userTextRow = rows.findIndex((row) => row.includes("USER_SENTINEL"))
    const agentLabelRow = rows.findIndex((row) => row.includes(ROLE_LABELS.agent))
    const agentTextRow = rows.findIndex((row) => row.includes("AGENT_SENTINEL"))
    expect(userTextRow).toBeGreaterThan(0)
    expect(rows[userTextRow - 1]?.trim()).toBe("")
    expect(rows[userTextRow + 1]?.trim()).toBe("")
    expect(agentLabelRow).toBe(userTextRow + 3)
    expect(agentTextRow).toBe(agentLabelRow + 1)

    const spans = setup.captureSpans().lines.flatMap((line) => line.spans)
    const user = spans.find((span) => span.text.includes("USER_SENTINEL"))
    const agent = spans.find((span) => span.text.includes("AGENT_SENTINEL"))
    expect(user?.bg.toString()).toBe(paletteColor(DARK_PALETTE.userMessageSurface))
    expect(agent?.bg.toString()).not.toBe(user?.bg.toString())

    await destroyMounted(setup.renderer)
  })
})
