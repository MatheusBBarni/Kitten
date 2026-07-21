import { describe, expect, it } from "bun:test"

import { createOsNotificationChannel, type OsCommand } from "../src/notify/channel.ts"
import type { FocusSource } from "../src/notify/focus.ts"
import { createNotifier } from "../src/notify/notifier.ts"
import { createAppStore } from "../src/store/appStore.ts"

/**
 * Integration: a mock session driven into a needs-you state while the app is unfocused
 * flows all the way through the real store, the notifier's focus gate, and the per-OS
 * channel to a single resolved shell-out command carrying only session metadata.
 */
describe("attention notifier (integration)", () => {
  it("raises exactly one native notification carrying the session's title, directory, and state", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "Alpha", cwd: "/work/alpha" },
        { id: "b", providerKind: "codex", title: "Bravo", cwd: "/work/bravo" },
      ],
    })

    const commands: OsCommand[] = []
    const unfocused: FocusSource = { current: () => "unfocused" }
    let bells = 0
    const notifier = createNotifier({
      // Real channel, but with a captured runner so nothing actually spawns.
      channel: createOsNotificationChannel({ platform: "linux", run: (command) => commands.push(command) }),
      focus: unfocused,
      ringBell: () => bells++,
    })
    notifier.watch(store)

    // Drive session B through work into an error; A never moves.
    store.applyEvent("b", { kind: "status", status: "working" })
    store.applyEvent("b", { kind: "status", status: "error" })

    expect(bells).toBe(1)
    expect(commands).toHaveLength(1)

    const command = commands[0]!
    expect(command.file).toBe("notify-send")
    const rendered = command.args.join(" ")
    expect(rendered).toContain("Bravo") // title
    expect(rendered).toContain("/work/bravo") // directory
    expect(rendered).toContain("error") // state
    expect(rendered).not.toContain("Alpha") // the untouched session is not mentioned
  })

  it("routes one content-free alert from background work with an empty Visible workspace", () => {
    const store = createAppStore({
      seeds: [{ id: "a", providerKind: "codex", title: "Background", cwd: "/work/background" }],
      selectedVisibleId: "a",
    })
    store.backgroundConversation("a")
    const commands: OsCommand[] = []
    let bells = 0
    createNotifier({
      channel: createOsNotificationChannel({ platform: "linux", run: (command) => commands.push(command) }),
      focus: { current: () => "unfocused" },
      ringBell: () => bells++,
    }).watch(store)

    store.applyEvent("a", { kind: "status", status: "awaiting_approval" })

    expect(store.getState().workspace.selectedVisibleId).toBeNull()
    expect(bells).toBe(1)
    expect(commands).toHaveLength(1)
    expect(commands[0]?.args.join(" ")).not.toContain("prompt")
  })
})
