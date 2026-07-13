import { describe, expect, it } from "bun:test"

import type { ProviderKind } from "../core/types.ts"
import type { AgentReadiness } from "./readiness.ts"
import {
  buildFirstRunReport,
  formatFirstRunReport,
  isInsideRepo,
  readinessSetup,
  REPO_REQUIREMENT_MESSAGE,
  sessionSetup,
  type AgentSetupState,
} from "./firstRun.ts"

/** A ready readiness verdict for `agentId`. */
function ready(agentId: ProviderKind, displayName: string): AgentReadiness {
  return {
    agentId,
    displayName,
    clarificationCapability: { status: "unsupported", reason: "unknown_recipe" },
    ready: true,
    protocolVersion: 1,
  }
}

/** A not-ready readiness verdict carrying the setup gap message. */
function notReady(agentId: ProviderKind, displayName: string, message: string): AgentReadiness {
  return {
    agentId,
    displayName,
    clarificationCapability: { status: "unsupported", reason: "unknown_recipe" },
    ready: false,
    reason: "binary_not_found",
    message,
  }
}

describe("readinessSetup", () => {
  it("maps a ready verdict to a ready setup state with no gap", () => {
    expect(readinessSetup(ready("codex", "Codex"))).toEqual({ agentId: "codex", displayName: "Codex", ready: true })
  })

  it("carries the not-ready verdict's message through as the gap", () => {
    const setup = readinessSetup(notReady("claude-code", "Claude Code", "Claude Code: command not found."))
    expect(setup).toEqual({
      agentId: "claude-code",
      displayName: "Claude Code",
      ready: false,
      gap: "Claude Code: command not found.",
    })
  })
})

describe("buildFirstRunReport", () => {
  it("reports the not-ready agent's specific reason and marks the other ready", () => {
    const readiness: AgentReadiness[] = [
      notReady("claude-code", "Claude Code", "Claude Code: command \"claude-code-acp\" was not found on your PATH."),
      ready("codex", "Codex"),
    ]

    const report = buildFirstRunReport({ insideRepo: true, agents: readiness.map(readinessSetup) })

    expect(report.anyReady).toBe(true)
    expect(report.allReady).toBe(false)
    expect(report.blocked).toBe(false)
    expect(report.gaps).toEqual(['Claude Code: command "claude-code-acp" was not found on your PATH.'])

    const codex = report.agents.find((agent) => agent.agentId === "codex")
    expect(codex?.ready).toBe(true)
    const claude = report.agents.find((agent) => agent.agentId === "claude-code")
    expect(claude?.ready).toBe(false)
    expect(claude?.gap).toContain("was not found on your PATH")
  })

  it("is blocked when no agent is ready", () => {
    const report = buildFirstRunReport({
      insideRepo: true,
      agents: [notReady("codex", "Codex", "Codex: not authenticated.")].map(readinessSetup),
    })
    expect(report.anyReady).toBe(false)
    expect(report.blocked).toBe(true)
  })

  it("is blocked when outside a repository even if agents are ready", () => {
    const report = buildFirstRunReport({ insideRepo: false, agents: [ready("codex", "Codex")].map(readinessSetup) })
    expect(report.insideRepo).toBe(false)
    expect(report.blocked).toBe(true)
  })

  it("reports allReady only when every agent is ready and at least one exists", () => {
    expect(buildFirstRunReport({ insideRepo: true, agents: [] }).allReady).toBe(false)
    const both = [ready("claude-code", "Claude Code"), ready("codex", "Codex")].map(readinessSetup)
    expect(buildFirstRunReport({ insideRepo: true, agents: both }).allReady).toBe(true)
  })

  it("falls back to a generic gap when a not-ready agent carries no message", () => {
    const agents: AgentSetupState[] = [{ agentId: "codex", displayName: "Codex", ready: false }]
    const report = buildFirstRunReport({ insideRepo: true, agents })
    expect(report.gaps).toEqual(["Codex: not ready."])
  })
})

describe("formatFirstRunReport", () => {
  const sessionsPath = "/state/kitten/sessions"

  it("shows only the repo requirement message when outside a repo", () => {
    const report = buildFirstRunReport({ insideRepo: false, agents: [] })
    expect(formatFirstRunReport(report)).toEqual([REPO_REQUIREMENT_MESSAGE])
  })

  it("lists each not-ready gap and says no agents are ready when none is", () => {
    const report = buildFirstRunReport({
      insideRepo: true,
      agents: [notReady("codex", "Codex", "Codex: not authenticated.")].map(readinessSetup),
    })
    const lines = formatFirstRunReport(report)
    expect(lines[0]).toContain("No agents are ready")
    expect(lines).toContain("  - Codex: not authenticated.")
    expect(lines[lines.length - 1]).toContain("Fix the setup above")
  })

  it("says only some agents are not ready when at least one is ready", () => {
    const report = buildFirstRunReport({
      insideRepo: true,
      agents: [ready("claude-code", "Claude Code"), notReady("codex", "Codex", "Codex: not authenticated.")].map(
        readinessSetup,
      ),
    })
    const lines = formatFirstRunReport(report)
    expect(lines[0]).toBe("Some agents are not ready:")
    expect(lines).toContain("  - Codex: not authenticated.")
  })

  it("produces no lines when everything is ready and inside a repo", () => {
    const report = buildFirstRunReport({ insideRepo: true, agents: [ready("codex", "Codex")].map(readinessSetup) })
    expect(formatFirstRunReport(report)).toEqual([])
  })

  it("discloses where remembered sessions are stored and how to delete them when persistence is enabled", () => {
    const report = buildFirstRunReport({ insideRepo: true, agents: [ready("codex", "Codex")].map(readinessSetup) })

    const lines = formatFirstRunReport(report, { persistenceEnabled: true, sessionsPath })

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("remembers sessions for this project")
    expect(lines[0]).toContain(sessionsPath)
    expect(lines[0]).toContain("/resume")
    expect(lines[0]).toContain("Ctrl+D")
    expect(lines[0]).toContain("Ctrl+A")
    expect(report.blocked).toBe(false)
  })

  it("omits the persistence disclosure when persistence is disabled", () => {
    const report = buildFirstRunReport({ insideRepo: true, agents: [ready("codex", "Codex")].map(readinessSetup) })

    expect(formatFirstRunReport(report, { persistenceEnabled: false, sessionsPath })).toEqual([])
    expect(report.blocked).toBe(false)
  })
})

describe("sessionSetup - per-session repository check", () => {
  const standing = {
    agentId: "codex" as ProviderKind,
    displayName: "Codex",
    title: "Codex on services",
    cwd: "/work/services",
    ready: true,
  }

  it("keeps a ready session whose directory is a repository ready", () => {
    expect(sessionSetup(standing, { insideRepo: () => true })).toEqual({
      agentId: "codex",
      displayName: "Codex",
      ready: true,
    })
  })

  it("reports a ready session pointed at a non-repository directory as not ready, with its reason", () => {
    const setup = sessionSetup(standing, { insideRepo: () => false })
    expect(setup.ready).toBe(false)
    expect(setup.gap).toContain("/work/services")
    expect(setup.gap).toContain("not inside a git repository")
    // Its title names the offending session so a multi-session fleet is unambiguous.
    expect(setup.gap).toContain("Codex on services")
  })

  it("does not block the whole report when one session sits outside a repository", () => {
    const inRepo = sessionSetup({ ...standing, cwd: "/work/app" }, { insideRepo: (cwd) => cwd === "/work/app" })
    const outOfRepo = sessionSetup(standing, { insideRepo: (cwd) => cwd === "/work/app" })

    const report = buildFirstRunReport({ insideRepo: true, agents: [inRepo, outOfRepo] })

    expect(report.blocked).toBe(false)
    expect(report.anyReady).toBe(true)
    expect(report.gaps.some((gap) => gap.includes("not inside a git repository"))).toBe(true)
  })

  it("surfaces a connection failure over the repository check", () => {
    const setup = sessionSetup(
      { ...standing, ready: false, error: "Codex: not authenticated." },
      { insideRepo: () => true },
    )
    expect(setup).toEqual({ agentId: "codex", displayName: "Codex", ready: false, gap: "Codex: not authenticated." })
  })
})

describe("isInsideRepo", () => {
  it("is true when a .git entry sits in the current directory", () => {
    const exists = (path: string) => path === "/work/project/.git"
    expect(isInsideRepo("/work/project", { exists })).toBe(true)
  })

  it("walks up to find a .git in an ancestor directory", () => {
    const exists = (path: string) => path === "/work/project/.git"
    expect(isInsideRepo("/work/project/src/config", { exists })).toBe(true)
  })

  it("is false when no ancestor has a .git entry", () => {
    expect(isInsideRepo("/work/project/src", { exists: () => false })).toBe(false)
  })

  it("treats a .git file (worktree/submodule) as inside a repo", () => {
    const exists = (path: string) => path === "/repo/.git"
    expect(isInsideRepo("/repo", { exists })).toBe(true)
  })
})
