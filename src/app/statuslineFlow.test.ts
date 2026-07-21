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

  it("documents only the supported colored and legacy-compatible item grammar", () => {
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain(
      'Legacy uncolored simple fields are the strings "FOLDER", "FULL_PATH", "BRANCH", "PROVIDER", "MODEL", "EFFORT", "HELP_TEXT", and "CONTEXT".',
    )
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain(
      'A colored simple field is exactly {"kind":"FOLDER","color":"purple"}',
    )
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain(
      'ELLIPSIS_BRANCH is exactly {"kind":"ELLIPSIS_BRANCH","maxChars":24} with optional "color"',
    )
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).toContain(
      'Color is either a known CSS color name or exactly six hexadecimal digits in #RRGGBB form.',
    )
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).not.toMatch(/(?:rgba?|hsla?)\s*\(/iu)
    expect(STATUSLINE_PROPOSAL_INSTRUCTION).not.toMatch(/background|palette|theme token/iu)
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

  it("does not add selected-session values or prior transcript content to the agent input", async () => {
    const f = fixture({ onSend: (store) => agent(store, "new", validReply()) })
    apply(f.store, { kind: "branch", branch: "secret-branch-value" })
    apply(f.store, { kind: "usage", used: 37, size: 101 })
    apply(f.store, {
      kind: "config_options",
      options: [
        {
          id: "model",
          category: "model",
          label: "Model",
          currentValue: "private-model-value",
          options: [{ value: "private-model-value", name: "Private model" }],
        },
        {
          id: "effort",
          category: "thought_level",
          label: "Effort",
          currentValue: "private-effort-value",
          options: [{ value: "private-effort-value", name: "Private effort" }],
        },
      ],
    })
    user(f.store, "prior-user", "prior raw transcript value")
    agent(f.store, "prior-agent", "prior private agent response")

    await f.flow.request("Arrange the fields.", SESSION_ID)

    const input = f.calls[0]?.input
    expect(input).toBe(buildStatuslineProposalPrompt("Arrange the fields."))
    for (const value of [
      "/resolved/private/worktree",
      "secret-branch-value",
      "codex",
      "private-model-value",
      "private-effort-value",
      "37",
      "101",
      "prior raw transcript value",
      "prior private agent response",
    ]) {
      expect(input).not.toContain(value)
    }
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
    ["named colors", [{ kind: "BRANCH", color: "purple" } as const], [{ kind: "BRANCH", color: "#800080" } as const]],
    ["hex colors", [{ kind: "MODEL", color: "#0a8bcf" } as const], [{ kind: "MODEL", color: "#0A8BCF" } as const]],
    [
      "colored ellipsis branches",
      [{ kind: "ELLIPSIS_BRANCH", maxChars: 24, color: "teal" } as const],
      [{ kind: "ELLIPSIS_BRANCH", maxChars: 24, color: "#008080" } as const],
    ],
  ])("canonicalizes %s through the strict core proposal boundary", async (_case, proposed, canonical) => {
    const f = fixture({ onSend: (store) => agent(store, "new", validReply(proposed)) })

    await expect(f.flow.request("Color the important field.", SESSION_ID)).resolves.toEqual({
      kind: "proposal",
      layout: { separator: " · ", line: canonical },
    })
  })

  it.each([
    ["surrounding prose", `Here you go\n${validReply()}`],
    ["multiple fenced blocks", `${validReply()}\n${validReply(["MODEL"])}`],
    ["unfenced JSON", JSON.stringify({ statusline: { separator: " · ", line: ["MODEL"] } })],
    ["trailing content", `${validReply()}\nDone.`],
    ["malformed JSON", "```json\n{nope}\n```"],
    ["invalid layout", validReply(["SHELL_COMMAND"])],
    ["invalid color", validReply([{ kind: "MODEL", color: "#123" }])],
    ["unsupported transparent color", validReply([{ kind: "MODEL", color: "transparent" }])],
    ["extra colored item key", validReply([{ kind: "MODEL", color: "purple", background: "black" }])],
    [
      "extra response key",
      `\`\`\`json\n${JSON.stringify({ statusline: { separator: " · ", line: ["MODEL"] }, explanation: "extra" })}\n\`\`\``,
    ],
    [
      "extra layout key",
      `\`\`\`json\n${JSON.stringify({ statusline: { separator: " · ", line: ["MODEL"], palette: "extra" } })}\n\`\`\``,
    ],
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
  it("yields a canonical colored preview-ready proposal while changing only the intentional transcript", async () => {
    const rawRequest = "Use a compact purple folder and blue model line."
    const rawResponse = validReply([
      { kind: "FOLDER", color: "purple" },
      { kind: "MODEL", color: "#0a8bcf" },
    ])
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
      layout: {
        separator: " · ",
        line: [
          { kind: "FOLDER", color: "#800080" },
          { kind: "MODEL", color: "#0A8BCF" },
        ],
      },
    })

    expect(f.store.getState().preferences).toBe(preferences)
    expect(f.store.getState().overlays).toBe(overlays)
    expect(telemetryCalls).toEqual([])
    expect(f.store.getState().sessions[SESSION_ID]?.turns.map((turn) => turn.kind === "tool_call" ? "" : turn.text))
      .toEqual([buildStatuslineProposalPrompt(rawRequest), rawResponse])
  })
})
