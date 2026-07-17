import { describe, expect, it } from "bun:test"

import type { ElicitationSchema, SessionUpdate, ToolCall, ToolCallUpdate as AcpToolCallUpdate } from "@agentclientprotocol/sdk"

import { createSessionState, sessionReducer } from "../core/sessionReducer.ts"
import type { ClarificationAnswer, ClarificationPayload, DomainSessionEvent, McpServerConfig } from "../core/types.ts"
import {
  classifyBundledMcpFailure,
  toAcpElicitationOutcome,
  toAcpMcpServers,
  toUnifiedDiff,
  translateCommand,
  translateElicitationForm,
  translateSessionUpdate,
  translateToolCall,
} from "./acpTranslate.ts"

describe("elicitation form translation", () => {
  const schema = (value: ElicitationSchema): ElicitationSchema => value

  it("normalizes text, single-select, and string-array multi-select fields", () => {
    expect(
      translateElicitationForm(
        "Choose the implementation shape",
        schema({
          type: "object",
          required: ["strategy", "targets", "notes"],
          properties: {
            notes: { type: "string", title: "Notes", description: "Add context" },
            strategy: {
              type: "string",
              title: "Strategy",
              oneOf: [
                { const: "safe", title: "Safe", description: "Smallest change" },
                { const: "fast", title: "Fast" },
              ],
            },
            targets: {
              type: "array",
              title: "Targets",
              items: {
                anyOf: [
                  { const: "tests", title: "Tests" },
                  { const: "docs", title: "Docs", description: "Update guidance" },
                ],
              },
            },
            optional: { type: "string", enum: ["alpha", "beta"] },
          },
        }),
      ),
    ).toEqual({
      prompt: "Choose the implementation shape",
      fields: [
        { id: "notes", label: "Notes", description: "Add context", required: true, mode: "text" },
        {
          id: "strategy",
          label: "Strategy",
          required: true,
          mode: "single",
          allowsCustom: false,
          options: [
            { id: "safe", label: "Safe", description: "Smallest change" },
            { id: "fast", label: "Fast" },
          ],
        },
        {
          id: "targets",
          label: "Targets",
          required: true,
          mode: "multi",
          allowsCustom: false,
          options: [
            { id: "tests", label: "Tests" },
            { id: "docs", label: "Docs", description: "Update guidance" },
          ],
        },
        {
          id: "optional",
          label: "optional",
          required: false,
          mode: "single",
          allowsCustom: false,
          options: [
            { id: "alpha", label: "alpha" },
            { id: "beta", label: "beta" },
          ],
        },
      ],
    })
  })

  it("normalizes string-array enum items", () => {
    expect(
      translateElicitationForm("Pick", {
        properties: {
          choices: { type: "array", items: { type: "string", enum: ["one", "two"] } },
        },
      }),
    ).toEqual({
      prompt: "Pick",
      fields: [
        {
          id: "choices",
          label: "choices",
          required: false,
          mode: "multi",
          allowsCustom: false,
          options: [
            { id: "one", label: "one" },
            { id: "two", label: "two" },
          ],
        },
      ],
    })
  })

  it.each([
    ["empty prompt", "", { properties: { note: { type: "string" } } }],
    ["empty properties", "Ask", { properties: {} }],
    ["unknown required field", "Ask", { required: ["missing"], properties: { note: { type: "string" } } }],
    ["unsupported number", "Ask", { properties: { count: { type: "number" } } }],
    ["empty enum", "Ask", { properties: { choice: { type: "string", enum: [] } } }],
    ["duplicate enum", "Ask", { properties: { choice: { type: "string", enum: ["x", "x"] } } }],
    ["ambiguous string choices", "Ask", { properties: { choice: { type: "string", enum: ["x"], oneOf: [{ const: "x", title: "X" }] } } }],
    ["constrained text", "Ask", { properties: { note: { type: "string", minLength: 1 } } }],
    ["non-string array", "Ask", { properties: { choice: { type: "array", items: { type: "number" } } } }],
    ["unbounded array", "Ask", { properties: { choice: { type: "array", items: { type: "string", enum: ["x"] }, maxItems: 1 } } }],
    [
      "too many fields",
      "Ask",
      { properties: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`field-${index}`, { type: "string" }])) },
    ],
    [
      "too many options",
      "Ask",
      { properties: { choice: { type: "string", enum: Array.from({ length: 21 }, (_, index) => `option-${index}`) } } },
    ],
    ["oversized prompt", "x".repeat(4_097), { properties: { note: { type: "string" } } }],
  ])("rejects malformed or unsupported schema: %s", (_label, message, rawSchema) => {
    expect(translateElicitationForm(message, rawSchema as ElicitationSchema)).toBeNull()
  })
})

describe("elicitation outcome translation", () => {
  const payload: ClarificationPayload = {
    prompt: "Choose",
    fields: [
      {
        id: "strategy",
        label: "Strategy",
        required: true,
        mode: "single",
        allowsCustom: false,
        options: [
          { id: "safe", label: "Safe" },
          { id: "fast", label: "Fast" },
        ],
      },
      {
        id: "targets",
        label: "Targets",
        required: true,
        mode: "multi",
        allowsCustom: false,
        options: [
          { id: "tests", label: "Tests" },
          { id: "docs", label: "Docs" },
        ],
      },
      { id: "notes", label: "Notes", required: false, mode: "text" },
    ],
  }

  it("maps one valid submitted outcome to ACP accept content", () => {
    expect(
      toAcpElicitationOutcome(payload, {
        kind: "submitted",
        answers: {
          strategy: { selectedOptionIds: ["safe"] },
          targets: { selectedOptionIds: ["tests", "docs"] },
          notes: { selectedOptionIds: [], customText: "Keep it small" },
        },
      }),
    ).toEqual({
      action: "accept",
      content: { strategy: "safe", targets: ["tests", "docs"], notes: "Keep it small" },
    })
  })

  it.each(["skipped", "timed_out", "cancelled"] as const)("maps %s directly to ACP cancel", (kind) => {
    expect(toAcpElicitationOutcome(payload, { kind })).toEqual({ action: "cancel" })
  })

  it.each([
    ["missing required", { strategy: { selectedOptionIds: ["safe"] } }],
    [
      "unknown field",
      {
        strategy: { selectedOptionIds: ["safe"] },
        targets: { selectedOptionIds: ["tests"] },
        extra: { selectedOptionIds: [] },
      },
    ],
    [
      "unknown single option",
      { strategy: { selectedOptionIds: ["other"] }, targets: { selectedOptionIds: ["tests"] } },
    ],
    [
      "multiple single selections",
      { strategy: { selectedOptionIds: ["safe", "fast"] }, targets: { selectedOptionIds: ["tests"] } },
    ],
    [
      "unknown multi option",
      { strategy: { selectedOptionIds: ["safe"] }, targets: { selectedOptionIds: ["other"] } },
    ],
    [
      "duplicate multi option",
      { strategy: { selectedOptionIds: ["safe"] }, targets: { selectedOptionIds: ["tests", "tests"] } },
    ],
    [
      "empty required multi",
      { strategy: { selectedOptionIds: ["safe"] }, targets: { selectedOptionIds: [] } },
    ],
    [
      "custom choice",
      {
        strategy: { selectedOptionIds: [], customText: "other" },
        targets: { selectedOptionIds: ["tests"] },
      },
    ],
    [
      "selection on text field",
      {
        strategy: { selectedOptionIds: ["safe"] },
        targets: { selectedOptionIds: ["tests"] },
        notes: { selectedOptionIds: ["safe"], customText: "text" },
      },
    ],
  ])("terminally cancels invalid submitted answers: %s", (_label, answers) => {
    expect(
      toAcpElicitationOutcome(payload, {
        kind: "submitted",
        answers: answers as Record<string, ClarificationAnswer>,
      }),
    ).toEqual({ action: "cancel" })
  })

  it("cancels a choice field that advertises custom answers", () => {
    const customPayload: ClarificationPayload = {
      ...payload,
      fields: payload.fields.map((field) =>
        field.id === "strategy" && field.mode === "single"
          ? { ...field, allowsCustom: true }
          : field,
      ),
    }
    expect(
      toAcpElicitationOutcome(customPayload, {
        kind: "submitted",
        answers: {
          strategy: { selectedOptionIds: ["safe"] },
          targets: { selectedOptionIds: ["tests"] },
        },
      }),
    ).toEqual({ action: "cancel" })
  })

  it("cancels a payload with duplicate field IDs", () => {
    expect(
      toAcpElicitationOutcome(
        { ...payload, fields: [...payload.fields, payload.fields[0]!] },
        {
          kind: "submitted",
          answers: {
            strategy: { selectedOptionIds: ["safe"] },
            targets: { selectedOptionIds: ["tests"] },
          },
        },
      ),
    ).toEqual({ action: "cancel" })
  })

  it("cancels form metadata and answer properties that ACP cannot represent faithfully", () => {
    expect(
      toAcpElicitationOutcome(
        { ...payload, title: "Richer bridge title" },
        {
          kind: "submitted",
          answers: {
            strategy: { selectedOptionIds: ["safe"] },
            targets: { selectedOptionIds: ["tests"] },
          },
        },
      ),
    ).toEqual({ action: "cancel" })

    expect(
      toAcpElicitationOutcome(payload, {
        kind: "submitted",
        answers: {
          strategy: { selectedOptionIds: ["safe"], unsupported: true } as ClarificationAnswer,
          targets: { selectedOptionIds: ["tests"] },
        },
      }),
    ).toEqual({ action: "cancel" })
  })
})

/**
 * Unit tests for the pure ACP → domain translator. These assert that every
 * relevant `SessionUpdate` variant maps to the right {@link DomainSessionEvent}
 * and that no ACP-only field survives translation (ADR-003).
 */

/** Narrow a translated event to `tool_call` for focused assertions. */
const asToolCall = (event: DomainSessionEvent | null): Extract<DomainSessionEvent, { kind: "tool_call" }> => {
  if (event?.kind !== "tool_call") throw new Error(`expected tool_call event, got ${event?.kind}`)
  return event
}

describe("toAcpMcpServers", () => {
  it("maps a resolved domain server to the ACP stdio shape", () => {
    const servers: McpServerConfig[] = [
      { name: "gh", command: "/abs/npx", args: ["-y", "x"], env: { A: "1", B: "2" } },
    ]

    expect(toAcpMcpServers(servers)).toEqual([
      {
        name: "gh",
        command: "/abs/npx",
        args: ["-y", "x"],
        env: [
          { name: "A", value: "1" },
          { name: "B", value: "2" },
        ],
      },
    ])
  })

  it("returns an empty array for empty input", () => {
    expect(toAcpMcpServers([])).toEqual([])
  })

  it("maps an empty env map to an empty env array", () => {
    const servers: McpServerConfig[] = [{ name: "local", command: "/abs/local", args: [], env: {} }]

    expect(toAcpMcpServers(servers)).toEqual([{ name: "local", command: "/abs/local", args: [], env: [] }])
  })

  it("preserves the input server order", () => {
    const servers: McpServerConfig[] = [
      { name: "first", command: "/abs/first", args: [], env: {} },
      { name: "second", command: "/abs/second", args: ["serve"], env: {} },
    ]

    expect(toAcpMcpServers(servers).map((server) => server.name)).toEqual(["first", "second"])
  })
})

describe("translateSessionUpdate: messages", () => {
  it("maps agent_message_chunk to an agent_message carrying the textDelta", () => {
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "Hello" },
    }
    expect(translateSessionUpdate(update)).toEqual({ kind: "agent_message", messageId: "m1", textDelta: "Hello" })
  })

  it("maps user_message_chunk to a user_message", () => {
    const update: SessionUpdate = {
      sessionUpdate: "user_message_chunk",
      messageId: "u1",
      content: { type: "text", text: "hi there" },
    }
    expect(translateSessionUpdate(update)).toEqual({ kind: "user_message", messageId: "u1", text: "hi there" })
  })

  it("falls back to an empty messageId when the agent omits it", () => {
    const update: SessionUpdate = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } }
    expect(translateSessionUpdate(update)).toEqual({ kind: "agent_message", messageId: "", textDelta: "x" })
  })

  it("ignores non-text message content", () => {
    const update: SessionUpdate = {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "image", data: "AAAA", mimeType: "image/png" },
    }
    expect(translateSessionUpdate(update)).toBeNull()
  })
})

describe("translateSessionUpdate: tool calls", () => {
  const textResult = (text: string) => [{ type: "content" as const, content: { type: "text" as const, text } }]

  it.each([
    ['{ "error": "busy" }', "temporary_capacity"],
    ['{"error":"unavailable"}', "unavailable"],
  ] as const)("classifies the exact bundled child envelope %s", (text, expected) => {
    const failureKind = classifyBundledMcpFailure(textResult(text))
    const call = translateToolCall({
      toolCallId: "t1",
      status: "failed",
      content: textResult(text),
    }, failureKind)

    expect(call).toEqual({ toolCallId: "t1", status: "failed", diff: null, failureKind: expected })
    expect(JSON.stringify(call)).not.toContain(text)
    expect(JSON.stringify(call)).not.toContain('"error"')
  })

  it.each([
    ["missing content", undefined],
    ["null content", null],
    ["malformed JSON", textResult("not-json")],
    ["additional key", textResult('{"error":"busy","route":"private"}')],
    ["different error", textResult('{"error":"invalid_request"}')],
    ["arbitrary text", textResult("busy")],
    ["multiple blocks", [...textResult('{"error":"busy"}'), ...textResult("ignored")]],
    ["non-text block", [{ type: "content" as const, content: { type: "image" as const, data: "AAAA", mimeType: "image/png" } }]],
  ])("leaves a %s result unclassified", (_label, content) => {
    expect(classifyBundledMcpFailure(content)).toBeUndefined()
  })

  it("maps a tool_call preserving kind, title, status, locations, and a value-free input shape", () => {
    const sensitiveInput = "sk-proj-this-must-not-reach-the-transcript-state"
    const update: SessionUpdate = {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Read config",
      kind: "read",
      status: "pending",
      locations: [{ path: "/repo/a.ts", line: 3 }, { path: "/repo/b.ts" }],
      rawInput: { libraryName: "Context7", query: sensitiveInput, "not a safe field name": "also hidden" },
    }
    const call = asToolCall(translateSessionUpdate(update)).call

    expect(call).toEqual({
      toolCallId: "t1",
      kind: "read",
      title: "Read config",
      status: "pending",
      locations: ["/repo/a.ts", "/repo/b.ts"],
      inputSummary: "{ libraryName, query, field }",
    })
    expect(JSON.stringify(call)).not.toContain(sensitiveInput)
  })

  it("bounds an input shape and preserves only its top-level field names", () => {
    const call = translateToolCall({
      toolCallId: "t1",
      rawInput: { alpha: "one", beta: "two", gamma: "three", delta: "four", epsilon: "five" },
    })

    expect(call.inputSummary).toBe("{ alpha, beta, gamma, delta, … }")
  })

  it("maps a tool_call_update, extracting diff content as a unified diff", () => {
    const update: SessionUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      status: "in_progress",
      content: [{ type: "diff", path: "/repo/a.ts", oldText: "one\ntwo", newText: "one\nTWO" }],
    }
    const call = asToolCall(translateSessionUpdate(update)).call
    expect(call.toolCallId).toBe("t1")
    expect(call.status).toBe("in_progress")
    expect(call.diff).toEqual({
      path: "/repo/a.ts",
      unified: ["--- a//repo/a.ts", "+++ b//repo/a.ts", "@@ -1,2 +1,2 @@", " one", "-two", "+TWO"].join("\n"),
    })
  })

  it("clears the diff when content is present but carries no diff block", () => {
    const update: SessionUpdate = {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      content: [{ type: "content", content: { type: "text", text: "done" } }],
    }
    // `null` is the explicit clear signal the reducer understands.
    expect(asToolCall(translateSessionUpdate(update)).call.diff).toBeNull()
  })

  it("omits diff entirely when content is absent so the reducer preserves it", () => {
    const update: SessionUpdate = { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" }
    expect("diff" in asToolCall(translateSessionUpdate(update)).call).toBe(false)
  })

  it("maps the ACP-only switch_mode kind onto the domain 'other' kind", () => {
    const update: SessionUpdate = { sessionUpdate: "tool_call", toolCallId: "t1", title: "Switch", kind: "switch_mode" }
    expect(asToolCall(translateSessionUpdate(update)).call.kind).toBe("other")
  })

  it("translateToolCall works directly on a permission-request tool call", () => {
    const toolCall: AcpToolCallUpdate = { toolCallId: "t9", title: "Delete", kind: "delete", status: "pending" }
    expect(translateToolCall(toolCall)).toEqual({
      toolCallId: "t9",
      title: "Delete",
      kind: "delete",
      status: "pending",
    })
  })
})

describe("translateSessionUpdate: plan, commands, and ignored variants", () => {
  it("maps a plan update to plan entries", () => {
    const update: SessionUpdate = {
      sessionUpdate: "plan",
      entries: [
        { content: "Write tests", priority: "high", status: "pending" },
        { content: "Ship", priority: "low", status: "in_progress" },
      ],
    }
    expect(translateSessionUpdate(update)).toEqual({
      kind: "plan",
      entries: [
        { content: "Write tests", priority: "high", status: "pending" },
        { content: "Ship", priority: "low", status: "in_progress" },
      ],
    })
  })

  it.each<SessionUpdate>([
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } },
    { sessionUpdate: "current_mode_update", currentModeId: "code" },
    { sessionUpdate: "plan_update", plan: { type: "markdown", planId: "p1", content: "# plan" } },
    { sessionUpdate: "plan_removed", planId: "p1" },
    { sessionUpdate: "session_info_update", title: "Renamed session" },
  ])("returns null for the unsurfaced variant %o", (update) => {
    expect(translateSessionUpdate(update)).toBeNull()
  })
})

describe("translateSessionUpdate: usage", () => {
  it("maps usage_update to content-free domain counters", () => {
    expect(translateSessionUpdate({ sessionUpdate: "usage_update", used: 36000, size: 200000 })).toEqual({
      kind: "usage",
      used: 36000,
      size: 200000,
    })
  })

  it("drops cost and metadata from usage_update", () => {
    const event = translateSessionUpdate({
      sessionUpdate: "usage_update",
      used: 36000,
      size: 200000,
      cost: { amount: 0.25, currency: "USD", _meta: { billingTrace: "private" } },
      _meta: { trace: "private" },
    })

    expect(event).toEqual({ kind: "usage", used: 36000, size: 200000 })
    expect(Object.keys(event ?? {}).sort()).toEqual(["kind", "size", "used"])
  })
})

describe("translateSessionUpdate: available commands", () => {
  it("maps advertised commands into protocol-free domain records", () => {
    const event = translateSessionUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: [
        {
          name: "review",
          description: "Review the current changes",
          input: { hint: "[scope]", _meta: { ignored: true } },
          _meta: { ignored: true },
        },
        { name: "test", description: "Run tests" },
      ],
      _meta: { ignored: true },
    })

    expect(event).toEqual({
      kind: "commands",
      commands: [
        { name: "review", description: "Review the current changes", hint: "[scope]" },
        { name: "test", description: "Run tests" },
      ],
    })
    expect(event?.kind === "commands" && event.commands[1]?.hint).toBeUndefined()
  })

  it("drops ACP metadata while preserving the advertised input hint", () => {
    expect(
      translateCommand({
        name: "status",
        description: "Show status",
        input: { hint: "", _meta: { internal: true } },
        _meta: { internal: true },
      }),
    ).toEqual({ name: "status", description: "Show status", hint: "" })
  })

  it("translates an empty advertised command list into an empty commands event", () => {
    expect(
      translateSessionUpdate({ sessionUpdate: "available_commands_update", availableCommands: [] }),
    ).toEqual({ kind: "commands", commands: [] })
  })

  it("flows an available-commands update through the reducer", () => {
    const event = translateSessionUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "review", description: "Review the current changes" }],
    })
    if (event === null || event.kind !== "commands") throw new Error("expected a commands event")

    const state = createSessionState({ id: "s1", providerKind: "claude-code", title: "t", cwd: "/repo" })
    expect(sessionReducer(state, event).commands).toEqual([{ name: "review", description: "Review the current changes" }])
  })
})

describe("translateSessionUpdate: config options", () => {
  const modelOption: SessionUpdate = {
    sessionUpdate: "config_option_update",
    configOptions: [
      {
        type: "select",
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "opus",
        options: [
          { value: "opus", name: "Opus" },
          { value: "sonnet", name: "Sonnet" },
        ],
      },
    ],
  }

  it("translates a model select option into a config_options event", () => {
    expect(translateSessionUpdate(modelOption)).toEqual({
      kind: "config_options",
      options: [
        {
          id: "model",
          category: "model",
          label: "Model",
          currentValue: "opus",
          options: [
            { value: "opus", name: "Opus" },
            { value: "sonnet", name: "Sonnet" },
          ],
        },
      ],
    })
  })

  it("maps both model and thought_level options, preserving currentValue and the option list", () => {
    const update: SessionUpdate = {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          type: "select",
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "sonnet",
          options: [
            { value: "opus", name: "Opus" },
            { value: "sonnet", name: "Sonnet" },
          ],
        },
        {
          type: "select",
          id: "thought_level",
          name: "Reasoning",
          category: "thought_level",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
      ],
    }
    expect(translateSessionUpdate(update)).toEqual({
      kind: "config_options",
      options: [
        {
          id: "model",
          category: "model",
          label: "Model",
          currentValue: "sonnet",
          options: [
            { value: "opus", name: "Opus" },
            { value: "sonnet", name: "Sonnet" },
          ],
        },
        {
          id: "thought_level",
          category: "thought_level",
          label: "Reasoning",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
      ],
    })
  })

  it("skips a boolean config option instead of crashing", () => {
    const update: SessionUpdate = {
      sessionUpdate: "config_option_update",
      configOptions: [
        { type: "boolean", id: "fast_mode", name: "Fast mode", category: "model_config", currentValue: true },
        {
          type: "select",
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "opus",
          options: [{ value: "opus", name: "Opus" }],
        },
      ],
    }
    const event = translateSessionUpdate(update)
    expect(event).toEqual({
      kind: "config_options",
      options: [
        { id: "model", category: "model", label: "Model", currentValue: "opus", options: [{ value: "opus", name: "Opus" }] },
      ],
    })
  })

  it("defaults an absent category to an empty string, kept opaque", () => {
    const update: SessionUpdate = {
      sessionUpdate: "config_option_update",
      configOptions: [
        { type: "select", id: "x", name: "X", currentValue: "a", options: [{ value: "a", name: "A" }] },
      ],
    }
    const event = translateSessionUpdate(update)
    expect(event?.kind === "config_options" && event.options[0]?.category).toBe("")
  })

  it("flattens grouped select options into a single ordered list", () => {
    const update: SessionUpdate = {
      sessionUpdate: "config_option_update",
      configOptions: [
        {
          type: "select",
          id: "model",
          name: "Model",
          category: "model",
          currentValue: "opus",
          options: [
            { group: "anthropic", name: "Anthropic", options: [{ value: "opus", name: "Opus" }] },
            { group: "openai", name: "OpenAI", options: [{ value: "gpt", name: "GPT" }] },
          ],
        },
      ],
    }
    const event = translateSessionUpdate(update)
    expect(event?.kind === "config_options" && event.options[0]?.options).toEqual([
      { value: "opus", name: "Opus" },
      { value: "gpt", name: "GPT" },
    ])
  })

  it("flows through the reducer into SessionState.configOptions unchanged", () => {
    const event = translateSessionUpdate(modelOption)
    if (event === null) throw new Error("expected a config_options event")
    const state = createSessionState({ id: "s1", providerKind: "claude-code", title: "t", cwd: "/repo" })
    const next = sessionReducer(state, event)
    expect(next.configOptions).toEqual([
      {
        id: "model",
        category: "model",
        label: "Model",
        currentValue: "opus",
        options: [
          { value: "opus", name: "Opus" },
          { value: "sonnet", name: "Sonnet" },
        ],
      },
    ])
  })
})

describe("translation completeness", () => {
  const FORBIDDEN_ACP_KEYS = ["_meta", "sessionUpdate", "rawInput", "rawOutput", "content", "annotations", "line", "cost"]

  const collectKeys = (value: unknown, keys: Set<string> = new Set()): Set<string> => {
    if (Array.isArray(value)) {
      for (const item of value) collectKeys(item, keys)
    } else if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        keys.add(key)
        collectKeys(nested, keys)
      }
    }
    return keys
  }

  it("never leaks an ACP-only field through a translated event", () => {
    const acpToolCall: ToolCall = {
      toolCallId: "t1",
      title: "Edit",
      kind: "edit",
      status: "in_progress",
      locations: [{ path: "/x.ts", line: 10 }],
      content: [{ type: "diff", path: "/x.ts", oldText: "a", newText: "b" }],
      rawInput: { secret: "should-not-leak" },
      _meta: { trace: "abc" },
    }
    const events = [
      translateSessionUpdate({ ...acpToolCall, sessionUpdate: "tool_call" }),
      translateSessionUpdate({
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "review",
            description: "Review the current changes",
            input: { hint: "[scope]", _meta: { trace: "nested" } },
            _meta: { trace: "command" },
          },
        ],
        _meta: { trace: "update" },
      }),
      translateSessionUpdate({
        sessionUpdate: "usage_update",
        used: 36000,
        size: 200000,
        cost: { amount: 0.25, currency: "USD" },
        _meta: { trace: "abc" },
      }),
    ]
    const keys = collectKeys(events)
    for (const forbidden of FORBIDDEN_ACP_KEYS) {
      expect(keys.has(forbidden)).toBe(false)
    }
  })
})

describe("toUnifiedDiff", () => {
  it("emits context, removed and added lines for an edit", () => {
    expect(toUnifiedDiff("/f.ts", "a\nb\nc", "a\nx\nc")).toBe(
      ["--- a//f.ts", "+++ b//f.ts", "@@ -1,3 +1,3 @@", " a", "-b", "+x", " c"].join("\n"),
    )
  })

  it("uses a zero old-range for a newly created file", () => {
    expect(toUnifiedDiff("/new.ts", null, "line1\nline2")).toBe(
      ["--- a//new.ts", "+++ b//new.ts", "@@ -0,0 +1,2 @@", "+line1", "+line2"].join("\n"),
    )
  })
})
