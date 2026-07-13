import { describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PersistedRunRecordV1, PersistedRunRecordV2 } from "../src/persistence/runRecord.ts"
import { createRunStore, encodeProjectDirectory } from "../src/persistence/runStore.ts"

// Suite: run-store real filesystem round trip
// Invariant: a persisted cockpit run can be discovered, restored, and deleted through the public store API.
// Boundary IN: public RunStore API plus the operating system filesystem
// Boundary OUT: store-subscription autosave and controller restore orchestration

describe("run store round trip", () => {
  it("atomically round-trips V2 state while a malformed sibling remains fail-soft", () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-run-store-v2-integration-"))
    try {
      const cwd = join(base, "project")
      const record: PersistedRunRecordV2 = {
        version: 2,
        runId: "v2-run",
        cwd,
        gitBranch: null,
        createdAt: 1_000,
        updatedAt: 3_000,
        conversations: {
          background: {
            sessionId: "background",
            providerKind: "codex",
            cwd,
            initialTitle: "Codex",
            acpSessionId: "acp-resume-pointer",
            lastPrompt: "continue later",
            messageCount: 6,
            status: "finished",
          },
        },
        workspace: {
          conversations: {
            background: {
              sessionId: "background",
              displayName: "Background review",
              lifecycle: "background",
              createdOrdinal: 2,
              attention: { seen: false, sequence: 4 },
            },
          },
          order: ["background"],
          selectedVisibleId: null,
        },
        handoffBundle: null,
      }
      const store = createRunStore({ enabled: true, path: base })

      store.save(record)
      const projectDirectory = join(base, "sessions", encodeProjectDirectory(cwd))
      mkdirSync(projectDirectory, { recursive: true })
      writeFileSync(join(projectDirectory, "malformed.json"), '{"version":2,"runId":', "utf8")

      expect(store.load(cwd, record.runId)).toEqual(record)
      expect(store.load(cwd, "malformed")).toBeNull()
      expect(store.list(cwd).map((summary) => summary.runId)).toEqual(["v2-run"])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("saves, lists, loads, and deletes a run in an injected state directory", () => {
    const base = mkdtempSync(join(tmpdir(), "kitten-run-store-integration-"))
    try {
      const cwd = join(base, "project")
      const record: PersistedRunRecordV1 = {
        version: 1,
        runId: "integration-run",
        cwd,
        gitBranch: "feat/session-resume",
        focusedAgentId: "claude-code",
        createdAt: 1_000,
        updatedAt: 2_000,
        agents: {
          "claude-code": {
            sessionId: "claude-acp-session",
            lastPrompt: "finish the run store",
            messageCount: 12,
            status: "finished",
          },
          codex: {
            sessionId: "codex-acp-session",
            lastPrompt: "review the storage contract",
            messageCount: 8,
            status: "idle",
          },
        },
        handoffBundle: null,
      }
      const store = createRunStore({ enabled: true, path: base })

      store.save(record)
      expect(store.list(cwd)).toEqual([
        {
          runId: "integration-run",
          updatedAt: 2_000,
          gitBranch: "feat/session-resume",
          focusedAgentId: "claude-code",
          lastPrompt: "finish the run store",
          messageCount: 12,
        },
      ])
      expect(store.load(cwd, record.runId)).toEqual(record)

      store.delete(cwd, record.runId)
      expect(store.load(cwd, record.runId)).toBeNull()
      expect(store.list(cwd)).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
