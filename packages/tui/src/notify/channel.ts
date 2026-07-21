/**
 * The native OS notification channel (ADR-007).
 *
 * Delivers a content-free desktop notification by shelling out to a tool that already
 * ships with the platform - `osascript` on macOS, `notify-send` on Linux, a PowerShell
 * toast on Windows - so Kitten reaches an away developer natively while adding no
 * dependency. The channel is deliberately best-effort: a missing tool or a blocked
 * shell-out is swallowed here, and the notifier still rings the terminal bell.
 *
 * The security posture from ADR-007 is load-bearing. The command is assembled only
 * from the session's own title, provider, working directory, and state - never any
 * prompt or transcript content - and every string is passed as a spawn argument (no
 * shell), with the one interpolated surface (the AppleScript / PowerShell literal)
 * escaped. {@link buildNotificationCommand} is a pure function so the per-OS command
 * shape is unit-testable without spawning anything.
 */

import type { ProviderKind, SessionStatus } from "../core/types.ts"

/** The content-free payload a notification carries. Assembled from session metadata only. */
export interface NotificationInput {
  /** The session's display title. */
  title: string
  /** Which provider kind is running the session. */
  provider: ProviderKind
  /** The session's working directory. */
  cwd: string
  /** The needs-you state the session just entered. */
  state: SessionStatus
}

/**
 * The injectable notification seam the notifier drives. The default is the per-OS
 * shell-out; tests inject a recording fake so no real notification is raised.
 */
export interface NotificationChannel {
  /** Deliver one notification, best-effort. Implementations must not throw. */
  notify(input: NotificationInput): void
}

/** A resolved shell-out: the executable and its argument vector (no shell involved). */
export interface OsCommand {
  file: string
  args: string[]
}

/** Runs a resolved command, best-effort. The default spawns via `Bun.spawn`. */
export type CommandRunner = (command: OsCommand) => void

/**
 * The notification body - a single content-free line built from the session's own
 * metadata. No prompt or transcript text ever reaches here.
 */
function formatBody(input: NotificationInput): string {
  return `${input.provider} · ${input.state} · ${input.cwd}`
}

/** Escape a string for embedding inside an AppleScript double-quoted literal. */
function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/** Escape a string for embedding inside a PowerShell single-quoted literal. */
function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Build the per-OS notification command for a platform, or `null` when the platform
 * has no supported built-in tool. Pure: the same platform and input always yield the
 * same command, so every branch is testable without spawning.
 */
export function buildNotificationCommand(
  platform: NodeJS.Platform,
  input: NotificationInput,
): OsCommand | null {
  const body = formatBody(input)
  switch (platform) {
    case "darwin": {
      const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(input.title)}"`
      return { file: "osascript", args: ["-e", script] }
    }
    case "linux":
      // notify-send takes summary and body as separate arguments - no interpolation.
      return { file: "notify-send", args: [input.title, body] }
    case "win32": {
      const title = escapePowerShell(input.title)
      const text = escapePowerShell(body)
      const script = [
        "$ErrorActionPreference='Stop'",
        "[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] > $null",
        "$template=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
        "$nodes=$template.GetElementsByTagName('text')",
        `$nodes.Item(0).AppendChild($template.CreateTextNode('${title}')) > $null`,
        `$nodes.Item(1).AppendChild($template.CreateTextNode('${text}')) > $null`,
        "$toast=[Windows.UI.Notifications.ToastNotification]::new($template)",
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Kitten').Show($toast)",
      ].join("; ")
      return { file: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", script] }
    }
    default:
      return null
  }
}

/** The default runner: fire-and-forget `Bun.spawn`, output discarded. */
function spawnCommand(command: OsCommand): void {
  const child = Bun.spawn({
    cmd: [command.file, ...command.args],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  // Detach: the notification is fire-and-forget and must not keep the process alive.
  child.unref()
}

/** Construction seams for {@link createOsNotificationChannel}. */
export interface OsNotificationChannelOptions {
  /** The platform to build the command for. Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** How to run the resolved command. Defaults to a detached `Bun.spawn`. */
  run?: CommandRunner
}

/**
 * The per-OS native notification channel. Resolves the command for the platform and
 * runs it best-effort: an unsupported platform, a missing tool, or a failing spawn is
 * swallowed here so the notifier's bell fallback always still fires.
 */
export function createOsNotificationChannel(options: OsNotificationChannelOptions = {}): NotificationChannel {
  const platform = options.platform ?? process.platform
  const run = options.run ?? spawnCommand
  return {
    notify(input: NotificationInput): void {
      const command = buildNotificationCommand(platform, input)
      if (!command) return
      try {
        run(command)
      } catch {
        // Best-effort: a failed shell-out is expected on locked-down hosts. The
        // notifier still rings the bell, which is the universal fallback.
      }
    },
  }
}
