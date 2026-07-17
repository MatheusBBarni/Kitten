import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Dirent,
} from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"

import { createSecretRedactor } from "../core/secretRedactor.ts"
import { resolveTelemetryPath } from "../telemetry/recorder.ts"
import {
  HARNESS_DELIVERY_CHECKPOINT_SCHEMA,
  PERSISTED_CONTEXT_PACK_SCHEMA,
  PERSISTED_RUN_RECORD_SCHEMA,
  migratePersistedRunV1,
  type PersistedAgent,
  type PersistedConversationV2,
  type PersistedRunRecord,
  type PersistedRunRecordV1,
  type PersistedRunRecordV2,
  type PersistedRunRecordV3,
  type PersistedRunRecordV4,
  type PersistedRunSummary,
  type PersistedWorkspaceConversationV2,
} from "./runRecord.ts"

export {
  migratePersistedRunV1,
  migratePersistedRunToV4,
  type PersistedAgent,
  type PersistedRunRecord,
  type PersistedRunRecordV1,
  type PersistedRunRecordV2,
  type PersistedRunRecordV3,
  type PersistedRunRecordV4,
  type PersistedRunSummary,
} from "./runRecord.ts"

/** Environment override for the Kitten state base that contains `sessions/`. */
export const SESSIONS_PATH_ENV_VAR = "KITTEN_SESSIONS_PATH"

export interface RunStore {
  save(record: PersistedRunRecord): void
  list(cwd: string): PersistedRunSummary[]
  load(cwd: string, runId: string): PersistedRunRecord | null
  delete(cwd: string, runId: string): void
  deleteAll(): void
  flush(): void
}

export interface RunStoreOptions {
  enabled: boolean
  /** Kitten state base. Run files live beneath its `sessions/` child. */
  path?: string
  /** Content-free load diagnostics. At most a bounded number are emitted per record. */
  onDiagnostic?: (diagnostic: RunStoreDiagnostic) => void
}

export interface RunStoreDiagnostic {
  readonly code: "invalid_context_pack_projection"
}

const MAX_LOAD_DIAGNOSTICS_PER_RECORD = 8

const NOOP_RUN_STORE: RunStore = {
  save() {},
  list() {
    return []
  },
  load() {
    return null
  },
  delete() {},
  deleteAll() {},
  flush() {},
}

/** Resolve Kitten's state base with telemetry's XDG-state fallback rules. */
export function resolveSessionsBasePath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env[SESSIONS_PATH_ENV_VAR]
  if (explicit) return explicit
  return dirname(resolveTelemetryPath({ XDG_STATE_HOME: env.XDG_STATE_HOME }))
}

/** A stable, filesystem-safe project key derived from the absolute working directory. */
export function encodeProjectDirectory(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex")
}

/** Build a synchronous one-file-per-run store, or a true no-op when disabled. */
export function createRunStore(options: RunStoreOptions): RunStore {
  if (!options.enabled) return NOOP_RUN_STORE
  return new FileRunStore(options.path ?? resolveSessionsBasePath(), options.onDiagnostic ?? (() => {}))
}

class FileRunStore implements RunStore {
  private readonly sessionsRoot: string
  private readonly onDiagnostic: (diagnostic: RunStoreDiagnostic) => void

  constructor(basePath: string, onDiagnostic: (diagnostic: RunStoreDiagnostic) => void) {
    this.sessionsRoot = join(basePath, "sessions")
    this.onDiagnostic = onDiagnostic
  }

  save(record: PersistedRunRecord): void {
    assertSafeRunId(record.runId)
    const sanitized = sanitizeRecord(record)
    const decoded = PERSISTED_RUN_RECORD_SCHEMA.safeParse(sanitized)
    if (!decoded.success) throw new Error(`Invalid persisted run record: ${decoded.error.message}`)
    const persisted = decoded.data
    const projectDirectory = this.projectDirectory(persisted.cwd)
    mkdirSync(projectDirectory, { recursive: true, mode: 0o700 })

    const finalPath = this.runPath(persisted.cwd, persisted.runId)
    const temporaryPath = join(projectDirectory, `.${persisted.runId}.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      renameSync(temporaryPath, finalPath)
    } finally {
      rmSync(temporaryPath, { force: true })
    }
  }

  list(cwd: string): PersistedRunSummary[] {
    let entries: Dirent[]
    try {
      entries = readdirSync(this.projectDirectory(cwd), { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => this.readRecord(join(this.projectDirectory(cwd), entry.name)))
      .filter((record): record is PersistedRunRecord => record !== null)
      .map(toSummary)
      .filter((summary): summary is PersistedRunSummary => summary !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  load(cwd: string, runId: string): PersistedRunRecord | null {
    return this.readRecord(this.runPath(cwd, runId))
  }

  delete(cwd: string, runId: string): void {
    rmSync(this.runPath(cwd, runId), { force: true })
  }

  deleteAll(): void {
    rmSync(this.sessionsRoot, { recursive: true, force: true })
  }

  flush(): void {
    // Writes are synchronous, so there is no pending queue to drain.
  }

  private projectDirectory(cwd: string): string {
    return join(this.sessionsRoot, encodeProjectDirectory(cwd))
  }

  private runPath(cwd: string, runId: string): string {
    assertSafeRunId(runId)
    return join(this.projectDirectory(cwd), `${runId}.json`)
  }

  private readRecord(path: string): PersistedRunRecord | null {
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"))
      const result = PERSISTED_RUN_RECORD_SCHEMA.safeParse(
        dropInvalidLoadedContextPacks(value, this.onDiagnostic),
      )
      return result.success ? result.data : null
    } catch (error) {
      if (error instanceof SyntaxError || isMissing(error)) return null
      throw error
    }
  }
}

function sanitizeRecord(record: PersistedRunRecord): PersistedRunRecord {
  const redactor = createSecretRedactor()
  if (record.version === 1) {
    const agents: Record<string, PersistedAgent> = {}
    for (const [agentId, agent] of Object.entries(record.agents)) {
      agents[agentId] = {
        sessionId: agent.sessionId,
        lastPrompt: redactor.redact(agent.lastPrompt).text,
        messageCount: agent.messageCount,
        status: agent.status,
      }
    }

    return {
      version: 1,
      runId: record.runId,
      cwd: resolve(record.cwd),
      gitBranch: record.gitBranch === null ? null : redactor.redact(record.gitBranch).text,
      focusedAgentId: record.focusedAgentId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      agents,
      handoffBundle: record.handoffBundle,
    }
  }

  const conversations: Record<string, PersistedConversationV2> = {}
  for (const [sessionId, conversation] of Object.entries(record.conversations)) {
    conversations[sessionId] = {
      sessionId: conversation.sessionId,
      providerKind: conversation.providerKind,
      cwd: resolve(conversation.cwd),
      initialTitle: redactor.redact(conversation.initialTitle).text,
      acpSessionId: conversation.acpSessionId,
      lastPrompt: redactor.redact(conversation.lastPrompt).text,
      messageCount: conversation.messageCount,
      status: conversation.status,
    }
  }
  const workspaceConversations: Record<string, PersistedWorkspaceConversationV2> = {}
  for (const [sessionId, conversation] of Object.entries(record.workspace.conversations)) {
    workspaceConversations[sessionId] = {
      sessionId: conversation.sessionId,
      displayName: redactor.redact(conversation.displayName).text,
      lifecycle: conversation.lifecycle,
      createdOrdinal: conversation.createdOrdinal,
      attention: { ...conversation.attention },
    }
  }

  const common = {
    runId: record.runId,
    cwd: resolve(record.cwd),
    gitBranch: record.gitBranch === null ? null : redactor.redact(record.gitBranch).text,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    conversations,
    workspace: {
      conversations: workspaceConversations,
      order: [...record.workspace.order],
      selectedVisibleId: record.workspace.selectedVisibleId,
    },
    handoffBundle: record.handoffBundle,
  }

  if (record.version === 2) return { version: 2, ...common }

  const harnessDeliveries: PersistedRunRecordV3["harnessDeliveries"] = {}
  for (const [sessionId, checkpoint] of Object.entries(record.harnessDeliveries)) {
    const decoded = HARNESS_DELIVERY_CHECKPOINT_SCHEMA.safeParse(checkpoint)
    if (!decoded.success) {
      throw new Error(`Invalid harness delivery checkpoint: ${decoded.error.message}`)
    }
    harnessDeliveries[sessionId] = decoded.data
  }
  if (record.version === 3) return { version: 3, ...common, harnessDeliveries }

  const contextPacks: PersistedRunRecordV4["contextPacks"] = {}
  for (const [sessionId, projection] of Object.entries(record.contextPacks)) {
    const decoded = PERSISTED_CONTEXT_PACK_SCHEMA.safeParse(projection)
    if (!decoded.success) throw new Error("Invalid persisted Context Pack projection")
    contextPacks[sessionId] = decoded.data
  }
  return { version: 4, ...common, harnessDeliveries, contextPacks }
}

function dropInvalidLoadedContextPacks(
  value: unknown,
  onDiagnostic: (diagnostic: RunStoreDiagnostic) => void,
): unknown {
  if (!isObject(value) || value.version !== 4 || !isObject(value.contextPacks)) return value

  const conversations = isObject(value.conversations) ? value.conversations : {}
  const contextPacks: PersistedRunRecordV4["contextPacks"] = {}
  let diagnostics = 0
  for (const [sessionId, projection] of Object.entries(value.contextPacks)) {
    const decoded = PERSISTED_CONTEXT_PACK_SCHEMA.safeParse(projection)
    if (decoded.success && sessionId in conversations) {
      contextPacks[sessionId] = decoded.data
      continue
    }
    if (diagnostics >= MAX_LOAD_DIAGNOSTICS_PER_RECORD) continue
    diagnostics += 1
    try {
      onDiagnostic({ code: "invalid_context_pack_projection" })
    } catch {
      // Diagnostics cannot make an otherwise recoverable run unreadable.
    }
  }
  return { ...value, contextPacks }
}

function toSummary(record: PersistedRunRecord): PersistedRunSummary | null {
  if (record.version === 1) {
    const focusedAgent = record.agents[record.focusedAgentId]
    if (!focusedAgent) return null
    return {
      runId: record.runId,
      updatedAt: record.updatedAt,
      gitBranch: record.gitBranch,
      focusedAgentId: record.focusedAgentId,
      lastPrompt: focusedAgent.lastPrompt,
      messageCount: focusedAgent.messageCount,
    }
  }

  const selectedId = record.workspace.selectedVisibleId
  const summaryId = selectedId ?? record.workspace.order[0]
  const conversation = summaryId === undefined ? undefined : record.conversations[summaryId]
  return {
    runId: record.runId,
    updatedAt: record.updatedAt,
    gitBranch: record.gitBranch,
    focusedAgentId: selectedId,
    lastPrompt: conversation?.lastPrompt ?? "",
    messageCount: conversation?.messageCount ?? 0,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertSafeRunId(runId: string): void {
  if (runId.length === 0 || runId === "." || runId === ".." || runId.includes("/") || runId.includes("\\")) {
    throw new Error(`Invalid run id: ${JSON.stringify(runId)}`)
  }
}

function isMissing(error: unknown): boolean {
  return isObject(error) && error.code === "ENOENT"
}
