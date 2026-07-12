import type { HandoffBundle, SessionId, SessionStatus } from "../core/types.ts"

/** The per-session pointer and light metadata stored for one cockpit run. */
export interface PersistedAgent {
  sessionId: string
  lastPrompt: string
  messageCount: number
  status: SessionStatus
}

/**
 * The complete on-disk contract for one cockpit run.
 *
 * Transcripts and reducer-derived session fields deliberately do not belong here;
 * restore replays them from each agent's own session store.
 */
export interface PersistedRunRecord {
  version: 1
  runId: string
  cwd: string
  gitBranch: string | null
  focusedAgentId: SessionId
  createdAt: number
  updatedAt: number
  agents: Record<SessionId, PersistedAgent>
  handoffBundle: HandoffBundle | null
}

/** The project-picker projection of a persisted run. */
export interface PersistedRunSummary {
  runId: string
  updatedAt: number
  gitBranch: string | null
  focusedAgentId: SessionId
  lastPrompt: string
  messageCount: number
}
