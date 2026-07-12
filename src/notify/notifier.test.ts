import { describe, expect, it } from "bun:test"

import { createAppStore, type AppStore } from "../store/appStore.ts"
import type { NotificationChannel, NotificationInput } from "./channel.ts"
import type { FocusSource, FocusState } from "./focus.ts"
import { createNotifier } from "./notifier.ts"

/** A channel that records every notification it is asked to deliver. */
function recordingChannel(): NotificationChannel & { calls: NotificationInput[] } {
  const calls: NotificationInput[] = []
  return { calls, notify: (input) => calls.push(input) }
}

/** A focus source pinned to a fixed state, as a test double for the renderer gate. */
function fixedFocus(state: FocusState): FocusSource {
  return { current: () => state }
}

/** A single-session store seeded with a title/cwd, starting idle. */
function soloStore(): AppStore {
  return createAppStore({
    seeds: [{ id: "a", providerKind: "claude-code", title: "Alpha", cwd: "/work/alpha" }],
  })
}

/** Wire a notifier over a store with recording seams; returns everything to assert on. */
function harness(store: AppStore, focus: FocusState) {
  const channel = recordingChannel()
  let bells = 0
  const notifier = createNotifier({ channel, focus: fixedFocus(focus), ringBell: () => bells++ })
  notifier.watch(store)
  return { channel, bells: () => bells }
}

describe("attention notifier", () => {
  it("fires exactly one bell and one channel call on a needy transition while unfocused", () => {
    const store = soloStore()
    const h = harness(store, "unfocused")

    store.applyEvent("a", { kind: "status", status: "working" })
    store.applyEvent("a", { kind: "status", status: "awaiting_approval" })

    expect(h.bells()).toBe(1)
    expect(h.channel.calls).toHaveLength(1)
  })

  it("fires neither the bell nor the channel while focused (in-app only)", () => {
    const store = soloStore()
    const h = harness(store, "focused")

    store.applyEvent("a", { kind: "status", status: "working" })
    store.applyEvent("a", { kind: "status", status: "awaiting_approval" })

    expect(h.bells()).toBe(0)
    expect(h.channel.calls).toHaveLength(0)
  })

  it("does not re-fire while a session stays in a needs-you state (per-session dedup)", () => {
    const store = soloStore()
    const h = harness(store, "unfocused")

    store.applyEvent("a", { kind: "status", status: "awaiting_approval" })
    // Further activity while still awaiting approval must not raise a second alert.
    store.applyEvent("a", { kind: "agent_message", messageId: "m1", textDelta: "thinking" })
    store.applyEvent("a", { kind: "status", status: "awaiting_approval" })

    expect(h.bells()).toBe(1)
    expect(h.channel.calls).toHaveLength(1)
  })

  it("still rings the bell when the channel's shell-out throws", () => {
    const store = soloStore()
    let bells = 0
    const throwingChannel: NotificationChannel = {
      notify: () => {
        throw new Error("osascript blew up")
      },
    }
    const notifier = createNotifier({ channel: throwingChannel, focus: fixedFocus("unfocused"), ringBell: () => bells++ })
    notifier.watch(store)

    expect(() => store.applyEvent("a", { kind: "status", status: "error" })).not.toThrow()
    expect(bells).toBe(1)
  })

  it("notifies on a needy transition when focus state is unknown (fallback)", () => {
    const store = soloStore()
    const h = harness(store, "unknown")

    store.applyEvent("a", { kind: "status", status: "finished" })

    expect(h.bells()).toBe(1)
    expect(h.channel.calls).toHaveLength(1)
  })

  it("passes only title, provider, cwd, and state to the channel - never prompt or transcript text", () => {
    const store = soloStore()
    const h = harness(store, "unfocused")

    // A prompt and streamed transcript precede the needy transition; none may leak.
    store.applyEvent("a", { kind: "agent_message", messageId: "m1", textDelta: "secret transcript text" })
    store.applyEvent("a", { kind: "status", status: "awaiting_approval" })

    expect(h.channel.calls).toHaveLength(1)
    const input = h.channel.calls[0]!
    expect(Object.keys(input).sort()).toEqual(["cwd", "provider", "state", "title"])
    expect(input).toEqual({ title: "Alpha", provider: "claude-code", cwd: "/work/alpha", state: "awaiting_approval" })
  })

  it("does not fire for a session already needy at boot (latch primed from initial state)", () => {
    const store = soloStore()
    store.applyEvent("a", { kind: "status", status: "awaiting_approval" })
    // The notifier subscribes only now, with the session already needy.
    const h = harness(store, "unfocused")

    // An unrelated change re-emits the list; the pre-existing needy session must stay quiet.
    store.applyEvent("a", { kind: "agent_message", messageId: "m1", textDelta: "more" })

    expect(h.bells()).toBe(0)
    expect(h.channel.calls).toHaveLength(0)
  })

  it("notifies a background transition once even when no Visible conversation is selected", () => {
    const store = createAppStore({
      seeds: [
        { id: "a", providerKind: "claude-code", title: "Alpha", cwd: "/work/alpha" },
        { id: "b", providerKind: "codex", title: "Bravo", cwd: "/work/bravo" },
      ],
      selectedVisibleId: "a",
    })
    store.backgroundConversation("a")
    store.backgroundConversation("b")
    const h = harness(store, "unfocused")

    store.applyEvent("b", { kind: "status", status: "working" })
    store.applyEvent("b", { kind: "status", status: "finished" })
    store.applyEvent("b", { kind: "status", status: "finished" })

    expect(store.getState().workspace.selectedVisibleId).toBeNull()
    expect(h.bells()).toBe(1)
    expect(h.channel.calls).toEqual([
      { title: "Bravo", provider: "codex", cwd: "/work/bravo", state: "finished" },
    ])
  })

  it("never notifies a Closed conversation", () => {
    const store = soloStore()
    const h = harness(store, "unfocused")

    store.removeSession("a")
    store.applyEvent("a", { kind: "status", status: "error" })

    expect(h.bells()).toBe(0)
    expect(h.channel.calls).toHaveLength(0)
  })
})
