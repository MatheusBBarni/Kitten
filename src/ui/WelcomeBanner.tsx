/**
 * Kitten's shared welcome surface for boot and the empty conversation state.
 *
 * The banner owns no session state: callers provide the agent readiness summary and
 * working directory, while the live terminal supplies only palette and width. The
 * wordmark is deliberately plain ASCII so every cell has deterministic width and no
 * image or extended-Unicode capability is required. Returning launches retain a
 * compact wordmark too, so the product is recognizably Kitten without bringing back
 * the full connection and directory summary.
 */

import { useTerminalDimensions } from "@opentui/react"
import type { ReactNode } from "react"

import { usePalette, type CockpitPalette } from "./theme.ts"

export const WELCOME_GREETING = "Welcome to Kitten."
export const WELCOME_ON_RAMP = "Type to start. Use /help for commands."
export const WELCOME_WORDMARK_MIN_WIDTH = 64

/** Fixed-width, ASCII-only Kitten wordmark cells. */
export const WELCOME_WORDMARK = [
  "K   K  III  TTTTT  TTTTT  EEEEE  N   N",
  "KK KK   I     T      T    E      NN  N",
  "K   K  III    T      T    EEEEE  N   N",
] as const

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

  if (width < WELCOME_WORDMARK_MIN_WIDTH) {
    return <Greeting palette={palette} />
  }

  if (variant === "quiet") {
    return (
      <box style={{ flexDirection: "column", flexShrink: 0 }}>
        <Wordmark palette={palette} />
        <Greeting palette={palette} />
      </box>
    )
  }

  return (
    <box
      borderStyle="rounded"
      style={{
        width: "100%",
        flexDirection: "column",
        flexShrink: 0,
        border: true,
        borderColor: palette.border,
        backgroundColor: palette.surface,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 1,
        paddingBottom: 1,
      }}
    >
      <Wordmark palette={palette} />

      <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1 }}>
        <Greeting palette={palette} />

        {agents.length > 0 ? (
          <text>
            <span fg={palette.banner.detail}>Agents: </span>
            {agents.map((agent, index) => (
              <span key={`${agent.state}-${index}`} fg={agentStateColor(palette, agent.state)}>
                {`${index === 0 ? "" : " · "}${agent.state}`}
              </span>
            ))}
          </text>
        ) : null}

        <text>
          <span fg={palette.banner.detail}>Working directory: </span>
          <span fg={palette.text}>{cwd}</span>
        </text>

        <text fg={palette.muted}>{WELCOME_ON_RAMP}</text>
      </box>
    </box>
  )
}

/** The same ANSI-safe wordmark in full and compact welcome variants. */
function Wordmark({ palette }: { palette: CockpitPalette }): ReactNode {
  return (
    <box style={{ flexDirection: "column", flexShrink: 0 }}>
      {WELCOME_WORDMARK.map((line) => (
        <text key={line} fg={palette.banner.mascot}>
          {line}
        </text>
      ))}
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
