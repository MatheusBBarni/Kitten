// Suite: focused-agent statusline proposal orchestration
// Invariant: only one post-boundary normal-transcript agent reply can become a proposal.
// Boundary IN: injected controller action and store transcript read model
// Boundary OUT: statusline modal/persistence UI, owned by later tasks

import { describe, expect, it } from "bun:test"

import type { ControllerActions, PromptInput, PromptSendOptions } from "./actions.ts"
import {
  buildStatuslineProposalPrompt,
  createStatuslineFlow,
  STATUSLINE_PROPOSAL_INSTRUCTION,
} from "./statuslineFlow.ts"
import type { DomainSessionEvent, SessionId } from "../core/types.ts"
import { createAppStore, type AppStore } from "../store/appStore.ts"

const SESSION_ID = "focused-agent"
const validReply = (line: unknown = ["FOLDER", "MODEL"]): string =>
  `\`\`\`json\n${JSON.stringify({ statusline: { separator: " · ", line } })}\n\`\`\``

interface Fixture {
  readonly store: AppStore
  readonly calls: Array<{ input: PromptInput; sessionId?: SessionId; options?: PromptSendOptions }>
  readonly flow: ReturnType<typeof createStatuslineFlow>
}

function fixture(options: {
  readonly ready?: boolean
  readonly onSend?: (store: AppStore) => void | Promise<void>
  readonly result?: { stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" } | null
  readonly reject?: unknown
} = {}): Fixture {
  const store = createAppStore({
    seeds: [{ id: SESSION_ID, providerKind: "codex", title: "Focused", cwd: "/resolved/private/worktree" }],
    selectedVisibleId: SESSION_ID,
  })
  if (options.ready !== false) store.setConversationAvailability(SESSION_ID, { kind: "ready" })
  const calls: Array<{ input: PromptInput; sessionId?: SessionId; options?: PromptSendOptions }> = []
  const actions: Pick<ControllerActions, "sendPrompt"> = {
    async sendPrompt(input, sessionId, sendOptions) {
      calls.push({ input, sessionId, options: sendOptions })
      if (options.reject !== undefined) throw options.reject
      await options.onSend?.(store)
      return options.result === undefined ? { stopReason: "end_turn" } : options.result
    },
  }
  return { store, calls, flow: createStatuslineFlow({ actions, store }) }
}

function agent(store: AppStore, messageId: string, text: string): void {
  apply(store, { kind: "agent_message", messageId, textDelta: text })
}

function user(store: AppStore, messageId: string, text: string): void {
  apply(store, { kind: "user_message", messageId, text })
}

function apply(store: AppStore, event: DomainSessionEvent): void {
  store.applyEvent(SESSION_ID, event)
}

describe("statusline proposal prompt", () => {
  it("sends the product instruction and developer request exactly once to the selected session", async () => {
    const f = fixture({ onSend: (store) => agent(store, "new", validReply()) })

    await f.flow.request("Put the folder before the model.", SESSION_ID)

    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toEqual({
      input: buildStatuslineProposalPrompt("Put the folder before the model."),
      sessionId: SESSION_ID,
      options: { persist: false },
    })
  })

  it("contains only the declarative schema and excludes resolved session or transcript values", () => {
    const forbiddenValues = [
      "/resolved/private/worktree",
      "secret-branch-value",
      "private-provider-value",
      "private-model-value",
      "private-effort-value",
      "prior raw transcript value",
    ]

    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain("exactly one lowercase-json fenced block with no prose")
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain("FOLDER")
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain("ELLIPSIS_BRANCH")
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain("HELP_TEXT")
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain("CONTEXT")
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain("Do not emit scripts, commands, templates")
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).not.toMatch(/\b\d+%/u)
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).not.toMatch(/\b(?:used|size)\b/u)
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).not.toMatch(
      /\b(?:state|config|persistence|ACP|telemetry|UI)\b/iu,
    )
    for (const forbiddenDetail of [
      "contextHeadroom",
      "usage.used",
      "usage.size",
      "SessionState",
      "config persistence",
      "ACP",
      "telemetry",
      "UI ownership",
    ]) {
      expect(STATUSLINE_PROPOSAL_INSTRUCTION).not.toContain(forbiddenDetail)
    }
    for (const value of forbiddenValues) expect(STATUSLINE_PROPOSAL_INSTRUCTION).not.toContain(value)
  })
})

describe("statusline transcript boundary", () => {
  it("waits for terminal completion and parses only the newly flushed agent turn", async () => {
    const f = fixture({
      onSend: async (store) => {
        await Promise.resolve()
        user(store, "request", "normal transcript request")
        agent(store, "new", validReply(["BRANCH", "EFFORT"]))
      },
    })
    agent(f.store, "old", "not a proposal")

    await expect(f.flow.request("Show branch and effort.", SESSION_ID)).resolves.toEqual({
      kind: "proposal",
      layout: { separator: " · ", line: ["BRANCH", "EFFORT"] },
    })
  })

  it("parses a literal CONTEXT proposal through the strict flow", async () => {
    const f = fixture({ onSend: (store) => agent(store, "new", validReply(["FOLDER", "CONTEXT"])) })

    await expect(f.flow.request("Show folder and context.", SESSION_ID)).resolves.toEqual({
      kind: "proposal",
      layout: { separator: " · ", line: ["FOLDER", "CONTEXT"] },
    })
  })

  it.each([
    ["surrounding prose", `Here you go\n${validReply()}`],
    ["multiple fenced blocks", `${validReply()}\n${validReply(["MODEL"])}`],
    ["malformed JSON", "```json\n{nope}\n```"],
    ["invalid layout", validReply(["SHELL_COMMAND"])],
  ])("returns invalid-response for %s", async (_case, response) => {
    const f = fixture({ onSend: (store) => agent(store, "new", response) })
    expect((await f.flow.request("Customize it.", SESSION_ID)).kind).toBe("invalid-response")
  })

  it("rejects multiple new agent replies instead of guessing", async () => {
    const f = fixture({
      onSend: (store) => {
        agent(store, "one", validReply())
        agent(store, "two", validReply(["MODEL"]))
      },
    })

    await expect(f.flow.request("Customize it.", SESSION_ID)).resolves.toMatchObject({
      kind: "invalid-response",
      reason: expect.stringContaining("multiple"),
    })
  })

  it("classifies multiple empty agent turns as multiple responses, not as silence", async () => {
    const f = fixture({
      onSend: (store) => {
        agent(store, "one", "")
        agent(store, "two", "   ")
      },
    })

    await expect(f.flow.request("Customize it.", SESSION_ID)).resolves.toMatchObject({
      kind: "invalid-response",
      reason: expect.stringContaining("multiple"),
    })
  })
})

describe("statusline recovery outcomes", () => {
  it("does not send when the selected session is not ready", async () => {
    const f = fixture({ ready: false })
    await expect(f.flow.request("Customize it.", SESSION_ID)).resolves.toMatchObject({ kind: "unavailable" })
    expect(f.calls).toEqual([])
  })

  it.each([
    ["null prompt result", { result: null }],
    ["cancelled prompt", { result: { stopReason: "cancelled" as const } }],
    ["refused prompt", { result: { stopReason: "refusal" as const } }],
    ["incomplete prompt", { result: { stopReason: "max_tokens" as const } }],
    ["action failure", { reject: new Error("connection failed") }],
    ["zero new response", {}],
    ["empty new response", { onSend: (store: AppStore) => agent(store, "empty", "   ") }],
  ])("returns unavailable without rejecting for %s", async (_case, options) => {
    const f = fixture(options)
    await expect(f.flow.request("Customize it.", SESSION_ID)).resolves.toMatchObject({ kind: "unavailable" })
  })

  it("returns unavailable if the session disappears after terminal completion", async () => {
    const f = fixture({ onSend: (store) => store.removeSession(SESSION_ID) })
    await expect(f.flow.request("Customize it.", SESSION_ID)).resolves.toMatchObject({ kind: "unavailable" })
  })
})

describe("normal transcript integration", () => {
  it("yields a preview-ready proposal while changing only the intentional transcript", async () => {
    const rawRequest = "Use a compact folder and model line."
    const rawResponse = validReply(["FOLDER", "MODEL"])
    const f = fixture({
      onSend: (store) => {
        user(store, "statusline-request", buildStatuslineProposalPrompt(rawRequest))
        agent(store, "statusline-response", rawResponse)
      },
    })
    const preferences = f.store.getState().preferences
    const overlays = f.store.getState().overlays
    const telemetryCalls: unknown[] = []

    await expect(f.flow.request(rawRequest, SESSION_ID)).resolves.toEqual({
      kind: "proposal",
      layout: { separator: " · ", line: ["FOLDER", "MODEL"] },
    })

    expect(f.store.getState().preferences).toBe(preferences)
    expect(f.store.getState().overlays).toBe(overlays)
    expect(telemetryCalls).toEqual([])
    expect(f.store.getState().sessions[SESSION_ID]?.turns.map((turn) => turn.kind === "tool_call" ? "" : turn.text))
      .toEqual([buildStatuslineProposalPrompt(rawRequest), rawResponse])
  })
})
