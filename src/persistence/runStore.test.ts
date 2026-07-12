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
import type { PersistedRunRecord } from "./runRecord.ts"
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
  overrides: Partial<PersistedRunRecord> = {},
): PersistedRunRecord {
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
      expect(store.load(cwd, "run-1")?.agents.codex?.lastPrompt).toBe(
        `use ${REDACTION_PLACEHOLDER} to continue`,
      )
      expect(store.load(cwd, "run-1")?.gitBranch).toBe(`feat/${REDACTION_PLACEHOLDER}`)
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
      writeFileSync(join(projectDirectory, "wrong-version.json"), '{"version":2}', "utf8")

      expect(store.list(cwd).map((summary) => summary.runId)).toEqual(["valid"])
      expect(store.load(cwd, "broken")).toBeNull()
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
