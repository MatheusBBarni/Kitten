import { describe, expect, it } from "bun:test"

import { DEFAULT_BUNDLE_LIMITS, createDeterministicAssembler } from "./bundleAssembler.ts"
import { REDACTION_PLACEHOLDER, createSecretRedactor } from "./secretRedactor.ts"
import { createSessionState, sessionReducer } from "./sessionReducer.ts"
import type { DomainSessionEvent, SessionState, ShellSnapshot } from "./types.ts"

/**
 * Fixtures are built by folding real domain events through the real reducer, so
 * the referenced-file set and the pending diffs under test are the same
 * derivations the running app produces. The assembler is pure, so no mocks and
 * no I/O appear anywhere here.
 */

const R = REDACTION_PLACEHOLDER
const ANTHROPIC_KEY = "sk-ant-api03-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"
const AWS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"

const fold = (events: DomainSessionEvent[]): SessionState =>
  events.reduce(sessionReducer, createSessionState({ id: "claude-code", providerKind: "claude-code", title: "claude-code", cwd: "/w", acpSessionId: "session-1" }))

const assembler = createDeterministicAssembler()

describe("referenced files and pending diffs", () => {
  it("derives two referenced files with the right reason and one pending diff", () => {
    const session = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "read",
          title: "Read src/parser.ts",
          status: "completed",
          locations: ["src/parser.ts"],
        },
      },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t2",
          kind: "edit",
          title: "Edit src/lexer.ts",
          status: "pending",
          locations: ["src/lexer.ts"],
          diff: { path: "src/lexer.ts", unified: "@@ -1 +1 @@\n-old\n+new" },
        },
      },
    ])

    const bundle = assembler.assemble(session, "codex")

    expect(bundle.intent).toBe("continue")
    expect(bundle.files).toEqual([
      { path: "src/lexer.ts", reason: "edited" },
      { path: "src/parser.ts", reason: "read" },
    ])
    expect(bundle.pendingDiffs).toEqual([
      { toolCallId: "t2", path: "src/lexer.ts", unified: "@@ -1 +1 @@\n-old\n+new" },
    ])
    expect(bundle.redactionCount).toBe(0)
  })

  it("yields an empty pendingDiffs array when the session has no edit tool calls", () => {
    const session = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "read",
          title: "Read src/parser.ts",
          status: "completed",
          locations: ["src/parser.ts"],
        },
      },
      {
        kind: "tool_call",
        call: { toolCallId: "t2", kind: "search", title: "Grep tokenize", status: "completed", locations: [] },
      },
    ])

    const bundle = assembler.assemble(session, "codex")

    expect(bundle.pendingDiffs).toEqual([])
    expect(bundle.files).toEqual([{ path: "src/parser.ts", reason: "read" }])
  })

  it("sorts the referenced file set by path so assembly is deterministic", () => {
    const session = fold(
      ["src/z.ts", "src/a.ts", "src/m.ts"].map((path, i) => ({
        kind: "tool_call" as const,
        call: { toolCallId: `t${i}`, kind: "read" as const, title: `Read ${path}`, locations: [path] },
      })),
    )

    const bundle = assembler.assemble(session, "codex")
    expect(bundle.files.map((f) => f.path)).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"])
  })

  it("produces an identical bundle for the same session on repeated calls", () => {
    const session = fold([
      { kind: "user_message", messageId: "u1", text: "fix the lexer" },
      { kind: "agent_message", messageId: "m1", textDelta: "on it" },
    ])
    expect(assembler.assemble(session, "codex")).toEqual(assembler.assemble(session, "codex"))
  })

  it("does not mutate the session it is given", () => {
    const session = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit src/a.ts",
          status: "in_progress",
          locations: ["src/a.ts"],
          diff: { path: "src/a.ts", unified: `+const k = "${ANTHROPIC_KEY}"` },
        },
      },
    ])
    const before = structuredClone(session.pendingDiffs)

    assembler.assemble(session, "codex")

    expect(session.pendingDiffs).toEqual(before)
    expect(session.pendingDiffs[0]?.unified).toContain(ANTHROPIC_KEY)
  })
})

describe("shell snapshot assembly", () => {
  // Suite: deterministic shell snapshot assembly
  // Invariant: emitted shell context contains only redacted cwd and command records.
  // Boundary IN: BundleAssembler and the existing SecretRedactor.
  // Boundary OUT: prompt composition, owned by src/app/handoff.test.ts.
  const shell: ShellSnapshot = {
    cwd: "/workspace/kitten",
    commands: [
      { id: "command-1", command: "bun test", output: "12 pass\n0 fail", exitCode: 0 },
      { id: "command-2", command: "git status --short", output: " M src/app.ts", exitCode: 0 },
    ],
  }

  it("populates the bundle from cwd and recent command records", () => {
    expect(assembler.assemble(fold([]), "codex", shell).shell).toEqual(shell)
  })

  it("redacts shell cwd, command text, and output before the bundle leaves the core", () => {
    const withSecret: ShellSnapshot = {
      cwd: `/workspace/${ANTHROPIC_KEY}`,
      commands: [
        {
          id: "command-secret",
          command: `export API_KEY=${ANTHROPIC_KEY}`,
          output: `token=${ANTHROPIC_KEY}`,
          exitCode: 0,
        },
      ],
    }

    const bundle = assembler.assemble(fold([]), "codex", withSecret)

    expect(bundle.shell?.cwd).toBe(`/workspace/${R}`)
    expect(bundle.shell?.commands[0]?.command).toBe(`export API_KEY=${R}`)
    expect(bundle.shell?.commands[0]?.output).toBe(`token=${R}`)
    expect(bundle.redactionCount).toBe(3)
  })

  it("never copies environment-variable data into the snapshot", () => {
    const shellSlice = {
      ...shell,
      env: { KITTEN_TEST_SECRET: "environment-only-value" },
    }

    const bundle = assembler.assemble(fold([]), "codex", shellSlice)
    const serialized = JSON.stringify(bundle.shell)

    expect(serialized).not.toContain("KITTEN_TEST_SECRET")
    expect(serialized).not.toContain("environment-only-value")
    expect(bundle.shell).toEqual(shell)
  })

  it("omits the optional snapshot when there are no command records", () => {
    const bundle = assembler.assemble(fold([]), "codex", { cwd: shell.cwd, commands: [] })

    expect(bundle.shell).toBeUndefined()
  })
})

describe("transcript excerpt", () => {
  it("renders user, agent, and tool-call turns in transcript order", () => {
    const session = fold([
      { kind: "user_message", messageId: "u1", text: "fix the lexer" },
      { kind: "agent_message", messageId: "m1", textDelta: "Reading the file." },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "read",
          title: "Read src/lexer.ts",
          status: "completed",
          locations: ["src/lexer.ts"],
        },
      },
    ])

    const { summary } = assembler.assemble(session, "codex")

    expect(summary).toBe(
      [
        "Transcript excerpt from claude-code (intent: continue, target: codex).",
        "",
        "user: fix the lexer",
        "claude-code: Reading the file.",
        "tool[read/completed] Read src/lexer.ts (src/lexer.ts)",
      ].join("\n"),
    )
  })

  it("bounds the summary for a long transcript and announces what was dropped", () => {
    const session = fold(
      Array.from({ length: 200 }, (_, i) => ({
        kind: "user_message" as const,
        messageId: `u${i}`,
        text: `turn ${i} `.padEnd(1000, "x"),
      })),
    )

    const { summary } = assembler.assemble(session, "codex")

    expect(summary.length).toBeLessThanOrEqual(DEFAULT_BUNDLE_LIMITS.maxSummaryChars)
    expect(summary).toContain("earlier turn(s) omitted")
    // The tail of the transcript is what the target agent needs to continue.
    expect(summary).toContain("turn 199")
    expect(summary).not.toContain("turn 0 ")
  })

  it("truncates a single over-long turn to the per-turn bound", () => {
    const bounded = createDeterministicAssembler({ limits: { maxTurnChars: 40 } })
    const session = fold([{ kind: "user_message", messageId: "u1", text: "y".repeat(500) }])

    const lines = bounded.assemble(session, "codex").summary.split("\n")
    const turnLine = lines[lines.length - 1] as string

    expect(turnLine).toHaveLength(40)
    expect(turnLine).toStartWith("user: yyy")
    expect(turnLine).toEndWith(" [truncated]")
  })

  it("drops the truncation marker when the per-turn bound cannot hold it", () => {
    const tiny = createDeterministicAssembler({ limits: { maxTurnChars: 8 } })
    const session = fold([{ kind: "user_message", messageId: "u1", text: "z".repeat(50) }])

    const lines = tiny.assemble(session, "codex").summary.split("\n")
    expect(lines[lines.length - 1]).toBe("user: zz")
  })

  it("renders nothing for a turn when the per-turn bound is zero", () => {
    const zero = createDeterministicAssembler({ limits: { maxTurnChars: 0 } })
    const session = fold([{ kind: "user_message", messageId: "u1", text: "hello" }])

    const lines = zero.assemble(session, "codex").summary.split("\n")
    expect(lines[lines.length - 1]).toBe("")
  })

  it("keeps only the most recent maxTurns turns", () => {
    const bounded = createDeterministicAssembler({ limits: { maxTurns: 2 } })
    const session = fold(
      ["first", "second", "third"].map((text, i) => ({ kind: "user_message" as const, messageId: `u${i}`, text })),
    )

    const { summary } = bounded.assemble(session, "codex")

    expect(summary).toContain("[1 earlier turn(s) omitted]")
    expect(summary).not.toContain("first")
    expect(summary).toContain("second")
    expect(summary).toContain("third")
  })

  it("stays well formed when the limits leave no room for any turn", () => {
    const starved = createDeterministicAssembler({ limits: { maxSummaryChars: 10 } })
    const session = fold([{ kind: "user_message", messageId: "u1", text: "hello" }])

    const { summary } = starved.assemble(session, "codex")
    expect(summary).toHaveLength(10)
    expect(summary).toBe("Transcript")
  })

  it("names the target agent so the bundle reads as a continue hand-off", () => {
    const session = fold([{ kind: "user_message", messageId: "u1", text: "hi" }])
    expect(assembler.assemble(session, "codex").summary).toContain("target: codex")
  })
})

describe("empty session", () => {
  it("produces a well-formed empty bundle rather than throwing", () => {
    const session = createSessionState({ id: "codex", providerKind: "codex", title: "codex", cwd: "/w", acpSessionId: "session-empty" })

    const bundle = assembler.assemble(session, "claude-code")

    expect(bundle).toEqual({
      intent: "continue",
      summary: [
        "Transcript excerpt from codex (intent: continue, target: claude-code).",
        "",
        "No transcript yet.",
      ].join("\n"),
      files: [],
      pendingDiffs: [],
      redactionCount: 0,
    })
  })
})

describe("redaction", () => {
  it("redacts an api-key-shaped token in message text and counts it", () => {
    const session = fold([{ kind: "user_message", messageId: "u1", text: `use ${ANTHROPIC_KEY} for auth` }])

    const bundle = assembler.assemble(session, "codex")

    expect(bundle.summary).toContain(`use ${R} for auth`)
    expect(bundle.summary).not.toContain(ANTHROPIC_KEY)
    expect(bundle.redactionCount).toBe(1)
  })

  it("redacts a secret inside a pending diff hunk without corrupting the diff", () => {
    const unified = [
      "--- a/src/client.ts",
      "+++ b/src/client.ts",
      "@@ -1,2 +1,2 @@",
      "-const key = process.env.ANTHROPIC_API_KEY",
      `+const key = "${ANTHROPIC_KEY}"`,
    ].join("\n")

    const session = fold([
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit src/client.ts",
          status: "pending",
          locations: ["src/client.ts"],
          diff: { path: "src/client.ts", unified },
        },
      },
    ])

    const bundle = assembler.assemble(session, "codex")
    const diff = bundle.pendingDiffs[0]

    expect(diff?.path).toBe("src/client.ts")
    expect(diff?.unified.split("\n")).toEqual([
      "--- a/src/client.ts",
      "+++ b/src/client.ts",
      "@@ -1,2 +1,2 @@",
      "-const key = process.env.ANTHROPIC_API_KEY",
      `+const key = "${R}"`,
    ])
    expect(bundle.redactionCount).toBe(1)
  })

  it("redacts a secret hiding in a tool-call title", () => {
    const session = fold([
      {
        kind: "tool_call",
        call: { toolCallId: "t1", kind: "execute", title: `curl -H "x: ${AWS_KEY_ID}"`, locations: [] },
      },
    ])

    const bundle = assembler.assemble(session, "codex")
    expect(bundle.summary).not.toContain(AWS_KEY_ID)
    expect(bundle.redactionCount).toBe(1)
  })

  it("counts secrets from the excerpt and the diffs together", () => {
    const session = fold([
      { kind: "user_message", messageId: "u1", text: `key ${ANTHROPIC_KEY}` },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "edit",
          title: "Edit .env",
          status: "pending",
          locations: [".env"],
          diff: { path: ".env", unified: `+AWS_ACCESS_KEY_ID=${AWS_KEY_ID}` },
        },
      },
    ])

    expect(assembler.assemble(session, "codex").redactionCount).toBe(2)
  })

  it("does not count a secret in a turn that fell outside the excerpt bound", () => {
    const bounded = createDeterministicAssembler({ limits: { maxTurns: 1 } })
    const session = fold([
      { kind: "user_message", messageId: "u1", text: `dropped ${ANTHROPIC_KEY}` },
      { kind: "user_message", messageId: "u2", text: "kept" },
    ])

    const bundle = bounded.assemble(session, "codex")

    expect(bundle.summary).not.toContain(ANTHROPIC_KEY)
    expect(bundle.redactionCount).toBe(0)
  })

  it("accepts an injected redactor", () => {
    const narrow = createDeterministicAssembler({
      redactor: createSecretRedactor([{ name: "internal", regex: /INTERNAL-[0-9]{4}/g }]),
    })
    const session = fold([{ kind: "user_message", messageId: "u1", text: `INTERNAL-1234 and ${ANTHROPIC_KEY}` }])

    const bundle = narrow.assemble(session, "codex")

    expect(bundle.summary).toContain(R)
    expect(bundle.summary).toContain(ANTHROPIC_KEY)
    expect(bundle.redactionCount).toBe(1)
  })
})

describe("integration: realistic session", () => {
  /**
   * A plausible mid-task transcript: the agent reads two files, starts an edit
   * that is still pending approval, runs a command whose output carries a
   * credential, and completes an edit that has already been applied. The
   * completed edit must not appear as a pending diff; the applied file must
   * still appear in the referenced file set.
   */
  const realistic = (): SessionState =>
    fold([
      { kind: "status", status: "working" },
      { kind: "user_message", messageId: "u1", text: "Wire the API client to the config loader." },
      { kind: "agent_message", messageId: "m1", textDelta: "Let me look at the client and the loader." },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          kind: "read",
          title: "Read src/client.ts",
          status: "completed",
          locations: ["src/client.ts"],
        },
      },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t2",
          kind: "read",
          title: "Read src/config.ts",
          status: "completed",
          locations: ["src/config.ts"],
        },
      },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t3",
          kind: "edit",
          title: "Apply loader wiring",
          status: "completed",
          locations: ["src/config.ts"],
          diff: { path: "src/config.ts", unified: "@@ -1 +1 @@\n-export const load = null\n+export const load = fn" },
        },
      },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t4",
          kind: "execute",
          title: "bun test",
          status: "completed",
          locations: [],
        },
      },
      {
        kind: "agent_message",
        messageId: "m2",
        textDelta: `Tests pass. The env file still holds ${ANTHROPIC_KEY}, which I left alone.`,
      },
      {
        kind: "tool_call",
        call: {
          toolCallId: "t5",
          kind: "edit",
          title: "Inject the key into src/client.ts",
          status: "pending",
          locations: ["src/client.ts"],
          diff: {
            path: "src/client.ts",
            unified: [
              "--- a/src/client.ts",
              "+++ b/src/client.ts",
              "@@ -3,2 +3,3 @@",
              " export function makeClient() {",
              `+  const apiKey = "${ANTHROPIC_KEY}"`,
              `+  const awsId = "${AWS_KEY_ID}"`,
            ].join("\n"),
          },
        },
      },
      { kind: "status", status: "awaiting_approval" },
    ])

  it("assembles files, diffs, and the redaction count end to end", () => {
    const bundle = assembler.assemble(realistic(), "codex")

    expect(bundle.intent).toBe("continue")

    // src/config.ts was read then edited; `edited` wins. src/client.ts likewise.
    expect(bundle.files).toEqual([
      { path: "src/client.ts", reason: "edited" },
      { path: "src/config.ts", reason: "edited" },
    ])

    // Only t5 is unapplied. The completed edit (t3) is not a pending diff.
    expect(bundle.pendingDiffs).toHaveLength(1)
    expect(bundle.pendingDiffs[0]?.toolCallId).toBe("t5")
    expect(bundle.pendingDiffs[0]?.path).toBe("src/client.ts")

    // One secret in the agent message, two inside the pending diff.
    expect(bundle.redactionCount).toBe(3)
  })

  it("leaves no secret anywhere in the emitted bundle", () => {
    const bundle = assembler.assemble(realistic(), "codex")
    const serialized = JSON.stringify(bundle)

    expect(serialized).not.toContain(ANTHROPIC_KEY)
    expect(serialized).not.toContain(AWS_KEY_ID)
  })

  it("keeps the pending diff readable after redaction", () => {
    const bundle = assembler.assemble(realistic(), "codex")

    expect(bundle.pendingDiffs[0]?.unified.split("\n")).toEqual([
      "--- a/src/client.ts",
      "+++ b/src/client.ts",
      "@@ -3,2 +3,3 @@",
      " export function makeClient() {",
      `+  const apiKey = "${R}"`,
      `+  const awsId = "${R}"`,
    ])
  })

  it("keeps the whole transcript within the excerpt bound", () => {
    const { summary } = assembler.assemble(realistic(), "codex")

    expect(summary.length).toBeLessThanOrEqual(DEFAULT_BUNDLE_LIMITS.maxSummaryChars)
    expect(summary).not.toContain("earlier turn(s) omitted")
    expect(summary).toContain("user: Wire the API client to the config loader.")
    expect(summary).toContain("tool[edit/pending] Inject the key into src/client.ts (src/client.ts)")
  })
})
