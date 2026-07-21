/**
 * The layered attention notifier (ADR-007).
 *
 * Watches session-status transitions and reaches the developer when a session newly
 * needs them: it rings the terminal bell and fires a native OS notification, gated on
 * terminal focus, with the bell as the universal fallback. This is the part of the
 * multi-session feature that actually cuts idle time for an away developer, and it
 * stays content-free - the OS message is assembled only from the session's own title,
 * provider, directory, and state (never any prompt or transcript text).
 *
 * Three invariants, straight from the ADR:
 *
 * - **Fire once per transition into needs-you, per session.** A per-session boolean
 *   latch fires only on a non-needy -> needy edge; while the session stays needy
 *   (including moving between needs-you states) nothing repeats. The latch is primed
 *   from the store's initial state so a session that is already needy at boot never
 *   raises a spurious notification.
 * - **Focus gates the external channels.** While Kitten is focused the developer is
 *   looking straight at the cockpit, so a needy transition stays in-app only - neither
 *   the bell nor the OS channel fires. While unfocused, or while focus is unknown (the
 *   documented DECSET-1004 fallback), the bell rings and the OS channel fires.
 * - **The bell is the universal fallback.** In the notify path the bell always rings,
 *   and it rings before the OS channel, so a channel whose shell-out throws still
 *   leaves the developer alerted.
 */

import type { SessionId } from "../core/types.ts"
import type { AppStore, Unsubscribe } from "../store/appStore.ts"
import { selectSessionList, type SessionListItem } from "../store/selectors.ts"
import type { NotificationChannel } from "./channel.ts"
import type { FocusSource } from "./focus.ts"

/** Ring the terminal bell by writing BEL. Injectable so a test never touches stdout. */
export type RingBell = () => void

/** The default bell: write BEL to stdout. Most terminals alert or badge on this. */
const writeBell: RingBell = () => {
  process.stdout.write("\x07")
}

/** The notifier surface: subscribe it to a store and it fires on needs-you transitions. */
export interface Notifier {
  /**
   * Subscribe to the store and fire on each transition into a needs-you state. Returns
   * an unsubscribe.
   */
  watch(store: AppStore): Unsubscribe
}

/** Construction seams. `channel` and `focus` are required; `ringBell` has a real default. */
export interface NotifierOptions {
  /** Where OS notifications go. The default per-OS shell-out, or an injected fake. */
  channel: NotificationChannel
  /** How Kitten's terminal focus is read, to gate the external channels. */
  focus: FocusSource
  /** How the bell is rung. Defaults to writing BEL to stdout. */
  ringBell?: RingBell
}

/** Build an attention notifier over a channel, a focus source, and a bell. */
export function createNotifier(options: NotifierOptions): Notifier {
  return new AttentionNotifier(options)
}

class AttentionNotifier implements Notifier {
  private readonly channel: NotificationChannel
  private readonly focus: FocusSource
  private readonly ringBell: RingBell
  /** Per-session needy latch: true while the session is currently in a needs-you state. */
  private readonly needy = new Map<SessionId, boolean>()

  constructor(options: NotifierOptions) {
    this.channel = options.channel
    this.focus = options.focus
    this.ringBell = options.ringBell ?? writeBell
  }

  watch(store: AppStore): Unsubscribe {
    // Prime the latch from the initial state so a session already needy at boot does
    // not fire on the first transition of an unrelated session.
    for (const item of selectSessionList(store.getState())) {
      this.needy.set(item.id, item.needsAttention)
    }
    return store.subscribeSelector(selectSessionList, (list) => {
      for (const item of list) {
        const wasNeedy = this.needy.get(item.id) ?? false
        this.needy.set(item.id, item.needsAttention)
        if (!wasNeedy && item.needsAttention) this.fire(item)
      }
    })
  }

  /** Alert on one non-needy -> needy transition, honoring the focus gate. */
  private fire(item: SessionListItem): void {
    // Focused: the developer is on the cockpit; the status strip is the notification.
    if (this.focus.current() === "focused") return

    // Unfocused or unknown: ring the bell first so a failing channel still alerts.
    this.ringBell()
    try {
      this.channel.notify({
        title: item.title,
        provider: item.providerKind,
        cwd: item.cwd,
        state: item.status,
      })
    } catch {
      // Best-effort OS channel: the bell already rang.
    }
  }
}
