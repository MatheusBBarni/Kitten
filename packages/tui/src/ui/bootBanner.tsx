/**
 * Transient, store-free welcome root used while the session controller connects.
 *
 * Boot does not have an app store yet. This helper therefore accepts only resolved
 * configuration data, owns exactly one short-lived React root, and hands callers an
 * idempotent disposer so the cockpit can become the renderer's sole live tree.
 */

import type { CliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

import { bannerVariant } from "../config/appState.ts"
import type { ThemePreference, WelcomeBannerPreference } from "../core/types.ts"
import { resolvePalette } from "./theme.ts"
import { WelcomeBanner, type WelcomeBannerProps } from "./WelcomeBanner.tsx"

export interface BootBannerOptions {
  preference: WelcomeBannerPreference
  theme: ThemePreference
  firstRunSeen: boolean
  agents: WelcomeBannerProps["agents"]
  cwd: string
}

export type BootBannerDisposer = () => void

/** Mount the configured welcome variant and return an idempotent root disposer. */
export function renderBootBanner(renderer: CliRenderer, options: BootBannerOptions): BootBannerDisposer {
  const variant = bannerVariant(options.preference, options.firstRunSeen)
  if (variant === "none") return () => {}

  const root = createRoot(renderer)
  const palette = resolvePalette(options.theme, renderer.themeMode ?? "dark")
  root.render(<WelcomeBanner variant={variant} agents={options.agents} cwd={options.cwd} palette={palette} />)

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    root.unmount()
  }
}
