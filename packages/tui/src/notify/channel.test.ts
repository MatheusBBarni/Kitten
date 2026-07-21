import { describe, expect, it } from "bun:test"

import {
  buildNotificationCommand,
  createOsNotificationChannel,
  type NotificationInput,
  type OsCommand,
} from "./channel.ts"

const INPUT: NotificationInput = {
  title: "Payments API",
  provider: "claude-code",
  cwd: "/work/payments",
  state: "awaiting_approval",
}

describe("buildNotificationCommand", () => {
  it("shells out to osascript on macOS with title and body in the AppleScript", () => {
    const command = buildNotificationCommand("darwin", INPUT)
    expect(command?.file).toBe("osascript")
    expect(command?.args[0]).toBe("-e")
    const script = command?.args[1] ?? ""
    expect(script).toContain("display notification")
    expect(script).toContain(INPUT.title)
    expect(script).toContain(INPUT.cwd)
    expect(script).toContain(INPUT.state)
  })

  it("shells out to notify-send on Linux with summary and body as separate arguments", () => {
    const command = buildNotificationCommand("linux", INPUT)
    expect(command).toEqual({
      file: "notify-send",
      args: [INPUT.title, `${INPUT.provider} · ${INPUT.state} · ${INPUT.cwd}`],
    })
  })

  it("shells out to a PowerShell toast on Windows carrying title and body", () => {
    const command = buildNotificationCommand("win32", INPUT)
    expect(command?.file).toBe("powershell")
    expect(command?.args).toContain("-Command")
    const script = command?.args.at(-1) ?? ""
    expect(script).toContain("ToastNotification")
    expect(script).toContain(INPUT.title)
    expect(script).toContain(INPUT.cwd)
  })

  it("returns null on an unsupported platform", () => {
    expect(buildNotificationCommand("aix", INPUT)).toBeNull()
  })

  it("carries only session metadata - title, provider, cwd, state - never other text", () => {
    // A title bearing quotes and backslashes must be escaped into the AppleScript
    // literal, not interpolated raw (ADR-007 security posture).
    const command = buildNotificationCommand("darwin", { ...INPUT, title: 'a "quote" and \\slash' })
    const script = command?.args[1] ?? ""
    expect(script).toContain('\\"quote\\"')
    expect(script).toContain("\\\\slash")
  })
})

describe("createOsNotificationChannel", () => {
  it("runs the resolved command for the detected platform", () => {
    const ran: OsCommand[] = []
    const channel = createOsNotificationChannel({ platform: "linux", run: (command) => ran.push(command) })
    channel.notify(INPUT)
    expect(ran).toHaveLength(1)
    expect(ran[0]?.file).toBe("notify-send")
  })

  it("is a no-op on an unsupported platform - it never runs a command", () => {
    let runs = 0
    const channel = createOsNotificationChannel({ platform: "aix", run: () => runs++ })
    channel.notify(INPUT)
    expect(runs).toBe(0)
  })

  it("swallows a failing shell-out so notify() never throws (best-effort)", () => {
    const channel = createOsNotificationChannel({
      platform: "darwin",
      run: () => {
        throw new Error("osascript not found")
      },
    })
    expect(() => channel.notify(INPUT)).not.toThrow()
  })
})
