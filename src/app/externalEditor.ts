export const EDITOR_FILE_PLACEHOLDER = "{file}"

/** A canonical regular-file target produced by the workspace explorer source. */
export interface OpenableFile {
  readonly kind: "openable-file"
  readonly absolutePath: string
}

/** Persistable direct-argv preference; task 04 owns config-schema validation. */
export type EditorPreference =
  | { readonly kind: "system-default" }
  | {
      readonly kind: "custom"
      readonly executable: string
      readonly args: readonly string[]
    }

/** Closed, content-free dispatch outcomes safe for notices and telemetry. */
export type EditorLaunchOutcome =
  | { readonly kind: "system-default-dispatched" }
  | { readonly kind: "custom-dispatched" }
  | { readonly kind: "fallback-dispatched" }
  | { readonly kind: "unsupported-platform" }
  | { readonly kind: "failed" }

export interface ExternalEditorLauncher {
  launch(file: OpenableFile, preference: EditorPreference): Promise<EditorLaunchOutcome>
}

export interface ExternalEditorSpawnProcess {
  readonly exited: Promise<number>
}

/** Direct process contract: intentionally has no shell or command-string field. */
export interface ExternalEditorSpawnOptions {
  readonly cmd: string[]
  readonly stdin: "ignore"
  readonly stdout: "ignore"
  readonly stderr: "ignore"
}

export type ExternalEditorSpawn = (
  options: ExternalEditorSpawnOptions,
) => ExternalEditorSpawnProcess

export interface CreateExternalEditorLauncherOptions {
  readonly spawn?: ExternalEditorSpawn
  readonly platform?: NodeJS.Platform
}

const spawnWithBun: ExternalEditorSpawn = (options) => Bun.spawn(options)

export function createExternalEditorLauncher(
  options: CreateExternalEditorLauncherOptions = {},
): ExternalEditorLauncher {
  const spawn = options.spawn ?? spawnWithBun
  const platform = options.platform ?? process.platform

  return {
    async launch(file, preference) {
      if (!isOpenableFile(file)) return failed()

      const defaultCommand = systemDefaultCommand(platform, file.absolutePath)
      if (!defaultCommand) return { kind: "unsupported-platform" }

      if (preference.kind === "system-default") {
        return (await dispatch(spawn, defaultCommand))
          ? { kind: "system-default-dispatched" }
          : failed()
      }

      const customCommand = customEditorCommand(preference, file.absolutePath)
      if (!customCommand) return failed()

      if (await dispatch(spawn, customCommand)) return { kind: "custom-dispatched" }
      return (await dispatch(spawn, defaultCommand))
        ? { kind: "fallback-dispatched" }
        : failed()
    },
  }
}

export const externalEditorLauncher = createExternalEditorLauncher()

function isOpenableFile(file: OpenableFile): boolean {
  return file.kind === "openable-file" && file.absolutePath.length > 0
}

function systemDefaultCommand(platform: NodeJS.Platform, filePath: string): string[] | null {
  if (platform === "darwin") return ["open", filePath]
  if (platform === "linux") return ["xdg-open", filePath]
  return null
}

function customEditorCommand(
  preference: Extract<EditorPreference, { readonly kind: "custom" }>,
  filePath: string,
): string[] | null {
  if (
    typeof preference.executable !== "string" ||
    preference.executable.trim().length === 0 ||
    !Array.isArray(preference.args) ||
    !preference.args.every((arg) => typeof arg === "string")
  ) {
    return null
  }

  let placeholderIndex = -1
  for (const [index, arg] of preference.args.entries()) {
    if (arg === EDITOR_FILE_PLACEHOLDER) {
      if (placeholderIndex !== -1) return null
      placeholderIndex = index
    } else if (arg.includes(EDITOR_FILE_PLACEHOLDER)) {
      return null
    }
  }
  if (placeholderIndex === -1) return null

  const args = [...preference.args]
  args[placeholderIndex] = filePath
  return [preference.executable, ...args]
}

async function dispatch(spawn: ExternalEditorSpawn, cmd: string[]): Promise<boolean> {
  try {
    const child = spawn({
      cmd,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    })
    return (await child.exited) === 0
  } catch {
    return false
  }
}

function failed(): EditorLaunchOutcome {
  return { kind: "failed" }
}
