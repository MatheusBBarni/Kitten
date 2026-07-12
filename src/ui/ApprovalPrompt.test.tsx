import { join } from "node:path"

import { describe, expect, it } from "bun:test"

import type { TestRendererSetup } from "@opentui/core/testing"
import { testRender } from "@opentui/react/test-utils"

import { createAgentConnection, type AgentConnection, type PermissionRequest } from "../agent/agentConnection.ts"
import { createInMemoryTransportPair } from "../agent/transport.ts"
import { createSessionController } from "../app/controller.ts"
import type { AgentConfig, AppConfig, ProviderKind, SessionId, SessionStatus } from "../core/types.ts"
import type { AppStore } from "../store/appStore.ts"
import { startMockAgent, type MockPromptScript } from "../../test/mockAgent.ts"
import { createFakeController, type FakeController } from "../../test/fakeController.ts"
import { actAsync, destroyMounted } from "../../test/reactTui.ts"
import { APPROVAL_HINT } from "./keymap.ts"
import { approvalTitleFor, OPTION_MARKER, UNTITLED_ACTION } from "./ApprovalPrompt.tsx"
import { CockpitApp, HELP_TITLE } from "./CockpitApp.tsx"
import { PROMPT_PLACEHOLDER } from "./PromptEditor.tsx"
import { TOOL_KIND_LABELS } from "./ToolCallRow.tsx"

/**
 * The overlay is exercised inside the real shell rather than in isolation, because
 * two of its guarantees are about the shell: it must paint over the cockpit, and it
 * must take every key away from the prompt editor and the shell chord underneath it.
 *
 * The terminal speaks the Kitty keyboard protocol so a bare Escape arrives as a
 * complete sequence rather than a lone byte the parser holds for 20ms.
 */

const WIDTH = 80
const HEIGHT = 24

/** A unified diff of the shape the adapter's `toUnifiedDiff` produces. */
const UNIFIED = [
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,2 +1,2 @@",
  " const a = 1",
  "-const b = 2",
  "+const b = 3",
].join("\n")

const ALLOW = { optionId: "allow", name: "Allow once", kind: "allow_once" } as const
const REJECT = { optionId: "reject", name: "Reject", kind: "reject_once" } as const

/** Typed at the modal overlay; must never appear anywhere, least of all in the composer. */
const DRAFT_MARKER = "zzq"

/** An `edit` permission request carrying the diff it wants to apply. */
function editRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    sessionId: "claude-session",
    toolCall: { toolCallId: "call-1", kind: "edit", title: "Bump b", diff: { path: "src/app.ts", unified: UNIFIED } },
    options: [ALLOW, REJECT],
    ...overrides,
  }
}

async function renderCockpit(controller: FakeController): Promise<TestRendererSetup> {
  const setup = await testRender(<CockpitApp controller={controller} />, {
    width: WIDTH,
    height: HEIGHT,
    kittyKeyboard: true,
  })
  await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))
  return setup
}

/** Park `request` in the approval slot, exactly as the controller does on `requestPermission`. */
async function openApproval(controller: FakeController, sessionId: SessionId, request: PermissionRequest): Promise<void> {
  await actAsync(() => {
    controller.store.openApproval({ sessionId, title: sessionId, cwd: "/workspace/kitten", request })
  })
}

/** Wait for the real controller to surface a particular permission request in the store. */
function waitForApprovalForSession(store: AppStore, sessionId: SessionId): Promise<void> {
  if (store.getState().overlays.approval?.sessionId === sessionId) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((state) => {
      if (state.overlays.approval?.sessionId !== sessionId) return
      unsubscribe()
      resolve()
    })
  })
}

/** Wait for the other real agent turn to reach its explicit blocked state. */
function waitForSessionStatus(store: AppStore, sessionId: SessionId, expected: SessionStatus): Promise<void> {
  if (store.getState().sessions[sessionId]?.status === expected) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = store.subscribeSelector(
      (state) => state.sessions[sessionId]?.status,
      (status) => {
        if (status !== expected) return
        unsubscribe()
        resolve()
      },
    )
  })
}

/** Mount the cockpit with one pending `edit` request already on screen. */
async function renderWithApproval(
  controller: FakeController,
  request: PermissionRequest = editRequest(),
): Promise<TestRendererSetup> {
  const setup = await renderCockpit(controller)
  await openApproval(controller, "claude-code", request)
  await setup.waitForFrame((frame) => frame.includes(approvalTitleFor("Claude Code")))
  return setup
}

describe("ApprovalPrompt visibility", () => {
  it("renders nothing while the approval slot is empty", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderCockpit(controller)

    const frame = captureCharFrame()
    expect(frame).not.toContain(approvalTitleFor("Claude Code"))
    expect(frame).not.toContain(APPROVAL_HINT)
    // The cockpit underneath is untouched.
    expect(frame).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("renders the overlay when the slot holds a request, and hides it once answered", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderWithApproval(controller)

    expect(await waitForFrame((f) => f.includes(APPROVAL_HINT))).toContain(approvalTitleFor("Claude Code"))

    // The fake controller closes the slot on an answer, as the real one does.
    await actAsync(() => {
      controller.actions.respondPermission({ outcome: "cancelled" })
    })
    const closed = await waitForFrame((f) => !f.includes(APPROVAL_HINT))
    expect(closed).not.toContain(approvalTitleFor("Claude Code"))
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("names the agent that is asking, not merely the focused one", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderCockpit(controller)

    // Codex asks while Claude Code holds focus.
    await openApproval(controller, "codex", editRequest())
    const frame = await waitForFrame((f) => f.includes(approvalTitleFor("Codex")))

    expect(frame).not.toContain(approvalTitleFor("Claude Code"))
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")

    await destroyMounted(renderer)
  })
})

describe("ApprovalPrompt contents", () => {
  it("shows the pending action's kind, title, and diff for an edit request", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderWithApproval(controller)

    const frame = captureCharFrame()
    expect(frame).toContain(TOOL_KIND_LABELS.edit)
    expect(frame).toContain("Bump b")

    // The diff itself: its path, its context line, and both sides of the change.
    expect(frame).toContain("src/app.ts")
    expect(frame).toContain("const a = 1")
    expect(frame).toContain("const b = 2")
    expect(frame).toContain("const b = 3")

    await destroyMounted(renderer)
  })

  it("lists every option, numbered, with the first one highlighted", async () => {
    const controller = createFakeController()
    const { renderer, captureCharFrame } = await renderWithApproval(controller)

    const frame = captureCharFrame()
    expect(frame).toContain(`${OPTION_MARKER} 1. ${ALLOW.name}`)
    expect(frame).toContain(`2. ${REJECT.name}`)
    // Only the highlighted row carries the marker.
    expect(frame).not.toContain(`${OPTION_MARKER} 2.`)

    await destroyMounted(renderer)
  })

  it("keeps the options reachable when the diff is taller than the terminal", async () => {
    const controller = createFakeController()
    // Far more hunk lines than the 24-row viewport can hold.
    const long = ["--- a/big.ts", "+++ b/big.ts", "@@ -1,40 +1,40 @@"]
      .concat(Array.from({ length: 40 }, (_, i) => `+line ${i}`))
      .join("\n")
    const request = editRequest({
      toolCall: { toolCallId: "call-1", kind: "edit", title: "Big", diff: { path: "big.ts", unified: long } },
    })
    const { renderer, captureCharFrame, mockInput } = await renderWithApproval(controller, request)

    // The diff gives up rows; the decision the user came here to make does not.
    const frame = captureCharFrame()
    expect(frame).toContain(`${OPTION_MARKER} 1. ${ALLOW.name}`)
    expect(frame).toContain(`2. ${REJECT.name}`)
    expect(frame).toContain(APPROVAL_HINT)

    // Nothing painted outside the viewport, and no uninitialized filler cells.
    const rows = frame.replace(/\n$/, "").split("\n")
    expect(rows).toHaveLength(HEIGHT)
    for (const row of rows) {
      expect([...row]).toHaveLength(WIDTH)
    }
    expect(frame).not.toContain("਀")

    // And the dialog still answers, so the blocked agent is not stranded.
    await actAsync(() => {
      mockInput.pressEnter()
    })
    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: ALLOW.optionId }])

    await destroyMounted(renderer)
  })

  it("falls back to a legible label when the tool call carries no title or kind", async () => {
    const controller = createFakeController()
    const request = editRequest({ toolCall: { toolCallId: "call-1" } })
    const { renderer, captureCharFrame } = await renderWithApproval(controller, request)

    const frame = captureCharFrame()
    expect(frame).toContain(UNTITLED_ACTION)
    expect(frame).toContain(TOOL_KIND_LABELS.other)
    // Nothing to show, so nothing is drawn where a diff would be.
    expect(frame).not.toContain("const b = 3")

    await destroyMounted(renderer)
  })

  it("labels the overlay with the requesting session's title and working directory (task_07)", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderCockpit(controller)

    await actAsync(() => {
      controller.store.openApproval({
        sessionId: "claude-code",
        title: "backend-api",
        cwd: "/srv/backend-api",
        request: editRequest(),
      })
    })

    // The prompt names which session, in which directory, is asking - not merely the
    // provider - so an answer can never land in the wrong repository.
    const frame = await waitForFrame((f) => f.includes(APPROVAL_HINT))
    expect(frame).toContain("backend-api")
    expect(frame).toContain("/srv/backend-api")

    await destroyMounted(renderer)
  })

  it("gives two sessions of the same provider visibly distinct headers (task_07)", async () => {
    const controller = createFakeController()
    const { renderer, waitForFrame } = await renderCockpit(controller)

    // Same provider (claude-code) share the frame's display name; the session title and
    // full working directory are what tell the two apart.
    await actAsync(() => {
      controller.store.openApproval({ sessionId: "claude-code", title: "web", cwd: "/repos/web", request: editRequest() })
    })
    const first = await waitForFrame((f) => f.includes("/repos/web"))
    expect(first).toContain("web")
    expect(first).not.toContain("/repos/api")

    // The next queued request replaces the slot in place; the header re-homes onto it.
    await actAsync(() => {
      controller.store.openApproval({ sessionId: "claude-code", title: "api", cwd: "/repos/api", request: editRequest() })
    })
    const second = await waitForFrame((f) => f.includes("/repos/api"))
    expect(second).toContain("api")
    expect(second).not.toContain("/repos/web")

    await destroyMounted(renderer)
  })
})

describe("ApprovalPrompt outcome routing", () => {
  it("answers with the allow option when Enter confirms the default highlight", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithApproval(controller)

    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: ALLOW.optionId }])
    expect(await waitForFrame((f) => !f.includes(APPROVAL_HINT))).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("answers with the reject option after the highlight is arrowed onto it", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithApproval(controller)

    await actAsync(() => {
      mockInput.pressArrow("down")
    })
    await waitForFrame((f) => f.includes(`${OPTION_MARKER} 2. ${REJECT.name}`))

    await actAsync(() => {
      mockInput.pressEnter()
    })

    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: REJECT.optionId }])
    expect(await waitForFrame((f) => !f.includes(APPROVAL_HINT))).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("answers with the numbered option a digit names, without confirming", async () => {
    const controller = createFakeController()
    const { renderer, mockInput } = await renderWithApproval(controller)

    await actAsync(async () => {
      await mockInput.typeText("2")
    })

    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: REJECT.optionId }])

    await destroyMounted(renderer)
  })

  it("cancels the request on Escape rather than interrupting the agent", async () => {
    const controller = createFakeController()
    controller.store.applyEvent("claude-code", { kind: "status", status: "working" })
    const { renderer, mockInput, waitForFrame } = await renderWithApproval(controller)

    await actAsync(() => {
      mockInput.pressEscape()
    })

    expect(controller.calls.respondPermission).toEqual([{ outcome: "cancelled" }])
    // The editor never saw the key, so the working turn was not interrupted.
    expect(controller.calls.cancel).toHaveLength(0)
    await waitForFrame((f) => !f.includes(APPROVAL_HINT))

    await destroyMounted(renderer)
  })

  it("clamps the highlight at both ends of the option list", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithApproval(controller)

    // Up from the first option stays on the first.
    await actAsync(() => {
      mockInput.pressArrow("up")
    })
    await waitForFrame((f) => f.includes(`${OPTION_MARKER} 1. ${ALLOW.name}`))

    // Down past the last option stays on the last.
    await actAsync(() => {
      mockInput.pressArrow("down")
      mockInput.pressArrow("down")
    })
    await waitForFrame((f) => f.includes(`${OPTION_MARKER} 2. ${REJECT.name}`))

    await actAsync(() => {
      mockInput.pressEnter()
    })
    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: REJECT.optionId }])

    await destroyMounted(renderer)
  })

  it("ignores a digit and a confirm that name no option", async () => {
    const controller = createFakeController()
    const request = editRequest({ options: [] })
    const { renderer, mockInput } = await renderWithApproval(controller, request)

    await actAsync(async () => {
      await mockInput.typeText("1")
    })
    await actAsync(() => {
      mockInput.pressEnter()
    })
    expect(controller.calls.respondPermission).toHaveLength(0)

    // Escape is still the way out of a request that offers nothing to choose.
    await actAsync(() => {
      mockInput.pressEscape()
    })
    expect(controller.calls.respondPermission).toEqual([{ outcome: "cancelled" }])

    await destroyMounted(renderer)
  })

  it("re-homes the highlight when the next queued request replaces this one", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithApproval(controller)

    await actAsync(() => {
      mockInput.pressArrow("down")
    })
    await waitForFrame((f) => f.includes(`${OPTION_MARKER} 2. ${REJECT.name}`))

    // The controller swaps the slot's contents in place, without closing it.
    await openApproval(controller, "codex", editRequest({ toolCall: { toolCallId: "call-2", title: "Next" } }))
    const frame = await waitForFrame((f) => f.includes(approvalTitleFor("Codex")))
    expect(frame).toContain(`${OPTION_MARKER} 1. ${ALLOW.name}`)

    // Confirming now answers the *new* request's first option, not the old highlight.
    await actAsync(() => {
      mockInput.pressEnter()
    })
    expect(controller.calls.respondPermission).toEqual([{ outcome: "selected", optionId: ALLOW.optionId }])

    await destroyMounted(renderer)
  })
})

describe("ApprovalPrompt modality", () => {
  it("keeps every key from the shell and the prompt editor while it is open", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithApproval(controller)

    await actAsync(async () => {
      mockInput.pressKey("`", { ctrl: true })
      await mockInput.typeText("/help")
      await mockInput.typeText(DRAFT_MARKER)
    })

    // Neither the global shell chord nor prompt command can reach past the approval gate.
    expect(controller.store.getState().focusedPane.kind).toBe("agent")
    expect(controller.store.getState().workspace.selectedVisibleId).toBe("claude-code")
    expect(await waitForFrame((f) => f.includes(APPROVAL_HINT))).not.toContain(HELP_TITLE)

    // Dismiss, and only then read the composer. A keystroke paints a pass after it
    // lands, so a frame captured while the overlay is still up would show an empty
    // composer whether or not the marker had leaked into its buffer.
    await actAsync(() => {
      mockInput.pressEscape()
    })
    const closed = await waitForFrame((f) => !f.includes(APPROVAL_HINT))
    expect(closed).not.toContain(DRAFT_MARKER)
    expect(closed).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(renderer)
  })

  it("returns the keys to the cockpit once the request is answered", async () => {
    const controller = createFakeController()
    const { renderer, mockInput, waitForFrame } = await renderWithApproval(controller)

    await actAsync(() => {
      mockInput.pressEscape()
    })
    await waitForFrame((f) => !f.includes(APPROVAL_HINT))

    await actAsync(() => {
      mockInput.pressKey("`", { ctrl: true })
    })
    expect(controller.store.getState().focusedPane.kind).toBe("shell")

    await destroyMounted(renderer)
  })
})

const CLAUDE: AgentConfig = { id: "claude-code", displayName: "Claude Code", command: "claude-acp", args: [], env: {} }
const CODEX: AgentConfig = { id: "codex", displayName: "Codex", command: "codex-acp", args: [], env: {} }
const APP_CONFIG: AppConfig = {
  providers: {
    "claude-code": { displayName: CLAUDE.displayName, command: CLAUDE.command, args: CLAUDE.args, env: CLAUDE.env },
    codex: { displayName: CODEX.displayName, command: CODEX.command, args: CODEX.args, env: CODEX.env },
  },
  sessions: [],
  shell: { enabled: true, command: "/bin/sh", scrollback: 1_000 },
  persistenceEnabled: true,
  telemetryEnabled: false,
  theme: "auto",
  welcomeBanner: "auto",
}

/** Wire a real `AgentConnection` to a fresh in-process mock ACP agent. */
function connectionToMockAgent(config: AgentConfig, onPrompt?: MockPromptScript) {
  const pair = createInMemoryTransportPair()
  const agent = startMockAgent(pair.agent, { sessionId: `${config.id}-session`, onPrompt })
  const connection = createAgentConnection({
    config,
    transport: () => ({ stream: pair.client, onClose: () => {}, dispose: async () => {} }),
    scheduler: { schedule: (flush) => flush(), dispose: () => {} },
  })
  return { connection, agent }
}

describe("integration - a mock agent's permission request", () => {
  it("opens the overlay and delivers the chosen outcome back to the requesting agent", async () => {
    const claude = connectionToMockAgent(CLAUDE, async (_request, ctx) => {
      await ctx.requestPermission({ toolCallId: "call-1", kind: "edit", title: "Bump b" }, [ALLOW, REJECT])
    })
    const codex = connectionToMockAgent(CODEX)
    const connections: Record<ProviderKind, AgentConnection> = {
      "claude-code": claude.connection,
      codex: codex.connection,
    }

    const controller = await createSessionController({
      config: APP_CONFIG,
      cwd: "/workspace/kitten",
      createConnection: (config) => connections[config.id],
    })

    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: WIDTH,
      height: HEIGHT,
      kittyKeyboard: true,
    })
    await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))

    // The agent blocks inside its prompt turn until the user answers.
    let prompt: Promise<unknown> = Promise.resolve()
    await actAsync(() => {
      prompt = controller.actions.sendPrompt("bump b", "claude-code")
    })
    const opened = await setup.waitForFrame((frame) => frame.includes(approvalTitleFor("Claude Code")))
    expect(opened).toContain("Bump b")
    expect(opened).toContain(ALLOW.name)
    expect(controller.store.getState().sessions["claude-code"]!.status).toBe("awaiting_approval")

    // The user rejects, by number.
    await actAsync(async () => {
      await setup.mockInput.typeText("2")
      await prompt
    })

    expect(claude.agent.permissionOutcomes).toEqual([{ outcome: "selected", optionId: REJECT.optionId }])
    expect(controller.store.getState().overlays.approval).toBeNull()
    expect(await setup.waitForFrame((f) => !f.includes(APPROVAL_HINT))).toContain(PROMPT_PLACEHOLDER)

    await destroyMounted(setup.renderer)
    await controller.dispose()
  })
})

describe("integration - two sessions of the same provider requesting permission (task_07)", () => {
  it("names each prompt by its own session and directory and routes each decision to the right agent", async () => {
    // Two claude-code sessions in two real, distinct directories - the same-provider
    // fleet where a provider display name alone cannot tell the prompts apart.
    const root = process.cwd()
    const dirA = join(root, "src")
    const dirB = join(root, "test")

    const permission: MockPromptScript = async (_request, ctx) => {
      await ctx.requestPermission({ toolCallId: "call-1", kind: "edit", title: "Bump b" }, [ALLOW, REJECT])
    }
    const agentA = connectionToMockAgent(CLAUDE, permission)
    const agentB = connectionToMockAgent(CLAUDE, permission)
    // Both sessions share the claude-code provider, so the controller asks for a
    // connection twice with the same config; hand out a fresh one per call, in plan order.
    const queue = [agentA.connection, agentB.connection]

    const config: AppConfig = {
      providers: APP_CONFIG.providers,
      sessions: [
        { provider: "claude-code", cwd: dirA, title: "repo-a" },
        { provider: "claude-code", cwd: dirB, title: "repo-b" },
      ],
      shell: APP_CONFIG.shell,
      persistenceEnabled: true,
      telemetryEnabled: false,
      theme: "auto",
      welcomeBanner: "auto",
    }
    const controller = await createSessionController({ config, cwd: root, createConnection: () => queue.shift()! })

    const setup = await testRender(<CockpitApp controller={controller} />, {
      width: WIDTH,
      height: HEIGHT,
      kittyKeyboard: true,
    })
    await setup.waitForFrame((frame) => frame.includes(PROMPT_PLACEHOLDER))

    // Session A (repo-a) asks first; the prompt is labeled with A's directory alone.
    let promptA: Promise<unknown> = Promise.resolve()
    const approvalA = waitForApprovalForSession(controller.store, "claude-code")
    await actAsync(async () => {
      promptA = controller.actions.sendPrompt("edit a", "claude-code")
      await approvalA
    })
    const openedA = await setup.waitForFrame((frame) => frame.includes(APPROVAL_HINT) && frame.includes("repo-a"))
    expect(openedA).toContain("repo-a")
    expect(openedA).not.toContain(dirB)

    // Session B (repo-b) asks while A is still on screen; its request queues behind A's
    // rather than replacing it, and B's own status flips to awaiting-approval.
    let promptB: Promise<unknown> = Promise.resolve()
    const awaitingB = waitForSessionStatus(controller.store, "claude-code-2", "awaiting_approval")
    await actAsync(async () => {
      promptB = controller.actions.sendPrompt("edit b", "claude-code-2")
      await awaitingB
    })

    // Answer A. Only A's agent hears the decision; B, still queued, hears nothing -
    // there is no path by which one session's answer settles another's request.
    const approvalB = waitForApprovalForSession(controller.store, "claude-code-2")
    await actAsync(async () => {
      controller.actions.respondPermission({ outcome: "selected", optionId: REJECT.optionId })
      await approvalB
      await promptA
    })
    expect(agentA.agent.permissionOutcomes).toEqual([{ outcome: "selected", optionId: REJECT.optionId }])
    expect(agentB.agent.permissionOutcomes).toEqual([])

    // The slot now belongs to B, labeled with B's directory alone.
    const openedB = await setup.waitForFrame((frame) => frame.includes(APPROVAL_HINT) && frame.includes("repo-b"))
    expect(openedB).toContain("repo-b")
    expect(openedB).not.toContain(dirA)

    // Answer B. Its own agent, and only now, hears its own decision.
    await actAsync(async () => {
      controller.actions.respondPermission({ outcome: "selected", optionId: ALLOW.optionId })
      await promptB
    })
    expect(agentB.agent.permissionOutcomes).toEqual([{ outcome: "selected", optionId: ALLOW.optionId }])

    await destroyMounted(setup.renderer)
    await controller.dispose()
  })
})
