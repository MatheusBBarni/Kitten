/**
 * Kitten's shared welcome surface for boot and the empty conversation state.
 *
 * The banner owns no session state: callers provide the agent readiness summary and
 * working directory, while the live terminal supplies only palette and width. The
 * mascot is deliberately plain ASCII so every cell has deterministic width and no
 * image or extended-Unicode capability is required.
 */

import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"

import { usePalette, type CockpitPalette } from "./theme.ts"

export const WELCOME_GREETING = "Welcome to Kitten."
export const WELCOME_ON_RAMP = "Type to start. Press ^T to hand off."
export const WELCOME_MASCOT_MIN_WIDTH = 52

/** Fixed-width, ASCII-only kitten cells. */
export const WELCOME_MASCOT = [" /\\_/\\", "( o.o )", " > ^ <"] as const

export type WelcomeAgentState = "connecting" | "ready" | "unavailable"

export interface WelcomeBannerProps {
  variant: "full" | "quiet"
  agents: { displayName: string; state: WelcomeAgentState }[]
  cwd: string
  /** Store-free boot roots pass their config-resolved palette explicitly. */
  palette?: CockpitPalette
}

/** The shared full/quiet banner used by the transient boot root and idle screen. */
export function WelcomeBanner({ palette, ...props }: WelcomeBannerProps): ReactNode {
  if (palette) return <WelcomeBannerContent {...props} palette={palette} />
  return <LiveWelcomeBanner {...props} />
}

/** Resolve the reactive cockpit palette only for mounts that have a controller store. */
function LiveWelcomeBanner(props: Omit<WelcomeBannerProps, "palette">): ReactNode {
  const palette = usePalette()
  return <WelcomeBannerContent {...props} palette={palette} />
}

/** Pure banner presentation shared by store-backed and store-free callers. */
function WelcomeBannerContent({
  variant,
  agents,
  cwd,
  palette,
}: Omit<WelcomeBannerProps, "palette"> & { palette: CockpitPalette }): ReactNode {
  const { width } = useTerminalDimensions()

  if (variant === "quiet" || width < WELCOME_MASCOT_MIN_WIDTH) {
    return <Greeting palette={palette} />
  }

  return (
    <box
      borderStyle="rounded"
      style={{
        width: "100%",
        flexDirection: "row",
        flexShrink: 0,
        gap: 2,
        border: true,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 1,
        paddingBottom: 1,
      }}
    >
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        {WELCOME_MASCOT.map((line) => (
          <text key={line} fg={palette.banner.mascot}>
            {line}
          </text>
        ))}
      </box>

      <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1 }}>
        <Greeting palette={palette} />

        {agents.map((agent, index) => (
          <text key={`${agent.displayName}-${index}`}>
            <span fg={palette.banner.detail}>{`${agent.displayName}: `}</span>
            <span fg={agentStateColor(palette, agent.state)}>{agent.state}</span>
          </text>
        ))}

        <text>
          <span fg={palette.banner.detail}>Working directory: </span>
          <span fg={palette.text}>{cwd}</span>
        </text>

        <text fg={palette.muted}>{WELCOME_ON_RAMP}</text>
      </box>
    </box>
  )
}

function Greeting({ palette }: { palette: CockpitPalette }): ReactNode {
  return (
    <text>
      <span fg={palette.text}>Welcome to </span>
      <span fg={palette.accent}>Kitten</span>
      <span fg={palette.text}>.</span>
    </text>
  )
}

function agentStateColor(palette: CockpitPalette, state: WelcomeAgentState): string {
  switch (state) {
    case "connecting":
      return palette.banner.detail
    case "ready":
      return palette.status.finished
    case "unavailable":
      return palette.status.not_ready
  }
}
