// Suite: self-check behavior
// Invariant: reload confirmation requires an advertised capability and replayed history from a fresh connection.
// Boundary IN: self-check result classification and report formatting with injected agent connections.
// Boundary OUT: real ACP wire framing, owned by test/reloadProbe.integration.test.ts.

import { describe, expect, it } from "bun:test"
import { RGBA, type CapturedFrame } from "@opentui/core"

import type { AgentConnection } from "../agent/agentConnection.ts"
import { defaultAppConfig } from "../config/configLoader.ts"
import type { AgentConfig, AppConfig, DomainSessionEvent } from "../core/types.ts"
import {
  assertSelfCheckHighlights,
  formatReloadProbeLine,
  runReloadConfirmationProbe,
  SELF_CHECK_DEFAULT_TOKEN,
  SELF_CHECK_DIFF_TOKEN,
  SELF_CHECK_MARKDOWN_TOKEN,
} from "./selfCheck.ts"

function singleSessionConfig(): AppConfig {
  const config = defaultAppConfig()
  return {
    ...config,
    providers: {
      ...config.providers,
      "claude-code": { ...config.providers["claude-code"], displayName: "Claude" },
    },
    sessions: [{ provider: "claude-code", cwd: process.cwd(), title: "Claude probe" }],
  }
}

interface FakeConnectionOptions {
  ready?: boolean
  canLoadSession?: boolean
  sessionId?: string
  replay?: DomainSessionEvent
  calls?: string[]
}

function fakeConnection(options: FakeConnectionOptions = {}): AgentConnection {
  const subscribers = new Set<(event: DomainSessionEvent) => void>()
  const calls = options.calls ?? []
  return {
    id: "claude-code",
    async connect() {
      calls.push("connect")
      return options.ready === false
        ? { ready: false, error: "handshake failed" }
        : { ready: true, protocolVersion: 1, canLoadSession: options.canLoadSession ?? true }
    },
    async newSession(cwd) {
      calls.push(`new:${cwd}`)
      return options.sessionId ?? "probe-session"
    },
    async loadSession(sessionId, cwd) {
      calls.push(`load:${sessionId}:${cwd}`)
      if (options.replay) {
        for (const subscriber of subscribers) subscriber(options.replay)
      }
    },
    async prompt(sessionId) {
      calls.push(`prompt:${sessionId}`)
      return { stopReason: "end_turn" }
    },
    async cancel() {},
    async setSessionConfigOption() {
      return []
    },
    onUpdate(subscriber) {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
    onPermission() {},
    async dispose() {
      calls.push("dispose")
    },
  }
}

function connectionSequence(...connections: AgentConnection[]): (config: AgentConfig) => AgentConnection {
  return () => {
    const connection = connections.shift()
    if (!connection) throw new Error("unexpected connection request")
    return connection
  }
}

function capturedFrame(colors: { default: string; markdown: string; diff: string }): CapturedFrame {
  const span = (text: string, color: string) => ({
    text,
    fg: RGBA.fromHex(color),
    bg: RGBA.fromHex("#000000"),
    attributes: 0,
    width: text.length,
  })
  return {
    cols: 80,
    rows: 3,
    cursor: [0, 0],
    lines: [
      { spans: [span(SELF_CHECK_DEFAULT_TOKEN, colors.default)] },
      { spans: [span(SELF_CHECK_MARKDOWN_TOKEN, colors.markdown)] },
      { spans: [span(SELF_CHECK_DIFF_TOKEN, colors.diff)] },
    ],
  }
}

describe("assertSelfCheckHighlights", () => {
  it("reports distinct Markdown and diff foregrounds", () => {
    expect(
      assertSelfCheckHighlights(
        capturedFrame({ default: "#E6E6E6", markdown: "#9CDCFE", diff: "#4EC9B0" }),
      ),
    ).toEqual({
      defaultForeground: RGBA.fromHex("#E6E6E6").toString(),
      markdownForeground: RGBA.fromHex("#9CDCFE").toString(),
      diffForeground: RGBA.fromHex("#4EC9B0").toString(),
    })
  })

  it("fails when the fenced-code token keeps the default foreground", () => {
    expect(() =>
      assertSelfCheckHighlights(
        capturedFrame({ default: "#E6E6E6", markdown: "#E6E6E6", diff: "#4EC9B0" }),
      ),
    ).toThrow("Markdown fence token rendered with the default foreground")
  })

  it("fails when the diff token keeps the default foreground", () => {
    expect(() =>
      assertSelfCheckHighlights(
        capturedFrame({ default: "#E6E6E6", markdown: "#9CDCFE", diff: "#E6E6E6" }),
      ),
    ).toThrow("diff token rendered with the default foreground")
  })
})

describe("reload confirmation probe", () => {
  it("reports reload confirmed only when a fresh connection re-streams history", async () => {
    const creatorCalls: string[] = []
    const loaderCalls: string[] = []
    const reports = await runReloadConfirmationProbe(singleSessionConfig(), {
      createConnection: connectionSequence(
        fakeConnection({ sessionId: "saved-7", calls: creatorCalls }),
        fakeConnection({
          calls: loaderCalls,
          replay: { kind: "user_message", messageId: "history-1", text: "saved context" },
        }),
      ),
    })

    expect(reports).toEqual([
      {
        configuredSessionId: "claude-code",
        displayName: "Claude",
        canLoadSession: true,
        outcome: "reload confirmed",
      },
    ])
    expect(creatorCalls).toContain("prompt:saved-7")
    expect(loaderCalls).toContain(`load:saved-7:${process.cwd()}`)
    expect(formatReloadProbeLine(reports[0]!)).toBe(
      "[PASS] Claude (claude-code): loadSession=true — reload confirmed",
    )
  })

  it("reports capability absent without creating or loading a session", async () => {
    const calls: string[] = []
    const reports = await runReloadConfirmationProbe(singleSessionConfig(), {
      createConnection: connectionSequence(fakeConnection({ canLoadSession: false, calls })),
    })

    expect(reports[0]).toMatchObject({ canLoadSession: false, outcome: "capability absent" })
    expect(calls).toEqual(["connect", "dispose"])
    expect(formatReloadProbeLine(reports[0]!)).toBe(
      "[FAIL] Claude (claude-code): loadSession=false — capability absent",
    )
  })

  it("reports reload failed when loading streams zero history", async () => {
    const reports = await runReloadConfirmationProbe(singleSessionConfig(), {
      createConnection: connectionSequence(
        fakeConnection(),
        fakeConnection({ replay: { kind: "status", status: "idle" } }),
      ),
      awaitReplay: async () => false,
    })

    expect(reports[0]).toMatchObject({
      canLoadSession: true,
      outcome: "reload failed",
      detail: "session/load streamed no history",
    })
    expect(formatReloadProbeLine(reports[0]!)).toBe(
      "[FAIL] Claude (claude-code): loadSession=true — reload failed: session/load streamed no history",
    )
  })

  it("returns one result line for every configured agent session", async () => {
    const config = defaultAppConfig()
    const reports = await runReloadConfirmationProbe(config, {
      createConnection: (agent) => fakeConnection({ canLoadSession: false, sessionId: `${agent.id}-probe` }),
    })

    expect(reports.map((report) => report.configuredSessionId)).toEqual(["codex", "claude-code"])
    expect(reports.map(formatReloadProbeLine)).toEqual([
      "[FAIL] Codex (codex): loadSession=false — capability absent",
      "[FAIL] Claude Code (claude-code): loadSession=false — capability absent",
    ])
  })
})
