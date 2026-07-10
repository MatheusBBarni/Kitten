/**
 * Headless boot self-check for the compiled artifact (ADR-006).
 *
 * ADR-006 ships Kitten as a per-platform standalone binary, and its stated risk is
 * that OpenTUI's native (Zig) core, embedded via FFI, fails to load on a target.
 * This self-check exercises the whole boot pipeline inside the built binary without
 * a terminal and without spawning the user's agents: it loads the config, mounts the
 * cockpit into an in-memory renderer, and waits for a frame to paint. If the native
 * core cannot load, the render pass crashes here - in CI, on a real machine per
 * target - instead of in front of the first user.
 *
 * It never spawns the configured agents: a health check must not launch someone's
 * Claude Code or Codex subprocess. Every agent comes up "not ready", which is fine -
 * the status strip still paints each agent's name, which is the frame we assert on.
 */

import type { AgentConnection } from "../agent/agentConnection.ts"
import type { AgentConfig, AppConfig } from "../core/types.ts"
import { PROVIDER_KINDS } from "../core/types.ts"
import { loadAppConfig } from "../config/configLoader.ts"
import { cockpitElement } from "../ui/main.tsx"
import { createSessionController } from "./controller.ts"

/** What the self-check reports back to the CLI dispatcher. */
export interface SelfCheckResult {
  /** The captured frame that satisfied the wait predicate. */
  frame: string
}

/** Injectable seams so the self-check is unit-testable in-process. */
export interface SelfCheckDeps {
  /** How to load the config; defaults to reading it from disk. */
  loadConfig?: () => Promise<AppConfig>
  /** Renderer dimensions for the headless frame. */
  width?: number
  height?: number
}

/**
 * A connection that never spawns a process and always reports not-ready.
 *
 * The controller stops at the failed handshake, so `connect` is the only method it
 * calls; the rest exist to satisfy the interface and to make "this agent was never
 * started" an explicit, honest state rather than a thrown surprise.
 */
export function createOfflineConnection(config: AgentConfig): AgentConnection {
  return {
    id: config.id,
    async connect() {
      return { ready: false, error: "not started (boot self-check does not spawn agents)" }
    },
    async newSession() {
      throw new Error("offline connection has no session")
    },
    async prompt() {
      throw new Error("offline connection cannot prompt")
    },
    async cancel() {},
    async setSessionConfigOption() {
      throw new Error("offline connection cannot set config options")
    },
    onUpdate() {
      return () => {}
    },
    onPermission() {},
    async dispose() {},
  }
}

/**
 * Load the config, mount the cockpit headlessly, and wait for it to paint.
 *
 * Resolves with the frame that painted, or rejects if the render never produces the
 * expected frame (a broken native core, a mount error) - the CLI turns a rejection
 * into a non-zero exit so CI fails loudly per target.
 */
export async function runSelfCheck(deps: SelfCheckDeps = {}): Promise<SelfCheckResult> {
  const config = await (deps.loadConfig ?? loadAppConfig)()
  const controller = await createSessionController({ config, createConnection: createOfflineConnection })

  // Imported lazily so merely importing this module (and the entry point) allocates
  // nothing from the native render library - the smoke test guards that invariant.
  // `testRender` drives the React commit into the in-memory renderer, the same path
  // the UI integration tests trust; the frame it paints is the proof the native core
  // loaded and the cockpit reached first paint.
  const { testRender } = await import("@opentui/react/test-utils")
  const { renderer, waitForFrame } = await testRender(cockpitElement(controller), {
    width: deps.width ?? 80,
    height: deps.height ?? 24,
  })

  try {
    const marker = PROVIDER_KINDS.map((kind) => config.providers[kind]?.displayName).find(Boolean) ?? "Kitten"
    const frame = await waitForFrame((f) => f.includes(marker))
    return { frame }
  } finally {
    renderer.destroy()
    await controller.dispose()
  }
}
