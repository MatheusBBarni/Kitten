/**
 * First-run guidance (ADR-005 readiness, PRD onboarding).
 *
 * The onboarding budget is time-to-first-agent-response under 60 seconds, so a
 * first run that will not work must say exactly why before it drops the user into a
 * cockpit where nothing responds. Two things gate a working cockpit:
 *
 * 1. Kitten assumes the current directory is the project, so it must be run inside a
 *    repository (a directory tracked by git). Outside one there is nothing to work
 *    on and file references would be meaningless.
 * 2. At least one agent must have completed its ACP handshake. Each not-ready agent
 *    already carries a legible, actionable reason from the readiness check; the
 *    first-run flow surfaces those reasons verbatim rather than restating them.
 *
 * This module is pure: it turns a repo verdict plus per-agent setup states into a
 * report and display lines. The boot path decides what to do with a blocked report;
 * the filesystem probe {@link isInsideRepo} is the only side-effecting piece and is
 * kept behind an injectable seam so the guidance stays unit-testable.
 */

import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"

import type { ProviderKind } from "../core/types.ts"
import type { AgentReadiness } from "./readiness.ts"

/** The one-line reason Kitten refuses to run outside a repository. */
export const REPO_REQUIREMENT_MESSAGE =
  "Kitten must be run from inside a project directory. `cd` into a repository (a directory tracked by git) and start Kitten again."

/**
 * One agent's setup standing, reduced to what the guidance needs: is it ready, and
 * if not, the single message telling the user what to fix. Both a readiness verdict
 * (at boot pre-check) and a live runtime state (post-boot) map onto this shape.
 */
export interface AgentSetupState {
  agentId: ProviderKind
  displayName: string
  ready: boolean
  /** The setup gap to fix, present only when the agent is not ready. */
  gap?: string
}

/** The first-run verdict for the whole session. */
export interface FirstRunReport {
  /** Whether the working directory sits inside a repository. */
  insideRepo: boolean
  /** Per-agent setup standing, in config order. */
  agents: AgentSetupState[]
  /** Not-ready agents' gap messages, in config order - what the user must fix. */
  gaps: string[]
  /** Every agent completed its handshake. */
  allReady: boolean
  /** At least one agent is ready, so the cockpit is usable. */
  anyReady: boolean
  /**
   * Kitten cannot deliver a working cockpit: either it is outside a repository, or
   * no agent came up. The boot path refuses to launch when this is true.
   */
  blocked: boolean
}

/**
 * Build a setup state, keeping the {@link AgentSetupState} shape in one place so the
 * two boot paths that produce it (a readiness verdict pre-boot, a live runtime state
 * post-boot) cannot drift. `gap` is carried only when the agent is not ready.
 */
export function makeSetupState(agentId: ProviderKind, displayName: string, ready: boolean, gap?: string): AgentSetupState {
  if (ready) return { agentId, displayName, ready: true }
  return { agentId, displayName, ready: false, gap }
}

/** Reduce a readiness verdict (task_04) to the setup state the guidance consumes. */
export function readinessSetup(readiness: AgentReadiness): AgentSetupState {
  if (readiness.ready) return makeSetupState(readiness.agentId, readiness.displayName, true)
  return makeSetupState(readiness.agentId, readiness.displayName, false, readiness.message)
}

/**
 * Assemble the first-run report from the repo verdict and per-agent setup states.
 *
 * Blocked when outside a repository, or when no agent is ready - both leave the
 * cockpit unable to do useful work, so boot stops and shows {@link formatFirstRunReport}.
 */
export function buildFirstRunReport(input: {
  insideRepo: boolean
  agents: AgentSetupState[]
}): FirstRunReport {
  const { insideRepo, agents } = input
  const gaps = agents.filter((agent) => !agent.ready).map((agent) => agent.gap ?? `${agent.displayName}: not ready.`)
  const anyReady = agents.some((agent) => agent.ready)
  const allReady = agents.length > 0 && agents.every((agent) => agent.ready)
  return {
    insideRepo,
    agents,
    gaps,
    allReady,
    anyReady,
    blocked: !insideRepo || !anyReady,
  }
}

/**
 * Render the report as terminal-ready guidance lines.
 *
 * Only the blocking conditions and the concrete setup gaps are shown: the repo
 * requirement first (it must be fixed before anything else matters), then each
 * not-ready agent's own reason. When at least one agent is ready but another is not,
 * the lines still name the gap so the user can fix it without hunting.
 */
export function formatFirstRunReport(report: FirstRunReport): string[] {
  const lines: string[] = []
  if (!report.insideRepo) {
    lines.push(REPO_REQUIREMENT_MESSAGE)
    return lines
  }
  if (report.gaps.length > 0) {
    lines.push(
      report.anyReady
        ? "Some agents are not ready:"
        : "No agents are ready. Kitten needs at least one agent to start:",
    )
    for (const gap of report.gaps) lines.push(`  - ${gap}`)
    lines.push("Fix the setup above, then start Kitten again.")
  }
  return lines
}

/** Injectable seam so {@link isInsideRepo} is testable without touching the disk. */
export interface RepoProbeOptions {
  /** Whether a path exists; defaults to `existsSync`. */
  exists?: (path: string) => boolean
}

/**
 * Whether `cwd` sits inside a repository, by walking up to the filesystem root
 * looking for a `.git` entry.
 *
 * A `.git` can be a directory (an ordinary clone) or a file (a worktree or
 * submodule), so presence - not type - is the test. Walking up matches git's own
 * behavior: running Kitten from a subdirectory of a repo is still "inside the repo".
 */
export function isInsideRepo(cwd: string = process.cwd(), options: RepoProbeOptions = {}): boolean {
  const exists = options.exists ?? existsSync
  let dir = resolve(cwd)
  for (;;) {
    if (exists(`${dir}/.git`)) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}
