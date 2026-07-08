import { describe, expect, it } from "bun:test"

import { createMockMouse, type TestRenderer } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import type { AgentId, ToolCallUpdate } from "../core/types.ts"
import { CockpitApp } from "./CockpitApp.tsx"
import { ConversationView, EMPTY_TRANSCRIPT_HINT } from "./ConversationView.tsx"
import { ROLE_LABELS } from "./MessageView.tsx"
import { filetypeFor, TOOL_KIND_LABELS } from "./ToolCallRow.tsx"

const WIDTH = 72
const HEIGHT = 20

/** A unified diff of the shape `toUnifiedDiff` produces in the adapter. */
const UNIFIED = ["--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1,2 +1,2 @@", " const a = 1", "-const b = 2", "+const b = 3"].join("\n")

/** Mount the conversation inside the real shell, so focus and the store are wired as in production. */
async function renderConversation(controller: FakeController, width = WIDTH, height = HEIGHT) {
  const setup = await testRender(
    <CockpitApp controller={controller}>
      <ConversationView />
    </CockpitApp>,
    { width, height },
  )
  await setup.waitForFrame((f) => f.includes("Claude Code"))
  return setup
}

/** Push a user turn onto an agent's transcript. */
function userMessage(controller: FakeController, agentId: AgentId, messageId: string, text: string): void {
  controller.store.applyEvent(agentId, { kind: "user_message", messageId, text })
}

/** Append a streamed delta to an agent's message, exactly as the coalescer would. */
function agentDelta(controller: FakeController, agentId: AgentId, messageId: string, textDelta: string): void {
  controller.store.applyEvent(agentId, { kind: "agent_message", messageId, textDelta })
}

/** Upsert a tool call by id. */
function toolCall(controller: FakeController, agentId: AgentId, call: ToolCallUpdate): void {
  controller.store.applyEvent(agentId, { kind: "tool_call", call })
}

/**
 * What the terminal would put on the clipboard for a drag from `from` to `to`.
 *
 * The focus column is exclusive, so `to` names the cell just past the last one the
 * user wants. A drag that *starts* on an unselectable cell (a box border, a diff's
 * line-number gutter) selects nothing at all.
 */
async function selectText(renderer: TestRenderer, from: [number, number], to: [number, number]): Promise<string> {
  const mouse = createMockMouse(renderer)
  await mouse.drag(from[0], from[1], to[0], to[1])
  return renderer.getSelection()?.getSelectedText() ?? ""
}

/** The box-drawing and gutter glyphs the cockpit paints around the transcript. */
const CHROME_GLYPHS = /[│┌┐└┘─█▄▌▸]/

describe("ConversationView turns", () => {
  it("shows an empty-state hint before the first turn", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderConversation(controller)

    expect(captureCharFrame()).toContain(EMPTY_TRANSCRIPT_HINT)

    await destroyMounted(renderer)
  })

  it("renders a user turn and an agent turn in order, each labelled by role", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() => {
      userMessage(controller, "claude-code", "m1", "rename the flag")
      agentDelta(controller, "claude-code", "m2", "Renaming it now.")
    })
    const frame = await waitForFrame((f) => f.includes("Renaming it now."))

    const rows = frame.split("\n")
    const userLabel = rows.findIndex((r) => r.includes(ROLE_LABELS.user))
    const userText = rows.findIndex((r) => r.includes("rename the flag"))
    const agentLabel = rows.findIndex((r) => r.includes(ROLE_LABELS.agent))
    const agentText = rows.findIndex((r) => r.includes("Renaming it now."))

    // Each message sits under its own role label, and the user spoke first.
    expect(userLabel).toBeGreaterThanOrEqual(0)
    expect(userText).toBe(userLabel + 1)
    expect(agentText).toBe(agentLabel + 1)
    expect(userText).toBeLessThan(agentLabel)

    await destroyMounted(renderer)
  })

  it("paints the two roles in different colors", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureSpans } = await renderConversation(controller)

    await actAsync(() => {
      userMessage(controller, "claude-code", "m1", "USERWORD")
      agentDelta(controller, "claude-code", "m2", "AGENTWORD")
    })
    await waitForFrame((f) => f.includes("AGENTWORD"))

    const colorOf = (needle: string): string | undefined =>
      captureSpans()
        .lines.flatMap((line) => line.spans)
        .find((span) => span.text.includes(needle))
        ?.fg?.toString()

    const userColor = colorOf("USERWORD")
    const agentColor = colorOf("AGENTWORD")
    expect(userColor).toBeDefined()
    expect(agentColor).toBeDefined()
    expect(userColor).not.toBe(agentColor)

    await destroyMounted(renderer)
  })
})

describe("ConversationView streaming", () => {
  it("settles a streamed agent message over several coalesced updates without losing earlier blocks", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() => agentDelta(controller, "claude-code", "m1", "## Plan\n\nI will "))
    const first = await waitForFrame((f) => f.includes("I will"))
    expect(first).toContain("Plan")

    await actAsync(() => agentDelta(controller, "claude-code", "m1", "read the file"))
    const second = await waitForFrame((f) => f.includes("read the file"))

    await actAsync(() => agentDelta(controller, "claude-code", "m1", " and edit it."))
    const third = await waitForFrame((f) => f.includes("and edit it."))

    // The heading survives every append: the block above the streaming tail is never
    // torn down and rebuilt, which is what "no flicker" means for a Markdown block.
    for (const frame of [first, second, third]) expect(frame).toContain("Plan")
    // Deltas concatenate rather than replace, and only one message exists.
    expect(third).toContain("I will read the file and edit it.")
    expect(third.match(/I will/g)).toHaveLength(1)

    await destroyMounted(renderer)
  })

  it("matches the expected frames as a message streams in", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller, WIDTH, 12)

    await actAsync(() => userMessage(controller, "claude-code", "m1", "hi"))
    await waitForFrame((f) => f.includes("hi"))
    expect(captureCharFrame()).toMatchSnapshot("01-user-turn")

    await actAsync(() => agentDelta(controller, "claude-code", "m2", "Hello"))
    await waitForFrame((f) => f.includes("Hello"))
    expect(captureCharFrame()).toMatchSnapshot("02-first-chunk")

    await actAsync(() => agentDelta(controller, "claude-code", "m2", ", world."))
    await waitForFrame((f) => f.includes("Hello, world."))
    expect(captureCharFrame()).toMatchSnapshot("03-settled")

    await destroyMounted(renderer)
  })
})

describe("ConversationView tool calls", () => {
  it("shows kind, title and status, then updates the status in place", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Update app.ts",
        status: "in_progress",
      }),
    )
    const running = await waitForFrame((f) => f.includes("in_progress"))
    expect(running).toContain(TOOL_KIND_LABELS.edit)
    expect(running).toContain("Update app.ts")

    await actAsync(() => toolCall(controller, "claude-code", { toolCallId: "t1", status: "completed" }))
    const done = await waitForFrame((f) => f.includes("completed"))

    // Upserted by id: the same single row now reads `completed`, kind and title intact.
    expect(done).not.toContain("in_progress")
    expect(done).toContain(TOOL_KIND_LABELS.edit)
    expect(done.match(/Update app\.ts/g)).toHaveLength(1)

    await destroyMounted(renderer)
  })

  it("renders a non-edit tool call without a diff", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "read",
        title: "Read app.ts",
        status: "completed",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    const frame = await waitForFrame((f) => f.includes("Read app.ts"))

    expect(frame).toContain(TOOL_KIND_LABELS.read)
    expect(frame).not.toContain("const b = 3")

    await destroyMounted(renderer)
  })

  it("renders an edit tool call's diff through the <diff> component", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Bump b",
        status: "in_progress",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    const frame = await waitForFrame((f) => f.includes("const b = 3"))

    // The diff's own unified view: context, removal and addition, each on its own row,
    // with the `-`/`+` signs the gutter draws. The `---`/`+++`/`@@` header is consumed.
    expect(frame).toContain("src/app.ts")
    expect(frame).toContain("const a = 1")
    expect(frame).toContain("const b = 2")
    expect(frame).toContain("const b = 3")
    expect(frame).not.toContain("@@")

    const rows = frame.split("\n")
    expect(rows.find((r) => r.includes("const b = 2"))).toContain("-")
    expect(rows.find((r) => r.includes("const b = 3"))).toContain("+")

    await destroyMounted(renderer)
  })
})

describe("ConversationView focus", () => {
  it("renders only the focused agent's transcript and swaps it when focus moves", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() => {
      agentDelta(controller, "claude-code", "m1", "CLAUDE_TRANSCRIPT")
      agentDelta(controller, "codex", "m2", "CODEX_TRANSCRIPT")
    })

    const claudeFocused = await waitForFrame((f) => f.includes("CLAUDE_TRANSCRIPT"))
    expect(claudeFocused).not.toContain("CODEX_TRANSCRIPT")

    await actAsync(() => controller.actions.switchFocus())

    const codexFocused = await waitForFrame((f) => f.includes("CODEX_TRANSCRIPT"))
    expect(codexFocused).not.toContain("CLAUDE_TRANSCRIPT")

    await destroyMounted(renderer)
  })

  it("leaves the transcript alone when the unfocused agent streams", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    await actAsync(() => agentDelta(controller, "claude-code", "m1", "FOCUSED_TEXT"))
    const before = await waitForFrame((f) => f.includes("FOCUSED_TEXT"))

    await actAsync(() => agentDelta(controller, "codex", "m2", "BACKGROUND_TEXT"))
    const after = captureCharFrame()

    expect(after).toBe(before)
    expect(after).not.toContain("BACKGROUND_TEXT")

    await destroyMounted(renderer)
  })
})

describe("ConversationView selection", () => {
  it("copies a message's words without the surrounding chrome", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    await actAsync(() => userMessage(controller, "claude-code", "m1", "copy me cleanly"))
    await waitForFrame((f) => f.includes("copy me cleanly"))

    const rows = captureCharFrame().split("\n")
    const row = rows.findIndex((r) => r.includes("copy me cleanly"))
    const start = rows[row]!.indexOf("copy me cleanly")

    // Dragged across the words only: the pane's border sits on the same screen rows.
    const selected = await selectText(renderer, [start, row], [start + "copy me cleanly".length, row])
    expect(selected).toBe("copy me cleanly")
    expect(selected).not.toMatch(CHROME_GLYPHS)

    await destroyMounted(renderer)
  })

  it("selects nothing when the drag starts on the pane border", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderConversation(controller)

    await actAsync(() => userMessage(controller, "claude-code", "m1", "copy me cleanly"))
    await waitForFrame((f) => f.includes("copy me cleanly"))

    // Column 0 is the box's left border, and a border is not selectable.
    expect(await selectText(renderer, [0, 1], [WIDTH - 1, 3])).toBe("")

    await destroyMounted(renderer)
  })

  it("copies a diff's code without its line numbers or sign gutter", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Bump b",
        status: "completed",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    await waitForFrame((f) => f.includes("const b = 3"))

    const rows = captureCharFrame().split("\n")
    const first = rows.findIndex((r) => r.includes("const a = 1"))
    const last = rows.findIndex((r) => r.includes("const b = 3"))
    const codeColumn = rows[first]!.indexOf("const a = 1")

    const selected = await selectText(renderer, [codeColumn, first], [rows[last]!.length, last])

    // Exactly the code. The gutter drew ` 1  `, ` 2 -` and ` 2 +` beside these lines
    // and the pane drew a border around them; none of it reaches the clipboard.
    expect(selected).toBe("const a = 1\nconst b = 2\nconst b = 3")
    expect(selected).not.toMatch(CHROME_GLYPHS)
    for (const line of selected.split("\n")) expect(line).not.toMatch(/^\s*[\d+-]/)

    await destroyMounted(renderer)
  })

  it("selects nothing when the drag starts on the diff's line-number gutter", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame, captureCharFrame } = await renderConversation(controller)

    await actAsync(() =>
      toolCall(controller, "claude-code", {
        toolCallId: "t1",
        kind: "edit",
        title: "Bump b",
        status: "completed",
        diff: { path: "src/app.ts", unified: UNIFIED },
      }),
    )
    await waitForFrame((f) => f.includes("const b = 3"))

    const rows = captureCharFrame().split("\n")
    const first = rows.findIndex((r) => r.includes("const a = 1"))
    const last = rows.findIndex((r) => r.includes("const b = 3"))
    const gutterColumn = rows[first]!.indexOf("1")

    expect(await selectText(renderer, [gutterColumn, first], [rows[last]!.length, last])).toBe("")

    await destroyMounted(renderer)
  })
})

describe("filetypeFor", () => {
  it("reads the extension off a path", () => {
    expect(filetypeFor("src/app.ts")).toBe("ts")
    expect(filetypeFor("a/b/c/main.py")).toBe("py")
    expect(filetypeFor("archive.tar.gz")).toBe("gz")
  })

  it("has nothing to offer for a path without a usable extension", () => {
    expect(filetypeFor("Makefile")).toBeUndefined()
    expect(filetypeFor("src/Makefile")).toBeUndefined()
    // A dotfile's leading dot does not name a filetype.
    expect(filetypeFor(".gitignore")).toBeUndefined()
    expect(filetypeFor("src/.gitignore")).toBeUndefined()
    // A trailing dot names nothing either.
    expect(filetypeFor("weird.")).toBeUndefined()
    expect(filetypeFor("")).toBeUndefined()
  })
})
