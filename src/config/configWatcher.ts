import { mkdirSync, watch, type FSWatcher } from "node:fs"
import { basename, dirname } from "node:path"

import type { AppConfig } from "../core/types.ts"
import { loadAppConfig, resolveConfigPath } from "./configLoader.ts"

const DEFAULT_DEBOUNCE_MS = 100

export interface ConfigWatcher {
  close(): void
}

export interface WatchUserConfigOptions {
  /** Explicit config-file path; defaults to {@link resolveConfigPath}. */
  path?: string
  /** Environment consulted by {@link resolveConfigPath} when `path` is omitted. */
  env?: Record<string, string | undefined>
  /** Quiet period before a filesystem-event burst reloads the config. */
  debounceMs?: number
}

/**
 * Watch the user config and report each successfully reloaded configuration.
 *
 * The target file catches in-place writes while its parent directory keeps atomic
 * rename replacements observable after the original inode is detached. Events are
 * only scheduling signals: the callback always receives a fresh
 * {@link loadAppConfig} result after the burst settles. A transient read or parse
 * failure is ignored until a later event.
 */
export function watchUserConfig(
  onConfig: (config: AppConfig) => void,
  options: WatchUserConfigOptions = {},
): ConfigWatcher {
  const path = options.path ?? resolveConfigPath(options.env)
  const directory = dirname(path)
  const targetName = basename(path)
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS

  mkdirSync(directory, { recursive: true })

  let closed = false
  let eventGeneration = 0
  let reloadTimer: ReturnType<typeof setTimeout> | undefined

  const reload = async (generation: number): Promise<void> => {
    let config: AppConfig
    try {
      config = await loadAppConfig({ path })
    } catch {
      return
    }

    if (!closed && generation === eventGeneration) onConfig(config)
  }

  const scheduleReload = (): void => {
    const generation = ++eventGeneration
    if (reloadTimer !== undefined) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = undefined
      void reload(generation)
    }, debounceMs)
  }

  let targetWatcher: FSWatcher | undefined
  const attachTargetWatcher = (): void => {
    targetWatcher?.close()
    targetWatcher = undefined
    if (closed) return

    try {
      const watcher = watch(path, { persistent: false }, (eventType) => {
        if (closed) return
        if (eventType === "change") {
          scheduleReload()
          return
        }
        if (eventType === "rename" && targetWatcher === watcher) {
          watcher.close()
          targetWatcher = undefined
        }
      })
      targetWatcher = watcher
    } catch {
      // A missing optional config can still be observed when the directory reports its creation.
    }
  }

  const directoryWatcher = watch(directory, { persistent: false }, (eventType, filename) => {
    if (closed || (eventType !== "change" && eventType !== "rename")) return
    if (filename !== null && filename.toString() !== targetName) return

    if (eventType === "rename" || targetWatcher === undefined) {
      attachTargetWatcher()
      scheduleReload()
    }
  })
  attachTargetWatcher()

  return {
    close(): void {
      if (closed) return
      closed = true
      ++eventGeneration
      if (reloadTimer !== undefined) {
        clearTimeout(reloadTimer)
        reloadTimer = undefined
      }
      targetWatcher?.close()
      targetWatcher = undefined
      directoryWatcher.close()
    },
  }
}
