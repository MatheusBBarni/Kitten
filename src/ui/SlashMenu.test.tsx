import { describe, expect, it } from "bun:test"

import { testRender } from "@opentui/react/test-utils"

import { createFakeController } from "../../test/fakeController.ts"
import { destroyMounted } from "../../test/reactTui.ts"
import { CockpitProvider } from "./cockpitContext.tsx"
import { NO_COMMANDS_MATCH, SlashMenu, type MenuRow } from "./SlashMenu.tsx"

const rows: MenuRow[] = [
  { source: "kitten", command: "hand-off", name: "handoff", description: "Send a curated hand-off" },
  { source: "agent", name: "review", description: "Review changes", hint: "[scope]" },
]

describe("SlashMenu", () => {
  it("renders named groups, the selected marker, and agent argument hints", async () => {
    const controller = createFakeController()
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <SlashMenu
          groups={[{ source: "Kitten", rows: [rows[0]!] }, { source: "Codex", rows: [rows[1]!] }]}
          highlightedIndex={0}
          onSelect={() => {}}
        />
      </CockpitProvider>,
      { width: 64, height: 12 },
    )

    const frame = await setup.waitForFrame((candidate) => candidate.includes("/handoff"))
    expect(frame).toContain("Kitten")
    expect(frame).toContain("Codex")
    expect(frame).toContain("/handoff")
    expect(frame).toContain("/review")
    expect(frame).toContain("[scope]")
    expect(frame).toContain("▸")

    await destroyMounted(setup.renderer)
  })

  it("shows an explicit empty state", async () => {
    const controller = createFakeController()
    const setup = await testRender(
      <CockpitProvider controller={controller}>
        <SlashMenu groups={[]} highlightedIndex={0} onSelect={() => {}} />
      </CockpitProvider>,
      { width: 64, height: 8 },
    )

    expect(await setup.waitForFrame((frame) => frame.includes(NO_COMMANDS_MATCH))).toContain(NO_COMMANDS_MATCH)
    await destroyMounted(setup.renderer)
  })
})
