import { describe, expect, it } from "bun:test"

import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import {
  ConversationActivity,
  WORKING_ACTIVITY_LABEL,
  WORKING_SPINNER_FRAMES,
} from "./ConversationActivity.tsx"
import { DARK_PALETTE } from "./theme.ts"

describe("ConversationActivity", () => {
  it("uses one fixed transcript row for the selected provider's working spinner", async () => {
    const controller = createFakeController()
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <ConversationActivity />
      </CockpitProvider>,
      { width: 48, height: 1 },
    )

    expect(setup.captureCharFrame()).not.toContain(WORKING_ACTIVITY_LABEL)

    await actAsync(() => controller.store.applyEvent("claude-code", { kind: "status", status: "working" }))
    const working = await setup.waitForFrame((frame) => frame.includes(WORKING_ACTIVITY_LABEL))
    expect(WORKING_SPINNER_FRAMES.some((frame) => working.includes(frame))).toBe(true)
    expect(
      setup.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes(WORKING_ACTIVITY_LABEL))?.fg.toString(),
    ).toBe(RGBA.fromHex(DARK_PALETTE.status.working).toString())

    await actAsync(() => controller.actions.selectConversation("codex"))
    expect(await setup.waitForFrame((frame) => !frame.includes(WORKING_ACTIVITY_LABEL))).not.toContain(WORKING_ACTIVITY_LABEL)

    await destroyMounted(setup.renderer)
  })
})
