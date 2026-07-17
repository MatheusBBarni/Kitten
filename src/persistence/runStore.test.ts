import { describe, expect, it } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { REDACTION_PLACEHOLDER } from "../core/secretRedactor.ts"
import type { ResolvedSession } from "../core/types.ts"
import {
  PERSISTED_RUN_RECORD_SCHEMA,
  migratePersistedRunV1,
  type PersistedRunRecord,
  type PersistedRunRecordV1,
  type PersistedRunRecordV2,
  type PersistedRunRecordV3,
  type PersistedRunRecordV4,
} from "./runRecord.ts"
import {
  SESSIONS_PATH_ENV_VAR,
  createRunStore,
  encodeProjectDirectory,
  resolveSessionsBasePath,
} from "./runStore.ts"

// Suite: filesystem run store
// Invariant: each run is an atomic project-scoped pointer record with no transcript state.
// Boundary IN: record sanitization, path resolution, filesystem save/list/load/delete behavior
// Boundary OUT: debounced store subscriptions (owned by task_03's runWriter suite)

const SECRET = "sk-ant-api03-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0"

function makeRecord(
  cwd: string,
  overrides: Partial<PersistedRunRecordV1> = {},
): PersistedRunRecordV1 {
  return {
    version: 1,
    runId: "run-1",
    cwd,
    gitBranch: "feat/resume",
    focusedAgentId: "codex",
    createdAt: 100,
    updatedAt: 200,
    agents: {
      "claude-code": {
        sessionId: "claude-session",
        lastPrompt: "review the persistence code",
        messageCount: 4,
        status: "idle",
      },
      codex: {
        sessionId: "codex-session",
        lastPrompt: "implement the run store",
        messageCount: 7,
        status: "working",
      },
    },
    handoffBundle: {
      intent: "continue",
      summary: "Implement the already-redacted persistence bundle.",
      files: [{ path: "src/persistence/runStore.ts", reason: "edited" }],
      pendingDiffs: [],
      redactionCount: 0,
    },
    ...overrides,
  }
}

function makeV2Record(cwd: string, overrides: Partial<PersistedRunRecordV2> = {}): PersistedRunRecordV2 {
  return {
    version: 2,
    runId: "run-v2",
    cwd,
    gitBranch: "feat/tabs",
    createdAt: 100,
    updatedAt: 300,
    conversations: {
      visible: {
        sessionId: "visible",
        providerKind: "codex",
        cwd,
        initialTitle: "Codex",
        acpSessionId: "acp-visible",
        lastPrompt: "implement persistence",
        messageCount: 3,
        status: "working",
      },
      background: {
        sessionId: "background",
        providerKind: "claude-code",
        cwd,
        initialTitle: "Claude Code",
        acpSessionId: "acp-background",
        lastPrompt: "review persistence",
        messageCount: 5,
        status: "finished",
      },
    },
    workspace: {
      conversations: {
        visible: {
          sessionId: "visible",
          displayName: "Writer",
          lifecycle: "visible",
          createdOrdinal: 4,
          attention: { seen: true, sequence: 2 },
        },
        background: {
          sessionId: "background",
          displayName: "Reviewer",
          lifecycle: "background",
          createdOrdinal: 7,
          attention: { seen: false, sequence: 8 },
        },
      },
      order: ["visible", "background"],
      selectedVisibleId: "visible",
    },
    handoffBundle: null,
    ...overrides,
  }
}

function makeV3Record(cwd: string, overrides: Partial<PersistedRunRecordV3> = {}): PersistedRunRecordV3 {
  const { version: _version, ...v2 } = makeV2Record(cwd)
  return {
    version: 3,
    ...v2,
    runId: "run-v3",
    harnessDeliveries: {
      visible: { version: "v1", generation: 4, state: "delivered" },
      background: {
        version: "v1",
        generation: 2,
        state: "failed",
        failureCategory: "dispatch_indeterminate",
      },
    },
    ...overrides,
  }
}

function makeV4Record(cwd: string, overrides: Partial<PersistedRunRecordV4> = {}): PersistedRunRecordV4 {
  const { version: _version, ...v3 } = makeV3Record(cwd)
  const payload = "exact\r\nsealed café e\u0301 [REDACTED]"
  return {
    version: 4,
    ...v3,
    runId: "run-v4",
    contextPacks: {
      visible: {
        draft: {
          version: 1,
          revision: 3,
          instructions: { original: "Persist exact context", mode: "augment", discovered: "" },
          budget: { unit: "estimated_tokens", limit: 80_000 },
          brief: {
            architecture: "Persistence boundary",
            selectedContext: "Run record",
            relationships: "Writer to store",
            ambiguities: "None",
            budgetOmissions: "None",
          },
          selections: [],
        },
        sealed: {
          payload,
          bytes: new TextEncoder().encode(payload).byteLength,
          revision: 3,
          sealedAt: 444,
        },
      },
    },
    ...overrides,
  }
}

function resolvedSession(id: string, providerKind: "claude-code" | "codex", cwd: string): ResolvedSession {
  return {
    seed: { id, providerKind, cwd, title: `${id} configured` },
    spawn: {
      id: providerKind,
      displayName: id,
      command: "agent",
      args: [],
      env: {},
      clarificationCapability: { status: "unsupported", reason: "unknown_recipe" },
      steeringCapability: { status: "unavailable" },
      runtimeProfile: { kind: "standard" },
    },
  }
}

function withTempStore(run: (base: string) => void): void {
  const base = mkdtempSync(join(tmpdir(), "kitten-run-store-"))
  try {
    run(base)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
}

describe("createRunStore", () => {
  it("writes one project-scoped JSON file and loads the equal record", () => {
    withTempStore((base) => {
      const cwd = join(base, "worktree")
      const record = makeRecord(cwd)
      const store = createRunStore({ enabled: true, path: base })

      store.save(record)

      const path = join(base, "sessions", encodeProjectDirectory(cwd), "run-1.json")
      expect(statSync(path).isFile()).toBe(true)
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(store.load(cwd, record.runId)).toEqual({ ...record, cwd: resolve(cwd) })
    })
  })

  it("round-trips V2 descriptors and canonical visible/background workspace metadata", () => {
    withTempStore((base) => {
      const cwd = join(base, "worktree")
      const record = makeV2Record(cwd)
      const store = createRunStore({ enabled: true, path: base })

      store.save(record)

      expect(store.load(cwd, record.runId)).toEqual({
        ...record,
        cwd: resolve(cwd),
        conversations: {
          visible: { ...record.conversations.visible!, cwd: resolve(cwd) },
          background: { ...record.conversations.background!, cwd: resolve(cwd) },
        },
      })
      expect(store.list(cwd)).toEqual([
        {
          runId: "run-v2",
          updatedAt: 300,
          gitBranch: "feat/tabs",
          focusedAgentId: "visible",
          lastPrompt: "implement persistence",
          messageCount: 3,
        },
      ])
    })
  })

  it("round-trips every fixed V3 checkpoint state", () => {
    const states = ["not_required", "pending", "in_flight", "delivered"] as const
    for (const state of states) {
      withTempStore((base) => {
        const cwd = join(base, state)
        const record = makeV3Record(cwd, {
          runId: `run-${state}`,
          harnessDeliveries: { visible: { version: "v1", generation: 0, state } },
        })
        const store = createRunStore({ enabled: true, path: base })
        store.save(record)
        expect(store.load(cwd, record.runId)).toMatchObject({
          version: 3,
          harnessDeliveries: { visible: { version: "v1", generation: 0, state } },
        })
      })
    }

    withTempStore((base) => {
      const cwd = join(base, "failed")
      const record = makeV3Record(cwd, {
        harnessDeliveries: {
          visible: {
            version: "v1",
            generation: 9,
            state: "failed",
            failureCategory: "unsupported_profile",
          },
        },
      })
      const store = createRunStore({ enabled: true, path: base })
      store.save(record)
      expect(store.load(cwd, record.runId)).toMatchObject({ harnessDeliveries: record.harnessDeliveries })
    })
  })

  it("atomically round-trips V4 Context Packs with exact bytes and owner-only mode", () => {
    withTempStore((base) => {
      const cwd = join(base, "worktree")
      const first = makeV4Record(cwd)
      const store = createRunStore({ enabled: true, path: base })
      store.save(first)

      const replacementPayload = "replacement\nwithout normalization e\u0301"
      const replacement = makeV4Record(cwd, {
        updatedAt: 999,
        contextPacks: {
          visible: {
            ...first.contextPacks.visible,
            sealed: {
              payload: replacementPayload,
              bytes: new TextEncoder().encode(replacementPayload).byteLength,
              revision: 4,
              sealedAt: 555,
            },
          },
        },
      })
      store.save(replacement)

      const directory = join(base, "sessions", encodeProjectDirectory(cwd))
      const path = join(directory, "run-v4.json")
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(readdirSync(directory)).toEqual(["run-v4.json"])
      const loaded = store.load(cwd, "run-v4")
      expect(loaded?.version).toBe(4)
      if (loaded?.version !== 4) throw new Error("expected V4")
      expect(loaded.updatedAt).toBe(999)
      expect(loaded.contextPacks.visible!.sealed!.payload).toBe(replacementPayload)
      expect(loaded.contextPacks.visible!.sealed!.bytes).toBe(
        new TextEncoder().encode(replacementPayload).byteLength,
      )
    })
  })

  it("persists a retained sealed Context Pack attachment in a handoff bundle", () => {
    withTempStore((base) => {
      const cwd = join(base, "worktree")
      const payload = "# Reviewed attachment\r\n\r\n[REDACTED]"
      const record = makeV4Record(cwd, {
        handoffBundle: {
          intent: "continue",
          summary: "Continue with the reviewed Context Pack.",
          files: [],
          pendingDiffs: [],
          contextPack: {
            payload,
            bytes: new TextEncoder().encode(payload).byteLength,
            sealedAt: 777,
            revision: 4,
            sourceIdentities: ["file:dev:1"],
            redactionCount: 1,
          },
          redactionCount: 1,
        },
      })
      const store = createRunStore({ enabled: true, path: base })

      store.save(record)

      const loaded = store.load(cwd, record.runId)
      expect(loaded?.handoffBundle).toEqual(record.handoffBundle)
    })
  })

  it("drops a malformed sibling Context Pack while restoring the valid projection", () => {
    withTempStore((base) => {
      const cwd = join(base, "worktree")
      const record = makeV4Record(cwd)
      const raw = structuredClone(record) as unknown as {
        contextPacks: Record<string, Record<string, unknown>>
      }
      raw.contextPacks.background = {
        draft: record.contextPacks.visible!.draft!,
        rawSource: "must not survive",
      }
      const directory = join(base, "sessions", encodeProjectDirectory(cwd))
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, "run-v4.json"), JSON.stringify(raw), { mode: 0o600 })
      const diagnostics: string[] = []
      const store = createRunStore({
        enabled: true,
        path: base,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
      })

      const loaded = store.load(cwd, "run-v4")

      expect(loaded?.version).toBe(4)
      if (loaded?.version !== 4) throw new Error("expected V4")
      expect(loaded.contextPacks).toEqual({ visible: record.contextPacks.visible! })
      expect(JSON.stringify(loaded)).not.toContain("must not survive")
      expect(diagnostics).toEqual(["invalid_context_pack_projection"])
    })
  })

  it("bounds malformed Context Pack diagnostics without retaining invalid entries", () => {
    withTempStore((base) => {
      const cwd = join(base, "worktree")
      const record = makeV4Record(cwd)
      for (let index = 0; index < 12; index += 1) {
        record.contextPacks[`invalid-${index}`] = { unexpected: index } as never
      }
      const directory = join(base, "sessions", encodeProjectDirectory(cwd))
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, "run-v4.json"), JSON.stringify(record), { mode: 0o600 })
      const diagnostics: string[] = []
      const store = createRunStore({
        enabled: true,
        path: base,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
      })

      const loaded = store.load(cwd, "run-v4")

      expect(loaded?.version).toBe(4)
      if (loaded?.version !== 4) throw new Error("expected V4")
      expect(Object.keys(loaded.contextPacks)).toEqual(["visible"])
      expect(diagnostics).toHaveLength(8)
      expect(new Set(diagnostics)).toEqual(new Set(["invalid_context_pack_projection"]))
    })
  })

  it("rejects prohibited Context Pack fields before the serializer can strip them", () => {
    withTempStore((base) => {
      const cwd = join(base, "worktree")
      const record = makeV4Record(cwd)
      const projection = record.contextPacks.visible as unknown as Record<string, unknown>
      projection.rawSource = "private bytes"
      const store = createRunStore({ enabled: true, path: base })

      expect(() => store.save(record)).toThrow("Invalid persisted Context Pack projection")
      expect(readdirSync(base)).toEqual([])
    })
  })

  it("strictly rejects invalid V3 checkpoint values, shapes, generations, and membership", () => {
    const cwd = "/work/project"
    const invalidCheckpoints: unknown[] = [
      { version: "v2", generation: 1, state: "pending" },
      { version: "v1", generation: -1, state: "pending" },
      { version: "v1", generation: 1.5, state: "pending" },
      { version: "v1", generation: 1, state: "unknown" },
      { version: "v1", generation: 1, state: "failed", failureCategory: "raw failure" },
      { version: "v1", generation: 1, state: "failed" },
      { version: "v1", generation: 1, state: "delivered", failureCategory: "dispatch_indeterminate" },
      { version: "v1", generation: 1, state: "pending", prompt: "private" },
    ]
    for (const checkpoint of invalidCheckpoints) {
      const record = makeV3Record(cwd, {
        harnessDeliveries: { visible: checkpoint } as never,
      })
      expect(PERSISTED_RUN_RECORD_SCHEMA.safeParse(record).success).toBe(false)
    }
    expect(PERSISTED_RUN_RECORD_SCHEMA.safeParse(makeV3Record(cwd, {
      harnessDeliveries: { missing: { version: "v1", generation: 1, state: "pending" } },
    })).success).toBe(false)
  })

  it("rejects nested transcript or prompt injection under a V3 checkpoint before sanitizing", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const record = makeV3Record(cwd, {
        harnessDeliveries: {
          visible: {
            version: "v1",
            generation: 1,
            state: "in_flight",
            transcript: [{ text: "private transcript" }],
            prompt: { text: "private prompt" },
          } as never,
        },
      })
      const store = createRunStore({ enabled: true, path: base })
      expect(() => store.save(record)).toThrow("Invalid harness delivery checkpoint")
      expect(readdirSync(base, { recursive: true }).map(String).join("\n")).not.toContain("run-v3.json")
    })
  })

  it("round-trips a pointers-only Cursor conversation through V2 workspace membership", () => {
    withTempStore((base) => {
      const cwd = join(base, "cursor-worktree")
      const record = makeV2Record(cwd)
      record.conversations.visible!.providerKind = "cursor"
      record.conversations.visible!.initialTitle = "Cursor"
      record.workspace.conversations.visible!.displayName = "Cursor"
      const recordWithRuntimeDetails = {
        ...record,
        runtimeProfile: { kind: "cursor-certified", certifiedVersion: "9.9.9" },
        credential: SECRET,
        conversations: {
          ...record.conversations,
          visible: {
            ...record.conversations.visible!,
            authenticationMethod: "cursor_login",
            cliVersion: "9.9.9",
            transcript: [{ role: "agent", text: "must never persist" }],
            capabilityResult: { clarification: true },
            rawError: "sensitive runtime failure",
            credential: SECRET,
          },
        },
      } as unknown as PersistedRunRecord
      const store = createRunStore({ enabled: true, path: base })

      store.save(recordWithRuntimeDetails)

      const path = join(base, "sessions", encodeProjectDirectory(cwd), "run-v2.json")
      const raw = readFileSync(path, "utf8")
      for (const forbidden of [
        "runtimeProfile",
        "authenticationMethod",
        "cliVersion",
        "transcript",
        "capabilityResult",
        "rawError",
        "credential",
        SECRET,
      ]) {
        expect(raw).not.toContain(forbidden)
      }

      const loaded = store.load(cwd, record.runId)
      expect(loaded?.version).toBe(2)
      if (loaded?.version !== 2) throw new Error("Expected V2 record")
      expect(loaded.conversations.visible).toEqual({
        sessionId: "visible",
        providerKind: "cursor",
        cwd: resolve(cwd),
        initialTitle: "Cursor",
        acpSessionId: "acp-visible",
        lastPrompt: "implement persistence",
        messageCount: 3,
        status: "working",
      })
      expect(loaded.workspace.order).toEqual(["visible", "background"])
      expect(loaded.workspace.selectedVisibleId).toBe("visible")
      expect(loaded.workspace.conversations.visible).toEqual({
        sessionId: "visible",
        displayName: "Cursor",
        lifecycle: "visible",
        createdOrdinal: 4,
        attention: { seen: true, sequence: 2 },
      })
    })
  })

  it("accepts a background-only V2 workspace with null selection and branch", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const original = makeV2Record(cwd)
      const backgroundOnly = makeV2Record(cwd, {
        gitBranch: null,
        conversations: { background: original.conversations.background! },
        workspace: {
          conversations: { background: original.workspace.conversations.background! },
          order: ["background"],
          selectedVisibleId: null,
        },
      })
      const store = createRunStore({ enabled: true, path: base })

      store.save(backgroundOnly)

      expect(store.load(cwd, "run-v2")).toMatchObject({
        version: 2,
        gitBranch: null,
        workspace: { order: ["background"], selectedVisibleId: null },
      })
      expect(store.list(cwd)[0]?.focusedAgentId).toBeNull()
    })
  })

  it("lists only the requested project sorted by updatedAt descending", () => {
    withTempStore((base) => {
      const firstProject = join(base, "project-a")
      const otherProject = join(base, "project-b")
      const store = createRunStore({ enabled: true, path: base })
      store.save(makeRecord(firstProject, { runId: "older", updatedAt: 200 }))
      store.save(makeRecord(firstProject, { runId: "newer", updatedAt: 900 }))
      store.save(makeRecord(otherProject, { runId: "other", updatedAt: 1_000 }))

      expect(store.list(firstProject)).toEqual([
        {
          runId: "newer",
          updatedAt: 900,
          gitBranch: "feat/resume",
          focusedAgentId: "codex",
          lastPrompt: "implement the run store",
          messageCount: 7,
        },
        {
          runId: "older",
          updatedAt: 200,
          gitBranch: "feat/resume",
          focusedAgentId: "codex",
          lastPrompt: "implement the run store",
          messageCount: 7,
        },
      ])
    })
  })

  it("redacts free text and drops excess transcript fields before writing", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const record = makeRecord(cwd, {
        gitBranch: `feat/${SECRET}`,
        agents: {
          codex: {
            sessionId: "codex-session",
            lastPrompt: `use ${SECRET} to continue`,
            messageCount: 1,
            status: "working",
          },
        },
      })
      const withTranscript = {
        ...record,
        turns: [{ kind: "user", messageId: "u1", text: "must never persist" }],
        agents: {
          codex: {
            ...record.agents.codex!,
            turns: [{ kind: "agent", messageId: "a1", text: "also forbidden" }],
          },
        },
      } as unknown as PersistedRunRecord
      const store = createRunStore({ enabled: true, path: base })

      store.save(withTranscript)

      const path = join(base, "sessions", encodeProjectDirectory(cwd), "run-1.json")
      const raw = readFileSync(path, "utf8")
      expect(raw).not.toContain(SECRET)
      expect(raw).not.toContain('"turns"')
      expect(raw).not.toContain("must never persist")
      const loaded = store.load(cwd, "run-1")
      expect(loaded?.version).toBe(1)
      expect(loaded?.version === 1 ? loaded.agents.codex?.lastPrompt : undefined).toBe(
        `use ${REDACTION_PLACEHOLDER} to continue`,
      )
      expect(store.load(cwd, "run-1")?.gitBranch).toBe(`feat/${REDACTION_PLACEHOLDER}`)
    })
  })

  it("redacts V2 branch, titles, display names, and prompt summaries", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const record = makeV2Record(cwd, { gitBranch: `feat/${SECRET}` })
      record.conversations.visible!.initialTitle = `Title ${SECRET}`
      record.conversations.visible!.lastPrompt = `Prompt ${SECRET}`
      record.workspace.conversations.visible!.displayName = `Name ${SECRET}`
      const store = createRunStore({ enabled: true, path: base })

      store.save(record)

      const raw = readFileSync(
        join(base, "sessions", encodeProjectDirectory(cwd), "run-v2.json"),
        "utf8",
      )
      expect(raw).not.toContain(SECRET)
      const loaded = store.load(cwd, "run-v2")
      expect(loaded?.version).toBe(2)
      if (loaded?.version !== 2) throw new Error("Expected V2 record")
      expect(loaded.gitBranch).toBe(`feat/${REDACTION_PLACEHOLDER}`)
      expect(loaded.conversations.visible?.initialTitle).toBe(`Title ${REDACTION_PLACEHOLDER}`)
      expect(loaded.conversations.visible?.lastPrompt).toBe(`Prompt ${REDACTION_PLACEHOLDER}`)
      expect(loaded.workspace.conversations.visible?.displayName).toBe(`Name ${REDACTION_PLACEHOLDER}`)
    })
  })

  it("deletes only the selected run", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const store = createRunStore({ enabled: true, path: base })
      store.save(makeRecord(cwd, { runId: "keep", updatedAt: 100 }))
      store.save(makeRecord(cwd, { runId: "remove", updatedAt: 200 }))

      store.delete(cwd, "remove")

      expect(store.load(cwd, "remove")).toBeNull()
      expect(store.list(cwd).map((summary) => summary.runId)).toEqual(["keep"])
    })
  })

  it("deleteAll clears every project and allows later writes", () => {
    withTempStore((base) => {
      const firstProject = join(base, "project-a")
      const secondProject = join(base, "project-b")
      const store = createRunStore({ enabled: true, path: base })
      store.save(makeRecord(firstProject, { runId: "first" }))
      store.save(makeRecord(secondProject, { runId: "second" }))

      store.deleteAll()

      expect(store.list(firstProject)).toEqual([])
      expect(store.list(secondProject)).toEqual([])
      store.save(makeRecord(firstProject, { runId: "after-clear" }))
      expect(store.list(firstProject).map((summary) => summary.runId)).toEqual(["after-clear"])
    })
  })

  it("is a true no-op when disabled", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const store = createRunStore({ enabled: false, path: base })

      store.save(makeRecord(cwd))
      store.flush()
      store.delete(cwd, "run-1")
      store.deleteAll()

      expect(store.list(cwd)).toEqual([])
      expect(store.load(cwd, "run-1")).toBeNull()
      expect(readdirSync(base)).toEqual([])
    })
  })

  it("leaves no partial final file or temp file when the atomic rename fails", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const store = createRunStore({ enabled: true, path: base })
      store.save(makeRecord(cwd, { runId: "seed" }))
      const projectDirectory = join(base, "sessions", encodeProjectDirectory(cwd))
      const blockedFinalPath = join(projectDirectory, "blocked.json")
      mkdirSync(blockedFinalPath)

      expect(() => store.save(makeRecord(cwd, { runId: "blocked" }))).toThrow()

      expect(statSync(blockedFinalPath).isDirectory()).toBe(true)
      expect(readdirSync(projectDirectory).filter((name) => name.endsWith(".tmp"))).toEqual([])
      expect(store.load(cwd, "seed")?.runId).toBe("seed")
    })
  })

  it("ignores malformed records while preserving valid runs", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const store = createRunStore({ enabled: true, path: base })
      store.save(makeRecord(cwd, { runId: "valid" }))
      const projectDirectory = join(base, "sessions", encodeProjectDirectory(cwd))
      writeFileSync(join(projectDirectory, "broken.json"), "{ not json", "utf8")
      writeFileSync(join(projectDirectory, "wrong-version.json"), '{"version":3}', "utf8")

      expect(store.list(cwd).map((summary) => summary.runId)).toEqual(["valid"])
      expect(store.load(cwd, "broken")).toBeNull()
    })
  })

  it.each([
    ["duplicate order", (record: PersistedRunRecordV2) => record.workspace.order.push("visible")],
    ["missing membership", (record: PersistedRunRecordV2) => delete record.workspace.conversations.background],
    ["invalid lifecycle", (record: PersistedRunRecordV2) => {
      ;(record.workspace.conversations.background as { lifecycle: string }).lifecycle = "closed"
    }],
    ["invalid selection", (record: PersistedRunRecordV2) => {
      record.workspace.selectedVisibleId = "background"
    }],
    ["missing visible selection", (record: PersistedRunRecordV2) => {
      record.workspace.selectedVisibleId = null
      record.gitBranch = null
    }],
  ])("fails soft for V2 %s while retaining valid sibling runs", (_name, mutate) => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const store = createRunStore({ enabled: true, path: base })
      store.save(makeV2Record(cwd, { runId: "valid" }))
      const invalid = structuredClone(makeV2Record(cwd, { runId: "invalid" }))
      mutate(invalid)
      const projectDirectory = join(base, "sessions", encodeProjectDirectory(cwd))
      writeFileSync(join(projectDirectory, "invalid.json"), JSON.stringify(invalid), "utf8")

      expect(store.load(cwd, "invalid")).toBeNull()
      expect(store.list(cwd).map((summary) => summary.runId)).toEqual(["valid"])
    })
  })

  it("rejects records whose hand-off bundle is incomplete", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const store = createRunStore({ enabled: true, path: base })
      store.save(makeRecord(cwd, { runId: "valid" }))
      const projectDirectory = join(base, "sessions", encodeProjectDirectory(cwd))
      const incomplete = { ...makeRecord(cwd, { runId: "incomplete" }), handoffBundle: {} }
      writeFileSync(join(projectDirectory, "incomplete.json"), JSON.stringify(incomplete), "utf8")

      expect(store.list(cwd).map((summary) => summary.runId)).toEqual(["valid"])
      expect(store.load(cwd, "incomplete")).toBeNull()
    })
  })

  it("rejects run ids that could escape the project directory", () => {
    withTempStore((base) => {
      const cwd = join(base, "project")
      const store = createRunStore({ enabled: true, path: base })

      expect(() => store.save(makeRecord(cwd, { runId: "../escape" }))).toThrow(/Invalid run id/)
      expect(readdirSync(base)).toEqual([])
    })
  })
})

describe("migratePersistedRunV1", () => {
  it("keeps only configuration-matched entries and treats legacy sessionId as the ACP pointer", () => {
    const cwd = "/work/kitten"
    const legacy = makeRecord(cwd, {
      focusedAgentId: "dynamic-unmatched",
      agents: {
        codex: {
          sessionId: "saved-acp-pointer",
          lastPrompt: "resume this",
          messageCount: 9,
          status: "finished",
        },
        "dynamic-unmatched": {
          sessionId: "must-not-migrate",
          lastPrompt: "unknown descriptor",
          messageCount: 2,
          status: "idle",
        },
      },
    })

    const migrated = migratePersistedRunV1(legacy, [
      resolvedSession("claude", "claude-code", cwd),
      resolvedSession("codex", "codex", cwd),
    ])

    expect(migrated.conversations).toEqual({
      codex: {
        sessionId: "codex",
        providerKind: "codex",
        cwd,
        initialTitle: "codex configured",
        acpSessionId: "saved-acp-pointer",
        lastPrompt: "resume this",
        messageCount: 9,
        status: "finished",
      },
    })
    expect(migrated.workspace).toEqual({
      conversations: {
        codex: {
          sessionId: "codex",
          displayName: "codex configured",
          lifecycle: "visible",
          createdOrdinal: 0,
          attention: { seen: false, sequence: 0 },
        },
      },
      order: ["codex"],
      selectedVisibleId: null,
    })
    expect(migrated.gitBranch).toBeNull()
    expect(legacy.agents["dynamic-unmatched"]).toBeDefined()
    expect(migrated).not.toHaveProperty("harnessDeliveries")
    expect(PERSISTED_RUN_RECORD_SCHEMA.parse(makeV2Record(cwd))).not.toHaveProperty("harnessDeliveries")
  })
})

describe("session state path resolution", () => {
  it("prefers the sessions override, otherwise follows telemetry's XDG state base", () => {
    expect(resolveSessionsBasePath({ [SESSIONS_PATH_ENV_VAR]: "/override", XDG_STATE_HOME: "/state" })).toBe(
      "/override",
    )
    expect(resolveSessionsBasePath({ XDG_STATE_HOME: "/state" })).toBe("/state/kitten")
    expect(resolveSessionsBasePath({}).endsWith(join(".local", "state", "kitten"))).toBe(true)
  })

  it("encodes the absolute cwd deterministically without project-key collisions in the fixture", () => {
    expect(encodeProjectDirectory("./src")).toBe(encodeProjectDirectory(resolve("./src")))
    expect(encodeProjectDirectory("./src")).not.toBe(encodeProjectDirectory("./test"))
  })
})
