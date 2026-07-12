import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"
import { createElement } from "react"

import type { PromptBlock } from "../src/agent/agentConnection.ts"
import { composeHandoffBlocks, createHandoffEdits, SHELL_HEADING } from "../src/app/handoff.ts"
import { createDeterministicAssembler } from "../src/core/bundleAssembler.ts"
import { REDACTION_PLACEHOLDER } from "../src/core/secretRedactor.ts"
import { createSessionState, sessionReducer } from "../src/core/sessionReducer.ts"
import { CockpitApp } from "../src/ui/CockpitApp.tsx"
import { DROPPED_BOX, ITEM_MARKER, KEPT_BOX } from "../src/ui/HandoffPreview.tsx"
import { HANDOFF_HINT } from "../src/ui/keymap.ts"
import { createFakeController, type FakeController } from "./fakeController.ts"
import { actAsync, destroyMounted } from "./reactTui.ts"

// Suite: shell hand-off assembly and composition
// Invariant: the target prompt sees cwd and redacted output from the same curated snapshot.
// Boundary IN: real deterministic assembler/composer plus the mounted cockpit preview.
// Boundary OUT: real agent subprocesses and PTY runtime.
describe("shell hand-off assembly to prompt composition", () => {
  it("carries cwd and redacted command output across the real boundary", () => {
    const session = sessionReducer(
      createSessionState({
        id: "claude-code",
        providerKind: "claude-code",
        title: "Claude Code",
        cwd: "/workspace/kitten",
        acpSessionId: "session-1",
      }),
      { kind: "user_message", messageId: "user-1", text: "Verify the implementation" },
    )
    const secret = "sk-ant-api03-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"
    const bundle = createDeterministicAssembler().assemble(session, "codex", {
      cwd: "/workspace/kitten",
      commands: [
        {
          id: "command-1",
          command: "bun test",
          output: `token=${secret}\n12 pass\n0 fail`,
          exitCode: 0,
        },
      ],
    })

    const blocks = composeHandoffBlocks(bundle, createHandoffEdits(bundle))
    const shellBlock = blocks.find((block) => block.text.startsWith(SHELL_HEADING))

    expect(bundle.redactionCount).toBe(1)
    expect(shellBlock?.text).toContain("Working directory: /workspace/kitten")
    expect(shellBlock?.text).toContain("Command: bun test")
    expect(shellBlock?.text).toContain(`token=${REDACTION_PLACEHOLDER}`)
    expect(shellBlock?.text).not.toContain(secret)
  })
})

function seedCuratableHandoff(controller: FakeController): void {
  controller.store.applyEvent("claude-code", { kind: "user_message", messageId: "user-1", text: "Verify it" })
  controller.store.applyEvent("claude-code", {
    kind: "tool_call",
    call: {
      toolCallId: "read-preview",
      kind: "read",
      title: "Read preview",
      status: "completed",
      locations: ["src/ui/HandoffPreview.tsx"],
    },
  })
  controller.store.applyShellEvent({ kind: "cwd_changed", cwd: "/workspace/kitten" })
  controller.store.applyShellEvent({ kind: "command_started", id: "command-test", command: "bun test" })
  controller.store.applyShellEvent({ kind: "command_finished", id: "command-test", exitCode: 0, output: "12 pass" })
  controller.store.applyShellEvent({ kind: "command_started", id: "command-status", command: "git status --short" })
  controller.store.applyShellEvent({
    kind: "command_finished",
    id: "command-status",
    exitCode: 0,
    output: " M src/ui/HandoffPreview.tsx",
  })
}

function sentText(controller: FakeController): string {
  const call = controller.calls.sendPrompt[0]
  if (!call) throw new Error("expected a prompt to have been sent")
  return (call.input as PromptBlock[]).map((block) => block.text).join("\n")
}

async function openPreview(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await testRender(createElement(CockpitApp, { controller }), { width: 90, height: 32, kittyKeyboard: true })
  await setup.waitForFrame((frame) => frame.includes("Claude Code"))
  await actAsync(() => {
    setup.mockInput.pressKey("t", { ctrl: true })
  })
  await setup.waitForFrame((frame) => frame.includes(HANDOFF_HINT))
  return setup
}

describe("shell hand-off preview curation", () => {
  it("navigates to a command, drops it, and sends cwd plus only the survivor", async () => {
    const controller = createFakeController()
    seedCuratableHandoff(controller)
    const setup = await openPreview(controller)

    await actAsync(() => {
      setup.mockInput.pressArrow("down")
    })
    await setup.waitForFrame((frame) => frame.includes(`${ITEM_MARKER} ${KEPT_BOX} bun test`))
    await actAsync(async () => {
      await setup.mockInput.typeText(" ")
    })
    await setup.waitForFrame((frame) => frame.includes(`${DROPPED_BOX} bun test`))
    await actAsync(() => {
      setup.mockInput.pressEnter()
    })

    const prompt = sentText(controller)
    expect(prompt).toContain("Working directory: /workspace/kitten")
    expect(prompt).toContain("Command: git status --short")
    expect(prompt).not.toContain("Command: bun test")

    await destroyMounted(setup.renderer)
  })
})
