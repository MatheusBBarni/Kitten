/**
 * Fail-soft git branch discovery for status-bar data (ADR-007).
 *
 * The reader performs I/O only when a caller explicitly invokes it. Task 09 owns
 * those boot and turn-boundary calls; render code must never call this module.
 */

/** The subprocess surface the reader needs, kept small for injected test fakes. */
export interface GitSpawnProcess {
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
}

/** The fixed spawn contract used for every git command. */
export interface GitSpawnOptions {
  readonly cmd: string[]
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly stdin: "ignore"
  readonly stdout: "pipe"
  readonly stderr: "ignore"
}

/** Injectable subprocess seam; production delegates to `Bun.spawn`. */
export type GitSpawn = (options: GitSpawnOptions) => GitSpawnProcess

export interface ReadGitBranchOptions {
  /** Subprocess implementation; defaults to `Bun.spawn`. */
  spawn?: GitSpawn
  /** Additional environment values merged over the current process environment. */
  env?: Record<string, string | undefined>
}

const spawnWithBun: GitSpawn = (options) => Bun.spawn(options)

/**
 * Return the attached branch, detached short SHA, or `null` when git cannot
 * describe `cwd`. Expected subprocess and stream failures never escape.
 */
export async function readGitBranch(
  cwd: string,
  options: ReadGitBranchOptions = {},
): Promise<string | null> {
  const spawn = options.spawn ?? spawnWithBun
  const env = { ...process.env, ...options.env }

  const branch = await readGitOutput(spawn, cwd, env, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch === null) return null
  if (branch !== "HEAD") return branch

  return readGitOutput(spawn, cwd, env, ["rev-parse", "--short", "HEAD"])
}

async function readGitOutput(
  spawn: GitSpawn,
  cwd: string,
  env: Record<string, string | undefined>,
  args: string[],
): Promise<string | null> {
  try {
    const proc = spawn({
      cmd: ["git", ...args],
      cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    })
    const [exitCode, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
    if (exitCode !== 0) return null

    const value = stdout.trim()
    return value || null
  } catch {
    return null
  }
}
